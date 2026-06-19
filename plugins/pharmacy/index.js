// ============================================================
// Plugin: Pharmacy v3 (الصيدليات)
// Barcode | Batches | Expiry Alerts | Min-Stock | POS
// ============================================================
'use strict';
const express = require('express');
const { supabaseAdmin } = require('../../core/src/db/client');
const { authMiddleware } = require('../../core/src/middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware(['tenant_admin','accountant','cashier','staff']));

const meta = {
  key: 'pharmacy', version: '3.0.0',
  name_ar: 'الصيدليات', name_en: 'Pharmacy Management',
  tables: ['ph_batches','ph_sales','ph_sale_lines'],
  permissions: ['read','write','delete','print','export'],
};

// ── Dashboard ──────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const tid = req.tenantId;
  const today = new Date().toISOString().split('T')[0];
  const warn90 = new Date(); warn90.setDate(warn90.getDate()+90);
  const warn30 = new Date(); warn30.setDate(warn30.getDate()+30);

  const [{ data: exp90 }, { data: exp30 }, { data: todaySales }, { data: lowStockRaw }] = await Promise.all([
    supabaseAdmin.from('ph_batches').select('id').eq('tenant_id',tid).gt('qty_on_hand',0).lte('expiry_date',warn90.toISOString().split('T')[0]).gt('expiry_date',today),
    supabaseAdmin.from('ph_batches').select('id').eq('tenant_id',tid).gt('qty_on_hand',0).lte('expiry_date',warn30.toISOString().split('T')[0]).gt('expiry_date',today),
    supabaseAdmin.from('ph_sales').select('total').eq('tenant_id',tid).eq('sale_date',today),
    // PostgREST can't compare quantity <= items.min_stock (column-to-column) via .filter(),
    // so we fetch candidates (min_stock > 0 is a valid literal comparison) and filter in JS.
    supabaseAdmin.from('stock_balances').select('quantity,items!inner(min_stock,name_ar)').eq('tenant_id',tid).gt('items.min_stock',0),
  ]);
  const lowStock = (lowStockRaw||[]).filter(r => (+r.quantity||0) <= (+r.items.min_stock||0));

  res.json({
    alerts: { expiring_90: exp90?.length||0, expiring_30: exp30?.length||0, low_stock: lowStock?.length||0 },
    today_revenue: (todaySales||[]).reduce((s,x)=>s+(+x.total||0),0),
  });
});

// ── Batches (stock with expiry & lot tracking) ──────────────
router.get('/batches', async (req, res) => {
  const { item_id, expiring_days, page=1, limit=50 } = req.query;
  const off = (page-1)*limit;
  const today = new Date().toISOString().split('T')[0];

  let q = supabaseAdmin.from('ph_batches')
    .select('*,items(name_ar,code,unit),suppliers:stakeholders(name_ar)', { count:'exact' })
    .eq('tenant_id',req.tenantId).eq('is_active',true)
    .order('expiry_date',{ascending:true}).range(off,off+limit-1);

  if (item_id)       q = q.eq('item_id',item_id);
  if (expiring_days) {
    const t = new Date(); t.setDate(t.getDate()+parseInt(expiring_days));
    q = q.lte('expiry_date',t.toISOString().split('T')[0]);
  }

  const { data, count, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const enriched = (data||[]).map(b => ({
    ...b,
    days_to_expiry: Math.ceil((new Date(b.expiry_date)-new Date())/86400000),
    expiry_status: (() => {
      const d = Math.ceil((new Date(b.expiry_date)-new Date())/86400000);
      return d < 0 ? 'expired' : d<=30 ? 'critical' : d<=90 ? 'warning' : 'ok';
    })(),
  }));

  res.json({ data: enriched, total: count });
});

router.post('/batches', async (req, res) => {
  const batch = { ...req.body, tenant_id: req.tenantId, qty_on_hand: req.body.qty_in||0 };
  const { data, error } = await supabaseAdmin.from('ph_batches').insert(batch).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/batches/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('ph_batches').update(req.body).eq('id',req.params.id).eq('tenant_id',req.tenantId).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// ── Barcode lookup ─────────────────────────────────────────
router.get('/barcode/:barcode', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('ph_batches')
    .select('*,items(name_ar,code,unit,sale_price)')
    .eq('tenant_id',req.tenantId).eq('barcode',req.params.barcode)
    .gt('qty_on_hand',0).order('expiry_date',{ascending:true}).limit(1).single();
  if (error||!data) return res.status(404).json({ error: 'الباركود غير موجود أو الصنف نفد من المخزون' });
  res.json(data);
});

// ── POS Sales ──────────────────────────────────────────────
router.get('/sales', async (req, res) => {
  const { date_from, date_to, page=1, limit=50 } = req.query;
  const off = (page-1)*limit;
  let q = supabaseAdmin.from('ph_sales')
    .select('*,stakeholders(name_ar)', {count:'exact'})
    .eq('tenant_id',req.tenantId).order('sale_date',{ascending:false}).range(off,off+limit-1);
  if (date_from) q=q.gte('sale_date',date_from);
  if (date_to)   q=q.lte('sale_date',date_to);
  const { data, count } = await q;
  res.json({ data, total: count });
});

router.post('/sales', async (req, res) => {
  const { lines=[], customer_id, cashbox_id, discount=0, payment_method='cash' } = req.body;
  if (!lines.length) return res.status(400).json({ error: 'لا توجد أصناف في الفاتورة' });

  const { count } = await supabaseAdmin.from('ph_sales').select('*',{count:'exact',head:true}).eq('tenant_id',req.tenantId);
  const num = `PH-${new Date().getFullYear()}-${String((count||0)+1).padStart(5,'0')}`;
  const subtotal = lines.reduce((s,l)=>s+(l.quantity*l.unit_price),0);
  const total = subtotal - discount;

  const { data: sale, error } = await supabaseAdmin.from('ph_sales').insert({
    tenant_id:req.tenantId, invoice_number:num,
    sale_date: new Date().toISOString().split('T')[0],
    customer_id:customer_id||null, cashbox_id:cashbox_id||null,
    subtotal, discount, total, payment_method, created_by:req.user?.id,
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });

  await supabaseAdmin.from('ph_sale_lines').insert(
    lines.map((l,i)=>({ tenant_id:req.tenantId, sale_id:sale.id, item_id:l.item_id, batch_id:l.batch_id||null, quantity:l.quantity, unit_price:l.unit_price, discount:l.discount||0, line_total:l.quantity*l.unit_price-(l.discount||0), line_order:i }))
  );

  // Deduct batch stock
  for (const l of lines) {
    if (l.batch_id) {
      const { data: b } = await supabaseAdmin.from('ph_batches').select('qty_on_hand').eq('id',l.batch_id).single();
      await supabaseAdmin.from('ph_batches').update({ qty_on_hand: Math.max(0,(b?.qty_on_hand||0)-l.quantity) }).eq('id',l.batch_id);
    }
  }
  res.status(201).json(sale);
});

router.delete('/sales/:id', async (req, res) => {
  await supabaseAdmin.from('ph_sale_lines').delete().eq('sale_id',req.params.id).eq('tenant_id',req.tenantId);
  await supabaseAdmin.from('ph_sales').delete().eq('id',req.params.id).eq('tenant_id',req.tenantId);
  res.json({ success: true });
});

// ── Alerts ─────────────────────────────────────────────────
router.get('/alerts', async (req, res) => {
  const days = parseInt(req.query.days)||90;
  const threshold = new Date(); threshold.setDate(threshold.getDate()+days);
  const today = new Date().toISOString().split('T')[0];

  const [{ data: expiry }, { data: lowStockRaw }] = await Promise.all([
    supabaseAdmin.from('ph_batches').select('*,items(name_ar,code,unit)').eq('tenant_id',req.tenantId).gt('qty_on_hand',0).lte('expiry_date',threshold.toISOString().split('T')[0]).gt('expiry_date',today).order('expiry_date'),
    // PostgREST can't compare quantity <= items.min_stock via .filter(); filter in JS instead.
    supabaseAdmin.from('stock_balances').select('quantity,items!inner(name_ar,code,unit,min_stock)').eq('tenant_id',req.tenantId).gt('items.min_stock',0),
  ]);
  const lowStock = (lowStockRaw||[]).filter(r => (+r.quantity||0) <= (+r.items.min_stock||0));

  res.json({
    expiry: (expiry||[]).map(b=>({...b,days_left:Math.ceil((new Date(b.expiry_date)-new Date())/86400000)})),
    low_stock: lowStock||[],
  });
});

// ── Plugin DB Migration SQL ─────────────────────────────────
const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS ph_batches (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id      UUID NOT NULL REFERENCES items(id),
  barcode      VARCHAR(200),
  lot_number   VARCHAR(100),
  expiry_date  DATE NOT NULL,
  qty_in       DECIMAL(18,4) DEFAULT 0,
  qty_on_hand  DECIMAL(18,4) DEFAULT 0,
  purchase_price DECIMAL(18,4) DEFAULT 0,
  sale_price   DECIMAL(18,4) DEFAULT 0,
  supplier_id  UUID REFERENCES stakeholders(id),
  warehouse_id UUID REFERENCES warehouses(id),
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ph_sales (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number VARCHAR(50) NOT NULL,
  sale_date      DATE NOT NULL,
  customer_id    UUID REFERENCES stakeholders(id),
  cashbox_id     UUID REFERENCES cashboxes(id),
  subtotal       DECIMAL(18,4) DEFAULT 0,
  discount       DECIMAL(18,4) DEFAULT 0,
  total          DECIMAL(18,4) DEFAULT 0,
  payment_method VARCHAR(30) DEFAULT 'cash',
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ph_sale_lines (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id     UUID NOT NULL REFERENCES ph_sales(id) ON DELETE CASCADE,
  item_id     UUID REFERENCES items(id),
  batch_id    UUID REFERENCES ph_batches(id),
  quantity    DECIMAL(18,4) NOT NULL,
  unit_price  DECIMAL(18,4) NOT NULL,
  discount    DECIMAL(18,4) DEFAULT 0,
  line_total  DECIMAL(18,4) NOT NULL,
  line_order  INTEGER DEFAULT 0
);
ALTER TABLE ph_batches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ph_sales     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ph_sale_lines ENABLE ROW LEVEL SECURITY;
`;

module.exports = { router, meta, MIGRATION_SQL };

// ============================================================
// Plugin: Manufacturing v3 (التصنيع والإنتاج)
// Garment | Textile | Dye-house | BOM | Scrap% | 5 Stages
// ============================================================
'use strict';
const express = require('express');
const { supabaseAdmin } = require('../../core/src/db/client');
const { authMiddleware } = require('../../core/src/middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware(['tenant_admin','accountant','warehouse','staff']));

const meta = {
  key: 'manufacturing', version: '3.0.0',
  name_ar: 'التصنيع والإنتاج', name_en: 'Manufacturing & BOM',
  tables: ['bom_templates','bom_lines','production_orders','production_order_lines'],
  permissions: ['read','write','delete','print','export'],
};

const STAGES = { raw:'خام', wip:'تحت التصنيع', finished:'منتج تام', damaged:'تالف', inspection:'تحت الفحص' };

// ── BOM Templates ──────────────────────────────────────────
router.get('/bom', async (req, res) => {
  const { product_item_id } = req.query;
  let q = supabaseAdmin.from('bom_templates')
    .select('*,items(name_ar,code,unit),bom_lines(*,items(name_ar,code,unit))')
    .eq('tenant_id',req.tenantId).order('created_at',{ascending:false});
  if (product_item_id) q=q.eq('product_item_id',product_item_id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.post('/bom', async (req, res) => {
  const { name_ar, product_item_id, output_qty=1, lines=[] } = req.body;
  const { data: bom, error } = await supabaseAdmin.from('bom_templates')
    .insert({ tenant_id:req.tenantId, name_ar, product_item_id, output_qty }).select().single();
  if (error) return res.status(400).json({ error: error.message });

  if (lines.length) {
    await supabaseAdmin.from('bom_lines').insert(
      lines.map(l => ({
        tenant_id:        req.tenantId,
        bom_id:           bom.id,
        raw_item_id:      l.raw_item_id,
        required_qty:     l.required_qty,
        scrap_percentage: l.scrap_percentage||0,
        adjusted_qty:     +(l.required_qty*(1+(l.scrap_percentage||0)/100)).toFixed(4),
        unit:             l.unit,
        stage:            l.stage||'raw',
        notes:            l.notes||null,
      }))
    );
  }

  const { data: full } = await supabaseAdmin.from('bom_templates')
    .select('*,bom_lines(*,items(name_ar,code,unit))').eq('id',bom.id).single();
  res.status(201).json(full);
});

// PATCH scrap % on a single BOM line (per-order override)
router.patch('/bom/:bomId/lines/:lineId', async (req, res) => {
  const { scrap_percentage, required_qty } = req.body;
  const qty = required_qty || 1;
  const pct = scrap_percentage ?? 0;
  const { data, error } = await supabaseAdmin.from('bom_lines')
    .update({ scrap_percentage: pct, adjusted_qty: +(qty*(1+pct/100)).toFixed(4) })
    .eq('id',req.params.lineId).eq('tenant_id',req.tenantId).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/bom/:id', async (req, res) => {
  await supabaseAdmin.from('bom_lines').delete().eq('bom_id',req.params.id).eq('tenant_id',req.tenantId);
  await supabaseAdmin.from('bom_templates').delete().eq('id',req.params.id).eq('tenant_id',req.tenantId);
  res.json({ success: true });
});

// ── Production Orders ──────────────────────────────────────
router.get('/orders', async (req, res) => {
  const { status, page=1, limit=50 } = req.query;
  const off = (page-1)*limit;
  let q = supabaseAdmin.from('production_orders')
    .select('*,items(name_ar,code,unit),bom_templates(name_ar)', {count:'exact'})
    .eq('tenant_id',req.tenantId).order('created_at',{ascending:false}).range(off,off+limit-1);
  if (status) q=q.eq('status',status);
  const { data, count, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ data, total: count });
});

router.get('/orders/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('production_orders')
    .select('*,items(name_ar,code,unit),production_order_lines(*,items(name_ar,code,unit))')
    .eq('id',req.params.id).eq('tenant_id',req.tenantId).single();
  if (error) return res.status(404).json({ error: 'الأمر غير موجود' });
  res.json(data);
});

router.post('/orders', async (req, res) => {
  const { product_item_id, bom_id, planned_qty, start_date, end_date, notes, per_line_scrap={} } = req.body;
  const { count } = await supabaseAdmin.from('production_orders').select('*',{count:'exact',head:true}).eq('tenant_id',req.tenantId);
  const num = `PRD-${new Date().getFullYear()}-${String((count||0)+1).padStart(5,'0')}`;

  const { data: order, error } = await supabaseAdmin.from('production_orders').insert({
    tenant_id:req.tenantId, order_number:num,
    product_item_id, bom_id:bom_id||null, planned_qty,
    start_date:start_date||null, end_date:end_date||null, notes:notes||null,
    status:'planned', created_by:req.user?.id,
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Copy BOM lines to order lines with optional per-line scrap override
  if (bom_id) {
    const { data: bomLines } = await supabaseAdmin.from('bom_lines').select('*').eq('bom_id',bom_id).eq('tenant_id',req.tenantId);
    if (bomLines?.length) {
      await supabaseAdmin.from('production_order_lines').insert(
        bomLines.map(bl => {
          const scrapPct = per_line_scrap[bl.raw_item_id] ?? bl.scrap_percentage;
          return {
            tenant_id:          req.tenantId,
            order_id:           order.id,
            bom_line_id:        bl.id,
            raw_item_id:        bl.raw_item_id,
            planned_qty:        +(bl.adjusted_qty * planned_qty).toFixed(4),
            expected_scrap_pct: scrapPct,
            stage:              bl.stage,
          };
        })
      );
    }
  }

  res.status(201).json(order);
});

router.patch('/orders/:id', async (req, res) => {
  const { actual_qty, scrap_qty, status, lines } = req.body;
  const upd = {};
  if (actual_qty !== undefined) upd.actual_qty = actual_qty;
  if (scrap_qty  !== undefined) upd.scrap_qty  = scrap_qty;
  if (status)                   upd.status     = status;

  const { data, error } = await supabaseAdmin.from('production_orders')
    .update(upd).eq('id',req.params.id).eq('tenant_id',req.tenantId).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Update actual consumption per BOM line
  if (lines?.length) {
    for (const l of lines) {
      await supabaseAdmin.from('production_order_lines').update({
        actual_consumed_qty: l.actual_consumed_qty,
        actual_scrap_qty:    l.actual_scrap_qty,
        expected_scrap_pct:  l.expected_scrap_pct,
      }).eq('id',l.id).eq('tenant_id',req.tenantId);
    }
  }
  res.json(data);
});

// ── Variance Report ────────────────────────────────────────
router.get('/orders/:id/variance', async (req, res) => {
  const { data: order } = await supabaseAdmin.from('production_orders')
    .select('*,items(name_ar,code)').eq('id',req.params.id).eq('tenant_id',req.tenantId).single();

  const { data: lines } = await supabaseAdmin.from('production_order_lines')
    .select('*,items(name_ar,code,unit)').eq('order_id',req.params.id).eq('tenant_id',req.tenantId);

  const report = (lines||[]).map(l => {
    const expectedScrap = +(l.planned_qty * l.expected_scrap_pct / 100).toFixed(4);
    const variance      = +((l.actual_scrap_qty||0) - expectedScrap).toFixed(4);
    return {
      item:               l.items?.name_ar,
      code:               l.items?.code,
      unit:               l.items?.unit,
      stage:              STAGES[l.stage] || l.stage,
      planned_qty:        l.planned_qty,
      expected_scrap_pct: l.expected_scrap_pct,
      expected_scrap_qty: expectedScrap,
      actual_consumed:    l.actual_consumed_qty||0,
      actual_scrap:       l.actual_scrap_qty||0,
      variance_qty:       variance,
      variance_status:    variance > 0.001 ? '⬆️ تجاوز الهادر' : variance < -0.001 ? '⬇️ وفر في الهادر' : '✅ مطابق',
      variance_pct:       l.planned_qty > 0 ? +((variance/l.planned_qty)*100).toFixed(2) : 0,
    };
  });

  const totalVariance = report.reduce((s,r)=>s+r.variance_qty,0);
  res.json({ order, report, summary:{ total_variance: +totalVariance.toFixed(4), lines_count: report.length }, stages: STAGES });
});

// ── Inventory by Stage ─────────────────────────────────────
router.get('/stages', async (req, res) => {
  const { data: warehouses } = await supabaseAdmin.from('warehouses')
    .select('*,stock_balances(quantity,items(name_ar,code,unit,min_stock))')
    .eq('tenant_id',req.tenantId).not('stage','eq','main');

  const grouped = {};
  for (const wh of (warehouses||[])) {
    grouped[wh.stage] = {
      warehouse_id:   wh.id,
      warehouse_name: wh.name_ar,
      stage_label:    STAGES[wh.stage] || wh.stage,
      items:          wh.stock_balances || [],
      total_items:    wh.stock_balances?.length || 0,
    };
  }
  res.json({ stages: grouped, stage_labels: STAGES });
});

module.exports = { router, meta };

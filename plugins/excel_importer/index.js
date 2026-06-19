// ============================================================
// Plugin: Excel Importer v3 (استيراد Excel)
// Download Templates | Drag-Drop Upload | Background Import
// ============================================================
'use strict';
const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const { supabaseAdmin } = require('../../core/src/db/client');
const { authMiddleware } = require('../../core/src/middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware(['tenant_admin','accountant']));

const meta = {
  key: 'excel_importer', version: '3.0.0',
  name_ar: 'استيراد Excel', name_en: 'Excel Data Importer & Template Exporter',
  tables: ['import_jobs'],
  permissions: ['read','write','export'],
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25*1024*1024 } });

// ── Template definitions ───────────────────────────────────
const TEMPLATES = {
  items: {
    sheet: 'الأصناف',
    headers: ['الكود*','الاسم بالعربية*','الاسم بالإنجليزية','الفئة','الوحدة','سعر الشراء','سعر البيع','الحد الأدنى للمخزون','باركود','له رقم تسلسلي','له تاريخ صلاحية'],
    keys:    ['code','name_ar','name_en','category','unit','cost_price','sale_price','min_stock','barcode','has_serial','has_expiry'],
    sample:  [['ITEM-001','قماش قطني أبيض','White Cotton','خامات','متر','45','60','100','6281234567890','لا','نعم']],
    required: ['name_ar'],
  },
  customers: {
    sheet: 'العملاء',
    headers: ['الكود*','الاسم*','الهاتف','الموبايل','البريد الإلكتروني','العنوان','الرقم الضريبي','حد الائتمان'],
    keys:    ['code','name_ar','phone','mobile','email','address_ar','tax_number','credit_limit'],
    sample:  [['CUST-001','محمد أحمد علي','0224455667','01012345678','m@email.com','القاهرة','123456789','50000']],
    required: ['name_ar'],
    extra:   { type: 'customer' },
  },
  suppliers: {
    sheet: 'الموردون',
    headers: ['الكود*','الاسم*','الهاتف','الموبايل','البريد الإلكتروني','العنوان','الرقم الضريبي'],
    keys:    ['code','name_ar','phone','mobile','email','address_ar','tax_number'],
    sample:  [['SUP-001','شركة النصر للتوريدات','0223344556','01098765432','nasr@supply.com','الجيزة','987654321']],
    required: ['name_ar'],
    extra:   { type: 'supplier' },
  },
  employees: {
    sheet: 'الموظفون',
    headers: ['الكود*','الاسم*','الرقم القومي','المسمى الوظيفي','القسم','تاريخ التعيين (YYYY-MM-DD)','الراتب الأساسي','بدل السكن','بدل النقل','ساعات العمل اليومية'],
    keys:    ['code','name_ar','national_id','job_title','department','hire_date','base_salary','housing_allow','transport_allow','working_hours'],
    sample:  [['EMP-001','أحمد محمود','29901012345678','محاسب','المحاسبة','2020-01-15','8000','1500','500','8']],
    required: ['name_ar'],
  },
  chart_of_accounts: {
    sheet: 'دليل الحسابات',
    headers: ['الكود*','الاسم بالعربية*','نوع الحساب*','هل هو حساب رئيسي','كود الحساب الأب'],
    keys:    ['code','name_ar','account_type','is_header','parent_code'],
    sample:  [['1001','الأصول المتداولة','asset','نعم',''],['1001001','الصندوق الرئيسي','asset','لا','1001']],
    required: ['code','name_ar','account_type'],
    notes:   ['account_type: asset | liability | equity | revenue | expense'],
  },
  opening_balances: {
    sheet: 'الأرصدة الافتتاحية',
    headers: ['كود الحساب*','اسم الحساب','مدين','دائن','العملة'],
    keys:    ['account_code','account_name','debit','credit','currency'],
    sample:  [['1001001','الصندوق الرئيسي','50000','0','EGP'],['2001001','موردون متنوعون','0','25000','EGP']],
    required: ['account_code'],
  },
};

// ── GET /template/:type — Download pre-formatted Excel ──────
router.get('/template/:type', async (req, res) => {
  const tmpl = TEMPLATES[req.params.type];
  if (!tmpl) return res.status(400).json({ error:'نوع غير مدعوم', supported: Object.keys(TEMPLATES) });

  const wb = XLSX.utils.book_new();

  // ── Data sheet ──────────────────────────────────────────
  const wsData = XLSX.utils.aoa_to_sheet([tmpl.headers, ...tmpl.sample]);
  wsData['!cols'] = tmpl.headers.map(h => ({ wch: Math.max(h.length+4, 20) }));
  // Freeze first row
  wsData['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, wsData, tmpl.sheet);

  // ── Instructions sheet ──────────────────────────────────
  const instr = [
    [`قالب استيراد: ${tmpl.sheet} | جيتك المطور | أ. علاء غبن | 01014868778`],[''],
    ['📌 تعليمات مهمة:'],
    ['1. الأعمدة المحددة بـ (*) إلزامية'],
    ['2. لا تغير أسماء الأعمدة في الصف الأول'],
    ['3. ابدأ إدخال بياناتك من الصف الثالث (الثاني مثال فقط)'],
    ['4. الأرقام: بدون فواصل آلاف أو رموز عملة'],
    ['5. التواريخ: بصيغة YYYY-MM-DD فقط (مثال: 2024-06-15)'],
    ['6. الحقول المنطقية (نعم/لا): اكتب نعم أو لا'],
    [''],
    ...(tmpl.notes||[]).map(n=>['📎 '+n]),
    [''],['في حالة وجود مشكلة: أ. علاء غبن | 01014868778'],
  ];
  const wsInst = XLSX.utils.aoa_to_sheet(instr);
  wsInst['!cols'] = [{ wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsInst, 'التعليمات');

  const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="gtech_template_${req.params.type}_${Date.now()}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── POST /upload/:type — Drag-drop upload & bulk import ─────
router.post('/upload/:type', upload.single('file'), async (req, res) => {
  const tmpl = TEMPLATES[req.params.type];
  if (!tmpl || !req.file) return res.status(400).json({ error:'ملف أو نوع غير صالح' });

  // Create job record immediately
  const { data: job } = await supabaseAdmin.from('import_jobs').insert({
    tenant_id:   req.tenantId,
    import_type: req.params.type,
    status:      'processing',
    created_by:  req.user?.id,
  }).select().single();

  // Respond immediately with job ID (non-blocking)
  res.status(202).json({ job_id: job.id, message: 'جاري معالجة الملف في الخلفية...' });

  // ── Background processing ──────────────────────────────
  setImmediate(async () => {
    try {
      const wb   = XLSX.read(req.file.buffer, { type:'buffer', cellDates:true });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: tmpl.keys, range: 2, defval: '' });

      let imported = 0, failed = 0;
      const errors = [];

      // For opening_balances: create ONE journal entry header to attach all lines to,
      // since journal_entry_lines.entry_id is NOT NULL.
      let openingEntryId = null;
      let openingTotals  = { debit: 0, credit: 0 };
      if (req.params.type === 'opening_balances') {
        const today = new Date().toISOString().split('T')[0];
        const { count } = await supabaseAdmin.from('journal_entries').select('*',{count:'exact',head:true}).eq('tenant_id',req.tenantId);
        const entryNumber = `JE-${new Date().getFullYear()}-${String((count||0)+1).padStart(5,'0')}`;
        const { data: entry, error: entryErr } = await supabaseAdmin.from('journal_entries').insert({
          tenant_id:      req.tenantId,
          entry_number:   entryNumber,
          entry_date:     today,
          description_ar: 'أرصدة افتتاحية — استيراد من Excel',
          fiscal_year:    new Date().getFullYear(),
          fiscal_month:   new Date().getMonth()+1,
          is_posted:      false,
          created_by:     req.user?.id,
        }).select().single();
        if (entryErr) {
          await supabaseAdmin.from('import_jobs').update({ status:'failed', errors:[{error: entryErr.message}] }).eq('id', job.id);
          return;
        }
        openingEntryId = entry.id;
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Skip completely empty rows
        const hasData = tmpl.required.some(k => row[k]?.toString().trim());
        if (!hasData) continue;

        // Validate required fields
        const missing = tmpl.required.filter(k => !row[k]?.toString().trim());
        if (missing.length) {
          failed++;
          errors.push({ row: i+3, error: `الحقول المطلوبة مفقودة: ${missing.join(', ')}`, data: row });
          continue;
        }

        try {
          const lineTotals = await importRow(req.params.type, tmpl, row, req.tenantId, openingEntryId);
          if (lineTotals) {
            openingTotals.debit  += lineTotals.debit;
            openingTotals.credit += lineTotals.credit;
          }
          imported++;
        } catch (err) {
          failed++;
          errors.push({ row: i+3, error: err.message, data: row });
        }
      }

      // Finalize opening-balance entry totals
      if (openingEntryId) {
        await supabaseAdmin.from('journal_entries').update({
          total_debit:  +openingTotals.debit.toFixed(4),
          total_credit: +openingTotals.credit.toFixed(4),
        }).eq('id', openingEntryId);
      }

      await supabaseAdmin.from('import_jobs').update({
        status: failed > 0 && imported === 0 ? 'failed' : 'done',
        total_rows:    rows.length,
        imported_rows: imported,
        failed_rows:   failed,
        errors:        errors.slice(0,100),
        started_at:    new Date(),
        completed_at:  new Date(),
      }).eq('id', job.id);

    } catch (err) {
      await supabaseAdmin.from('import_jobs').update({
        status: 'failed', errors: [{ error: err.message }],
      }).eq('id', job.id);
    }
  });
});

// ── Import dispatcher per type ─────────────────────────────
// Returns { debit, credit } for opening_balances rows (used to total the entry header), else undefined
async function importRow(type, tmpl, row, tenantId, openingEntryId) {
  const clean = Object.fromEntries(
    Object.entries(row).map(([k,v]) => [k, typeof v === 'string' ? v.trim() : v])
  );

  if (type === 'items') {
    clean.has_serial = clean.has_serial === 'نعم';
    clean.has_expiry = clean.has_expiry === 'نعم';
    clean.cost_price = parseFloat(clean.cost_price)||0;
    clean.sale_price = parseFloat(clean.sale_price)||0;
    clean.min_stock  = parseFloat(clean.min_stock)||0;
    const { error } = await supabaseAdmin.from('items').upsert({ ...clean, tenant_id:tenantId, is_active:true }, { onConflict:'tenant_id,code' });
    if (error) throw new Error(error.message);
  }
  else if (type === 'customers' || type === 'suppliers') {
    clean.credit_limit = parseFloat(clean.credit_limit)||0;
    const { error } = await supabaseAdmin.from('stakeholders').upsert({ ...clean, ...tmpl.extra, tenant_id:tenantId, is_active:true }, { onConflict:'tenant_id,code' });
    if (error) throw new Error(error.message);
  }
  else if (type === 'employees') {
    clean.base_salary     = parseFloat(clean.base_salary)||0;
    clean.housing_allow   = parseFloat(clean.housing_allow)||0;
    clean.transport_allow = parseFloat(clean.transport_allow)||0;
    clean.working_hours   = parseFloat(clean.working_hours)||8;
    const { error } = await supabaseAdmin.from('employees').upsert({ ...clean, tenant_id:tenantId, is_active:true }, { onConflict:'tenant_id,code' });
    if (error) throw new Error(error.message);
  }
  else if (type === 'chart_of_accounts') {
    clean.is_header = clean.is_header === 'نعم';
    let parent_id = null;
    if (clean.parent_code) {
      const { data: par } = await supabaseAdmin.from('chart_of_accounts').select('id').eq('code',clean.parent_code).eq('tenant_id',tenantId).single();
      parent_id = par?.id || null;
    }
    const { error } = await supabaseAdmin.from('chart_of_accounts').upsert({ code:clean.code, name_ar:clean.name_ar, account_type:clean.account_type, is_header:clean.is_header, parent_id, tenant_id:tenantId, is_active:true }, { onConflict:'tenant_id,code' });
    if (error) throw new Error(error.message);
  }
  else if (type === 'opening_balances') {
    const { data: acct } = await supabaseAdmin.from('chart_of_accounts').select('id').eq('code',clean.account_code).eq('tenant_id',tenantId).single();
    if (!acct) throw new Error(`الحساب ${clean.account_code} غير موجود`);
    const debit  = parseFloat(clean.debit)||0;
    const credit = parseFloat(clean.credit)||0;
    const { error } = await supabaseAdmin.from('journal_entry_lines').insert({
      tenant_id:tenantId, entry_id: openingEntryId, account_id:acct.id,
      debit, credit,
      description: `رصيد افتتاحي — ${clean.account_name||clean.account_code}`,
      currency: clean.currency||'EGP', line_order: 0,
    });
    if (error) throw new Error(error.message);
    return { debit, credit };
  }
}

// ── GET /jobs — list import history ───────────────────────
router.get('/jobs', async (req, res) => {
  const { data } = await supabaseAdmin.from('import_jobs')
    .select('id,import_type,status,total_rows,imported_rows,failed_rows,created_at,completed_at')
    .eq('tenant_id',req.tenantId).order('created_at',{ascending:false}).limit(50);
  res.json(data);
});

router.get('/jobs/:id', async (req, res) => {
  const { data } = await supabaseAdmin.from('import_jobs').select('*').eq('id',req.params.id).eq('tenant_id',req.tenantId).single();
  if (!data) return res.status(404).json({ error: 'المهمة غير موجودة' });
  res.json(data);
});

module.exports = { router, meta };

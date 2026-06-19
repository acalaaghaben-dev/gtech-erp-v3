// ============================================================
// Plugin: HR & Payroll v3 (الموارد البشرية والرواتب)
// Auto-Payroll | Attendance | Deductions | Overtime
// ============================================================
'use strict';
const express = require('express');
const { supabaseAdmin } = require('../../core/src/db/client');
const { authMiddleware } = require('../../core/src/middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware(['tenant_admin','hr_manager','accountant']));

const meta = {
  key: 'hr', version: '3.0.0',
  name_ar: 'الموارد البشرية والرواتب', name_en: 'HR & Payroll',
  tables: ['employees','attendance','payroll_runs','payroll_lines'],
  permissions: ['read','write','delete','print','export'],
};

// ── Employees ──────────────────────────────────────────────
router.get('/employees', async (req, res) => {
  const { search, department, is_active, page=1, limit=50 } = req.query;
  const off = (page-1)*limit;
  let q = supabaseAdmin.from('employees').select('*',{count:'exact'}).eq('tenant_id',req.tenantId).order('name_ar').range(off,off+limit-1);
  if (department)          q=q.eq('department',department);
  if (is_active!==undefined) q=q.eq('is_active',is_active==='true');
  if (search)              q=q.ilike('name_ar',`%${search}%`);
  const { data, count } = await q;
  res.json({ data, total: count });
});

router.get('/employees/:id', async (req, res) => {
  const { data } = await supabaseAdmin.from('employees').select('*').eq('id',req.params.id).eq('tenant_id',req.tenantId).single();
  res.json(data);
});

router.post('/employees', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('employees').insert({ ...req.body, tenant_id:req.tenantId }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/employees/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('employees').update(req.body).eq('id',req.params.id).eq('tenant_id',req.tenantId).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/employees/:id', async (req, res) => {
  await supabaseAdmin.from('employees').update({ is_active: false }).eq('id',req.params.id).eq('tenant_id',req.tenantId);
  res.json({ success: true });
});

// ── Attendance ─────────────────────────────────────────────
router.get('/attendance', async (req, res) => {
  const { employee_id, date_from, date_to, status, page=1, limit=100 } = req.query;
  const off = (page-1)*limit;
  let q = supabaseAdmin.from('attendance').select('*,employees(name_ar,code,department)',{count:'exact'}).eq('tenant_id',req.tenantId).order('work_date',{ascending:false}).range(off,off+limit-1);
  if (employee_id) q=q.eq('employee_id',employee_id);
  if (date_from)   q=q.gte('work_date',date_from);
  if (date_to)     q=q.lte('work_date',date_to);
  if (status)      q=q.eq('status',status);
  const { data, count } = await q;
  res.json({ data, total: count });
});

router.post('/attendance', async (req, res) => {
  const rec = { ...req.body, tenant_id: req.tenantId };
  if (rec.check_in && rec.check_out) {
    const [ih,im] = rec.check_in.split(':').map(Number);
    const [oh,om] = rec.check_out.split(':').map(Number);
    rec.hours_worked = +((oh*60+om - (ih*60+im))/60).toFixed(2);
  }
  const { data, error } = await supabaseAdmin.from('attendance')
    .upsert(rec, { onConflict:'tenant_id,employee_id,work_date' }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// Bulk attendance import for a day
router.post('/attendance/bulk', async (req, res) => {
  const { records=[] } = req.body;
  const enriched = records.map(r => {
    const rec = { ...r, tenant_id: req.tenantId };
    if (rec.check_in && rec.check_out) {
      const [ih,im]=rec.check_in.split(':').map(Number);
      const [oh,om]=rec.check_out.split(':').map(Number);
      rec.hours_worked = +((oh*60+om-(ih*60+im))/60).toFixed(2);
    }
    return rec;
  });
  const { data, error } = await supabaseAdmin.from('attendance').upsert(enriched, { onConflict:'tenant_id,employee_id,work_date' }).select();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ imported: data?.length, data });
});

// ── Payroll ────────────────────────────────────────────────
router.get('/payroll', async (req, res) => {
  const { year } = req.query;
  let q = supabaseAdmin.from('payroll_runs').select('*').eq('tenant_id',req.tenantId).order('period_year',{ascending:false}).order('period_month',{ascending:false});
  if (year) q=q.eq('period_year',year);
  const { data } = await q;
  res.json(data);
});

router.get('/payroll/:id', async (req, res) => {
  const { data } = await supabaseAdmin.from('payroll_runs').select('*').eq('id',req.params.id).eq('tenant_id',req.tenantId).single();
  res.json(data);
});

router.get('/payroll/:id/lines', async (req, res) => {
  const { data } = await supabaseAdmin.from('payroll_lines')
    .select('*,employees(name_ar,code,department,job_title,bank_account)')
    .eq('payroll_run_id',req.params.id).eq('tenant_id',req.tenantId)
    .order('employees(name_ar)');
  res.json(data);
});

router.post('/payroll/generate', async (req, res) => {
  const { period_month, period_year } = req.body;
  if (!period_month||!period_year) return res.status(400).json({ error:'الشهر والسنة مطلوبان' });

  // Period lock check
  const locked = (req.tenant?.locked_periods||[]).find(lp=>lp.month===period_month&&lp.year===period_year);
  if (locked) return res.status(403).json({ error:'هذه الفترة المحاسبية مقفلة' });

  // Check not already generated
  const { data: existing } = await supabaseAdmin.from('payroll_runs').select('id,status').eq('tenant_id',req.tenantId).eq('period_month',period_month).eq('period_year',period_year).single();
  if (existing) return res.status(400).json({ error:`مسير الرواتب موجود بالفعل بحالة: ${existing.status}`, run_id: existing.id });

  const { data: emps } = await supabaseAdmin.from('employees').select('*').eq('tenant_id',req.tenantId).eq('is_active',true);
  if (!emps?.length) return res.status(400).json({ error:'لا يوجد موظفون نشطون' });

  const df = `${period_year}-${String(period_month).padStart(2,'0')}-01`;
  const dt = new Date(period_year, period_month, 0).toISOString().split('T')[0];
  const { data: att } = await supabaseAdmin.from('attendance').select('*').eq('tenant_id',req.tenantId).gte('work_date',df).lte('work_date',dt);

  const { data: run } = await supabaseAdmin.from('payroll_runs').insert({
    tenant_id:req.tenantId, period_month, period_year, status:'draft', run_by:req.user?.id,
  }).select().single();

  const lines = emps.map(emp => {
    const ea = (att||[]).filter(a=>a.employee_id===emp.id);
    const absent   = ea.filter(a=>a.status==='absent').length;
    const halfDay  = ea.filter(a=>a.status==='half_day').length;
    const ot       = ea.reduce((s,a)=>s+(+a.overtime_hours||0),0);
    const late     = ea.reduce((s,a)=>s+(+a.late_minutes||0),0);

    const daily  = emp.base_salary/26;
    const hourly = emp.base_salary/(26*(+emp.working_hours||8));

    const allows  = (+emp.housing_allow||0)+(+emp.transport_allow||0);
    const deds    = daily*absent + daily*0.5*halfDay + (late/60)*hourly;
    const otPay   = ot*hourly*1.5;
    const gross   = emp.base_salary + allows + otPay;
    const net     = Math.max(0, gross-deds);

    return {
      tenant_id:      req.tenantId,
      payroll_run_id: run.id,
      employee_id:    emp.id,
      base_salary:    emp.base_salary,
      allowances:     +allows.toFixed(2),
      overtime_pay:   +otPay.toFixed(2),
      deductions:     +deds.toFixed(2),
      advances:       0,
      gross_salary:   +gross.toFixed(2),
      net_salary:     +net.toFixed(2),
      payment_status: 'pending',
    };
  });

  await supabaseAdmin.from('payroll_lines').insert(lines);

  const tg=+lines.reduce((s,l)=>s+l.gross_salary,0).toFixed(2);
  const tn=+lines.reduce((s,l)=>s+l.net_salary,0).toFixed(2);
  const td=+lines.reduce((s,l)=>s+l.deductions,0).toFixed(2);
  await supabaseAdmin.from('payroll_runs').update({ total_gross:tg, total_net:tn, total_ded:td }).eq('id',run.id);

  res.status(201).json({ run:{...run,total_gross:tg,total_net:tn,total_ded:td}, summary:{ employees:emps.length, totalGross:tg, totalNet:tn, totalDed:td } });
});

router.post('/payroll/:id/approve', async (req, res) => {
  const { data, error } = await supabaseAdmin.from('payroll_runs')
    .update({ status:'approved', approved_by:req.user?.id })
    .eq('id',req.params.id).eq('tenant_id',req.tenantId).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post('/payroll/:id/pay', async (req, res) => {
  await supabaseAdmin.from('payroll_runs').update({ status:'paid' }).eq('id',req.params.id).eq('tenant_id',req.tenantId);
  await supabaseAdmin.from('payroll_lines').update({ payment_status:'paid' }).eq('payroll_run_id',req.params.id).eq('tenant_id',req.tenantId);
  res.json({ success: true });
});

// ── Departments list (distinct) ────────────────────────────
router.get('/departments', async (req, res) => {
  const { data } = await supabaseAdmin.from('employees').select('department').eq('tenant_id',req.tenantId).eq('is_active',true).not('department','is',null);
  const depts = [...new Set((data||[]).map(e=>e.department).filter(Boolean))].sort();
  res.json(depts);
});

module.exports = { router, meta };

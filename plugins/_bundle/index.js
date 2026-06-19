// ============================================================
// G-Tech ERP v3 — Remaining 10 Plugins Bundle
// Shipping | Logistics | Medical | Contracting | Real Estate
// Security | NGO | CRM | Mobiles | Veterinary
// Each module exports: { router, meta }
// ============================================================
'use strict';
const express = require('express');
const { supabaseAdmin } = require('../../core/src/db/client');
const { authMiddleware } = require('../../core/src/middleware/authMiddleware');

const guard = authMiddleware(['tenant_admin','accountant','hr_manager','sales','cashier','warehouse','staff']);

// Generic CRUD factory
const crud = (table, extra={}) => {
  const r = express.Router();
  r.use(guard);
  r.get('/', async (req,res) => {
    const {page=1,limit=50,search,...f}=req.query;
    const off=(page-1)*limit;
    let q=supabaseAdmin.from(table).select('*',{count:'exact'}).eq('tenant_id',req.tenantId).order('created_at',{ascending:false}).range(off,off+limit-1);
    if(search) q=q.ilike('name_ar',`%${search}%`);
    Object.entries(f).forEach(([k,v])=>{ if(v!==undefined&&v!=='') q=q.eq(k,v); });
    const {data,count,error}=await q;
    if(error) return res.status(500).json({error:error.message});
    res.json({data,total:count});
  });
  r.get('/:id', async (req,res) => {
    const {data,error}=await supabaseAdmin.from(table).select('*').eq('id',req.params.id).eq('tenant_id',req.tenantId).single();
    if(error) return res.status(404).json({error:'غير موجود'});
    res.json(data);
  });
  r.post('/', async (req,res) => {
    const {data,error}=await supabaseAdmin.from(table).insert({...req.body,...extra,tenant_id:req.tenantId}).select().single();
    if(error) return res.status(400).json({error:error.message});
    res.status(201).json(data);
  });
  r.put('/:id', async (req,res) => {
    const {data,error}=await supabaseAdmin.from(table).update(req.body).eq('id',req.params.id).eq('tenant_id',req.tenantId).select().single();
    if(error) return res.status(400).json({error:error.message});
    res.json(data);
  });
  r.delete('/:id', async (req,res) => {
    await supabaseAdmin.from(table).update({is_active:false}).eq('id',req.params.id).eq('tenant_id',req.tenantId);
    res.json({success:true});
  });
  return r;
};

// ============================================================
// 1. SHIPPING & COURIERS
// ============================================================
const shippingRouter = express.Router();
shippingRouter.use(guard);
shippingRouter.use('/couriers', crud('shipping_couriers'));

shippingRouter.get('/shipments', async (req,res) => {
  const {courier_id,status,page=1,limit=50}=req.query;
  const off=(page-1)*limit;
  let q=supabaseAdmin.from('shipments').select('*,shipping_couriers(name_ar),stakeholders(name_ar)',{count:'exact'}).eq('tenant_id',req.tenantId).order('created_at',{ascending:false}).range(off,off+limit-1);
  if(courier_id) q=q.eq('courier_id',courier_id);
  if(status)     q=q.eq('status',status);
  const {data,count}=await q;
  res.json({data,total:count});
});

shippingRouter.post('/shipments', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('shipments').insert({...req.body,tenant_id:req.tenantId}).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.status(201).json(data);
});

shippingRouter.post('/shipments/:id/settle', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('shipments').update({status:'settled',settled_amount:req.body.amount,settled_at:new Date()}).eq('id',req.params.id).eq('tenant_id',req.tenantId).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.json(data);
});

shippingRouter.get('/cod-pending', async (req,res) => {
  const {data}=await supabaseAdmin.from('shipments').select('*,shipping_couriers(name_ar),stakeholders(name_ar)').eq('tenant_id',req.tenantId).eq('payment_type','cod').eq('status','delivered').neq('cod_settled',true).order('delivery_date');
  res.json(data);
});

// ============================================================
// 2. LOGISTICS & FLEET
// ============================================================
const logisticsRouter = express.Router();
logisticsRouter.use(guard);
logisticsRouter.use('/vehicles', crud('fleet_vehicles'));
logisticsRouter.use('/drivers',  crud('fleet_drivers'));

logisticsRouter.post('/trips', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('fleet_trips').insert({...req.body,tenant_id:req.tenantId}).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.status(201).json(data);
});

logisticsRouter.get('/vehicles/:id/pnl', async (req,res) => {
  const {date_from='2000-01-01',date_to='2099-12-31'}=req.query;
  const [{data:trips},{data:maint}]=await Promise.all([
    supabaseAdmin.from('fleet_trips').select('earnings,fuel_cost,other_expenses').eq('vehicle_id',req.params.id).eq('tenant_id',req.tenantId).gte('trip_date',date_from).lte('trip_date',date_to),
    supabaseAdmin.from('fleet_maintenance').select('cost').eq('vehicle_id',req.params.id).eq('tenant_id',req.tenantId),
  ]);
  const earnings=+(trips||[]).reduce((s,t)=>s+(+t.earnings||0),0).toFixed(2);
  const fuel=+(trips||[]).reduce((s,t)=>s+(+t.fuel_cost||0),0).toFixed(2);
  const maintenance=+(maint||[]).reduce((s,m)=>s+(+m.cost||0),0).toFixed(2);
  const other=+(trips||[]).reduce((s,t)=>s+(+t.other_expenses||0),0).toFixed(2);
  res.json({earnings,fuel,maintenance,other,net:+(earnings-fuel-maintenance-other).toFixed(2)});
});

logisticsRouter.get('/drivers/:id/advances', async (req,res) => {
  const {data}=await supabaseAdmin.from('driver_advances').select('*').eq('driver_id',req.params.id).eq('tenant_id',req.tenantId).order('advance_date',{ascending:false});
  res.json(data);
});

// ============================================================
// 3. MEDICAL CLINICS & HOSPITALS
// ============================================================
const medicalRouter = express.Router();
medicalRouter.use(guard);
medicalRouter.use('/patients',     crud('medical_patients'));
medicalRouter.use('/appointments', crud('medical_appointments'));
medicalRouter.use('/rooms',        crud('hospital_rooms'));
medicalRouter.use('/lab',          crud('lab_tests'));

medicalRouter.get('/patients/:id/records', async (req,res) => {
  const {data}=await supabaseAdmin.from('medical_records').select('*').eq('patient_id',req.params.id).eq('tenant_id',req.tenantId).order('record_date',{ascending:false});
  res.json(data);
});

medicalRouter.post('/patients/:id/records', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('medical_records').insert({...req.body,patient_id:req.params.id,tenant_id:req.tenantId}).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.status(201).json(data);
});

medicalRouter.get('/today-appointments', async (req,res) => {
  const today=new Date().toISOString().split('T')[0];
  const {data}=await supabaseAdmin.from('medical_appointments').select('*,medical_patients(name_ar,phone)').eq('tenant_id',req.tenantId).eq('appointment_date',today).order('appointment_time');
  res.json(data);
});

// ============================================================
// 4. CONTRACTING
// ============================================================
const contractingRouter = express.Router();
contractingRouter.use(guard);
contractingRouter.use('/projects',       crud('contracting_projects'));
contractingRouter.use('/subcontractors', crud('contracting_subcontractors'));

contractingRouter.get('/projects/:id/extractions', async (req,res) => {
  const {data}=await supabaseAdmin.from('contracting_extractions').select('*').eq('project_id',req.params.id).eq('tenant_id',req.tenantId).order('extraction_date',{ascending:false});
  res.json(data);
});

contractingRouter.post('/projects/:id/extractions', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('contracting_extractions').insert({...req.body,project_id:req.params.id,tenant_id:req.tenantId}).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.status(201).json(data);
});

contractingRouter.get('/projects/:id/costing', async (req,res) => {
  const {data:proj}=await supabaseAdmin.from('contracting_projects').select('*').eq('id',req.params.id).eq('tenant_id',req.tenantId).single();
  const {data:extr}=await supabaseAdmin.from('contracting_extractions').select('amount').eq('project_id',req.params.id).eq('tenant_id',req.tenantId);
  const billed=(extr||[]).reduce((s,e)=>s+(+e.amount||0),0);
  res.json({ project:proj, total_billed:+billed.toFixed(2), remaining:+((proj?.contract_value||0)-billed).toFixed(2) });
});

// ============================================================
// 5. REAL ESTATE
// ============================================================
const realEstateRouter = express.Router();
realEstateRouter.use(guard);
realEstateRouter.use('/properties', crud('re_properties'));
realEstateRouter.use('/units',      crud('re_units'));

realEstateRouter.get('/due-installments', async (req,res) => {
  const days=parseInt(req.query.days)||30;
  const threshold=new Date(); threshold.setDate(threshold.getDate()+days);
  const {data}=await supabaseAdmin.from('re_installments')
    .select('*,re_units(unit_number,re_properties(name_ar)),stakeholders(name_ar,mobile)')
    .eq('tenant_id',req.tenantId).eq('status','pending')
    .lte('due_date',threshold.toISOString().split('T')[0]).order('due_date');
  res.json(data);
});

realEstateRouter.post('/installments/:id/collect', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('re_installments').update({status:'paid',paid_at:new Date(),paid_amount:req.body.amount}).eq('id',req.params.id).eq('tenant_id',req.tenantId).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.json(data);
});

// ============================================================
// 6. SECURITY & FACILITIES
// ============================================================
const securityRouter = express.Router();
securityRouter.use(guard);
securityRouter.use('/sites',    crud('security_sites'));
securityRouter.use('/guards',   crud('security_guards'));
securityRouter.use('/schedules',crud('security_schedules'));

securityRouter.get('/billing/generate', async (req,res) => {
  const {month,year}=req.query;
  const {data:contracts}=await supabaseAdmin.from('security_contracts').select('*,security_sites(name_ar)').eq('tenant_id',req.tenantId).eq('is_active',true);
  const bills=(contracts||[]).map(c=>({ site:c.security_sites?.name_ar, month:+month, year:+year, amount:c.monthly_rate||0, contract_id:c.id }));
  res.json(bills);
});

// ============================================================
// 7. NGO & NON-PROFITS
// ============================================================
const ngoRouter = express.Router();
ngoRouter.use(guard);
ngoRouter.use('/donors',   crud('ngo_donors'));
ngoRouter.use('/projects', crud('ngo_projects'));
ngoRouter.use('/grants',   crud('ngo_grants'));

ngoRouter.post('/donations', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('ngo_donations').insert({...req.body,tenant_id:req.tenantId}).select().single();
  if(error) return res.status(400).json({error:error.message});
  // Update donor total
  await supabaseAdmin.rpc('update_donor_total',{p_donor_id:req.body.donor_id,p_amount:req.body.amount}).catch(()=>{});
  res.status(201).json(data);
});

ngoRouter.get('/reports/donor-summary', async (req,res) => {
  const {data}=await supabaseAdmin.from('ngo_donations').select('donor_id,amount,ngo_donors(name_ar)').eq('tenant_id',req.tenantId);
  const grouped={};
  (data||[]).forEach(d=>{
    if(!grouped[d.donor_id]) grouped[d.donor_id]={donor_id:d.donor_id,name_ar:d.ngo_donors?.name_ar,total:0,count:0};
    grouped[d.donor_id].total+=+d.amount||0;
    grouped[d.donor_id].count++;
  });
  res.json(Object.values(grouped).sort((a,b)=>b.total-a.total));
});

// ============================================================
// 8. CRM & LOYALTY
// ============================================================
const crmRouter = express.Router();
crmRouter.use(guard);
crmRouter.use('/leads',      crud('crm_leads'));
crmRouter.use('/activities', crud('crm_activities'));

crmRouter.get('/loyalty/:stakeholderId', async (req,res) => {
  const {data}=await supabaseAdmin.from('stakeholders').select('loyalty_points,name_ar,balance').eq('id',req.params.stakeholderId).eq('tenant_id',req.tenantId).single();
  if(!data) return res.status(404).json({error:'العميل غير موجود'});
  res.json(data);
});

crmRouter.post('/loyalty/:stakeholderId/add', async (req,res) => {
  const {points,reason}=req.body;
  const {data:s}=await supabaseAdmin.from('stakeholders').select('loyalty_points').eq('id',req.params.stakeholderId).eq('tenant_id',req.tenantId).single();
  const {data,error}=await supabaseAdmin.from('stakeholders').update({loyalty_points:(s?.loyalty_points||0)+points}).eq('id',req.params.stakeholderId).eq('tenant_id',req.tenantId).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.json(data);
});

crmRouter.post('/loyalty/:stakeholderId/redeem', async (req,res) => {
  const {points}=req.body;
  const {data:s}=await supabaseAdmin.from('stakeholders').select('loyalty_points').eq('id',req.params.stakeholderId).eq('tenant_id',req.tenantId).single();
  if((s?.loyalty_points||0)<points) return res.status(400).json({error:'نقاط ولاء غير كافية'});
  const {data,error}=await supabaseAdmin.from('stakeholders').update({loyalty_points:(s.loyalty_points-points)}).eq('id',req.params.stakeholderId).eq('tenant_id',req.tenantId).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.json(data);
});

// ============================================================
// 9. MOBILES & MAINTENANCE
// ============================================================
const mobilesRouter = express.Router();
mobilesRouter.use(guard);
mobilesRouter.use('/devices',  crud('mobile_devices'));
mobilesRouter.use('/tickets',  crud('maintenance_tickets'));
mobilesRouter.use('/topups',   crud('mobile_topups'));
mobilesRouter.use('/wallets',  crud('mobile_wallets'));

mobilesRouter.get('/devices/imei/:imei', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('mobile_devices').select('*').eq('tenant_id',req.tenantId).eq('serial_imei',req.params.imei).single();
  if(error||!data) return res.status(404).json({error:'الجهاز غير موجود'});
  res.json(data);
});

mobilesRouter.patch('/tickets/:id/status', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('maintenance_tickets').update({status:req.body.status,updated_at:new Date()}).eq('id',req.params.id).eq('tenant_id',req.tenantId).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.json(data);
});

// ============================================================
// 10. VETERINARY
// ============================================================
const vetRouter = express.Router();
vetRouter.use(guard);
vetRouter.use('/animals',   crud('vet_animals'));
vetRouter.use('/visits',    crud('vet_visits'));
vetRouter.use('/batches',   crud('vet_batches'));

vetRouter.get('/batches/expiring', async (req,res) => {
  const days=parseInt(req.query.days)||90;
  const threshold=new Date(); threshold.setDate(threshold.getDate()+days);
  const today=new Date().toISOString().split('T')[0];
  const {data}=await supabaseAdmin.from('vet_batches').select('*,items(name_ar,code,unit)').eq('tenant_id',req.tenantId).gt('qty_on_hand',0).lte('expiry_date',threshold.toISOString().split('T')[0]).gt('expiry_date',today).order('expiry_date');
  const enriched=(data||[]).map(b=>({...b,days_left:Math.ceil((new Date(b.expiry_date)-new Date())/86400000)}));
  res.json(enriched);
});

vetRouter.get('/animals/by-category', async (req,res) => {
  const {data}=await supabaseAdmin.from('vet_animals').select('category').eq('tenant_id',req.tenantId).eq('is_active',true);
  const cats={};
  (data||[]).forEach(a=>{ cats[a.category]=(cats[a.category]||0)+1; });
  res.json(Object.entries(cats).map(([cat,count])=>({category:cat,count})).sort((a,b)=>b.count-a.count));
});

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  shipping:    { router: shippingRouter,    meta:{ key:'shipping',    version:'3.0.0', name_ar:'الشحن والكوريير'           } },
  logistics:   { router: logisticsRouter,   meta:{ key:'logistics',   version:'3.0.0', name_ar:'اللوجستيات والأسطول'      } },
  medical:     { router: medicalRouter,     meta:{ key:'medical',     version:'3.0.0', name_ar:'العيادات والمستشفيات'     } },
  contracting: { router: contractingRouter, meta:{ key:'contracting', version:'3.0.0', name_ar:'المقاولات'                } },
  real_estate: { router: realEstateRouter,  meta:{ key:'real_estate', version:'3.0.0', name_ar:'العقارات'                 } },
  security:    { router: securityRouter,    meta:{ key:'security',    version:'3.0.0', name_ar:'الأمن والحراسة'           } },
  ngo:         { router: ngoRouter,         meta:{ key:'ngo',         version:'3.0.0', name_ar:'الجمعيات والمنظمات'       } },
  crm:         { router: crmRouter,         meta:{ key:'crm',         version:'3.0.0', name_ar:'CRM والولاء'              } },
  mobiles:     { router: mobilesRouter,     meta:{ key:'mobiles',     version:'3.0.0', name_ar:'المحمول والصيانة'         } },
  veterinary:  { router: vetRouter,         meta:{ key:'veterinary',  version:'3.0.0', name_ar:'البيطرة'                  } },
};

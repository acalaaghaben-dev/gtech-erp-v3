// ============================================================
// G-Tech ERP v3 — All Core API Routes
// Auth | Admin | Financials | Invoices | HR | Inventory
// Reports | Settings | Plugins | Broadcasts | Notifications
// ============================================================
'use strict';
const express          = require('express');
const bcrypt           = require('bcryptjs');
const jwt              = require('jsonwebtoken');
const multer           = require('multer');
const path             = require('path');
const fs               = require('fs');
const { supabaseAdmin, nextNumber } = require('./db/client');
const { hotReloadPlugin, deactivatePlugin, getRegistryStatus } = require('./services/pluginLoader');
const { broadcastToAll, sendToTenant, sendKillSwitch }         = require('./services/fcmService');
const { flushTenantCache }                                      = require('./middleware/tenantMiddleware');
const { logger }                                                = require('./utils/logger');

const sign = (p) => jwt.sign(p, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRY || '8h' });

const PM_LABELS = { cash:'نقدي',check:'شيك',credit:'آجل',bank_transfer:'تحويل بنكي',vodafone_cash:'فودافون كاش',instapay:'انستاباي',other:'أخرى' };

// ────────────────────────────────────────────────────────────
// AUTH
// ────────────────────────────────────────────────────────────
const auth = express.Router();

auth.post('/login', async (req, res) => {
  const { email, password, tenant_code } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'البريد وكلمة المرور مطلوبان' });

  if (!tenant_code) {
    // Super-admin login
    const { data: sa } = await supabaseAdmin.from('super_admins').select('*').eq('email', email).eq('is_active', true).single();
    if (!sa || !await bcrypt.compare(password, sa.password_hash))
      return res.status(401).json({ error: 'بيانات غير صحيحة' });
    await supabaseAdmin.from('super_admins').update({ last_login_at: new Date() }).eq('id', sa.id);
    return res.json({ token: sign({ id: sa.id, email, role: 'super_admin', name: sa.name }), role: 'super_admin', name: sa.name });
  }

  // Tenant user login
  const { data: tenant } = await supabaseAdmin.from('tenants')
    .select('id,name_ar,status,suspension_message,suspension_logo_url,logo_url,theme_config,currency,locale,alert_days_before,alert_bar_enabled,alert_bar_position')
    .eq('code', tenant_code).single();

  if (!tenant) return res.status(404).json({ error: 'كود الشركة غير موجود' });

  if (tenant.status !== 'active') {
    return res.status(403).json({
      error: tenant.status,
      message: tenant.suspension_message || 'الحساب موقوف. أ. علاء غبن: 01014868778',
      logo_url: tenant.suspension_logo_url,
      contact: '01014868778',
      data_intact: true,
    });
  }

  const { data: user } = await supabaseAdmin.from('users')
    .select('*').eq('tenant_id', tenant.id).eq('email', email).eq('is_active', true).single();

  if (!user || !await bcrypt.compare(password, user.password_hash))
    return res.status(401).json({ error: 'بيانات غير صحيحة' });

  await supabaseAdmin.from('users').update({ last_login_at: new Date() }).eq('id', user.id);

  const token = sign({
    id: user.id, email, role: user.role, name_ar: user.name_ar,
    tenantId: tenant.id, tenantCode: tenant_code, permissions: user.permissions,
  });

  res.json({ token, role: user.role, name_ar: user.name_ar, tenant });
});

auth.post('/refresh', (req, res) => {
  try {
    const p = jwt.verify(req.body.token, process.env.JWT_SECRET, { ignoreExpiration: true });
    delete p.iat; delete p.exp;
    res.json({ token: sign(p) });
  } catch { res.status(401).json({ error: 'رمز غير صالح' }); }
});

auth.post('/fcm-token', async (req, res) => {
  try {
    const p = jwt.verify(req.body.auth_token, process.env.JWT_SECRET);
    if (p.tenantId) await supabaseAdmin.from('users').update({ fcm_token: req.body.fcm_token }).eq('id', p.id);
    res.json({ success: true });
  } catch { res.status(401).json({ error: 'غير مصرح' }); }
});

// ────────────────────────────────────────────────────────────
// ADMIN (super_admin only)
// ────────────────────────────────────────────────────────────
const admin = express.Router();
const pluginUpload = multer({
  dest: path.resolve(__dirname, '..', 'plugins', '_uploads'),
  limits: { fileSize: 50*1024*1024 },
  fileFilter: (_, f, cb) => f.originalname.endsWith('.zip') ? cb(null, true) : cb(new Error('ZIP only')),
});

admin.get('/dashboard', async (req, res) => {
  const [tenantsTotal, tenantsActive, tenantsSuspended, usersTotal, auditLog] = await Promise.all([
    supabaseAdmin.from('tenants').select('*',{count:'exact',head:true}),
    supabaseAdmin.from('tenants').select('*',{count:'exact',head:true}).eq('status','active'),
    supabaseAdmin.from('tenants').select('*',{count:'exact',head:true}).eq('status','suspended'),
    supabaseAdmin.from('users').select('*',{count:'exact',head:true}),
    supabaseAdmin.from('audit_log').select('*').order('created_at',{ascending:false}).limit(20),
  ]);
  res.json({
    stats: {
      total:      tenantsTotal.count || 0,
      active:     tenantsActive.count || 0,
      suspended:  tenantsSuspended.count || 0,
      users:      usersTotal.count || 0,
      registry:   getRegistryStatus(),
    },
    activity: auditLog.data || [],
    system: { uptime: process.uptime(), version: process.env.APP_VERSION || '3.0.0' },
  });
});

admin.get('/tenants', async (req, res) => {
  const {search,status,plan,page=1,limit=25}=req.query;
  const off=(page-1)*limit;
  let q=supabaseAdmin.from('tenants').select('*,tenant_plugin_activations(plugin_key)',{count:'exact'}).order('created_at',{ascending:false}).range(off,off+limit-1);
  if(status) q=q.eq('status',status);
  if(plan)   q=q.eq('plan',plan);
  if(search) q=q.ilike('name_ar',`%${search}%`);
  const {data,count,error}=await q;
  if(error) return res.status(500).json({error:error.message});
  res.json({data,total:count,page:+page});
});

admin.patch('/tenants/:id', async (req, res) => {
  const allowed=['name_ar','name_en','plan','logo_url','suspension_logo_url','suspension_message','alert_days_before','alert_bar_enabled','alert_bar_position'];
  const updates=Object.fromEntries(Object.entries(req.body).filter(([k])=>allowed.includes(k)));
  updates.updated_at=new Date();
  const {data,error}=await supabaseAdmin.from('tenants').update(updates).eq('id',req.params.id).select().single();
  if(error) return res.status(400).json({error:error.message});
  flushTenantCache(req.params.id);
  res.json(data);
});

// KILL-SWITCH — DATA FREEZE (never deletes anything)
admin.post('/tenants/:id/kill-switch', async (req, res) => {
  const {id}=req.params;
  const {action,message}=req.body;
  if(!['suspend','terminate','reactivate'].includes(action))
    return res.status(400).json({error:'action: suspend | terminate | reactivate'});

  const statusMap={suspend:'suspended',terminate:'terminated',reactivate:'active'};
  const defaultMsg='النسخة متوقفة مؤقتاً، يرجى مراجعة المطور أ. علاء غبن على 01014868778';

  await supabaseAdmin.from('tenants').update({
    status:statusMap[action],
    suspension_message: action!=='reactivate'?(message||defaultMsg):null,
    suspended_at: action!=='reactivate'?new Date():null,
    suspended_by: req.user?.id,
    updated_at: new Date(),
  }).eq('id',id);

  flushTenantCache(id); // Immediate effect on next request

  if(action!=='reactivate') await sendKillSwitch(id, message||defaultMsg).catch(()=>{});

  await supabaseAdmin.from('audit_log').insert({
    tenant_id:id, actor_id:req.user?.id, actor_role:'super_admin',
    action:`kill_switch_${action}`, resource:'tenant', resource_id:id,
    new_data:{status:statusMap[action],data_preserved:true},
  });

  logger.warn(`🚨 Kill-switch [${action}] → tenant:${id} | data_intact:true`);
  res.json({ success:true, newStatus:statusMap[action], data_preserved:true, message:message||defaultMsg });
});

// Plugin Injector — hot-plug without restart
admin.post('/plugins/inject', pluginUpload.single('plugin'), async (req, res) => {
  const {plugin_key,name_ar,version='1.0.0',changelog_ar}=req.body;
  if(!req.file||!plugin_key) return res.status(400).json({error:'plugin_key و ZIP مطلوبان'});
  try {
    const AdmZip=require('adm-zip');
    const zip=new AdmZip(req.file.path);
    const targetDir=path.resolve(__dirname,'..','plugins',plugin_key);
    fs.mkdirSync(targetDir,{recursive:true});
    zip.extractAllTo(targetDir,true);
    if(!fs.existsSync(path.join(targetDir,'index.js'))){
      fs.rmSync(targetDir,{recursive:true});
      return res.status(400).json({error:'index.js مفقود في الحزمة'});
    }
    fs.unlinkSync(req.file.path);
    const {data:existing}=await supabaseAdmin.from('plugins').select('id,version').eq('plugin_key',plugin_key).single();
    if(existing){
      await supabaseAdmin.from('plugin_update_log').insert({plugin_id:existing.id,plugin_key,from_version:existing.version,to_version:version,changelog_ar,deployed_by:req.user?.id});
      await supabaseAdmin.from('plugins').update({version,name_ar,updated_at:new Date()}).eq('plugin_key',plugin_key);
      const reload=await hotReloadPlugin(plugin_key);
      return res.json({success:true,action:'updated',plugin_key,version,...reload});
    }
    await supabaseAdmin.from('plugins').insert({plugin_key,name_ar,version,is_published:true});
    res.json({success:true,action:'created',plugin_key,version});
  } catch(err){
    if(req.file?.path) try{fs.unlinkSync(req.file.path)}catch(e){}
    res.status(500).json({error:err.message});
  }
});

admin.post('/tenants/:tenantId/plugins/:key/activate', async (req, res) => {
  const {tenantId,key}=req.params;
  const {data:p}=await supabaseAdmin.from('plugins').select('id').eq('plugin_key',key).single();
  if(!p) return res.status(404).json({error:'الإضافة غير موجودة'});
  await supabaseAdmin.from('tenant_plugin_activations').upsert({tenant_id:tenantId,plugin_id:p.id,plugin_key:key,is_active:true,config:req.body.config||{},activated_by:req.user?.id},{onConflict:'tenant_id,plugin_id'});
  res.json({success:true});
});

admin.post('/tenants/:tenantId/plugins/:key/deactivate', async (req, res) => {
  const {tenantId,key}=req.params;
  await supabaseAdmin.from('tenant_plugin_activations').update({is_active:false,deactivated_at:new Date()}).eq('tenant_id',tenantId).eq('plugin_key',key);
  deactivatePlugin(tenantId,key);
  res.json({success:true});
});

admin.post('/notify/tenant/:id', async (req, res) => {
  const r=await sendToTenant(req.params.id,req.body);
  await supabaseAdmin.from('notifications').insert({tenant_id:req.params.id,source:'developer',title_ar:req.body.title_ar,body_ar:req.body.body_ar,type:req.body.type||'info'});
  res.json({success:true,...r});
});

admin.post('/notify/broadcast', async (req, res) => {
  const r=await broadcastToAll(req.body);
  await supabaseAdmin.from('notifications').insert({tenant_id:null,source:'developer',title_ar:req.body.title_ar,body_ar:req.body.body_ar,type:'system'});
  res.json({success:true,...r});
});

admin.post('/updates/deploy', async (req, res) => {
  const {version,changelog_ar}=req.body;
  await broadcastToAll({title_ar:`🔄 تحديث النظام v${version}`,body_ar:changelog_ar||'تم تحديث النظام. يرجى إعادة تحميل الصفحة.',type:'system'});
  res.json({success:true,version,deployed_at:new Date()});
});

// ────────────────────────────────────────────────────────────
// FINANCIALS
// ────────────────────────────────────────────────────────────
const financials = express.Router();

financials.get('/accounts', async (req,res) => {
  const {type,search,is_header}=req.query;
  let q=supabaseAdmin.from('chart_of_accounts').select('*').eq('tenant_id',req.tenantId).eq('is_active',true).order('code');
  if(type)      q=q.eq('account_type',type);
  if(is_header) q=q.eq('is_header',is_header==='true');
  if(search)    q=q.or(`name_ar.ilike.%${search}%,code.ilike.%${search}%`);
  const {data,error}=await q;
  if(error) return res.status(500).json({error:error.message});
  res.json(data);
});

financials.post('/accounts', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('chart_of_accounts').insert({...req.body,tenant_id:req.tenantId}).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.status(201).json(data);
});

financials.put('/accounts/:id', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('chart_of_accounts').update(req.body).eq('id',req.params.id).eq('tenant_id',req.tenantId).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.json(data);
});

financials.get('/journal', async (req,res) => {
  const {date_from,date_to,is_posted,page=1,limit=50}=req.query;
  const off=(page-1)*limit;
  let q=supabaseAdmin.from('journal_entries').select('*,journal_entry_lines(*,chart_of_accounts(code,name_ar))',{count:'exact'}).eq('tenant_id',req.tenantId).order('entry_date',{ascending:false}).range(off,off+limit-1);
  if(date_from) q=q.gte('entry_date',date_from);
  if(date_to)   q=q.lte('entry_date',date_to);
  if(is_posted!==undefined) q=q.eq('is_posted',is_posted==='true');
  const {data,count,error}=await q;
  if(error) return res.status(500).json({error:error.message});
  res.json({data,total:count});
});

financials.post('/journal', async (req,res) => {
  const {entry_date,description_ar,lines=[],due_date,payment_method,reference}=req.body;
  const d=new Date(entry_date);
  const locked=(req.tenant?.locked_periods||[]).find(lp=>lp.month===d.getMonth()+1&&lp.year===d.getFullYear());
  if(locked) return res.status(403).json({error:'هذه الفترة المحاسبية مقفلة'});
  const td=lines.reduce((s,l)=>s+(+l.debit||0),0);
  const tc=lines.reduce((s,l)=>s+(+l.credit||0),0);
  if(Math.abs(td-tc)>0.01) return res.status(400).json({error:'مجموع المدين لا يساوي الدائن'});
  const num=await nextNumber(req.tenantId,'journal_entries','JE');
  const {data:entry,error}=await supabaseAdmin.from('journal_entries').insert({
    tenant_id:req.tenantId,entry_number:num,entry_date,description_ar,
    due_date:due_date||null,payment_method:payment_method||'cash',reference:reference||null,
    fiscal_year:d.getFullYear(),fiscal_month:d.getMonth()+1,
    total_debit:td,total_credit:tc,created_by:req.user?.id,
  }).select().single();
  if(error) return res.status(400).json({error:error.message});
  if(lines.length){
    await supabaseAdmin.from('journal_entry_lines').insert(
      lines.map((l,i)=>({tenant_id:req.tenantId,entry_id:entry.id,account_id:l.account_id,debit:l.debit||0,credit:l.credit||0,description:l.description,line_order:i}))
    );
  }
  res.status(201).json(entry);
});

financials.get('/cashboxes', async (req,res) => {
  const {data}=await supabaseAdmin.from('cashboxes').select('*').eq('tenant_id',req.tenantId).eq('is_active',true).order('name_ar');
  res.json(data);
});

financials.post('/cashboxes', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('cashboxes').insert({...req.body,tenant_id:req.tenantId}).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.status(201).json(data);
});

financials.post('/cashboxes/:id/transaction', async (req,res) => {
  const {trans_type,amount,description,reference}=req.body;
  const {data:box}=await supabaseAdmin.from('cashboxes').select('current_balance').eq('id',req.params.id).eq('tenant_id',req.tenantId).single();
  if(!box) return res.status(404).json({error:'الخزينة غير موجودة'});
  const after=box.current_balance+(trans_type==='in'?+amount:-+amount);
  if(after<0) return res.status(400).json({error:'رصيد الخزينة غير كافٍ'});
  await supabaseAdmin.from('cashboxes').update({current_balance:after}).eq('id',req.params.id);
  const {data,error}=await supabaseAdmin.from('cashbox_transactions').insert({tenant_id:req.tenantId,cashbox_id:req.params.id,trans_type,amount,balance_after:after,description,reference,created_by:req.user?.id}).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.status(201).json({transaction:data,new_balance:after});
});

financials.post('/periods/lock', async (req,res) => {
  const {month,year}=req.body;
  const {data:t}=await supabaseAdmin.from('tenants').select('locked_periods').eq('id',req.tenantId).single();
  const periods=t?.locked_periods||[];
  if(!periods.find(p=>p.month===month&&p.year===year)){
    periods.push({month,year,locked_by:req.user?.id,locked_at:new Date()});
    await supabaseAdmin.from('tenants').update({locked_periods:periods}).eq('id',req.tenantId);
  }
  res.json({success:true,locked_periods:periods});
});

financials.post('/periods/unlock', async (req,res) => {
  const {month,year}=req.body;
  const {data:t}=await supabaseAdmin.from('tenants').select('locked_periods').eq('id',req.tenantId).single();
  const periods=(t?.locked_periods||[]).filter(p=>!(p.month===month&&p.year===year));
  await supabaseAdmin.from('tenants').update({locked_periods:periods}).eq('id',req.tenantId);
  res.json({success:true,locked_periods:periods});
});

// ────────────────────────────────────────────────────────────
// INVOICES
// ────────────────────────────────────────────────────────────
const invoices = express.Router();

invoices.get('/', async (req,res) => {
  const {type,status,date_from,date_to,due_from,due_to,payment_method,stakeholder_id,overdue,page=1,limit=50}=req.query;
  const off=(page-1)*limit;
  let q=supabaseAdmin.from('invoices').select('*,stakeholders(name_ar,code,phone)',{count:'exact'}).eq('tenant_id',req.tenantId).order('invoice_date',{ascending:false}).range(off,off+limit-1);
  if(type)           q=q.eq('invoice_type',type);
  if(status)         q=q.eq('status',status);
  if(date_from)      q=q.gte('invoice_date',date_from);
  if(date_to)        q=q.lte('invoice_date',date_to);
  if(due_from)       q=q.gte('due_date',due_from);
  if(due_to)         q=q.lte('due_date',due_to);
  if(payment_method) q=q.eq('payment_method',payment_method);
  if(stakeholder_id) q=q.eq('stakeholder_id',stakeholder_id);
  if(overdue==='true') q=q.lt('due_date',new Date().toISOString().split('T')[0]).not('status','in','(paid,cancelled)');
  const {data,count,error}=await q;
  if(error) return res.status(500).json({error:error.message});
  const today=new Date();
  const enriched=(data||[]).map(inv=>({
    ...inv,
    payment_method_label:PM_LABELS[inv.payment_method]||inv.payment_method,
    days_overdue:inv.due_date?Math.max(0,Math.floor((today-new Date(inv.due_date))/86400000)):null,
    days_remaining:inv.due_date?Math.ceil((new Date(inv.due_date)-today)/86400000):null,
  }));
  res.json({data:enriched,total:count,page:+page,limit:+limit,payment_methods:PM_LABELS});
});

invoices.get('/due-soon', async (req,res) => {
  const days=req.tenant?.alert_days_before||5;
  const threshold=new Date();
  threshold.setDate(threshold.getDate()+days);
  const {data}=await supabaseAdmin.from('invoices')
    .select('id,invoice_number,invoice_type,due_date,balance_due,stakeholders(name_ar)')
    .eq('tenant_id',req.tenantId)
    .lte('due_date',threshold.toISOString().split('T')[0])
    .gte('due_date',new Date().toISOString().split('T')[0])
    .not('status','in','(paid,cancelled)')
    .order('due_date');
  res.json({data,bar_enabled:req.tenant?.alert_bar_enabled,bar_position:req.tenant?.alert_bar_position,days});
});

invoices.get('/:id', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('invoices').select('*,invoice_lines(*,items(name_ar,code,unit)),stakeholders(name_ar,phone,address_ar)').eq('id',req.params.id).eq('tenant_id',req.tenantId).single();
  if(error) return res.status(404).json({error:'الفاتورة غير موجودة'});
  res.json(data);
});

invoices.post('/', async (req,res) => {
  const {invoice_type,invoice_date,due_date,payment_method,check_number,stakeholder_id,warehouse_id,cashbox_id,discount=0,tax_amount=0,paid_amount=0,notes,lines=[]}=req.body;
  const d=new Date(invoice_date);
  const locked=(req.tenant?.locked_periods||[]).find(lp=>lp.month===d.getMonth()+1&&lp.year===d.getFullYear());
  if(locked) return res.status(403).json({error:'هذه الفترة المحاسبية مقفلة'});
  const prefix=invoice_type==='sale'?'INV':invoice_type==='purchase'?'PUR':invoice_type==='return_sale'?'RSL':'RPR';
  const num=await nextNumber(req.tenantId,'invoices',prefix);
  const subtotal=lines.reduce((s,l)=>s+(l.quantity*l.unit_price-(l.discount||0)),0);
  const total=subtotal-discount+tax_amount;
  const {data:inv,error}=await supabaseAdmin.from('invoices').insert({
    tenant_id:req.tenantId,invoice_type,invoice_number:num,invoice_date,due_date:due_date||null,
    payment_method:payment_method||'cash',check_number:check_number||null,
    stakeholder_id:stakeholder_id||null,warehouse_id:warehouse_id||null,cashbox_id:cashbox_id||null,
    subtotal,discount,tax_amount,total,paid_amount,balance_due:total-paid_amount,
    notes:notes||null,created_by:req.user?.id,
  }).select().single();
  if(error) return res.status(400).json({error:error.message});
  if(lines.length){
    await supabaseAdmin.from('invoice_lines').insert(
      lines.map((l,i)=>({tenant_id:req.tenantId,invoice_id:inv.id,item_id:l.item_id||null,description:l.description,quantity:l.quantity,unit_price:l.unit_price,discount:l.discount||0,tax_rate:l.tax_rate||0,line_total:l.quantity*l.unit_price-(l.discount||0),warehouse_id:l.warehouse_id||warehouse_id||null,line_order:i}))
    );
  }
  res.status(201).json(inv);
});

invoices.patch('/:id', async (req,res) => {
  const allowed=['due_date','payment_method','check_number','paid_amount','balance_due','status','notes'];
  const upd=Object.fromEntries(Object.entries(req.body).filter(([k])=>allowed.includes(k)));
  const {data,error}=await supabaseAdmin.from('invoices').update(upd).eq('id',req.params.id).eq('tenant_id',req.tenantId).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.json(data);
});

invoices.delete('/:id', async (req,res) => {
  const {data:inv}=await supabaseAdmin.from('invoices').select('status').eq('id',req.params.id).eq('tenant_id',req.tenantId).single();
  if(inv?.status!=='draft') return res.status(400).json({error:'يمكن حذف المسودات فقط'});
  await supabaseAdmin.from('invoice_lines').delete().eq('invoice_id',req.params.id).eq('tenant_id',req.tenantId);
  await supabaseAdmin.from('invoices').delete().eq('id',req.params.id).eq('tenant_id',req.tenantId);
  res.json({success:true});
});

// ────────────────────────────────────────────────────────────
// INVENTORY
// ────────────────────────────────────────────────────────────
const inventory = express.Router();

const crudHelper = (table, searchField='name_ar') => {
  const r = express.Router();
  r.get('/', async (req,res) => {
    const {search,page=1,limit=50,...filters}=req.query;
    const off=(page-1)*limit;
    let q=supabaseAdmin.from(table).select('*',{count:'exact'}).eq('tenant_id',req.tenantId).order('created_at',{ascending:false}).range(off,off+limit-1);
    if(search) q=q.ilike(searchField,`%${search}%`);
    Object.entries(filters).forEach(([k,v])=>{ if(v) q=q.eq(k,v); });
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
    const {data,error}=await supabaseAdmin.from(table).insert({...req.body,tenant_id:req.tenantId}).select().single();
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

inventory.use('/items',        crudHelper('items'));
inventory.use('/warehouses',   crudHelper('warehouses'));
inventory.use('/stakeholders', crudHelper('stakeholders'));

inventory.get('/stock', async (req,res) => {
  const {warehouse_id,item_id,low_stock}=req.query;
  let q=supabaseAdmin.from('stock_balances').select('*,items(name_ar,code,unit,min_stock),warehouses(name_ar,stage)').eq('tenant_id',req.tenantId);
  if(warehouse_id) q=q.eq('warehouse_id',warehouse_id);
  if(item_id)      q=q.eq('item_id',item_id);
  const {data,error}=await q;
  if(error) return res.status(500).json({error:error.message});
  // PostgREST cannot compare quantity <= items.min_stock via .filter() (column-to-column),
  // so low-stock filtering happens here in JS after the fetch.
  const result = low_stock==='true'
    ? (data||[]).filter(r => (r.items?.min_stock||0) > 0 && (+r.quantity||0) <= (+r.items.min_stock||0))
    : data;
  res.json(result);
});

inventory.get('/items/barcode/:barcode', async (req,res) => {
  const {data,error}=await supabaseAdmin.from('items').select('*').eq('tenant_id',req.tenantId).eq('barcode',req.params.barcode).eq('is_active',true).single();
  if(error||!data) return res.status(404).json({error:'الباركود غير موجود'});
  res.json(data);
});

// ────────────────────────────────────────────────────────────
// HR
// ────────────────────────────────────────────────────────────
const hr = express.Router();
hr.use('/employees',  crudHelper('employees'));

hr.get('/attendance', async (req,res) => {
  const {employee_id,date_from,date_to,page=1,limit=100}=req.query;
  const off=(page-1)*limit;
  let q=supabaseAdmin.from('attendance').select('*,employees(name_ar,code)',{count:'exact'}).eq('tenant_id',req.tenantId).order('work_date',{ascending:false}).range(off,off+limit-1);
  if(employee_id) q=q.eq('employee_id',employee_id);
  if(date_from)   q=q.gte('work_date',date_from);
  if(date_to)     q=q.lte('work_date',date_to);
  const {data,count}=await q;
  res.json({data,total:count});
});

hr.post('/attendance', async (req,res) => {
  const rec={...req.body,tenant_id:req.tenantId};
  if(rec.check_in&&rec.check_out){
    const [ih,im]=rec.check_in.split(':').map(Number);
    const [oh,om]=rec.check_out.split(':').map(Number);
    rec.hours_worked=((oh*60+om)-(ih*60+im))/60;
  }
  const {data,error}=await supabaseAdmin.from('attendance').upsert(rec,{onConflict:'tenant_id,employee_id,work_date'}).select().single();
  if(error) return res.status(400).json({error:error.message});
  res.status(201).json(data);
});

hr.post('/payroll/generate', async (req,res) => {
  const {period_month,period_year}=req.body;
  const locked=(req.tenant?.locked_periods||[]).find(lp=>lp.month===period_month&&lp.year===period_year);
  if(locked) return res.status(403).json({error:'الفترة مقفلة'});
  const {data:emps}=await supabaseAdmin.from('employees').select('*').eq('tenant_id',req.tenantId).eq('is_active',true);
  if(!emps?.length) return res.status(400).json({error:'لا يوجد موظفون نشطون'});
  const df=`${period_year}-${String(period_month).padStart(2,'0')}-01`;
  const dt=new Date(period_year,period_month,0).toISOString().split('T')[0];
  const {data:att}=await supabaseAdmin.from('attendance').select('*').eq('tenant_id',req.tenantId).gte('work_date',df).lte('work_date',dt);
  const num=await nextNumber(req.tenantId,'payroll_runs','PAY');
  const {data:run}=await supabaseAdmin.from('payroll_runs').insert({tenant_id:req.tenantId,period_month,period_year,status:'draft',run_by:req.user?.id}).select().single();
  const lines=emps.map(emp=>{
    const ea=(att||[]).filter(a=>a.employee_id===emp.id);
    const absent=ea.filter(a=>a.status==='absent').length;
    const ot=ea.reduce((s,a)=>s+(a.overtime_hours||0),0);
    const late=ea.reduce((s,a)=>s+(a.late_minutes||0),0);
    const daily=emp.base_salary/26,hourly=emp.base_salary/(26*(emp.working_hours||8));
    const allows=(emp.housing_allow||0)+(emp.transport_allow||0);
    const deds=daily*absent+(late/60)*hourly;
    const otPay=ot*hourly*1.5;
    const gross=emp.base_salary+allows+otPay;
    const net=Math.max(0,gross-deds);
    return {tenant_id:req.tenantId,payroll_run_id:run.id,employee_id:emp.id,base_salary:emp.base_salary,allowances:allows,overtime_pay:otPay,deductions:deds,advances:0,gross_salary:gross,net_salary:net,payment_status:'pending'};
  });
  await supabaseAdmin.from('payroll_lines').insert(lines);
  const tg=lines.reduce((s,l)=>s+l.gross_salary,0),tn=lines.reduce((s,l)=>s+l.net_salary,0),td=lines.reduce((s,l)=>s+l.deductions,0);
  await supabaseAdmin.from('payroll_runs').update({total_gross:tg,total_net:tn,total_ded:td}).eq('id',run.id);
  res.status(201).json({run:{...run,total_gross:tg,total_net:tn},lines,summary:{employees:emps.length,totalGross:tg,totalNet:tn}});
});

hr.get('/payroll',              async (req,res) => { const {data}=await supabaseAdmin.from('payroll_runs').select('*').eq('tenant_id',req.tenantId).order('period_year',{ascending:false}); res.json(data); });
hr.get('/payroll/:id/lines',    async (req,res) => { const {data}=await supabaseAdmin.from('payroll_lines').select('*,employees(name_ar,code,department,job_title)').eq('payroll_run_id',req.params.id).eq('tenant_id',req.tenantId); res.json(data); });
hr.post('/payroll/:id/approve', async (req,res) => { const {data,error}=await supabaseAdmin.from('payroll_runs').update({status:'approved',approved_by:req.user?.id}).eq('id',req.params.id).eq('tenant_id',req.tenantId).select().single(); if(error) return res.status(400).json({error:error.message}); res.json(data); });

// ────────────────────────────────────────────────────────────
// REPORTS
// ────────────────────────────────────────────────────────────
const reports = express.Router();

reports.get('/overdue', async (req,res) => {
  const {data}=await supabaseAdmin.from('invoices').select('*,stakeholders(name_ar,phone,mobile)').eq('tenant_id',req.tenantId).eq('status','overdue').order('due_date');
  res.json(data);
});

reports.get('/cashbox-summary', async (req,res) => {
  const {data}=await supabaseAdmin.from('cashboxes').select('*').eq('tenant_id',req.tenantId).eq('is_active',true);
  const total=((data)||[]).reduce((s,c)=>s+(+c.current_balance||0),0);
  res.json({cashboxes:data,total_balance:total});
});

// ────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ────────────────────────────────────────────────────────────
const notifications = express.Router();

notifications.get('/', async (req,res) => {
  const {unread_only,page=1,limit=30}=req.query;
  const off=(page-1)*limit;
  let q=supabaseAdmin.from('notifications').select('*',{count:'exact'}).or(`user_id.eq.${req.user.id},and(tenant_id.eq.${req.tenantId},user_id.is.null)`).order('created_at',{ascending:false}).range(off,off+limit-1);
  if(unread_only==='true') q=q.eq('is_read',false);
  const {data,count}=await q;
  res.json({data,total:count,unread:(data||[]).filter(n=>!n.is_read).length});
});

notifications.get('/due-soon', async (req,res) => {
  const days=req.tenant?.alert_days_before||5;
  const threshold=new Date(); threshold.setDate(threshold.getDate()+days);
  const {data}=await supabaseAdmin.from('invoices').select('id,invoice_number,invoice_type,due_date,balance_due,total,stakeholders(name_ar)').eq('tenant_id',req.tenantId).lte('due_date',threshold.toISOString().split('T')[0]).gte('due_date',new Date().toISOString().split('T')[0]).not('status','in','(paid,cancelled)').order('due_date');
  res.json({data,bar_enabled:req.tenant?.alert_bar_enabled,bar_position:req.tenant?.alert_bar_position,days});
});

notifications.patch('/read-all', async (req,res) => {
  await supabaseAdmin.from('notifications').update({is_read:true}).or(`user_id.eq.${req.user.id},and(tenant_id.eq.${req.tenantId},user_id.is.null)`);
  res.json({success:true});
});

notifications.patch('/:id/read', async (req,res) => {
  const { error } = await supabaseAdmin.from('notifications')
    .update({is_read:true})
    .eq('id',req.params.id)
    .eq('tenant_id',req.tenantId)
    .or(`user_id.eq.${req.user.id},user_id.is.null`);
  if(error) return res.status(400).json({error:error.message});
  res.json({success:true});
});

// ────────────────────────────────────────────────────────────
// BROADCASTS (Tenant Admin only — isolated per tenant)
// ────────────────────────────────────────────────────────────
const broadcasts = express.Router();

broadcasts.get('/', async (req,res) => {
  const {data}=await supabaseAdmin.from('tenant_broadcasts').select('*,users(name_ar)').eq('tenant_id',req.tenantId).eq('is_active',true).gte('expires_at',new Date().toISOString()).order('created_at',{ascending:false});
  res.json(data);
});

broadcasts.post('/', async (req,res) => {
  const {message_ar,expires_hours=24}=req.body;
  if(!message_ar?.trim()) return res.status(400).json({error:'الرسالة مطلوبة'});
  const expiresAt=new Date(); expiresAt.setHours(expiresAt.getHours()+expires_hours);
  const {data,error}=await supabaseAdmin.from('tenant_broadcasts').insert({tenant_id:req.tenantId,message_ar,sent_by:req.user?.id,expires_at:expiresAt}).select().single();
  if(error) return res.status(400).json({error:error.message});
  await sendToTenant(req.tenantId,{title_ar:'📢 رسالة من الإدارة',body_ar:message_ar,type:'broadcast'}).catch(()=>{});
  await supabaseAdmin.from('notifications').insert({tenant_id:req.tenantId,user_id:null,source:'tenant_admin',title_ar:'📢 رسالة من الإدارة',body_ar:message_ar,type:'broadcast',meta:{broadcast_id:data.id}});
  res.status(201).json(data);
});

broadcasts.patch('/:id/deactivate', async (req,res) => {
  await supabaseAdmin.from('tenant_broadcasts').update({is_active:false}).eq('id',req.params.id).eq('tenant_id',req.tenantId);
  res.json({success:true});
});

// ────────────────────────────────────────────────────────────
// SETTINGS
// ────────────────────────────────────────────────────────────
const settings = express.Router();

settings.get('/', async (req,res) => {
  const {data}=await supabaseAdmin.from('tenants').select('theme_config,locale,currency,timezone,alert_days_before,alert_bar_enabled,alert_bar_position,logo_url,locked_periods,name_ar,name_en').eq('id',req.tenantId).single();
  res.json(data);
});

settings.patch('/', async (req,res) => {
  const allowed=['theme_config','locale','currency','timezone','alert_days_before','alert_bar_enabled','alert_bar_position','logo_url','name_ar','name_en'];
  const upd=Object.fromEntries(Object.entries(req.body).filter(([k])=>allowed.includes(k)));
  upd.updated_at=new Date();
  const {data,error}=await supabaseAdmin.from('tenants').update(upd).eq('id',req.tenantId).select().single();
  if(error) return res.status(400).json({error:error.message});
  flushTenantCache(req.tenantId);
  res.json(data);
});

// ────────────────────────────────────────────────────────────
// PLUGINS (tenant-facing)
// ────────────────────────────────────────────────────────────
const plugins = express.Router();

plugins.get('/', async (req,res) => {
  const {data}=await supabaseAdmin.from('tenant_plugin_activations').select('*,plugins(*)').eq('tenant_id',req.tenantId).eq('is_active',true);
  res.json(data);
});

// ────────────────────────────────────────────────────────────
// TENANTS (super_admin)
// ────────────────────────────────────────────────────────────
const tenants = express.Router();

tenants.get('/',    async (req,res) => { const {data}=await supabaseAdmin.from('tenants').select('*').order('created_at',{ascending:false}); res.json(data); });
tenants.post('/',   async (req,res) => { const {data,error}=await supabaseAdmin.from('tenants').insert(req.body).select().single(); if(error) return res.status(400).json({error:error.message}); res.status(201).json(data); });
tenants.patch('/:id', async (req,res) => { const {data,error}=await supabaseAdmin.from('tenants').update({...req.body,updated_at:new Date()}).eq('id',req.params.id).select().single(); if(error) return res.status(400).json({error:error.message}); flushTenantCache(req.params.id); res.json(data); });

// ────────────────────────────────────────────────────────────
// UPDATES (public, signed)
// ────────────────────────────────────────────────────────────
const updates = express.Router();
updates.get('/latest', (_,res) => res.json({ version: process.env.APP_VERSION||'3.0.0', released_at: new Date().toISOString() }));

// ── Single clean export ────────────────────────────────────
module.exports = { auth, admin, financials, invoices, inventory, hr, reports, notifications, broadcasts, settings, plugins, tenants, updates };

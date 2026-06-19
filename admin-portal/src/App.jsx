import { useState, useEffect } from "react";

// ════════════════════════════════════════════════════════════
// G-Tech Developer ERP v3 — Developer Admin Portal
// لوحة تحكم المطور | أ. علاء غبن | 01014868778
// Kill-Switch | Plugin Injector | Monitoring | Notifications
// ════════════════════════════════════════════════════════════

const T = {
  bg:'#0d1117', surface:'#161b22', surface2:'#1c2128',
  primary:'#0066ff', accent:'#00d4ff', danger:'#ef4444',
  success:'#23c55e', warn:'#f59e0b',
  text:'#e6edf3', muted:'#8b949e', border:'rgba(255,255,255,0.08)',
};

const PLUGINS = [
  { key:'pharmacy',      icon:'💊', name:'الصيدليات',               v:'3.0.0', tenants:15, status:'published' },
  { key:'hr',            icon:'👥', name:'الموارد البشرية والرواتب', v:'3.0.0', tenants:38, status:'published' },
  { key:'manufacturing', icon:'🏭', name:'التصنيع والإنتاج (BOM)',   v:'3.0.0', tenants:7,  status:'published' },
  { key:'excel_importer',icon:'📊', name:'استيراد Excel',            v:'3.0.0', tenants:22, status:'published' },
  { key:'ai_ocr',        icon:'🤖', name:'ماسح الفواتير الذكي',      v:'3.0.0', tenants:11, status:'published' },
  { key:'shipping',      icon:'🚚', name:'الشحن والكوريير',          v:'3.0.0', tenants:8,  status:'published' },
  { key:'logistics',     icon:'🚛', name:'اللوجستيات والأسطول',      v:'3.0.0', tenants:5,  status:'published' },
  { key:'medical',       icon:'🏥', name:'العيادات والمستشفيات',     v:'3.0.0', tenants:11, status:'published' },
  { key:'contracting',   icon:'🔨', name:'المقاولات',               v:'3.0.0', tenants:6,  status:'published' },
  { key:'real_estate',   icon:'🏢', name:'العقارات',                v:'3.0.0', tenants:9,  status:'published' },
  { key:'security',      icon:'🔒', name:'الأمن والحراسة',           v:'3.0.0', tenants:4,  status:'published' },
  { key:'ngo',           icon:'🤝', name:'الجمعيات والمنظمات',       v:'3.0.0', tenants:3,  status:'published' },
  { key:'crm',           icon:'🎯', name:'CRM والولاء',              v:'3.0.0', tenants:22, status:'published' },
  { key:'mobiles',       icon:'📱', name:'المحمول والصيانة',         v:'3.0.0', tenants:12, status:'published' },
  { key:'veterinary',    icon:'🐾', name:'البيطرة',                  v:'3.0.0', tenants:2,  status:'published' },
];

const TENANTS = [
  { id:'t1', code:'PHARMA-001', name_ar:'صيدلية النور الطبية',      status:'active',    plan:'pro',        plugins:['pharmacy','hr','crm'],              users:8,  created:'2024-01-15' },
  { id:'t2', code:'CLINIC-002', name_ar:'مركز الشفاء الطبي',        status:'active',    plan:'enterprise', plugins:['medical','hr','crm','pharmacy'],     users:25, created:'2024-02-01' },
  { id:'t3', code:'MFCT-003',   name_ar:'مصنع الأمل للغزل والنسيج', status:'active',    plan:'enterprise', plugins:['manufacturing','hr','logistics'],    users:42, created:'2024-02-10' },
  { id:'t4', code:'REAL-004',   name_ar:'الدار العقارية للاستثمار', status:'suspended', plan:'pro',        plugins:['real_estate','hr'],                 users:12, created:'2024-03-01' },
  { id:'t5', code:'CONT-005',   name_ar:'مقاولات الإنشاء الحديث',   status:'active',    plan:'pro',        plugins:['contracting','hr','logistics','ai_ocr'], users:18, created:'2024-03-15' },
  { id:'t6', code:'SHIP-006',   name_ar:'شركة السرعة للشحن',        status:'active',    plan:'starter',    plugins:['shipping'],                         users:6,  created:'2024-04-01' },
  { id:'t7', code:'VET-007',    name_ar:'عيادة الحيوان المتخصصة',   status:'active',    plan:'starter',    plugins:['veterinary','hr'],                  users:4,  created:'2024-05-01' },
  { id:'t8', code:'NGO-008',    name_ar:'جمعية نور مصر الخيرية',    status:'active',    plan:'pro',        plugins:['ngo','hr','excel_importer'],         users:9,  created:'2024-05-15' },
];

// ── Reusable Components ────────────────────────────────────
const Pill = ({ label, color }) => (
  <span style={{ background:`${color}20`, color, border:`1px solid ${color}40`, borderRadius:99, padding:'2px 10px', fontSize:11, fontWeight:600 }}>{label}</span>
);

const Card = ({ children, style={} }) => (
  <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:16, padding:22, ...style }}>{children}</div>
);

const Btn = ({ children, onClick, color=T.primary, outline=false, small=false, danger=false, disabled=false, full=false }) => {
  const bg = danger?T.danger:outline?'transparent':color;
  const cl = outline?(danger?T.danger:color):'#fff';
  const bd = outline?`1px solid ${danger?T.danger:color}`:'none';
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background:bg, border:bd, color:cl, borderRadius:10,
      padding:small?'6px 14px':'10px 22px', fontSize:small?12:14, fontWeight:600,
      cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1,
      fontFamily:"'Cairo',sans-serif", display:'inline-flex', alignItems:'center',
      gap:6, transition:'all 0.15s', width:full?'100%':'auto', justifyContent:'center',
    }}>{children}</button>
  );
};

const Input = ({ label, value, onChange, placeholder, type='text', textarea=false }) => (
  <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
    {label && <label style={{ fontSize:12, color:T.muted, fontWeight:600 }}>{label}</label>}
    {textarea
      ? <textarea value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={3}
          style={{ background:'rgba(255,255,255,0.04)', border:`1px solid ${T.border}`, borderRadius:10, padding:'9px 14px', color:T.text, fontFamily:"'Cairo',sans-serif", fontSize:13, outline:'none', resize:'vertical' }} />
      : <input type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
          style={{ background:'rgba(255,255,255,0.04)', border:`1px solid ${T.border}`, borderRadius:10, padding:'9px 14px', color:T.text, fontFamily:"'Cairo',sans-serif", fontSize:13, outline:'none', width:'100%' }} />
    }
  </div>
);

const Modal = ({ show, title, onClose, children, width=500 }) => {
  if (!show) return null;
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16, backdropFilter:'blur(6px)' }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:20, padding:28, width:'100%', maxWidth:width, maxHeight:'90vh', overflowY:'auto' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:22 }}>
          <h3 style={{ fontSize:17, fontWeight:800, color:T.text }}>{title}</h3>
          <button onClick={onClose} style={{ background:'rgba(255,255,255,0.07)', border:'none', color:T.muted, borderRadius:8, padding:'6px 12px', cursor:'pointer', fontSize:15 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
};

const Toast = ({ msg, type='success', onDone }) => {
  useEffect(()=>{ const t=setTimeout(onDone,3000); return ()=>clearTimeout(t); },[]);
  return (
    <div style={{ position:'fixed', top:24, left:'50%', transform:'translateX(-50%)', background:type==='success'?T.success:type==='error'?T.danger:T.warn, color:'#fff', borderRadius:12, padding:'12px 24px', fontWeight:600, fontSize:14, zIndex:2000, boxShadow:'0 8px 32px rgba(0,0,0,0.5)', fontFamily:"'Cairo',sans-serif" }}>
      {type==='success'?'✅':type==='error'?'❌':'⚠️'} {msg}
    </div>
  );
};

// ── Dashboard Page ─────────────────────────────────────────
const DashboardPage = ({ tenants }) => {
  const active    = tenants.filter(t=>t.status==='active').length;
  const suspended = tenants.filter(t=>t.status==='suspended').length;
  const totalUsers = tenants.reduce((s,t)=>s+t.users,0);
  const totalPlugins = tenants.reduce((s,t)=>s+t.plugins.length,0);

  const barData = [
    { label:'يناير', v:12 },{ label:'فبراير', v:18 },{ label:'مارس',   v:22 },
    { label:'أبريل', v:28 },{ label:'مايو',   v:35 },{ label:'يونيو',  v:tenants.length },
  ];
  const maxV = Math.max(...barData.map(d=>d.v));

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:14 }}>
        {[
          { label:'إجمالي المستأجرين', value:tenants.length, icon:'🏢', color:T.accent },
          { label:'نشطون',              value:active,         icon:'✅', color:T.success },
          { label:'موقوفون',             value:suspended,      icon:'⏸',  color:T.warn },
          { label:'إجمالي المستخدمين', value:totalUsers,      icon:'👥', color:'#a855f7' },
          { label:'إضافات مفعّلة',     value:totalPlugins,    icon:'🔌', color:'#f97316' },
          { label:'إضافات متاحة',      value:PLUGINS.length,  icon:'⭐', color:'#ec4899' },
        ].map((k,i) => (
          <Card key={i} style={{ cursor:'default' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
              <span style={{ fontSize:12, color:T.muted }}>{k.label}</span>
              <span style={{ fontSize:22, filter:`drop-shadow(0 0 6px ${k.color}88)` }}>{k.icon}</span>
            </div>
            <div style={{ fontSize:34, fontWeight:900, color:k.color, lineHeight:1 }}>{k.value}</div>
          </Card>
        ))}
      </div>

      {/* Growth Chart */}
      <Card>
        <h3 style={{ color:T.text, fontSize:15, fontWeight:700, marginBottom:20 }}>📈 نمو المستأجرين — آخر 6 أشهر</h3>
        <div style={{ display:'flex', alignItems:'flex-end', gap:10, height:140 }}>
          {barData.map((d,i) => (
            <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, flex:1 }}>
              <span style={{ fontSize:12, color:T.accent, fontWeight:700 }}>{d.v}</span>
              <div style={{ width:'100%', height:(d.v/maxV)*110, background:i===barData.length-1?`linear-gradient(180deg,${T.accent},${T.primary})`:`${T.primary}44`, borderRadius:'6px 6px 0 0', minHeight:4, transition:'all 0.3s' }} />
              <span style={{ fontSize:10, color:T.muted, textAlign:'center' }}>{d.label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Recent activity */}
      <Card>
        <h3 style={{ color:T.text, fontSize:15, fontWeight:700, marginBottom:16 }}>🕐 آخر المستأجرين المضافين</h3>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {tenants.slice(0,5).map(t => (
            <div key={t.id} style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 14px', background:T.surface2, borderRadius:10, border:`1px solid ${T.border}` }}>
              <div style={{ width:38, height:38, borderRadius:10, background:`${T.primary}22`, border:`1px solid ${T.primary}33`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>🏢</div>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:700, fontSize:13, color:T.text }}>{t.name_ar}</div>
                <div style={{ fontSize:11, color:T.muted }}>{t.code} • {t.plugins.length} إضافات • {t.users} مستخدم</div>
              </div>
              <Pill label={t.status==='active'?'نشط':'موقوف'} color={t.status==='active'?T.success:T.warn} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

// ── Tenants Page ───────────────────────────────────────────
const TenantsPage = ({ tenants, setTenants, showToast }) => {
  const [search,    setSearch]    = useState('');
  const [killModal, setKillModal] = useState(null);
  const [killMsg,   setKillMsg]   = useState('النسخة متوقفة مؤقتاً، يرجى مراجعة المطور أ. علاء غبن على 01014868778');
  const [plugModal, setPlugModal] = useState(null);

  const filtered = tenants.filter(t => t.name_ar.includes(search)||t.code.includes(search));

  const applyKill = (action) => {
    const statusMap = { suspend:'suspended', terminate:'terminated', reactivate:'active' };
    setTenants(prev => prev.map(t => t.id===killModal.id ? { ...t, status:statusMap[action] } : t));
    showToast(action==='reactivate'?'✅ تم إعادة التفعيل':'🚨 تم تطبيق Kill-Switch — البيانات محفوظة بالكامل', action==='reactivate'?'success':'warn');
    setKillModal(null);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <div style={{ display:'flex', gap:10, alignItems:'center' }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 بحث بالاسم أو الكود..."
          style={{ flex:1, background:'rgba(255,255,255,0.05)', border:`1px solid ${T.border}`, borderRadius:12, padding:'10px 16px', color:T.text, fontFamily:"'Cairo',sans-serif", fontSize:13, outline:'none' }} />
        <Btn small>➕ مستأجر جديد</Btn>
      </div>

      <div style={{ overflowX:'auto', border:`1px solid ${T.border}`, borderRadius:14 }}>
        <table style={{ width:'100%', borderCollapse:'collapse', minWidth:900 }}>
          <thead>
            <tr style={{ background:'rgba(255,255,255,0.04)', borderBottom:`1px solid ${T.border}` }}>
              {['الكود','الاسم','الحالة','الخطة','الإضافات','المستخدمين','الإجراءات'].map(h=>(
                <th key={h} style={{ padding:'12px 14px', textAlign:'right', fontSize:11, color:T.muted, fontWeight:700, whiteSpace:'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((t,i) => (
              <tr key={t.id} style={{ borderBottom:`1px solid ${T.border}`, background:i%2===0?'transparent':'rgba(255,255,255,0.01)', transition:'background 0.1s' }}
                onMouseEnter={e=>e.currentTarget.style.background=`${T.primary}08`}
                onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'transparent':'rgba(255,255,255,0.01)'}>
                <td style={{ padding:'12px 14px', fontFamily:'monospace', fontSize:12, color:T.accent }}>{t.code}</td>
                <td style={{ padding:'12px 14px', fontWeight:700, fontSize:13, color:T.text }}>{t.name_ar}</td>
                <td style={{ padding:'12px 14px' }}>
                  <Pill label={t.status==='active'?'✅ نشط':t.status==='suspended'?'⏸ موقوف':'🚫 منتهي'} color={t.status==='active'?T.success:t.status==='suspended'?T.warn:T.danger} />
                </td>
                <td style={{ padding:'12px 14px' }}>
                  <span style={{ background:t.plan==='enterprise'?'rgba(168,85,247,0.2)':t.plan==='pro'?`${T.primary}22`:'rgba(255,255,255,0.1)', color:t.plan==='enterprise'?'#a855f7':t.plan==='pro'?'#60a5fa':T.muted, borderRadius:6, padding:'2px 8px', fontSize:11, fontWeight:700 }}>
                    {t.plan==='enterprise'?'Enterprise':t.plan==='pro'?'Pro':'Starter'}
                  </span>
                </td>
                <td style={{ padding:'12px 14px' }}>
                  <div style={{ display:'flex', gap:3, flexWrap:'wrap' }}>
                    {t.plugins.slice(0,4).map(pk => {
                      const pl=PLUGINS.find(p=>p.key===pk);
                      return pl?<span key={pk} title={pl.name} style={{fontSize:14}}>{pl.icon}</span>:null;
                    })}
                    {t.plugins.length>4&&<span style={{fontSize:11,color:T.muted}}>+{t.plugins.length-4}</span>}
                  </div>
                </td>
                <td style={{ padding:'12px 14px', fontSize:13, color:T.muted }}>{t.users}</td>
                <td style={{ padding:'12px 14px' }}>
                  <div style={{ display:'flex', gap:6 }}>
                    <Btn small outline color={T.accent} onClick={()=>setPlugModal(t)}>إضافات</Btn>
                    <Btn small danger={t.status==='active'} outline={t.status!=='active'} color={t.status==='active'?T.danger:T.success}
                      onClick={()=>setKillModal(t)}>
                      {t.status==='active'?'إيقاف':'تفعيل'}
                    </Btn>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Kill-Switch Modal */}
      <Modal show={!!killModal} title={`⚡ Kill-Switch — ${killModal?.name_ar}`} onClose={()=>setKillModal(null)}>
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:10, padding:14, fontSize:13, color:'#fca5a5', lineHeight:1.7 }}>
            ⚠️ سيُجمَّد وصول المستأجر فوراً.<br/>
            ✅ <strong>لا يُحذف ولا يُعدَّل أي سجل في قاعدة البيانات.</strong><br/>
            عند إعادة التفعيل، تعود جميع البيانات كاملة.
          </div>
          <Input label="رسالة مخصصة تظهر للمستأجر" value={killMsg} onChange={setKillMsg} textarea />
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <Btn danger onClick={()=>applyKill('suspend')}>⏸ إيقاف مؤقت</Btn>
            <Btn danger onClick={()=>applyKill('terminate')}>🚫 إنهاء الحساب</Btn>
            <Btn color={T.success} onClick={()=>applyKill('reactivate')}>✅ إعادة التفعيل</Btn>
          </div>
        </div>
      </Modal>

      {/* Plugin Management Modal */}
      <Modal show={!!plugModal} title={`🔌 إضافات — ${plugModal?.name_ar}`} onClose={()=>setPlugModal(null)} width={560}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          {PLUGINS.map(p => {
            const active = plugModal?.plugins?.includes(p.key);
            return (
              <div key={p.key} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:active?`${T.primary}18`:T.surface2, borderRadius:10, border:`1px solid ${active?T.primary+'44':T.border}` }}>
                <span style={{fontSize:20}}>{p.icon}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:700,color:T.text}}>{p.name}</div>
                  <div style={{fontSize:10,color:T.muted}}>v{p.v}</div>
                </div>
                <Btn small outline={!active} color={active?T.danger:T.success}>{active?'إيقاف':'تفعيل'}</Btn>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
};

// ── Plugins Page ───────────────────────────────────────────
const PluginsPage = ({ showToast }) => {
  const [injectModal, setInjectModal] = useState(false);
  const [newPlugin, setNewPlugin] = useState({ key:'', name_ar:'', version:'1.0.0', changelog_ar:'' });
  const [injecting, setInjecting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleInject = () => {
    if (!newPlugin.key||!newPlugin.name_ar) return;
    setInjecting(true);
    setTimeout(()=>{ setInjecting(false); setInjectModal(false); showToast(`✅ تم حقن الإضافة "${newPlugin.name_ar}" v${newPlugin.version} بنجاح وتحميلها لجميع المستأجرين`); setNewPlugin({key:'',name_ar:'',version:'1.0.0',changelog_ar:''}); },2000);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <h2 style={{ fontSize:18, fontWeight:800, color:T.text }}>مكتبة الإضافات</h2>
          <p style={{ color:T.muted, fontSize:13, marginTop:4 }}>{PLUGINS.length} إضافة • Hot-plug بدون إيقاف الخادم</p>
        </div>
        <Btn onClick={()=>setInjectModal(true)}>⬆️ حقن إضافة جديدة</Btn>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:14 }}>
        {PLUGINS.map(p => (
          <Card key={p.key} style={{ transition:'all 0.2s', cursor:'default' }}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=`${T.accent}44`;e.currentTarget.style.transform='translateY(-2px)';}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.transform='translateY(0)';}}>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
              <span style={{ fontSize:30 }}>{p.icon}</span>
              <div>
                <div style={{ fontWeight:700, fontSize:14, color:T.text }}>{p.name}</div>
                <div style={{ fontSize:11, color:T.muted }}>v{p.v} • {p.key}</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:12 }}>
              <Pill label="✓ منشورة" color={T.success} />
              <span style={{ fontSize:12, color:T.muted }}>{p.tenants} مستأجر</span>
            </div>
            <div style={{ display:'flex', gap:6 }}>
              <Btn small outline color={T.accent}>🔄 تحديث</Btn>
              <Btn small outline color={T.muted}>⚙️ إدارة</Btn>
            </div>
          </Card>
        ))}
      </div>

      {/* Inject Modal */}
      <Modal show={injectModal} title="⬆️ حقن إضافة جديدة (Hot-Plug)" onClose={()=>setInjectModal(false)}>
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <Input label="مفتاح الإضافة (بالإنجليزية، بدون مسافات)" value={newPlugin.key} onChange={v=>setNewPlugin(p=>({...p,key:v.toLowerCase().replace(/\s/g,'_')}))} placeholder="my_new_plugin" />
          <Input label="اسم الإضافة بالعربية" value={newPlugin.name_ar} onChange={v=>setNewPlugin(p=>({...p,name_ar:v}))} placeholder="اسم الإضافة" />
          <Input label="رقم الإصدار" value={newPlugin.version} onChange={v=>setNewPlugin(p=>({...p,version:v}))} placeholder="1.0.0" />
          <Input label="سجل التغييرات (اختياري)" value={newPlugin.changelog_ar} onChange={v=>setNewPlugin(p=>({...p,changelog_ar:v}))} textarea placeholder="وصف التحديثات..." />
          {/* Drop zone */}
          <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={e=>{e.preventDefault();setDragOver(false);}}
            style={{ border:`2px dashed ${dragOver?T.primary:T.border}`, borderRadius:12, padding:30, textAlign:'center', color:dragOver?T.primary:T.muted, background:dragOver?`${T.primary}08`:'transparent', transition:'all 0.2s', cursor:'pointer' }}>
            📦 اسحب ملف ZIP هنا أو انقر للاختيار<br />
            <span style={{ fontSize:12 }}>الحجم الأقصى: 50MB | index.js مطلوب في الجذر</span>
          </div>
          <Btn full color={T.primary} onClick={handleInject} disabled={injecting||!newPlugin.key||!newPlugin.name_ar}>
            {injecting?'⏳ جاري الحقن والتحميل...':'🚀 حقن الإضافة الآن'}
          </Btn>
        </div>
      </Modal>
    </div>
  );
};

// ── Notifications Page ─────────────────────────────────────
const NotifyPage = ({ tenants, showToast }) => {
  const [mode, setMode] = useState('tenant');
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState({ title_ar:'', body_ar:'', type:'info' });
  const [sending, setSending] = useState(false);
  const upd = (k,v) => setForm(f=>({...f,[k]:v}));

  const handleSend = () => {
    if(!form.title_ar||!form.body_ar) return;
    setSending(true);
    setTimeout(()=>{
      setSending(false);
      const t=tenants.find(t=>t.id===selectedId);
      showToast(`✅ تم الإرسال: "${form.title_ar}" → ${mode==='broadcast'?'جميع المستأجرين':t?.name_ar||'المستأجر'}`);
      setForm({title_ar:'',body_ar:'',type:'info'});
    },1500);
  };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, alignItems:'start' }}>
      <Card>
        <h3 style={{ color:T.text, fontSize:16, fontWeight:700, marginBottom:20 }}>📣 إرسال إشعار</h3>
        {/* Mode toggle */}
        <div style={{ display:'flex', gap:8, marginBottom:18 }}>
          {[{k:'tenant',l:'🏢 مستأجر محدد'},{k:'broadcast',l:'📢 جميع المستأجرين'}].map(m=>(
            <button key={m.k} onClick={()=>setMode(m.k)} style={{ flex:1, padding:'10px', borderRadius:10, border:'none', background:mode===m.k?T.primary:'rgba(255,255,255,0.06)', color:T.text, cursor:'pointer', fontFamily:"'Cairo',sans-serif", fontSize:13, fontWeight:mode===m.k?700:400 }}>{m.l}</button>
          ))}
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {mode==='tenant'&&(
            <div>
              <label style={{ fontSize:12, color:T.muted, display:'block', marginBottom:5 }}>اختر المستأجر</label>
              <select value={selectedId} onChange={e=>setSelectedId(e.target.value)} style={{ width:'100%', background:'rgba(255,255,255,0.04)', border:`1px solid ${T.border}`, borderRadius:10, padding:'9px 14px', color:T.text, fontFamily:"'Cairo',sans-serif", fontSize:13, outline:'none' }}>
                <option value="">-- اختر مستأجر --</option>
                {tenants.map(t=><option key={t.id} value={t.id}>{t.name_ar}</option>)}
              </select>
            </div>
          )}
          <Input label="عنوان الإشعار" value={form.title_ar} onChange={v=>upd('title_ar',v)} placeholder="عنوان الإشعار..." />
          <Input label="نص الإشعار" value={form.body_ar} onChange={v=>upd('body_ar',v)} textarea placeholder="محتوى الإشعار..." />
          <div>
            <label style={{ fontSize:12, color:T.muted, display:'block', marginBottom:5 }}>نوع الإشعار</label>
            <select value={form.type} onChange={e=>upd('type',e.target.value)} style={{ width:'100%', background:'rgba(255,255,255,0.04)', border:`1px solid ${T.border}`, borderRadius:10, padding:'9px 14px', color:T.text, fontFamily:"'Cairo',sans-serif", fontSize:13, outline:'none' }}>
              <option value="info">💬 معلوماتي</option>
              <option value="warning">⚠️ تحذير</option>
              <option value="success">✅ نجاح</option>
              <option value="system">⚙️ نظام</option>
            </select>
          </div>
          <Btn full color={T.primary} onClick={handleSend} disabled={sending||!form.title_ar||!form.body_ar||(!selectedId&&mode==='tenant')}>
            {sending?'⏳ جاري الإرسال...':'🚀 إرسال الإشعار'}
          </Btn>
        </div>
      </Card>

      <Card>
        <h3 style={{ color:T.text, fontSize:15, fontWeight:700, marginBottom:16 }}>📋 آخر الإشعارات المرسلة</h3>
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[
            { title:'تحديث النظام v3.0',        type:'system',  time:'منذ ساعة',   to:'جميع المستأجرين' },
            { title:'تجديد الاشتراك',            type:'warning', time:'منذ 3 ساعات', to:'صيدلية النور' },
            { title:'تم تفعيل إضافة AI OCR',    type:'success', time:'أمس',         to:'مقاولات الإنشاء' },
            { title:'صيانة مجدولة — الجمعة',    type:'info',    time:'منذ 3 أيام',  to:'جميع المستأجرين' },
            { title:'Kill-Switch تم التطبيق',   type:'system',  time:'منذ 5 أيام',  to:'الدار العقارية' },
          ].map((n,i)=>(
            <div key={i} style={{ padding:'11px 14px', background:T.surface2, borderRadius:10, border:`1px solid ${T.border}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontWeight:600, fontSize:13, color:T.text }}>{n.title}</span>
                <span style={{ fontSize:10, color:T.muted }}>{n.time}</span>
              </div>
              <div style={{ fontSize:12, color:T.muted, marginTop:3 }}>→ {n.to}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

// ── MAIN ADMIN APP ─────────────────────────────────────────
export default function GTechAdminPortal() {
  const [page,        setPage]        = useState('dashboard');
  const [tenants,     setTenants]     = useState(TENANTS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toast,       setToast]       = useState(null);

  const showToast = (msg, type='success') => setToast({ msg, type });

  const nav = [
    { key:'dashboard',     label:'لوحة التحكم',    icon:'📊' },
    { key:'tenants',       label:'المستأجرون',      icon:'🏢' },
    { key:'plugins',       label:'الإضافات',         icon:'🔌' },
    { key:'notifications', label:'الإشعارات',        icon:'📣' },
    { key:'settings',      label:'الإعدادات',        icon:'⚙️' },
  ];

  const renderPage = () => {
    switch(page) {
      case 'dashboard':     return <DashboardPage    tenants={tenants} />;
      case 'tenants':       return <TenantsPage      tenants={tenants} setTenants={setTenants} showToast={showToast} />;
      case 'plugins':       return <PluginsPage       showToast={showToast} />;
      case 'notifications': return <NotifyPage        tenants={tenants} showToast={showToast} />;
      default: return <div style={{color:T.muted,padding:40,textAlign:'center'}}>قريباً...</div>;
    }
  };

  return (
    <div style={{ display:'flex', minHeight:'100vh', background:T.bg, color:T.text, fontFamily:"'Cairo',sans-serif", direction:'rtl' }}>
      {toast && <Toast msg={toast.msg} type={toast.type} onDone={()=>setToast(null)} />}

      {/* Sidebar */}
      <aside style={{ width:sidebarOpen?255:70, background:'#010409', borderLeft:`1px solid ${T.border}`, display:'flex', flexDirection:'column', transition:'width 0.25s ease', overflow:'hidden', position:'sticky', top:0, height:'100vh', flexShrink:0 }}>
        <div style={{ padding:sidebarOpen?'24px 20px 16px':'24px 14px 16px', borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ width:42, height:42, borderRadius:12, flexShrink:0, background:`linear-gradient(135deg,${T.primary},${T.accent})`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, fontWeight:900, color:'#fff', boxShadow:`0 4px 20px ${T.primary}55` }}>G</div>
            {sidebarOpen&&(
              <div>
                <div style={{ fontSize:14, fontWeight:900, color:T.text, lineHeight:1.2 }}>جيتك المطور</div>
                <div style={{ fontSize:10, color:T.muted }}>Developer Admin Portal v3</div>
              </div>
            )}
          </div>
        </div>

        <nav style={{ flex:1, padding:'12px 10px', display:'flex', flexDirection:'column', gap:3 }}>
          {nav.map(item=>(
            <button key={item.key} onClick={()=>setPage(item.key)} style={{
              display:'flex', alignItems:'center', gap:12,
              padding:sidebarOpen?'11px 14px':'11px',
              borderRadius:12, border:'none', cursor:'pointer',
              background:page===item.key?`${T.primary}20`:'transparent',
              color:page===item.key?T.primary:T.muted,
              fontFamily:"'Cairo',sans-serif", fontSize:13, fontWeight:page===item.key?700:400,
              borderRight:page===item.key?`3px solid ${T.primary}`:'3px solid transparent',
              width:'100%', textAlign:'right', transition:'all 0.15s',
            }}>
              <span style={{fontSize:18,flexShrink:0}}>{item.icon}</span>
              {sidebarOpen&&item.label}
            </button>
          ))}
        </nav>

        {sidebarOpen&&(
          <div style={{ padding:'12px 16px', borderTop:`1px solid ${T.border}`, fontSize:11, color:T.muted, flexShrink:0 }}>
            <div style={{ fontWeight:700, color:T.muted, marginBottom:2 }}>👤 أ. علاء غبن</div>
            <div>📞 01014868778</div>
            <div style={{ marginTop:4, color:'#21262d' }}>G-Tech Developer ERP v3.0</div>
          </div>
        )}
      </aside>

      {/* Main */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        <header style={{ height:62, background:T.surface, borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', padding:'0 22px', gap:14, position:'sticky', top:0, zIndex:100, flexShrink:0 }}>
          <button onClick={()=>setSidebarOpen(v=>!v)} style={{ background:'rgba(255,255,255,0.06)', border:'none', color:T.muted, borderRadius:8, padding:'7px 11px', cursor:'pointer', fontSize:16 }}>☰</button>
          <span style={{ fontWeight:800, fontSize:15, color:T.text }}>
            {nav.find(n=>n.key===page)?.icon}{' '}{nav.find(n=>n.key===page)?.label}
          </span>
          <div style={{ flex:1 }} />
          <Pill label={`${tenants.filter(t=>t.status==='active').length} نشط`} color={T.success} />
          <Pill label={`${tenants.filter(t=>t.status==='suspended').length} موقوف`} color={T.warn} />
          <div style={{ background:'rgba(35,197,94,0.12)', border:'1px solid rgba(35,197,94,0.3)', color:T.success, borderRadius:99, padding:'4px 12px', fontSize:11, fontWeight:600 }}>⬤ النظام يعمل</div>
        </header>

        <main style={{ flex:1, padding:24, overflowY:'auto' }}>
          <div style={{ maxWidth:1400, margin:'0 auto' }}>{renderPage()}</div>
        </main>
      </div>
    </div>
  );
}

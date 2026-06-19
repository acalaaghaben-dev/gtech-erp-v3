import { useState, useEffect, useRef, useMemo } from "react";

// ════════════════════════════════════════════════════════════
// G-Tech Developer ERP v3 — Tenant Portal (Complete)
// جيتك المطور | أ. علاء غبن | 01014868778
// PWA | Excel Grid | Theme Engine | Ticker | Broadcasts
// ════════════════════════════════════════════════════════════

// ── Theme Engine ───────────────────────────────────────────
const THEMES = {
  dark_blue:   { mode:'dark',  name:'داكن أزرق',    primary:'#0066ff', accent:'#00d4ff', bg:'#0d1117', surface:'#161b22', surfaceHover:'#1c2128', sidebar:'#010409', text:'#e6edf3', muted:'#8b949e', border:'rgba(255,255,255,0.08)', shadow:'rgba(0,102,255,0.2)' },
  dark_green:  { mode:'dark',  name:'داكن أخضر',    primary:'#10b981', accent:'#34d399', bg:'#0a0f0d', surface:'#0f1a14', surfaceHover:'#162010', sidebar:'#050d08', text:'#ecfdf5', muted:'#6ee7b7', border:'rgba(52,211,153,0.1)', shadow:'rgba(16,185,129,0.2)' },
  dark_purple: { mode:'dark',  name:'داكن بنفسجي',  primary:'#8b5cf6', accent:'#a78bfa', bg:'#0f0a1a', surface:'#17102b', surfaceHover:'#1e1535', sidebar:'#08051a', text:'#f5f3ff', muted:'#c4b5fd', border:'rgba(139,92,246,0.12)', shadow:'rgba(139,92,246,0.2)' },
  dark_red:    { mode:'dark',  name:'داكن أحمر',    primary:'#ef4444', accent:'#f97316', bg:'#0f0a0a', surface:'#1a1010', surfaceHover:'#201515', sidebar:'#080505', text:'#fef2f2', muted:'#fca5a5', border:'rgba(239,68,68,0.12)', shadow:'rgba(239,68,68,0.2)' },
  light_blue:  { mode:'light', name:'فاتح أزرق',    primary:'#0066ff', accent:'#0ea5e9', bg:'#f0f4ff', surface:'#ffffff', surfaceHover:'#f8faff', sidebar:'#1e293b', text:'#1e293b', muted:'#64748b', border:'rgba(0,0,0,0.08)', shadow:'rgba(0,102,255,0.15)' },
  light_clean: { mode:'light', name:'فاتح نظيف',    primary:'#1d4ed8', accent:'#3b82f6', bg:'#f8fafc', surface:'#ffffff', surfaceHover:'#f1f5f9', sidebar:'#0f172a', text:'#0f172a', muted:'#64748b', border:'rgba(0,0,0,0.07)', shadow:'rgba(29,78,216,0.15)' },
};

// ── PWA Install Prompt ─────────────────────────────────────
const usePWA = () => {
  const [installable, setInstallable] = useState(false);
  const promptRef = useRef(null);
  useEffect(() => {
    const handler = (e) => { e.preventDefault(); promptRef.current = e; setInstallable(true); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  const install = async () => {
    if (!promptRef.current) return;
    await promptRef.current.prompt();
    promptRef.current = null;
    setInstallable(false);
  };
  return { installable, install };
};

// ── Mock data ──────────────────────────────────────────────
const MOCK = {
  tenant: { name_ar:'صيدلية النور الطبية', logo_url:null, currency:'EGP', alert_bar_enabled:true, alert_bar_position:'top', theme_config:{ mode:'dark', primary:'#0066ff' } },
  user:   { name_ar:'أحمد محمد', role:'tenant_admin' },
  dueSoon:[
    { invoice_number:'PUR-2024-00234', stakeholders:{name_ar:'شركة الدواء المصرية'}, due_date:'2024-06-11', balance_due:12500, invoice_type:'purchase', days_remaining:2 },
    { invoice_number:'INV-2024-00891', stakeholders:{name_ar:'عيادة الرشيد'}, due_date:'2024-06-13', balance_due:4800, invoice_type:'sale', days_remaining:4 },
    { invoice_number:'PUR-2024-00245', stakeholders:{name_ar:'مستودع أدوية الأمل'}, due_date:'2024-06-16', balance_due:28000, invoice_type:'purchase', days_remaining:7 },
  ],
  broadcasts:[
    { id:'b1', message_ar:'📋 تذكير: اجتماع الموظفين غداً الساعة 10 صباحاً في قاعة الاجتماعات. الحضور إلزامي لجميع الأقسام.', created_at: new Date().toISOString() },
  ],
  stats:{ revenue:284500, purchases:147200, outstanding:48700, overdue:6700, cash_balance:35800 },
  invoices:[
    { id:'i1', invoice_number:'INV-2024-00891', invoice_type:'sale',     invoice_date:'2024-06-08', due_date:'2024-06-13', stakeholder:'عيادة الرشيد',             total:4800,  status:'posted',  payment_method:'check',         balance_due:4800,  days_remaining:4 },
    { id:'i2', invoice_number:'PUR-2024-00234', invoice_type:'purchase', invoice_date:'2024-06-05', due_date:'2024-06-11', stakeholder:'شركة الدواء المصرية',      total:12500, status:'posted',  payment_method:'credit',         balance_due:12500, days_remaining:2 },
    { id:'i3', invoice_number:'INV-2024-00890', invoice_type:'sale',     invoice_date:'2024-06-01', due_date:'2024-06-08', stakeholder:'مستشفى القاهرة الجديدة',  total:9200,  status:'paid',    payment_method:'bank_transfer',  balance_due:0,     days_remaining:null },
    { id:'i4', invoice_number:'INV-2024-00889', invoice_type:'sale',     invoice_date:'2024-05-28', due_date:'2024-06-03', stakeholder:'صيدلية السلام',            total:6700,  status:'overdue', payment_method:'cash',           balance_due:6700,  days_remaining:-4 },
    { id:'i5', invoice_number:'PUR-2024-00233', invoice_type:'purchase', invoice_date:'2024-05-25', due_date:null,         stakeholder:'مستلزمات طبية متعددة',    total:18900, status:'posted',  payment_method:'cash',           balance_due:18900, days_remaining:null },
    { id:'i6', invoice_number:'INV-2024-00888', invoice_type:'sale',     invoice_date:'2024-05-20', due_date:'2024-05-27', stakeholder:'مركز رعاية صحية',         total:3200,  status:'paid',    payment_method:'vodafone_cash',  balance_due:0,     days_remaining:null },
  ],
};

const PM_LABELS = { cash:'نقدي 💵', check:'شيك 📄', credit:'آجل 🔄', bank_transfer:'تحويل بنكي 🏦', vodafone_cash:'فودافون كاش 📱', instapay:'انستاباي ⚡', other:'أخرى' };
const STATUS_CFG = { draft:{label:'مسودة',color:'#8b949e'}, posted:{label:'مُرحَّل',color:'#60a5fa'}, paid:{label:'مدفوع',color:'#23c55e'}, overdue:{label:'متأخر',color:'#ef4444'}, cancelled:{label:'ملغي',color:'#6e7681'} };

// ══════════════════════════════════════════════════════════
// UI COMPONENTS
// ══════════════════════════════════════════════════════════

const Badge = ({ label, color, bg }) => (
  <span style={{ background: bg||`${color}22`, color, border:`1px solid ${color}44`, borderRadius:99, padding:'2px 10px', fontSize:11, fontWeight:600, whiteSpace:'nowrap' }}>{label}</span>
);

const Btn = ({ children, onClick, color, outline, small, danger, disabled, full, style={} }) => {
  const bg    = danger ? '#ef4444' : outline ? 'transparent' : (color||'#0066ff');
  const cl    = danger ? '#fff'    : outline ? (color||'#0066ff') : '#fff';
  const bd    = outline ? `1px solid ${color||'#0066ff'}` : danger ? '1px solid #ef4444' : 'none';
  const [hov, setHov] = useState(false);
  return (
    <button onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      onClick={onClick} disabled={disabled} style={{
        background:   disabled ? '#333' : hov ? (outline?`${color||'#0066ff'}18`:bg+'dd') : bg,
        border: bd, color: disabled?'#666':cl,
        borderRadius:10, padding:small?'6px 14px':'10px 22px',
        fontSize:small?12:14, fontWeight:600,
        cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.6:1,
        fontFamily:"'Cairo',sans-serif", display:'inline-flex', alignItems:'center',
        gap:6, transition:'all 0.15s', width:full?'100%':'auto',
        justifyContent:'center', ...style,
      }}>{children}</button>
  );
};

// ── Searchable Dropdown ────────────────────────────────────
const SearchDropdown = ({ options, value, onChange, placeholder, theme:t }) => {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef();
  const filtered = useMemo(()=>options.filter(o=>o.label.includes(search)||o.value.includes(search)),[options,search]);
  const selected = options.find(o=>o.value===value);
  useEffect(()=>{ const fn=e=>{ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown',fn); return()=>document.removeEventListener('mousedown',fn); },[]);
  return (
    <div ref={ref} style={{ position:'relative' }}>
      <button onClick={()=>setOpen(v=>!v)} style={{
        width:'100%', background:t.surface, border:`1px solid ${t.border}`, borderRadius:10,
        padding:'10px 14px', color:value?t.text:t.muted, fontSize:13,
        fontFamily:"'Cairo',sans-serif", cursor:'pointer',
        display:'flex', justifyContent:'space-between', alignItems:'center',
      }}>
        <span>{selected?.label||placeholder}</span><span style={{fontSize:10,color:t.muted}}>▾</span>
      </button>
      {open && (
        <div style={{ position:'absolute', top:'calc(100% + 4px)', right:0, left:0, zIndex:600,
          background:t.surface, border:`1px solid ${t.border}`, borderRadius:12,
          boxShadow:`0 12px 40px rgba(0,0,0,0.4)`, overflow:'hidden' }}>
          <div style={{ padding:8, borderBottom:`1px solid ${t.border}` }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="بحث..." autoFocus
              style={{ width:'100%', background:'transparent', border:'none', color:t.text, fontFamily:"'Cairo',sans-serif", fontSize:13, outline:'none' }} />
          </div>
          <div style={{ maxHeight:220, overflowY:'auto' }}>
            {filtered.map(o=>(
              <div key={o.value} onClick={()=>{onChange(o.value);setOpen(false);setSearch('');}}
                style={{ padding:'10px 14px', cursor:'pointer', fontSize:13, color:t.text,
                  background:o.value===value?`${t.primary}22`:'transparent', transition:'background 0.1s' }}
                onMouseEnter={e=>{ if(o.value!==value) e.currentTarget.style.background=`${t.primary}12`; }}
                onMouseLeave={e=>{ e.currentTarget.style.background=o.value===value?`${t.primary}22`:'transparent'; }}
              >{o.label}</div>
            ))}
            {!filtered.length&&<div style={{padding:14,color:t.muted,fontSize:13,textAlign:'center'}}>لا توجد نتائج</div>}
          </div>
        </div>
      )}
    </div>
  );
};

// ── Excel-Like Resizable Data Grid ─────────────────────────
const ExcelGrid = ({ columns, rows, theme:t, onRowClick, height=420, emptyMsg='لا توجد بيانات' }) => {
  const [colWidths,  setColWidths]  = useState(()=>columns.map(c=>c.width||140));
  const [sortCol,    setSortCol]    = useState(null);
  const [sortDir,    setSortDir]    = useState('asc');
  const [selRow,     setSelRow]     = useState(null);
  const [scrollX,    setScrollX]    = useState(0);
  const resizeRef = useRef(null);
  const containerRef = useRef(null);

  const startResize = (colIdx, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startW = colWidths[colIdx];
    resizeRef.current = { colIdx, startX, startW };
    const onMove = (me) => {
      const delta = me.clientX - resizeRef.current.startX;
      setColWidths(ws => ws.map((w,i) => i===resizeRef.current.colIdx ? Math.max(60, resizeRef.current.startW+delta) : w));
    };
    const onUp = () => { resizeRef.current=null; window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleSort = (key) => {
    if (sortCol===key) setSortDir(d=>d==='asc'?'desc':'asc');
    else { setSortCol(key); setSortDir('asc'); }
  };

  const sorted = useMemo(()=>[...rows].sort((a,b)=>{
    if(!sortCol) return 0;
    const av=a[sortCol]??'', bv=b[sortCol]??'';
    const cmp=av>bv?1:av<bv?-1:0;
    return sortDir==='asc'?cmp:-cmp;
  }),[rows,sortCol,sortDir]);

  const totalW = colWidths.reduce((s,w)=>s+w,0);

  return (
    <div ref={containerRef} style={{ border:`1px solid ${t.border}`, borderRadius:12, overflow:'hidden', background:t.surface }}>
      <div style={{ overflowX:'auto', overflowY:'auto', maxHeight:height }}
        onScroll={e=>setScrollX(e.currentTarget.scrollLeft)}>
        <table style={{ borderCollapse:'collapse', width:Math.max(totalW,400), tableLayout:'fixed' }}>
          <colgroup>{colWidths.map((w,i)=><col key={i} style={{width:w}} />)}</colgroup>
          <thead style={{ position:'sticky', top:0, zIndex:10 }}>
            <tr style={{ background: t.mode==='dark'?'rgba(255,255,255,0.05)':'#f1f5f9', borderBottom:`2px solid ${t.border}` }}>
              {columns.map((col,i)=>(
                <th key={col.key} onClick={()=>handleSort(col.key)} style={{
                  padding:'12px 14px', textAlign:'right', fontSize:12, color:t.muted,
                  fontWeight:700, whiteSpace:'nowrap', cursor:'pointer', userSelect:'none',
                  position:'relative', borderLeft:`1px solid ${t.border}`,
                }}>
                  <span style={{ display:'flex', alignItems:'center', gap:4, justifyContent:'space-between' }}>
                    <span>{col.label}</span>
                    {sortCol===col.key&&<span style={{color:t.primary}}>{sortDir==='asc'?'↑':'↓'}</span>}
                  </span>
                  {/* Drag resize handle */}
                  <div onMouseDown={e=>startResize(i,e)} style={{
                    position:'absolute', left:0, top:0, bottom:0, width:5, cursor:'col-resize', zIndex:1,
                    background:'transparent',
                  }}
                    onMouseEnter={e=>e.currentTarget.style.background=t.primary}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row,ri)=>(
              <tr key={row.id||ri}
                onClick={()=>{ setSelRow(ri); onRowClick?.(row); }}
                style={{
                  borderBottom:`1px solid ${t.border}`,
                  background: selRow===ri ? `${t.primary}18` : ri%2===0 ? 'transparent' : (t.mode==='dark'?'rgba(255,255,255,0.015)':'rgba(0,0,0,0.015)'),
                  cursor:'pointer', transition:'background 0.1s',
                }}
                onMouseEnter={e=>{ if(selRow!==ri) e.currentTarget.style.background=`${t.primary}0c`; }}
                onMouseLeave={e=>{ e.currentTarget.style.background=selRow===ri?`${t.primary}18`:ri%2===0?'transparent':(t.mode==='dark'?'rgba(255,255,255,0.015)':'rgba(0,0,0,0.015)'); }}
              >
                {columns.map((col,ci)=>(
                  <td key={col.key} style={{
                    padding:'11px 14px', fontSize:13, color:t.text,
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    borderLeft:`1px solid ${t.border}44`,
                  }}>
                    {col.render ? col.render(row[col.key], row) : (row[col.key]??'—')}
                  </td>
                ))}
              </tr>
            ))}
            {!sorted.length&&(
              <tr><td colSpan={columns.length} style={{padding:48,textAlign:'center',color:t.muted,fontSize:14}}>
                📭 {emptyMsg}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ padding:'8px 14px', borderTop:`1px solid ${t.border}`, fontSize:11, color:t.muted, display:'flex', justifyContent:'space-between' }}>
        <span>إجمالي: {rows.length} سجل</span>
        {selRow!==null&&<span>محدد: الصف {selRow+1}</span>}
      </div>
    </div>
  );
};

// ── Due-Date Ticker Bar ────────────────────────────────────
const TickerBar = ({ items, theme:t, position='top', onClose }) => {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(()=>{
    if(paused||!items.length) return;
    const iv=setInterval(()=>setIdx(i=>(i+1)%Math.max(1,items.length)),3500);
    return ()=>clearInterval(iv);
  },[items.length,paused]);
  if(!items.length) return null;
  const item=items[idx];
  const d=item.days_remaining;
  const urgency = d<=0?'#ef4444':d<=2?'#f97316':d<=5?'#f59e0b':'#60a5fa';
  const icon    = d<=0?'🚨':d<=2?'⛔':d<=5?'⚠️':'📅';
  return (
    <div style={{
      background:`${urgency}18`, borderTop:position==='bottom'?`2px solid ${urgency}55`:undefined,
      borderBottom:position==='top'?`2px solid ${urgency}55`:undefined,
      padding:'8px 16px', display:'flex', alignItems:'center', gap:10,
    }}>
      <span style={{fontSize:16}}>{icon}</span>
      <span style={{color:urgency,fontWeight:700,fontSize:13,flexShrink:0}}>تنبيه استحقاق</span>
      <div style={{flex:1,overflow:'hidden'}}>
        <marquee behavior="scroll" direction="right" scrollamount="3" style={{color:t.text,fontSize:13}}
          onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)}>
          {items.map((it,i)=>(
            <span key={i} style={{marginLeft:60}}>
              {it.invoice_type==='sale'?'🧾':'📦'} {it.invoice_number} — {it.stakeholders?.name_ar} — {(it.balance_due||0).toLocaleString('ar-EG')} ج.م — يستحق: {it.due_date} {it.days_remaining<=0?'(متأخر!)':it.days_remaining===0?'(اليوم!)':it.days_remaining===1?'(غداً)':it.days_remaining<=5?`(بعد ${it.days_remaining} أيام)`:''}
            </span>
          ))}
        </marquee>
      </div>
      <span style={{fontSize:11,color:t.muted,flexShrink:0}}>{idx+1}/{items.length}</span>
      <button onClick={onClose} style={{background:'none',border:'none',color:t.muted,cursor:'pointer',fontSize:16,flexShrink:0}}>✕</button>
    </div>
  );
};

// ── Broadcast Banner ───────────────────────────────────────
const BroadcastBanner = ({ broadcasts, theme:t }) => {
  const [dismissed, setDismissed] = useState([]);
  const active = broadcasts.filter(b=>!dismissed.includes(b.id));
  if(!active.length) return null;
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
      {active.map(b=>(
        <div key={b.id} style={{ background:`${t.primary}14`, border:`1px solid ${t.primary}44`, borderRadius:12, padding:'12px 16px', display:'flex', alignItems:'flex-start', gap:12 }}>
          <span style={{fontSize:20,flexShrink:0}}>📢</span>
          <div style={{flex:1}}>
            <div style={{fontSize:11,color:t.muted,marginBottom:3}}>رسالة من الإدارة</div>
            <div style={{fontSize:14,color:t.text,lineHeight:1.6}}>{b.message_ar}</div>
          </div>
          <button onClick={()=>setDismissed(d=>[...d,b.id])} style={{background:'none',border:'none',color:t.muted,cursor:'pointer',fontSize:16}}>✕</button>
        </div>
      ))}
    </div>
  );
};

// ── PWA Install Banner ─────────────────────────────────────
const PWABanner = ({ onInstall, onDismiss, theme:t }) => (
  <div style={{ background:`${t.primary}18`, border:`1px solid ${t.primary}44`, borderRadius:12, padding:'14px 18px', display:'flex', alignItems:'center', gap:14, marginBottom:16 }}>
    <span style={{fontSize:28}}>📲</span>
    <div style={{flex:1}}>
      <div style={{fontWeight:700,fontSize:14,color:t.text}}>تثبيت التطبيق على جهازك</div>
      <div style={{fontSize:12,color:t.muted}}>أضف جيتك ERP لشاشة الرئيسية للوصول السريع بدون متصفح</div>
    </div>
    <Btn small color={t.primary} onClick={onInstall}>تثبيت الآن</Btn>
    <button onClick={onDismiss} style={{background:'none',border:'none',color:t.muted,cursor:'pointer',fontSize:18}}>✕</button>
  </div>
);

// ── New Invoice Modal ──────────────────────────────────────
const InvoiceModal = ({ show, onClose, theme:t }) => {
  const [form, setForm] = useState({ type:'sale', date:new Date().toISOString().split('T')[0], due_date:'', payment_method:'cash', check_number:'', stakeholder:'', subtotal:'', discount:'0', tax:'0', notes:'' });
  const upd = (k,v) => setForm(f=>({...f,[k]:v}));
  const total = (+form.subtotal||0) - (+form.discount||0) + (+form.tax||0);
  if(!show) return null;
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16,backdropFilter:'blur(6px)'}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:20,padding:28,width:'100%',maxWidth:580,maxHeight:'92vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:22}}>
          <h3 style={{color:t.text,fontSize:17,fontWeight:800}}>➕ فاتورة جديدة</h3>
          <button onClick={onClose} style={{background:`${t.border}`,border:'none',color:t.muted,borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:15}}>✕</button>
        </div>
        {/* Invoice type */}
        <div style={{display:'flex',gap:8,marginBottom:16}}>
          {[{v:'sale',l:'🛒 مبيعات'},{v:'purchase',l:'📦 مشتريات'},{v:'return_sale',l:'🔄 مرتجع مبيعات'},{v:'return_purchase',l:'🔄 مرتجع مشتريات'}].map(o=>(
            <button key={o.v} onClick={()=>upd('type',o.v)} style={{flex:1,padding:'9px 8px',borderRadius:10,border:'none',cursor:'pointer',background:form.type===o.v?t.primary:`${t.border}66`,color:form.type===o.v?'#fff':t.muted,fontFamily:"'Cairo',sans-serif",fontSize:11,fontWeight:600,transition:'all 0.15s'}}>
              {o.l}
            </button>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
          {[['date','تاريخ الفاتورة','date'],['due_date','تاريخ الاستحقاق','date']].map(([k,label,type])=>(
            <div key={k}>
              <label style={{fontSize:12,color:t.muted,display:'block',marginBottom:5}}>{label}</label>
              <input type={type} value={form[k]} onChange={e=>upd(k,e.target.value)} style={{width:'100%',background:`${t.border}44`,border:`1px solid ${t.border}`,borderRadius:10,padding:'9px 12px',color:t.text,fontFamily:"'Cairo',sans-serif",fontSize:13,outline:'none'}} />
            </div>
          ))}
          <div style={{gridColumn:'span 2'}}>
            <label style={{fontSize:12,color:t.muted,display:'block',marginBottom:5}}>طريقة الدفع</label>
            <SearchDropdown options={Object.entries(PM_LABELS).map(([v,label])=>({value:v,label}))} value={form.payment_method} onChange={v=>upd('payment_method',v)} placeholder="اختر طريقة الدفع" theme={t} />
          </div>
          {form.payment_method==='check'&&(
            <div style={{gridColumn:'span 2'}}>
              <label style={{fontSize:12,color:t.muted,display:'block',marginBottom:5}}>رقم الشيك</label>
              <input value={form.check_number} onChange={e=>upd('check_number',e.target.value)} style={{width:'100%',background:`${t.border}44`,border:`1px solid ${t.border}`,borderRadius:10,padding:'9px 12px',color:t.text,fontFamily:"'Cairo',sans-serif",fontSize:13,outline:'none'}} />
            </div>
          )}
          <div style={{gridColumn:'span 2'}}>
            <label style={{fontSize:12,color:t.muted,display:'block',marginBottom:5}}>العميل / المورد</label>
            <input value={form.stakeholder} onChange={e=>upd('stakeholder',e.target.value)} placeholder="اكتب اسم العميل أو المورد للبحث..." style={{width:'100%',background:`${t.border}44`,border:`1px solid ${t.border}`,borderRadius:10,padding:'9px 12px',color:t.text,fontFamily:"'Cairo',sans-serif",fontSize:13,outline:'none'}} />
          </div>
          {[['subtotal','الإجمالي قبل الخصم'],['discount','الخصم'],['tax','الضريبة']].map(([k,label])=>(
            <div key={k}>
              <label style={{fontSize:12,color:t.muted,display:'block',marginBottom:5}}>{label} (ج.م)</label>
              <input type="number" min="0" value={form[k]} onChange={e=>upd(k,e.target.value)} style={{width:'100%',background:`${t.border}44`,border:`1px solid ${t.border}`,borderRadius:10,padding:'9px 12px',color:t.text,fontFamily:"'Cairo',sans-serif",fontSize:13,outline:'none'}} />
            </div>
          ))}
          <div>
            <label style={{fontSize:12,color:t.muted,display:'block',marginBottom:5}}>الإجمالي النهائي</label>
            <div style={{background:`${t.primary}18`,border:`1px solid ${t.primary}44`,borderRadius:10,padding:'9px 12px',color:t.primary,fontSize:15,fontWeight:800}}>{total.toLocaleString('ar-EG')} ج.م</div>
          </div>
          <div style={{gridColumn:'span 2'}}>
            <label style={{fontSize:12,color:t.muted,display:'block',marginBottom:5}}>ملاحظات</label>
            <textarea value={form.notes} onChange={e=>upd('notes',e.target.value)} rows={2} style={{width:'100%',background:`${t.border}44`,border:`1px solid ${t.border}`,borderRadius:10,padding:'9px 12px',color:t.text,fontFamily:"'Cairo',sans-serif",fontSize:13,outline:'none',resize:'vertical'}} />
          </div>
        </div>
        <div style={{display:'flex',gap:10,marginTop:20}}>
          <Btn color={t.primary} onClick={onClose}>💾 حفظ الفاتورة</Btn>
          <Btn outline color={t.muted} onClick={onClose}>إلغاء</Btn>
        </div>
      </div>
    </div>
  );
};

// ── PAGES ──────────────────────────────────────────────────
const DashboardPage = ({ theme:t, broadcasts }) => {
  const s = MOCK.stats;
  const kpis = [
    { label:'إجمالي المبيعات', value:`${s.revenue.toLocaleString('ar-EG')} ج.م`, icon:'💰', color:'#23c55e' },
    { label:'إجمالي المشتريات', value:`${s.purchases.toLocaleString('ar-EG')} ج.م`, icon:'📦', color:'#60a5fa' },
    { label:'ذمم مستحقة', value:`${s.outstanding.toLocaleString('ar-EG')} ج.م`, icon:'📋', color:'#f59e0b' },
    { label:'متأخرة السداد', value:`${s.overdue.toLocaleString('ar-EG')} ج.م`, icon:'🚨', color:'#ef4444' },
    { label:'رصيد الخزينة', value:`${s.cash_balance.toLocaleString('ar-EG')} ج.م`, icon:'🏦', color:'#a855f7' },
  ];
  return (
    <div style={{display:'flex',flexDirection:'column',gap:20}}>
      <BroadcastBanner broadcasts={broadcasts} theme={t} />
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:14}}>
        {kpis.map((k,i)=>(
          <div key={i} style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:'20px 18px',transition:'all 0.2s',cursor:'default'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor=k.color+'55';e.currentTarget.style.transform='translateY(-2px)';}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=t.border;e.currentTarget.style.transform='translateY(0)';}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <span style={{fontSize:12,color:t.muted,fontWeight:500}}>{k.label}</span>
              <span style={{fontSize:24}}>{k.icon}</span>
            </div>
            <div style={{fontSize:20,fontWeight:800,color:k.color,lineHeight:1}}>{k.value}</div>
          </div>
        ))}
      </div>
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:22}}>
        <h3 style={{color:t.text,fontSize:15,fontWeight:700,marginBottom:16}}>⚠️ فواتير تقترب من الاستحقاق</h3>
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {MOCK.dueSoon.map((d,i)=>{
            const days=d.days_remaining;
            const urg=days<=2?'#ef4444':days<=5?'#f59e0b':'#60a5fa';
            return (
              <div key={i} style={{display:'flex',alignItems:'center',gap:14,padding:'12px 14px',background:`${urg}0c`,borderRadius:10,border:`1px solid ${urg}30`}}>
                <span style={{fontSize:18}}>{days<=2?'🚨':days<=5?'⚠️':'📅'}</span>
                <div style={{flex:1}}>
                  <div style={{fontWeight:600,fontSize:13,color:t.text}}>{d.invoice_number} — {d.stakeholders?.name_ar}</div>
                  <div style={{fontSize:12,color:t.muted}}>يستحق: {d.due_date} — بعد {days} {days===1?'يوم':'أيام'}</div>
                </div>
                <div style={{fontWeight:700,color:urg,fontSize:14}}>{(d.balance_due||0).toLocaleString('ar-EG')} ج.م</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const InvoicesPage = ({ theme:t }) => {
  const [newModal, setNewModal] = useState(false);
  const [filterPM, setFilterPM] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  const filtered = MOCK.invoices
    .filter(r=>!filterPM||r.payment_method===filterPM)
    .filter(r=>!filterStatus||r.status===filterStatus)
    .filter(r=>!filterType||r.invoice_type===filterType);

  const cols = [
    { key:'invoice_number', label:'رقم الفاتورة', width:160 },
    { key:'invoice_type',   label:'النوع', width:120,
      render: v => <Badge label={v==='sale'?'مبيعات':'مشتريات'} color={v==='sale'?'#23c55e':'#60a5fa'} /> },
    { key:'invoice_date',   label:'التاريخ', width:120 },
    { key:'due_date',       label:'الاستحقاق', width:130,
      render:(v,row)=>{
        if(!v) return <span style={{color:t.muted}}>—</span>;
        const d=row.days_remaining;
        const c=d<0?'#ef4444':d<=2?'#f97316':d<=5?'#f59e0b':t.text;
        return <span style={{color:c,fontWeight:d<=5?700:400}}>{v}{d<0?' ⚠️':''}</span>;
      }},
    { key:'stakeholder',    label:'العميل / المورد', width:220 },
    { key:'payment_method', label:'طريقة الدفع', width:150,
      render:v=><span style={{fontSize:12}}>{PM_LABELS[v]||v}</span> },
    { key:'total',          label:'الإجمالي', width:140,
      render:v=><span style={{fontWeight:700,color:t.primary}}>{(v||0).toLocaleString('ar-EG')} ج.م</span> },
    { key:'balance_due',    label:'المتبقي', width:140,
      render:v=><span style={{color:v>0?'#ef4444':'#23c55e',fontWeight:700}}>{(v||0).toLocaleString('ar-EG')} ج.م</span> },
    { key:'status',         label:'الحالة', width:110,
      render:v=>{const c=STATUS_CFG[v]||{label:v,color:'#8b949e'}; return <Badge label={c.label} color={c.color} />;} },
  ];

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
        <div style={{minWidth:200}}>
          <SearchDropdown options={[{value:'',label:'كل طرق الدفع'},...Object.entries(PM_LABELS).map(([v,l])=>({value:v,label:l}))]} value={filterPM} onChange={setFilterPM} placeholder="طريقة الدفع" theme={t} />
        </div>
        <div style={{minWidth:160}}>
          <SearchDropdown options={[{value:'',label:'كل الحالات'},{value:'draft',label:'مسودة'},{value:'posted',label:'مُرحَّل'},{value:'paid',label:'مدفوع'},{value:'overdue',label:'متأخر'}]} value={filterStatus} onChange={setFilterStatus} placeholder="الحالة" theme={t} />
        </div>
        <div style={{minWidth:160}}>
          <SearchDropdown options={[{value:'',label:'كل الأنواع'},{value:'sale',label:'مبيعات'},{value:'purchase',label:'مشتريات'}]} value={filterType} onChange={setFilterType} placeholder="نوع الفاتورة" theme={t} />
        </div>
        <div style={{marginRight:'auto'}} />
        <Btn color={t.primary} onClick={()=>setNewModal(true)}>➕ فاتورة جديدة</Btn>
      </div>
      <ExcelGrid columns={cols} rows={filtered} theme={t} height={520} emptyMsg="لا توجد فواتير مطابقة للفلتر" />
      <InvoiceModal show={newModal} onClose={()=>setNewModal(false)} theme={t} />
    </div>
  );
};

const SettingsPage = ({ theme:t, themeKey, setThemeKey, themes }) => {
  const [alertDays, setAlertDays] = useState(5);
  const [alertBar,  setAlertBar]  = useState(true);
  const [barPos,    setBarPos]    = useState('top');
  const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const [lockedMonths, setLockedMonths] = useState([0,1,2,3,4]);
  const toggleLock = (i) => setLockedMonths(lm=>lm.includes(i)?lm.filter(m=>m!==i):[...lm,i].sort((a,b)=>a-b));
  return (
    <div style={{display:'flex',flexDirection:'column',gap:20}}>
      {/* Theme */}
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:24}}>
        <h3 style={{color:t.text,fontSize:16,fontWeight:700,marginBottom:18}}>🎨 سمة النظام</h3>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12}}>
          {Object.entries(themes).map(([key,th])=>(
            <button key={key} onClick={()=>setThemeKey(key)} style={{
              padding:16,borderRadius:14,border:`2px solid ${themeKey===key?th.primary:th.border}`,
              background:th.bg,cursor:'pointer',textAlign:'right',transition:'all 0.2s',
              boxShadow:themeKey===key?`0 0 24px ${th.primary}40`:'none',
            }}>
              <div style={{display:'flex',gap:6,marginBottom:10}}>
                {[th.primary,th.accent,th.surface].map((c,i)=>(
                  <div key={i} style={{width:18,height:18,borderRadius:'50%',background:c,border:`2px solid ${th.border}`}} />
                ))}
              </div>
              <div style={{fontSize:13,fontWeight:700,color:th.text}}>{th.name}</div>
              <div style={{fontSize:10,color:th.muted,marginTop:2}}>{th.mode==='dark'?'🌙 وضع الليل':'☀️ وضع النهار'}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Alert Settings */}
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:24}}>
        <h3 style={{color:t.text,fontSize:16,fontWeight:700,marginBottom:16}}>⏰ إعدادات تنبيهات الاستحقاق</h3>
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
            <span style={{color:t.text,fontSize:14}}>التنبيه قبل الاستحقاق بـ</span>
            <input type="number" value={alertDays} min={1} max={30} onChange={e=>setAlertDays(+e.target.value)} style={{width:70,background:`${t.border}44`,border:`1px solid ${t.border}`,borderRadius:10,padding:'8px 12px',color:t.text,fontFamily:"'Cairo',sans-serif",fontSize:14,outline:'none',textAlign:'center'}} />
            <span style={{color:t.text,fontSize:14}}>يوم</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <span style={{color:t.text,fontSize:14}}>إظهار شريط التنبيهات</span>
            <button onClick={()=>setAlertBar(v=>!v)} style={{background:alertBar?t.primary:'rgba(255,255,255,0.1)',border:'none',borderRadius:20,padding:'4px 12px',color:'#fff',cursor:'pointer',fontSize:13,fontFamily:"'Cairo',sans-serif"}}>
              {alertBar?'✓ مفعّل':'✕ معطّل'}
            </button>
            {alertBar&&(
              <SearchDropdown options={[{value:'top',label:'أعلى الصفحة'},{value:'bottom',label:'أسفل الصفحة'}]} value={barPos} onChange={setBarPos} placeholder="موضع الشريط" theme={t} />
            )}
          </div>
        </div>
      </div>

      {/* Period Lock */}
      <div style={{background:t.surface,border:`1px solid ${t.border}`,borderRadius:16,padding:24}}>
        <h3 style={{color:t.text,fontSize:16,fontWeight:700,marginBottom:6}}>🔒 قفل الفترات المحاسبية — {new Date().getFullYear()}</h3>
        <p style={{color:t.muted,fontSize:13,marginBottom:16}}>الفترات المقفلة لا تسمح بتسجيل أي قيود أو فواتير. هذا الإجراء حصري لمدير المستأجر فقط.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
          {months.map((m,i)=>{
            const locked=lockedMonths.includes(i);
            return (
              <button key={i} onClick={()=>toggleLock(i)} style={{
                padding:'12px 8px',borderRadius:10,border:`1px solid ${locked?'#ef444466':t.border}`,
                background:locked?'rgba(239,68,68,0.12)':'transparent',
                color:locked?'#ef4444':t.muted,fontSize:12,cursor:'pointer',
                fontFamily:"'Cairo',sans-serif",fontWeight:locked?700:400,
                transition:'all 0.15s',
              }}>
                {locked?'🔒':'🔓'} {m}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── MAIN APP ───────────────────────────────────────────────
export default function GTechERPv3() {
  const [themeKey, setThemeKey] = useState('dark_blue');
  const t = THEMES[themeKey] || THEMES.dark_blue;
  const [page,        setPage]        = useState('dashboard');
  const [showTicker,  setShowTicker]  = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showPWA,     setShowPWA]     = useState(false);
  const { installable, install }      = usePWA();
  const broadcasts = MOCK.broadcasts;

  useEffect(()=>{ if(installable) setTimeout(()=>setShowPWA(true),3000); },[installable]);
  useEffect(()=>{ window.dispatchEvent(new CustomEvent('app-ready')); },[]);

  const navItems = [
    { key:'dashboard', label:'الرئيسية',           icon:'🏠' },
    { key:'invoices',  label:'الفواتير',            icon:'🧾' },
    { key:'cashbox',   label:'الخزينة',             icon:'💰' },
    { key:'inventory', label:'المخزون',             icon:'📦' },
    { key:'hr',        label:'الموارد البشرية',     icon:'👥' },
    { key:'reports',   label:'التقارير',            icon:'📊' },
    { key:'settings',  label:'الإعدادات',           icon:'⚙️' },
  ];

  const renderPage = () => {
    switch(page) {
      case 'dashboard': return <DashboardPage theme={t} broadcasts={broadcasts} />;
      case 'invoices':  return <InvoicesPage theme={t} />;
      case 'settings':  return <SettingsPage theme={t} themeKey={themeKey} setThemeKey={setThemeKey} themes={THEMES} />;
      default: return (
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:300,color:t.muted,gap:12}}>
          <span style={{fontSize:48}}>🚧</span>
          <span style={{fontSize:16}}>قيد التطوير — قريباً</span>
        </div>
      );
    }
  };

  return (
    <div style={{display:'flex',flexDirection:'column',minHeight:'100vh',background:t.bg,color:t.text,fontFamily:"'Cairo',sans-serif",direction:'rtl'}}>

      {/* Ticker Bar — TOP */}
      {showTicker && MOCK.tenant.alert_bar_enabled && MOCK.tenant.alert_bar_position==='top' && (
        <TickerBar items={MOCK.dueSoon} theme={t} position="top" onClose={()=>setShowTicker(false)} />
      )}

      <div style={{display:'flex',flex:1}}>

        {/* Sidebar */}
        <aside style={{
          width:sidebarOpen?250:68, flexShrink:0,
          background:t.sidebar, borderLeft:`1px solid ${t.border}`,
          display:'flex', flexDirection:'column',
          transition:'width 0.25s ease', overflow:'hidden',
          position:'sticky', top:0, height:'100vh',
        }}>
          {/* Logo */}
          <div style={{padding:sidebarOpen?'22px 20px 16px':'22px 12px 16px',borderBottom:`1px solid ${t.border}`,flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{
                width:42,height:42,borderRadius:13,flexShrink:0,
                background:`linear-gradient(135deg, ${t.primary}, ${t.accent})`,
                display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:20,fontWeight:900,color:'#fff',
                boxShadow:`0 4px 20px ${t.shadow}`,
              }}>G</div>
              {sidebarOpen&&(
                <div>
                  <div style={{fontSize:14,fontWeight:800,color:t.text,lineHeight:1.2}}>{MOCK.tenant.name_ar}</div>
                  <div style={{fontSize:10,color:t.muted}}>جيتك ERP v3.0</div>
                </div>
              )}
            </div>
          </div>

          {/* Nav */}
          <nav style={{flex:1,padding:'12px 10px',display:'flex',flexDirection:'column',gap:3,overflowY:'auto'}}>
            {navItems.map(item=>(
              <button key={item.key} onClick={()=>setPage(item.key)} style={{
                display:'flex',alignItems:'center',gap:12,
                padding:sidebarOpen?'11px 14px':'11px',
                borderRadius:12,border:'none',cursor:'pointer',
                background:page===item.key?`${t.primary}20`:'transparent',
                color:page===item.key?t.primary:t.muted,
                fontFamily:"'Cairo',sans-serif",fontSize:13,fontWeight:page===item.key?700:400,
                borderRight:page===item.key?`3px solid ${t.primary}`:'3px solid transparent',
                width:'100%',textAlign:'right',transition:'all 0.15s',
              }}
                onMouseEnter={e=>{if(page!==item.key) e.currentTarget.style.background=`${t.primary}0e`;}}
                onMouseLeave={e=>{if(page!==item.key) e.currentTarget.style.background='transparent';}}
              >
                <span style={{fontSize:18,flexShrink:0}}>{item.icon}</span>
                {sidebarOpen&&item.label}
              </button>
            ))}
          </nav>

          {/* Sidebar footer */}
          {sidebarOpen&&(
            <div style={{padding:'12px 16px',borderTop:`1px solid ${t.border}`,flexShrink:0,fontSize:11,color:t.muted}}>
              <div style={{fontWeight:600,color:t.muted,marginBottom:2}}>{MOCK.user.name_ar}</div>
              <div>👤 {MOCK.user.role==='tenant_admin'?'مدير الحساب':'موظف'}</div>
              <div style={{marginTop:4,color:`${t.muted}66`}}>أ. علاء غبن | 01014868778</div>
            </div>
          )}
        </aside>

        {/* Main Content */}
        <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>

          {/* Header */}
          <header style={{height:62,background:t.surface,borderBottom:`1px solid ${t.border}`,display:'flex',alignItems:'center',padding:'0 20px',gap:14,position:'sticky',top:0,zIndex:100,flexShrink:0}}>
            <button onClick={()=>setSidebarOpen(v=>!v)} style={{background:`${t.border}66`,border:'none',color:t.muted,borderRadius:8,padding:'7px 10px',cursor:'pointer',fontSize:16}}>☰</button>
            <span style={{fontWeight:800,fontSize:15,color:t.text}}>
              {navItems.find(n=>n.key===page)?.icon}{' '}
              {navItems.find(n=>n.key===page)?.label}
            </span>
            <div style={{flex:1}} />
            {/* Broadcast indicator */}
            {broadcasts.length>0&&(
              <div style={{background:`${t.primary}18`,border:`1px solid ${t.primary}44`,borderRadius:10,padding:'5px 12px',fontSize:12,color:t.primary,fontWeight:600,cursor:'pointer'}} onClick={()=>setPage('dashboard')}>
                📢 {broadcasts.length} رسالة إدارة
              </div>
            )}
            {/* Overdue alert */}
            <div style={{background:'rgba(239,68,68,0.12)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:10,padding:'5px 12px',fontSize:12,color:'#ef4444',fontWeight:600}}>
              ⚠️ {MOCK.dueSoon.length} فواتير قريبة
            </div>
            <div style={{background:'rgba(35,197,94,0.12)',border:'1px solid rgba(35,197,94,0.3)',color:'#23c55e',borderRadius:99,padding:'4px 12px',fontSize:11,fontWeight:600}}>
              ⬤ متصل
            </div>
          </header>

          {/* Page Content */}
          <main style={{flex:1,padding:24,overflowY:'auto'}}>
            <div style={{maxWidth:1400,margin:'0 auto'}}>
              {/* PWA Install Banner */}
              {showPWA&&<PWABanner onInstall={()=>{install();setShowPWA(false);}} onDismiss={()=>setShowPWA(false)} theme={t} />}
              {renderPage()}
            </div>
          </main>
        </div>
      </div>

      {/* Ticker Bar — BOTTOM */}
      {showTicker && MOCK.tenant.alert_bar_enabled && MOCK.tenant.alert_bar_position==='bottom' && (
        <TickerBar items={MOCK.dueSoon} theme={t} position="bottom" onClose={()=>setShowTicker(false)} />
      )}
    </div>
  );
}

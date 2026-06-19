# وثيقة نظام التشغيل الشاملة — Product Backlog
## G-Tech Developer ERP v3 | جيتك المطور
### المطوّر: أ. علاء غبن | 📞 01014868778
### الإصدار: 3.0.0 | يونيو 2026

---

## 📁 هيكل الملفات الكامل

```
gtech-erp-v3/
│
├── 📄 .env.example                          ← متغيرات البيئة
├── 📄 package.json                          ← Root package
├── 📄 render.yaml                           ← Render.com deployment
│
├── 📂 core/                                 ← Backend API (Node.js + Express)
│   ├── package.json
│   └── src/
│       ├── server.js                        ← نقطة الدخول الرئيسية
│       ├── _allRoutes.js                    ← كل الـ routes في ملف واحد
│       │
│       ├── api/                             ← Route entry files
│       │   ├── auth.js                      ← تسجيل دخول + JWT
│       │   ├── admin.js                     ← لوحة المطور (kill-switch, inject)
│       │   ├── financials.js                ← COA، قيود، خزينة، قفل فترات
│       │   ├── invoices.js                  ← فواتير + due_date + payment_method
│       │   ├── inventory.js                 ← أصناف، مخازن، رصيد، عملاء
│       │   ├── hr.js                        ← موظفون، حضور، رواتب
│       │   ├── reports.js                   ← تقارير متعددة
│       │   ├── notifications.js             ← إشعارات + ticker
│       │   ├── broadcasts.js                ← بث داخلي للمستأجر
│       │   ├── plugins.js                   ← الإضافات المفعّلة
│       │   ├── settings.js                  ← إعدادات المستأجر + theme
│       │   ├── tenants.js                   ← إدارة المستأجرين
│       │   └── updates.js                   ← OTA endpoint
│       │
│       ├── middleware/
│       │   ├── tenantMiddleware.js          ← عزل المستأجرين + Kill-Switch
│       │   ├── authMiddleware.js            ← JWT + roles
│       │   └── errorHandler.js             ← معالجة الأخطاء
│       │
│       ├── db/
│       │   ├── client.js                    ← Supabase client + withTenant()
│       │   └── migrations/
│       │       └── 001_master_schema_v3.sql ← كامل مخطط DB + RLS + Seeds
│       │
│       ├── services/
│       │   ├── pluginLoader.js             ← Hot-Plug engine
│       │   ├── fcmService.js               ← Firebase FCM + cron
│       │   └── dueDateAlerts.js            ← Due-date cron starter
│       │
│       └── utils/
│           └── logger.js                   ← Winston logger
│
├── 📂 plugins/                             ← 15 إضافة منفصلة
│   ├── pharmacy/index.js                   ← صيدلية (باركود، صلاحية، POS)
│   ├── hr/index.js                         ← HR (رواتب تلقائية، حضور، خصومات)
│   ├── manufacturing/index.js              ← تصنيع BOM (هادر، 5 مراحل، تقرير)
│   ├── excel_importer/index.js             ← استيراد Excel (قوالب + drag-drop)
│   ├── ai_ocr/index.js                     ← OCR ذكي (GPT-4o، مسودات تلقائية)
│   └── _bundle/index.js                    ← Shipping, Logistics, Medical,
│                                              Contracting, Real Estate, Security,
│                                              NGO, CRM, Mobiles, Veterinary
│
├── 📂 frontend/                            ← Tenant Portal (React PWA)
│   ├── index.html                          ← Entry + Splash screen
│   ├── package.json
│   ├── vite.config.js                      ← Vite + PWA plugin
│   └── src/
│       ├── main.jsx                        ← React root
│       └── App.jsx                         ← Full ERP UI (theme, grid, ticker)
│
└── 📂 admin-portal/                        ← Developer Admin Portal (React)
    └── src/
        └── App.jsx                         ← Kill-switch، plugin injector، notify
```

---

## 🚀 إعداد النظام خطوة بخطوة

### المتطلبات
```
Node.js >= 18.x | npm >= 9.x
Supabase account (supabase.com)
Firebase project (console.firebase.google.com)
Render.com account (backend)
Vercel account (frontend)
OpenAI API key (للـ OCR)
```

### 1. إعداد Supabase
```sql
-- في SQL Editor بـ Supabase:
-- شغّل الملف: core/src/db/migrations/001_master_schema_v3.sql

-- فعّل pg_cron للتنبيهات التلقائية:
SELECT cron.schedule('due-alerts',   '0 * * * *', 'SELECT fire_due_date_alerts()');
SELECT cron.schedule('mark-overdue', '0 1 * * *', 'SELECT mark_overdue_invoices()');
```

### 2. متغيرات البيئة (.env)
```bash
NODE_ENV=production
PORT=4000
APP_VERSION=3.0.0
ALLOWED_ORIGINS=https://app.gtech-erp.com,https://admin.gtech-erp.com

SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

JWT_SECRET=<256-bit-random>
JWT_EXPIRY=8h

FIREBASE_PROJECT_ID=gtech-erp
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

OPENAI_API_KEY=sk-...
GOOGLE_VISION_API_KEY=AIza...
```

### 3. تشغيل محلي
```bash
cd core && npm install && npm run dev
# API → http://localhost:4000/health

cd frontend && npm install && npm run dev
# UI  → http://localhost:3000
```

### 4. النشر على Render.com
```bash
# ارفع الكود على GitHub
# أنشئ Web Service في Render وأشر إليه
# Build: cd core && npm install
# Start: cd core && npm start
```

### 5. النشر على Vercel
```bash
cd frontend
vercel --prod
```

---

## 📡 مخطط API الكامل

### المصادقة (Public)
```
POST /api/auth/login      { email, password, tenant_code? }
POST /api/auth/refresh    { token }
POST /api/auth/fcm-token  { auth_token, fcm_token }
GET  /api/updates/latest
GET  /health
```

### لوحة المطور (super_admin فقط)
```
GET  /api/admin/dashboard
GET  /api/admin/tenants?search=&status=&plan=

POST /api/admin/tenants/:id/kill-switch
     Body: { action: "suspend|terminate|reactivate", message: "..." }
     ✅ يجمّد الوصول فقط — صفر حذف للبيانات — data_preserved: true

PATCH /api/admin/tenants/:id
      Body: { logo_url, suspension_logo_url, plan, alert_days_before ... }

POST /api/admin/plugins/inject       FormData: { plugin: ZIP, plugin_key, name_ar, version }
GET  /api/admin/plugins

POST /api/admin/tenants/:id/plugins/:key/activate
POST /api/admin/tenants/:id/plugins/:key/deactivate

POST /api/admin/notify/tenant/:id    { title_ar, body_ar, type }
POST /api/admin/notify/broadcast     { title_ar, body_ar, type }
POST /api/admin/updates/deploy       { version, changelog_ar }
```

### الماليات
```
GET  /api/financials/accounts?type=&search=
POST /api/financials/accounts
PUT  /api/financials/accounts/:id

GET  /api/financials/journal?date_from=&date_to=&is_posted=
POST /api/financials/journal    { entry_date, description_ar, due_date, payment_method, lines: [{account_id,debit,credit}] }

GET  /api/financials/cashboxes
POST /api/financials/cashboxes
POST /api/financials/cashboxes/:id/transaction  { trans_type: in|out, amount, description }

POST /api/financials/periods/lock    { month, year }
POST /api/financials/periods/unlock  { month, year }
```

### الفواتير
```
GET  /api/invoices?type=&status=&payment_method=&due_from=&due_to=&overdue=true
GET  /api/invoices/due-soon          ← للـ Ticker Bar
GET  /api/invoices/:id
POST /api/invoices   { invoice_type, invoice_date, due_date, payment_method, stakeholder_id, lines: [...] }
PATCH /api/invoices/:id
DELETE /api/invoices/:id             ← مسودات فقط

Response يتضمن:
  payment_method_label: "نقدي | شيك | آجل ..."
  days_overdue:  عدد أيام التأخير
  days_remaining: أيام متبقية للاستحقاق
```

### الإشعارات
```
GET  /api/notifications?unread_only=true
GET  /api/notifications/due-soon
PATCH /api/notifications/read-all
PATCH /api/notifications/:id/read
```

### البث الداخلي للمستأجر
```
GET  /api/broadcasts
POST /api/broadcasts   { message_ar, expires_hours }
     ← يُرسل لجميع مستخدمي الشركة فقط، معزول تماماً عن المطور
PATCH /api/broadcasts/:id/deactivate
```

### الإعدادات
```
GET  /api/settings
PATCH /api/settings  { theme_config, alert_days_before, alert_bar_enabled, alert_bar_position, logo_url }
```

### الإضافات الديناميكية
```
GET  /api/plugins                        ← الإضافات المفعّلة للمستأجر
GET  /api/plugin/:pluginKey/*            ← كل مسارات الإضافة (hot-loaded)
```

---

## 🔌 مسارات الإضافات الرئيسية

### Pharmacy
```
GET  /api/plugin/pharmacy/dashboard
GET  /api/plugin/pharmacy/batches?expiring_days=30
POST /api/plugin/pharmacy/batches
GET  /api/plugin/pharmacy/barcode/:barcode
GET  /api/plugin/pharmacy/sales
POST /api/plugin/pharmacy/sales         ← POS فاتورة
GET  /api/plugin/pharmacy/alerts?days=90
```

### Manufacturing
```
GET  /api/plugin/manufacturing/bom
POST /api/plugin/manufacturing/bom      { name_ar, product_item_id, lines: [{raw_item_id, required_qty, scrap_percentage}] }
PATCH /api/plugin/manufacturing/bom/:id/lines/:lineId  { scrap_percentage }
POST /api/plugin/manufacturing/orders   { product_item_id, bom_id, planned_qty, per_line_scrap: {item_id: pct} }
PATCH /api/plugin/manufacturing/orders/:id  { actual_qty, scrap_qty, lines: [...] }
GET  /api/plugin/manufacturing/orders/:id/variance    ← تقرير الهادر
GET  /api/plugin/manufacturing/stages                 ← مخزون 5 مراحل
```

### Excel Importer
```
GET  /api/plugin/excel_importer/template/:type
     types: items | customers | suppliers | employees | chart_of_accounts | opening_balances
     Response: Excel file download (تنزيل مباشر)

POST /api/plugin/excel_importer/upload/:type
     Body: FormData { file: Excel }
     Response: { job_id, message: "جاري المعالجة..." }

GET  /api/plugin/excel_importer/jobs
GET  /api/plugin/excel_importer/jobs/:id
     Response: { status, total_rows, imported_rows, failed_rows, errors }
```

### AI OCR Scanner
```
POST /api/plugin/ai_ocr/scan
     Body: FormData { invoices: [image1, image2, ...] }  (حتى 20 صورة)
     Response: { job_id, total_files }

GET  /api/plugin/ai_ocr/jobs
GET  /api/plugin/ai_ocr/jobs/:id
     Response: { status, extracted: [{file, data: {vendor_name, total_amount, items...}}], draft_ids }

GET  /api/plugin/ai_ocr/jobs/:id/drafts   ← فواتير المسودات المنشأة تلقائياً
```

### HR
```
GET  /api/plugin/hr/employees?search=&department=
POST /api/plugin/hr/employees
PUT  /api/plugin/hr/employees/:id
GET  /api/plugin/hr/attendance?employee_id=&date_from=&date_to=
POST /api/plugin/hr/attendance
POST /api/plugin/hr/attendance/bulk         { records: [...] }
POST /api/plugin/hr/payroll/generate        { period_month, period_year }
GET  /api/plugin/hr/payroll
GET  /api/plugin/hr/payroll/:id/lines
POST /api/plugin/hr/payroll/:id/approve
POST /api/plugin/hr/payroll/:id/pay
```

---

## 🛠️ دليل تطوير إضافة جديدة (Future Plugin)

### الهيكل الإلزامي
```javascript
// plugins/my_plugin/index.js
'use strict';
const express = require('express');
const { supabaseAdmin } = require('../../core/src/db/client');
const { authMiddleware } = require('../../core/src/middleware/authMiddleware');

const router = express.Router();
router.use(authMiddleware(['tenant_admin', 'staff']));

// ✅ META مطلوب
const meta = {
  key:     'my_plugin',
  version: '1.0.0',
  name_ar: 'اسم الإضافة',
  name_en: 'Plugin Name',
  tables:  ['my_table'],
  permissions: ['read','write','delete','print','export'],
};

// ✅ Routes
router.get('/',    async (req, res) => {
  // req.tenantId متاح دائماً — استخدمه في كل query
  const { data } = await supabaseAdmin
    .from('my_table')
    .select('*')
    .eq('tenant_id', req.tenantId);  // إلزامي
  res.json(data);
});

router.post('/',   async (req, res) => { /* ... */ });
router.put('/:id', async (req, res) => { /* ... */ });
router.delete('/:id', async (req, res) => {
  // لا تحذف — استخدم is_active = false
  await supabaseAdmin.from('my_table').update({ is_active: false })
    .eq('id', req.params.id).eq('tenant_id', req.tenantId);
  res.json({ success: true });
});

// ✅ MIGRATION SQL (اختياري لكن موصى به)
const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS my_table (
    id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name_ar   VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE my_table ENABLE ROW LEVEL SECURITY;
`;

// ✅ EXPORT مطلوب
module.exports = { router, meta, MIGRATION_SQL };
```

### نشر الإضافة الجديدة
```bash
# 1. ضع الملفات في مجلد:
plugins/my_plugin/index.js

# 2. أنشئ ZIP:
zip -r my_plugin.zip plugins/my_plugin/

# 3. ارفع عبر Admin API:
curl -X POST https://api.gtech-erp.com/api/admin/plugins/inject \
  -H "Authorization: Bearer <super_admin_token>" \
  -F "plugin=@my_plugin.zip" \
  -F "plugin_key=my_plugin" \
  -F "name_ar=اسم الإضافة" \
  -F "version=1.0.0"

# 4. فعّل للمستأجر:
curl -X POST https://api.gtech-erp.com/api/admin/tenants/:id/plugins/my_plugin/activate \
  -H "Authorization: Bearer <super_admin_token>"

# 5. الإضافة متاحة فوراً بدون restart:
GET /api/plugin/my_plugin/
```

### قواعد لا تُكسر
```
✅ كل جدول يحتوي: tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
✅ كل جدول مفعّل عليه: ROW LEVEL SECURITY
✅ كل query مقيّد بـ: .eq('tenant_id', req.tenantId)
✅ الحذف = is_active = false (لا DELETE أبداً)
✅ استخدم withTenant() لأي عملية خارج tenant scope
✅ اختبر العزل: بيانات مستأجر واحد لا تظهر لآخر
```

---

## ⚡ Kill-Switch Architecture

```
المطور يستدعي:
POST /api/admin/tenants/:id/kill-switch
{ action: "suspend", message: "النسخة متوقفة..." }

↓
1. UPDATE tenants SET status='suspended' WHERE id=:id
   ← صفر حذف للبيانات

2. flushTenantCache(tenantId)
   ← تُحذف من الذاكرة فوراً (TTL 3 دقائق)

3. sendKillSwitch(tenantId, message)
   ← FCM push لكل مستخدمي المستأجر

4. في أي طلب تالٍ من المستأجر:
   tenantMiddleware → يجلب tenant من DB → يرى status='suspended'
   → يُعيد 403 + { message, data_intact: true, reactivatable: true }

5. عند إعادة التفعيل:
   action='reactivate' → status='active' → flushCache
   → كل البيانات سليمة تماماً، لم يُمسّ منها شيء
```

---

## 🎨 نظام الثيم والتخصيص

```javascript
// الثيمات المدعومة في v3:
dark_blue   | dark_green | dark_purple | dark_red  (وضع الليل)
light_blue  | light_clean                           (وضع النهار)

// كل مستأجر يختار ثيمه من الإعدادات
PATCH /api/settings
{ "theme_config": { "mode": "dark", "primary": "#0066ff", ... } }

// يُحفظ في DB ويُطبَّق عند كل login
```

---

## 📊 نظام الـ Ticker Bar والتنبيهات

```
1. المستأجر يضبط: alert_days_before (افتراضي 5 أيام)
   PATCH /api/settings { "alert_days_before": 3, "alert_bar_enabled": true, "alert_bar_position": "top" }

2. كل ساعة: fire_due_date_alerts() تُنفَّذ تلقائياً
   → تبحث عن فواتير due_date <= اليوم + alert_days_before
   → تُنشئ إشعار في notifications
   → تُرسل FCM push

3. الواجهة تستدعي: GET /api/notifications/due-soon
   → Ticker Bar يعرض الفواتير المستحقة في scrolling marquee
   → المستخدم يمكنه إغلاقه مؤقتاً أو تعطيله من الإعدادات
```

---

## 📞 بيانات المطور والدعم

```
المطور المسؤول : أ. علاء غبن
الهاتف        : 01014868778
البريد        : alaa@gtech-erp.com
العلامة التجارية: G-Tech Developer | جيتك المطور
النظام        : G-Tech Developer ERP v3.0.0
```

---
*وثيقة نظام التشغيل الشاملة — G-Tech Developer ERP v3 — يونيو 2026*
*جميع الحقوق محفوظة © أ. علاء غبن | 01014868778*

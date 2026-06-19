-- ============================================================
-- G-Tech Developer ERP v3 — Master Database Schema
-- جيتك المطور | أ. علاء غبن | 01014868778
-- Supabase / PostgreSQL | RLS | Multi-Tenant | Full Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ============================================================
-- SECTION 1: TENANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code                 VARCHAR(50)  UNIQUE NOT NULL,
  name_ar              VARCHAR(255) NOT NULL,
  name_en              VARCHAR(255),
  business_type        VARCHAR(100),
  owner_name           VARCHAR(255),
  phone                VARCHAR(50),
  email                VARCHAR(255) UNIQUE,
  logo_url             TEXT,
  address_ar           TEXT,
  tax_number           VARCHAR(100),
  license_key          VARCHAR(255) UNIQUE,
  plan                 VARCHAR(50)  DEFAULT 'starter'
                         CHECK (plan IN ('starter','pro','enterprise')),
  -- Kill-Switch (DATA FREEZE — NEVER DELETES)
  status               VARCHAR(20)  DEFAULT 'active'
                         CHECK (status IN ('active','suspended','terminated')),
  suspension_message   TEXT,
  suspension_logo_url  TEXT,
  suspended_at         TIMESTAMPTZ,
  suspended_by         UUID,
  -- Theme
  theme_config         JSONB DEFAULT '{
    "mode":"dark","primary":"#0066ff","secondary":"#00d4ff",
    "sidebar":"#0d1117","surface":"#161b22","font":"Cairo"
  }'::jsonb,
  locale               VARCHAR(10)  DEFAULT 'ar',
  currency             VARCHAR(10)  DEFAULT 'EGP',
  timezone             VARCHAR(50)  DEFAULT 'Africa/Cairo',
  -- Accounting period lock: [{month,year,locked_by,locked_at}]
  locked_periods       JSONB DEFAULT '[]'::jsonb,
  -- Alert settings
  alert_days_before    INTEGER DEFAULT 5,
  alert_bar_enabled    BOOLEAN DEFAULT TRUE,
  alert_bar_position   VARCHAR(10) DEFAULT 'top' CHECK (alert_bar_position IN ('top','bottom')),
  -- PWA
  pwa_prompted         BOOLEAN DEFAULT FALSE,
  trial_ends_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SECTION 2: SUPER ADMINS (Developer only)
-- ============================================================
CREATE TABLE IF NOT EXISTS super_admins (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255) DEFAULT 'علاء غبن',
  phone         VARCHAR(50)  DEFAULT '01014868778',
  is_active     BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SECTION 3: USERS (Tenant-scoped)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name_ar       VARCHAR(255) NOT NULL,
  name_en       VARCHAR(255),
  role          VARCHAR(50) DEFAULT 'staff'
                  CHECK (role IN ('tenant_admin','accountant','hr_manager',
                                  'sales','cashier','warehouse','viewer','staff')),
  permissions   JSONB  DEFAULT '[]'::jsonb,
  avatar_url    TEXT,
  phone         VARCHAR(50),
  fcm_token     TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);

-- ============================================================
-- SECTION 4: PLUGIN REGISTRY
-- ============================================================
CREATE TABLE IF NOT EXISTS plugins (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plugin_key    VARCHAR(100) UNIQUE NOT NULL,
  name_ar       VARCHAR(255) NOT NULL,
  name_en       VARCHAR(255),
  description_ar TEXT,
  version       VARCHAR(20) DEFAULT '1.0.0',
  category      VARCHAR(100),
  icon          VARCHAR(20),
  price_monthly DECIMAL(10,2) DEFAULT 0,
  is_published  BOOLEAN DEFAULT TRUE,
  requires      JSONB DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_plugin_activations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plugin_id     UUID NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  plugin_key    VARCHAR(100) NOT NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  config        JSONB DEFAULT '{}'::jsonb,
  activated_at  TIMESTAMPTZ DEFAULT NOW(),
  activated_by  UUID REFERENCES super_admins(id),
  deactivated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, plugin_id)
);
CREATE INDEX IF NOT EXISTS idx_activations ON tenant_plugin_activations(tenant_id, plugin_key, is_active);

CREATE TABLE IF NOT EXISTS plugin_update_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plugin_id     UUID REFERENCES plugins(id),
  plugin_key    VARCHAR(100),
  from_version  VARCHAR(20),
  to_version    VARCHAR(20),
  changelog_ar  TEXT,
  is_breaking   BOOLEAN DEFAULT FALSE,
  deployed_at   TIMESTAMPTZ DEFAULT NOW(),
  deployed_by   UUID REFERENCES super_admins(id)
);

-- ============================================================
-- SECTION 5: CHART OF ACCOUNTS
-- ============================================================
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code         VARCHAR(30) NOT NULL,
  name_ar      VARCHAR(255) NOT NULL,
  name_en      VARCHAR(255),
  account_type VARCHAR(50) NOT NULL
                 CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
  parent_id    UUID REFERENCES chart_of_accounts(id),
  level        INTEGER DEFAULT 1,
  is_header    BOOLEAN DEFAULT FALSE,
  currency     VARCHAR(10) DEFAULT 'EGP',
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_coa ON chart_of_accounts(tenant_id, is_active);

-- ============================================================
-- SECTION 6: JOURNAL ENTRIES
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_number   VARCHAR(50) NOT NULL,
  entry_date     DATE NOT NULL,
  due_date       DATE,
  description_ar TEXT NOT NULL,
  reference      VARCHAR(255),
  source_module  VARCHAR(100),
  source_id      UUID,
  fiscal_year    INTEGER NOT NULL,
  fiscal_month   INTEGER NOT NULL,
  payment_method VARCHAR(50) DEFAULT 'cash'
                   CHECK (payment_method IN ('cash','check','credit','bank_transfer',
                                             'vodafone_cash','instapay','other')),
  check_number   VARCHAR(100),
  is_posted      BOOLEAN DEFAULT FALSE,
  is_locked      BOOLEAN DEFAULT FALSE,
  alert_sent     BOOLEAN DEFAULT FALSE,
  total_debit    DECIMAL(18,4) DEFAULT 0,
  total_credit   DECIMAL(18,4) DEFAULT 0,
  created_by     UUID REFERENCES users(id),
  posted_by      UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, entry_number)
);
CREATE INDEX IF NOT EXISTS idx_je_date    ON journal_entries(tenant_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_je_due     ON journal_entries(tenant_id, due_date) WHERE due_date IS NOT NULL AND alert_sent = FALSE;
CREATE INDEX IF NOT EXISTS idx_je_fiscal  ON journal_entries(tenant_id, fiscal_year, fiscal_month);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_id      UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES chart_of_accounts(id),
  debit         DECIMAL(18,4) DEFAULT 0,
  credit        DECIMAL(18,4) DEFAULT 0,
  description   TEXT,
  currency      VARCHAR(10) DEFAULT 'EGP',
  exchange_rate DECIMAL(10,6) DEFAULT 1,
  cost_center   VARCHAR(100),
  line_order    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_jel_entry   ON journal_entry_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines(tenant_id, account_id);

-- ============================================================
-- SECTION 7: STAKEHOLDERS
-- ============================================================
CREATE TABLE IF NOT EXISTS stakeholders (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type           VARCHAR(20) CHECK (type IN ('customer','supplier','both')),
  code           VARCHAR(100),
  name_ar        VARCHAR(255) NOT NULL,
  name_en        VARCHAR(255),
  phone          VARCHAR(50),
  mobile         VARCHAR(50),
  email          VARCHAR(255),
  address_ar     TEXT,
  tax_number     VARCHAR(100),
  credit_limit   DECIMAL(18,4) DEFAULT 0,
  balance        DECIMAL(18,4) DEFAULT 0,
  loyalty_points INTEGER DEFAULT 0,
  account_id     UUID REFERENCES chart_of_accounts(id),
  category       VARCHAR(100),
  is_active      BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_sth_tenant ON stakeholders(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_sth_search ON stakeholders USING gin(name_ar gin_trgm_ops);

-- ============================================================
-- SECTION 8: ITEMS & INVENTORY
-- ============================================================
CREATE TABLE IF NOT EXISTS items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code         VARCHAR(100),
  barcode      VARCHAR(200),
  name_ar      VARCHAR(255) NOT NULL,
  name_en      VARCHAR(255),
  category     VARCHAR(100),
  unit         VARCHAR(50) DEFAULT 'piece',
  cost_price   DECIMAL(18,4) DEFAULT 0,
  sale_price   DECIMAL(18,4) DEFAULT 0,
  min_stock    DECIMAL(18,4) DEFAULT 0,
  has_serial   BOOLEAN DEFAULT FALSE,
  has_expiry   BOOLEAN DEFAULT FALSE,
  has_lot      BOOLEAN DEFAULT FALSE,
  is_active    BOOLEAN DEFAULT TRUE,
  account_id   UUID REFERENCES chart_of_accounts(id),
  image_url    TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_items_tenant  ON items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(tenant_id, barcode);
CREATE INDEX IF NOT EXISTS idx_items_search  ON items USING gin(name_ar gin_trgm_ops);

CREATE TABLE IF NOT EXISTS warehouses (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar   VARCHAR(255) NOT NULL,
  location  TEXT,
  stage     VARCHAR(50) DEFAULT 'main'
              CHECK (stage IN ('main','raw','wip','finished','damaged','inspection')),
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS stock_balances (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id      UUID NOT NULL REFERENCES items(id),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id),
  quantity     DECIMAL(18,4) DEFAULT 0,
  reserved_qty DECIMAL(18,4) DEFAULT 0,
  lot_number   VARCHAR(100),
  expiry_date  DATE,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, item_id, warehouse_id, lot_number)
);

-- ============================================================
-- SECTION 9: CASHBOXES (Multi-Currency)
-- ============================================================
CREATE TABLE IF NOT EXISTS cashboxes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar         VARCHAR(255) NOT NULL,
  currency        VARCHAR(10) DEFAULT 'EGP',
  current_balance DECIMAL(18,4) DEFAULT 0,
  account_id      UUID REFERENCES chart_of_accounts(id),
  branch          VARCHAR(100),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cashbox_transactions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cashbox_id    UUID NOT NULL REFERENCES cashboxes(id),
  trans_type    VARCHAR(20) CHECK (trans_type IN ('in','out','transfer')),
  amount        DECIMAL(18,4) NOT NULL,
  balance_after DECIMAL(18,4),
  description   TEXT,
  reference     VARCHAR(255),
  entry_id      UUID REFERENCES journal_entries(id),
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SECTION 10: INVOICES (Sales & Purchases)
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_type   VARCHAR(30) NOT NULL
                   CHECK (invoice_type IN ('sale','purchase','return_sale','return_purchase')),
  invoice_number VARCHAR(50) NOT NULL,
  invoice_date   DATE NOT NULL,
  due_date       DATE,
  payment_method VARCHAR(50) DEFAULT 'cash'
                   CHECK (payment_method IN ('cash','check','credit','bank_transfer',
                                             'vodafone_cash','instapay','other')),
  check_number   VARCHAR(100),
  check_due_date DATE,
  stakeholder_id UUID REFERENCES stakeholders(id),
  warehouse_id   UUID REFERENCES warehouses(id),
  cashbox_id     UUID REFERENCES cashboxes(id),
  subtotal       DECIMAL(18,4) DEFAULT 0,
  discount       DECIMAL(18,4) DEFAULT 0,
  tax_amount     DECIMAL(18,4) DEFAULT 0,
  total          DECIMAL(18,4) DEFAULT 0,
  paid_amount    DECIMAL(18,4) DEFAULT 0,
  balance_due    DECIMAL(18,4) DEFAULT 0,
  status         VARCHAR(20) DEFAULT 'posted'
                   CHECK (status IN ('draft','posted','paid','overdue','cancelled')),
  alert_sent     BOOLEAN DEFAULT FALSE,
  notes          TEXT,
  entry_id       UUID REFERENCES journal_entries(id),
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, invoice_number)
);
CREATE INDEX IF NOT EXISTS idx_inv_tenant  ON invoices(tenant_id, invoice_type);
CREATE INDEX IF NOT EXISTS idx_inv_due     ON invoices(tenant_id, due_date) WHERE due_date IS NOT NULL AND status NOT IN ('paid','cancelled');
CREATE INDEX IF NOT EXISTS idx_inv_status  ON invoices(tenant_id, status);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_id   UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id      UUID REFERENCES items(id),
  description  TEXT,
  quantity     DECIMAL(18,4) NOT NULL,
  unit_price   DECIMAL(18,4) NOT NULL,
  discount     DECIMAL(18,4) DEFAULT 0,
  tax_rate     DECIMAL(5,2) DEFAULT 0,
  line_total   DECIMAL(18,4) NOT NULL,
  warehouse_id UUID REFERENCES warehouses(id),
  batch_id     UUID,
  line_order   INTEGER DEFAULT 0
);

-- ============================================================
-- SECTION 11: HR & PAYROLL
-- ============================================================
CREATE TABLE IF NOT EXISTS employees (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            VARCHAR(50),
  name_ar         VARCHAR(255) NOT NULL,
  national_id     VARCHAR(50),
  job_title       VARCHAR(100),
  department      VARCHAR(100),
  hire_date       DATE,
  base_salary     DECIMAL(18,4) DEFAULT 0,
  housing_allow   DECIMAL(18,4) DEFAULT 0,
  transport_allow DECIMAL(18,4) DEFAULT 0,
  working_hours   DECIMAL(5,2) DEFAULT 8,
  bank_account    VARCHAR(100),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id    UUID NOT NULL REFERENCES employees(id),
  work_date      DATE NOT NULL,
  check_in       TIME,
  check_out      TIME,
  hours_worked   DECIMAL(5,2),
  late_minutes   INTEGER DEFAULT 0,
  overtime_hours DECIMAL(5,2) DEFAULT 0,
  status         VARCHAR(20) DEFAULT 'present'
                   CHECK (status IN ('present','absent','leave','holiday','half_day')),
  notes          TEXT,
  UNIQUE (tenant_id, employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_month INTEGER NOT NULL,
  period_year  INTEGER NOT NULL,
  status       VARCHAR(20) DEFAULT 'draft'
                 CHECK (status IN ('draft','approved','paid')),
  total_gross  DECIMAL(18,4) DEFAULT 0,
  total_net    DECIMAL(18,4) DEFAULT 0,
  total_ded    DECIMAL(18,4) DEFAULT 0,
  run_by       UUID REFERENCES users(id),
  approved_by  UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payroll_lines (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id    UUID NOT NULL REFERENCES employees(id),
  base_salary    DECIMAL(18,4) DEFAULT 0,
  allowances     DECIMAL(18,4) DEFAULT 0,
  overtime_pay   DECIMAL(18,4) DEFAULT 0,
  deductions     DECIMAL(18,4) DEFAULT 0,
  advances       DECIMAL(18,4) DEFAULT 0,
  gross_salary   DECIMAL(18,4) DEFAULT 0,
  net_salary     DECIMAL(18,4) DEFAULT 0,
  payment_status VARCHAR(20) DEFAULT 'pending'
);

-- ============================================================
-- SECTION 12: MANUFACTURING & BOM
-- ============================================================
CREATE TABLE IF NOT EXISTS bom_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_item_id UUID NOT NULL REFERENCES items(id),
  name_ar         VARCHAR(255) NOT NULL,
  output_qty      DECIMAL(18,4) DEFAULT 1,
  is_default      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bom_lines (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bom_id           UUID NOT NULL REFERENCES bom_templates(id) ON DELETE CASCADE,
  raw_item_id      UUID NOT NULL REFERENCES items(id),
  required_qty     DECIMAL(18,4) NOT NULL,
  scrap_percentage DECIMAL(5,2) DEFAULT 0,
  adjusted_qty     DECIMAL(18,4),
  unit             VARCHAR(50),
  stage            VARCHAR(30) DEFAULT 'raw'
                     CHECK (stage IN ('raw','wip','finished','damaged','inspection')),
  notes            TEXT
);

CREATE TABLE IF NOT EXISTS production_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_number    VARCHAR(50) NOT NULL,
  product_item_id UUID NOT NULL REFERENCES items(id),
  bom_id          UUID REFERENCES bom_templates(id),
  planned_qty     DECIMAL(18,4) NOT NULL,
  actual_qty      DECIMAL(18,4) DEFAULT 0,
  scrap_qty       DECIMAL(18,4) DEFAULT 0,
  status          VARCHAR(30) DEFAULT 'planned'
                    CHECK (status IN ('planned','in_progress','completed','cancelled')),
  start_date      DATE,
  end_date        DATE,
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, order_number)
);

CREATE TABLE IF NOT EXISTS production_order_lines (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id            UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  bom_line_id         UUID REFERENCES bom_lines(id),
  raw_item_id         UUID NOT NULL REFERENCES items(id),
  planned_qty         DECIMAL(18,4) NOT NULL,
  expected_scrap_pct  DECIMAL(5,2) DEFAULT 0,
  actual_consumed_qty DECIMAL(18,4) DEFAULT 0,
  actual_scrap_qty    DECIMAL(18,4) DEFAULT 0,
  variance_qty        DECIMAL(18,4) GENERATED ALWAYS AS
                        (actual_scrap_qty - (planned_qty * expected_scrap_pct / 100)) STORED,
  stage               VARCHAR(30) DEFAULT 'raw'
);

-- ============================================================
-- SECTION 13: NOTIFICATIONS & BROADCASTS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id)   ON DELETE CASCADE,
  source     VARCHAR(30) DEFAULT 'system'
               CHECK (source IN ('system','developer','tenant_admin','due_date','plugin')),
  title_ar   VARCHAR(255) NOT NULL,
  body_ar    TEXT NOT NULL,
  type       VARCHAR(30) DEFAULT 'info'
               CHECK (type IN ('info','warning','error','success','system','due_date','broadcast')),
  is_read    BOOLEAN DEFAULT FALSE,
  fcm_sent   BOOLEAN DEFAULT FALSE,
  fcm_msg_id TEXT,
  action_url TEXT,
  meta       JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_user   ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_tenant ON notifications(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_broadcasts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_ar TEXT NOT NULL,
  sent_by    UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ,
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_broadcasts ON tenant_broadcasts(tenant_id, is_active, expires_at);

-- ============================================================
-- SECTION 14: IMPORT & OCR JOBS
-- ============================================================
CREATE TABLE IF NOT EXISTS import_jobs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  import_type   VARCHAR(50) NOT NULL
                  CHECK (import_type IN ('items','customers','suppliers',
                                         'employees','opening_balances','chart_of_accounts')),
  file_url      TEXT,
  status        VARCHAR(20) DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','failed')),
  total_rows    INTEGER DEFAULT 0,
  imported_rows INTEGER DEFAULT 0,
  failed_rows   INTEGER DEFAULT 0,
  errors        JSONB DEFAULT '[]'::jsonb,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ocr_scan_jobs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_urls     JSONB NOT NULL,
  status        VARCHAR(20) DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','failed')),
  extracted     JSONB DEFAULT '[]'::jsonb,
  draft_ids     JSONB DEFAULT '[]'::jsonb,
  total_files   INTEGER DEFAULT 0,
  done_files    INTEGER DEFAULT 0,
  error         TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SECTION 15: AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id    UUID,
  actor_role  VARCHAR(50),
  action      VARCHAR(100) NOT NULL,
  resource    VARCHAR(100),
  resource_id UUID,
  old_data    JSONB,
  new_data    JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit ON audit_log(tenant_id, created_at DESC);

-- ============================================================
-- SECTION 16: RLS — Row Level Security
-- ============================================================
DO $rls$
DECLARE t TEXT;
  tbls TEXT[] := ARRAY[
    'users','tenant_plugin_activations','chart_of_accounts',
    'journal_entries','journal_entry_lines','invoices','invoice_lines',
    'cashboxes','cashbox_transactions','items','warehouses','stock_balances',
    'stakeholders','employees','attendance','payroll_runs','payroll_lines',
    'bom_templates','bom_lines','production_orders','production_order_lines',
    'notifications','tenant_broadcasts','import_jobs','ocr_scan_jobs','audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    BEGIN
      EXECUTE format(
        'CREATE POLICY rls_%1$s ON %1$I
           USING (tenant_id = current_setting(''app.current_tenant_id'',true)::uuid)
           WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'',true)::uuid);', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $rls$;

-- Helper functions
CREATE OR REPLACE FUNCTION set_tenant_context(p_tid UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN PERFORM set_config('app.current_tenant_id', p_tid::text, true); END $$;

CREATE OR REPLACE FUNCTION clear_tenant_context()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN PERFORM set_config('app.current_tenant_id', '', true); END $$;

-- ============================================================
-- SECTION 17: DUE DATE ALERT FUNCTION (called by pg_cron hourly)
-- ============================================================
CREATE OR REPLACE FUNCTION fire_due_date_alerts()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE rec RECORD; cnt INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT i.id, i.tenant_id, i.invoice_number, i.due_date, i.total,
           t.alert_days_before
    FROM invoices i JOIN tenants t ON t.id = i.tenant_id
    WHERE i.due_date IS NOT NULL
      AND i.alert_sent = FALSE
      AND i.status NOT IN ('paid','cancelled')
      AND i.due_date <= CURRENT_DATE + (t.alert_days_before||' days')::interval
  LOOP
    INSERT INTO notifications(tenant_id, source, title_ar, body_ar, type, meta)
    VALUES(rec.tenant_id,'due_date',
      'تنبيه: فاتورة تقترب من الاستحقاق',
      'الفاتورة ' || rec.invoice_number || ' تستحق في ' || rec.due_date::text || ' بمبلغ ' || rec.total::text || ' ج.م',
      'due_date',
      jsonb_build_object('invoice_id',rec.id,'due_date',rec.due_date));
    UPDATE invoices SET alert_sent = TRUE WHERE id = rec.id;
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END $$;

-- Auto-update overdue status daily
CREATE OR REPLACE FUNCTION mark_overdue_invoices()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE invoices SET status = 'overdue'
  WHERE due_date < CURRENT_DATE AND status = 'posted' AND balance_due > 0;
END $$;

-- Schedule: SELECT cron.schedule('due-alerts','0 * * * *','SELECT fire_due_date_alerts()');
-- Schedule: SELECT cron.schedule('mark-overdue','0 1 * * *','SELECT mark_overdue_invoices()');

-- ============================================================
-- SECTION 18: SEED DATA
-- ============================================================
INSERT INTO plugins (plugin_key,name_ar,name_en,category,icon,version) VALUES
  ('pharmacy',      'الصيدليات',               'Pharmacies',             'health',      '💊','2.0.0'),
  ('hr',            'الموارد البشرية والرواتب', 'HR & Payroll',           'hr',          '👥','2.0.0'),
  ('manufacturing', 'التصنيع والإنتاج',         'Manufacturing & BOM',    'production',  '🏭','2.0.0'),
  ('excel_importer','استيراد Excel',            'Excel Importer',         'utility',     '📊','1.0.0'),
  ('ai_ocr',        'ماسح الفواتير الذكي',      'AI OCR Scanner',         'utility',     '🤖','1.0.0'),
  ('shipping',      'الشحن والكوريير',          'Shipping & Couriers',    'logistics',   '🚚','1.0.0'),
  ('logistics',     'اللوجستيات والأسطول',      'Logistics & Fleet',      'logistics',   '🚛','1.0.0'),
  ('medical',       'العيادات والمستشفيات',     'Medical Clinics',        'health',      '🏥','1.0.0'),
  ('contracting',   'المقاولات',               'Contracting',            'construction','🔨','1.0.0'),
  ('real_estate',   'العقارات',                'Real Estate',            'property',    '🏢','1.0.0'),
  ('security',      'الأمن والحراسة',           'Security Services',      'services',    '🔒','1.0.0'),
  ('ngo',           'الجمعيات والمنظمات',       'NGOs & Non-Profits',     'nonprofit',   '🤝','1.0.0'),
  ('crm',           'CRM والولاء',              'CRM & Loyalty',          'sales',       '🎯','1.0.0'),
  ('mobiles',       'المحمول والصيانة',        'Mobiles & Maintenance',  'retail',      '📱','1.0.0'),
  ('veterinary',    'البيطرة',                  'Veterinary',             'health',      '🐾','1.0.0')
ON CONFLICT (plugin_key) DO NOTHING;

INSERT INTO super_admins (email, password_hash, name, phone) VALUES
  ('alaa@gtech-erp.com', crypt('Gtech@2024!', gen_salt('bf',12)), 'علاء غبن', '01014868778')
ON CONFLICT (email) DO NOTHING;

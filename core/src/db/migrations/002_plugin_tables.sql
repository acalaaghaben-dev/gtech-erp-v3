-- ============================================================
-- G-Tech Developer ERP v3 — Plugin Tables Migration
-- جيتك المطور | أ. علاء غبن | 01014868778
-- Run AFTER 001_master_schema_v3.sql
-- Covers: pharmacy (ph_*) + the 10 bundled plugins
-- ============================================================

-- ============================================================
-- PHARMACY (ph_*) — also defined in plugins/pharmacy/index.js
-- Included here so a single migration run provisions everything
-- ============================================================
CREATE TABLE IF NOT EXISTS ph_batches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id         UUID NOT NULL REFERENCES items(id),
  barcode         VARCHAR(200),
  lot_number      VARCHAR(100),
  expiry_date     DATE NOT NULL,
  qty_in          DECIMAL(18,4) DEFAULT 0,
  qty_on_hand     DECIMAL(18,4) DEFAULT 0,
  purchase_price  DECIMAL(18,4) DEFAULT 0,
  sale_price      DECIMAL(18,4) DEFAULT 0,
  supplier_id     UUID REFERENCES stakeholders(id),
  warehouse_id    UUID REFERENCES warehouses(id),
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ph_sales (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invoice_number  VARCHAR(50) NOT NULL,
  sale_date       DATE NOT NULL,
  customer_id     UUID REFERENCES stakeholders(id),
  cashbox_id      UUID REFERENCES cashboxes(id),
  subtotal        DECIMAL(18,4) DEFAULT 0,
  discount        DECIMAL(18,4) DEFAULT 0,
  total           DECIMAL(18,4) DEFAULT 0,
  payment_method  VARCHAR(30) DEFAULT 'cash',
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
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

-- ============================================================
-- 1. SHIPPING & COURIERS
-- ============================================================
CREATE TABLE IF NOT EXISTS shipping_couriers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar         VARCHAR(255) NOT NULL,
  phone           VARCHAR(50),
  commission_rate DECIMAL(5,2) DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shipment_number VARCHAR(50),
  courier_id      UUID REFERENCES shipping_couriers(id),
  stakeholder_id  UUID REFERENCES stakeholders(id),
  payment_type    VARCHAR(20) DEFAULT 'prepaid' CHECK (payment_type IN ('prepaid','cod')),
  cod_amount      DECIMAL(18,4) DEFAULT 0,
  cod_settled     BOOLEAN DEFAULT FALSE,
  settled_amount  DECIMAL(18,4),
  settled_at      TIMESTAMPTZ,
  status          VARCHAR(30) DEFAULT 'pending'
                    CHECK (status IN ('pending','in_transit','delivered','returned','settled','cancelled')),
  delivery_date   DATE,
  notes           TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shipments_tenant ON shipments(tenant_id, status);

-- ============================================================
-- 2. LOGISTICS & FLEET
-- ============================================================
CREATE TABLE IF NOT EXISTS fleet_vehicles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar      VARCHAR(255) NOT NULL,
  plate_number VARCHAR(50),
  vehicle_type VARCHAR(100),
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fleet_drivers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255) NOT NULL,
  phone       VARCHAR(50),
  license_no  VARCHAR(100),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fleet_trips (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id      UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  driver_id       UUID REFERENCES fleet_drivers(id),
  trip_date       DATE NOT NULL,
  earnings        DECIMAL(18,4) DEFAULT 0,
  fuel_cost       DECIMAL(18,4) DEFAULT 0,
  other_expenses  DECIMAL(18,4) DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fleet_trips_vehicle ON fleet_trips(tenant_id, vehicle_id, trip_date);

CREATE TABLE IF NOT EXISTS fleet_maintenance (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vehicle_id        UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  maintenance_date  DATE NOT NULL,
  description       TEXT,
  cost              DECIMAL(18,4) DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fleet_maint_vehicle ON fleet_maintenance(tenant_id, vehicle_id);

CREATE TABLE IF NOT EXISTS driver_advances (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  driver_id    UUID NOT NULL REFERENCES fleet_drivers(id) ON DELETE CASCADE,
  advance_date DATE NOT NULL,
  amount       DECIMAL(18,4) NOT NULL,
  notes        TEXT,
  settled      BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_advances ON driver_advances(tenant_id, driver_id);

-- ============================================================
-- 3. MEDICAL CLINICS & HOSPITALS
-- ============================================================
CREATE TABLE IF NOT EXISTS medical_patients (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255) NOT NULL,
  phone       VARCHAR(50),
  national_id VARCHAR(50),
  date_of_birth DATE,
  gender      VARCHAR(10) CHECK (gender IN ('male','female')),
  blood_type  VARCHAR(5),
  address_ar  TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_med_patients_search ON medical_patients USING gin(name_ar gin_trgm_ops);

CREATE TABLE IF NOT EXISTS medical_appointments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id        UUID NOT NULL REFERENCES medical_patients(id) ON DELETE CASCADE,
  appointment_date  DATE NOT NULL,
  appointment_time  TIME,
  doctor_name       VARCHAR(255),
  reason            TEXT,
  status            VARCHAR(20) DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled','completed','cancelled','no_show')),
  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_med_appts ON medical_appointments(tenant_id, appointment_date);

CREATE TABLE IF NOT EXISTS medical_records (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id  UUID NOT NULL REFERENCES medical_patients(id) ON DELETE CASCADE,
  record_date DATE NOT NULL DEFAULT CURRENT_DATE,
  diagnosis   TEXT,
  treatment   TEXT,
  prescription TEXT,
  doctor_name VARCHAR(255),
  notes       TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_med_records_patient ON medical_records(tenant_id, patient_id, record_date DESC);

CREATE TABLE IF NOT EXISTS hospital_rooms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255) NOT NULL,
  room_type   VARCHAR(100),
  capacity    INTEGER DEFAULT 1,
  status      VARCHAR(20) DEFAULT 'available'
                CHECK (status IN ('available','occupied','maintenance')),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lab_tests (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255) NOT NULL,
  patient_id  UUID REFERENCES medical_patients(id),
  test_date   DATE DEFAULT CURRENT_DATE,
  result      TEXT,
  status      VARCHAR(20) DEFAULT 'pending'
                CHECK (status IN ('pending','in_progress','completed','cancelled')),
  cost        DECIMAL(18,4) DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 4. CONTRACTING
-- ============================================================
CREATE TABLE IF NOT EXISTS contracting_projects (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar         VARCHAR(255) NOT NULL,
  client_id       UUID REFERENCES stakeholders(id),
  contract_value  DECIMAL(18,4) DEFAULT 0,
  start_date      DATE,
  end_date        DATE,
  status          VARCHAR(20) DEFAULT 'active'
                    CHECK (status IN ('active','completed','on_hold','cancelled')),
  notes           TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contracting_subcontractors (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255) NOT NULL,
  phone       VARCHAR(50),
  specialty   VARCHAR(255),
  balance     DECIMAL(18,4) DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contracting_extractions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        UUID NOT NULL REFERENCES contracting_projects(id) ON DELETE CASCADE,
  extraction_number VARCHAR(50),
  extraction_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  percentage        DECIMAL(5,2) DEFAULT 0,
  amount            DECIMAL(18,4) NOT NULL DEFAULT 0,
  notes             TEXT,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_extractions_project ON contracting_extractions(tenant_id, project_id, extraction_date DESC);

-- ============================================================
-- 5. REAL ESTATE
-- ============================================================
CREATE TABLE IF NOT EXISTS re_properties (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar       VARCHAR(255) NOT NULL,
  address_ar    TEXT,
  property_type VARCHAR(100),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS re_units (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id  UUID NOT NULL REFERENCES re_properties(id) ON DELETE CASCADE,
  unit_number  VARCHAR(50) NOT NULL,
  unit_type    VARCHAR(100),
  area_sqm     DECIMAL(10,2),
  status       VARCHAR(20) DEFAULT 'available'
                 CHECK (status IN ('available','leased','sold','rented')),
  price        DECIMAL(18,4) DEFAULT 0,
  stakeholder_id UUID REFERENCES stakeholders(id),
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS re_installments (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id        UUID NOT NULL REFERENCES re_units(id) ON DELETE CASCADE,
  stakeholder_id UUID REFERENCES stakeholders(id),
  installment_no INTEGER,
  due_date       DATE NOT NULL,
  amount         DECIMAL(18,4) NOT NULL,
  paid_amount    DECIMAL(18,4) DEFAULT 0,
  paid_at        TIMESTAMPTZ,
  status         VARCHAR(20) DEFAULT 'pending'
                   CHECK (status IN ('pending','paid','overdue')),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_re_installments ON re_installments(tenant_id, status, due_date);

-- ============================================================
-- 6. SECURITY & FACILITIES
-- ============================================================
CREATE TABLE IF NOT EXISTS security_sites (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255) NOT NULL,
  location    TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_guards (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255) NOT NULL,
  phone       VARCHAR(50),
  national_id VARCHAR(50),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS security_schedules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id     UUID NOT NULL REFERENCES security_sites(id) ON DELETE CASCADE,
  guard_id    UUID NOT NULL REFERENCES security_guards(id) ON DELETE CASCADE,
  shift_date  DATE NOT NULL,
  shift_start TIME,
  shift_end   TIME,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sec_schedules ON security_schedules(tenant_id, site_id, shift_date);

CREATE TABLE IF NOT EXISTS security_contracts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id      UUID NOT NULL REFERENCES security_sites(id) ON DELETE CASCADE,
  monthly_rate DECIMAL(18,4) DEFAULT 0,
  start_date   DATE,
  end_date     DATE,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 7. NGO & NON-PROFITS
-- ============================================================
CREATE TABLE IF NOT EXISTS ngo_donors (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar       VARCHAR(255) NOT NULL,
  phone         VARCHAR(50),
  email         VARCHAR(255),
  total_donated DECIMAL(18,4) DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ngo_projects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255) NOT NULL,
  budget      DECIMAL(18,4) DEFAULT 0,
  spent       DECIMAL(18,4) DEFAULT 0,
  start_date  DATE,
  end_date    DATE,
  status      VARCHAR(20) DEFAULT 'active'
                CHECK (status IN ('active','completed','on_hold','cancelled')),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ngo_grants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255) NOT NULL,
  donor_id    UUID REFERENCES ngo_donors(id),
  project_id  UUID REFERENCES ngo_projects(id),
  amount      DECIMAL(18,4) DEFAULT 0,
  grant_date  DATE DEFAULT CURRENT_DATE,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ngo_donations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  donor_id      UUID NOT NULL REFERENCES ngo_donors(id) ON DELETE CASCADE,
  project_id    UUID REFERENCES ngo_projects(id),
  amount        DECIMAL(18,4) NOT NULL,
  donation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes         TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ngo_donations ON ngo_donations(tenant_id, donor_id);

-- Donor total auto-update function (called via RPC after each donation)
CREATE OR REPLACE FUNCTION update_donor_total(p_donor_id UUID, p_amount DECIMAL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE ngo_donors SET total_donated = total_donated + COALESCE(p_amount,0)
  WHERE id = p_donor_id;
END $$;

-- ============================================================
-- 8. CRM & LOYALTY
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_leads (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar      VARCHAR(255) NOT NULL,
  phone        VARCHAR(50),
  email        VARCHAR(255),
  source       VARCHAR(100),
  stage        VARCHAR(50) DEFAULT 'new'
                 CHECK (stage IN ('new','contacted','qualified','proposal','won','lost')),
  value        DECIMAL(18,4) DEFAULT 0,
  assigned_to  UUID REFERENCES users(id),
  notes        TEXT,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crm_leads ON crm_leads(tenant_id, stage);

CREATE TABLE IF NOT EXISTS crm_activities (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id       UUID REFERENCES crm_leads(id) ON DELETE CASCADE,
  name_ar       VARCHAR(255),
  activity_type VARCHAR(50) DEFAULT 'call'
                  CHECK (activity_type IN ('call','meeting','email','note','whatsapp')),
  activity_date DATE DEFAULT CURRENT_DATE,
  notes         TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 9. MOBILES & MAINTENANCE
-- ============================================================
CREATE TABLE IF NOT EXISTS mobile_devices (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar       VARCHAR(255) NOT NULL,
  brand         VARCHAR(100),
  model         VARCHAR(100),
  serial_imei   VARCHAR(100),
  customer_id   UUID REFERENCES stakeholders(id),
  purchase_date DATE,
  sale_price    DECIMAL(18,4) DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mobile_devices_imei ON mobile_devices(tenant_id, serial_imei);

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar       VARCHAR(255) NOT NULL,
  device_id     UUID REFERENCES mobile_devices(id),
  customer_id   UUID REFERENCES stakeholders(id),
  issue_ar      TEXT,
  status        VARCHAR(20) DEFAULT 'open'
                  CHECK (status IN ('open','in_progress','completed','delivered','cancelled')),
  cost          DECIMAL(18,4) DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mobile_topups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255) NOT NULL,
  network     VARCHAR(50) CHECK (network IN ('vodafone','orange','etisalat','we','other')),
  amount      DECIMAL(18,4) NOT NULL,
  commission  DECIMAL(18,4) DEFAULT 0,
  customer_id UUID REFERENCES stakeholders(id),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mobile_wallets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255) NOT NULL,
  network     VARCHAR(50) CHECK (network IN ('vodafone','orange','etisalat','we','other')),
  balance     DECIMAL(18,4) DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 10. VETERINARY
-- ============================================================
CREATE TABLE IF NOT EXISTS vet_animals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255) NOT NULL,
  category    VARCHAR(100),
  species     VARCHAR(100),
  breed       VARCHAR(100),
  owner_id    UUID REFERENCES stakeholders(id),
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vet_animals_category ON vet_animals(tenant_id, category);

CREATE TABLE IF NOT EXISTS vet_visits (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar     VARCHAR(255),
  animal_id   UUID NOT NULL REFERENCES vet_animals(id) ON DELETE CASCADE,
  visit_date  DATE DEFAULT CURRENT_DATE,
  diagnosis   TEXT,
  treatment   TEXT,
  cost        DECIMAL(18,4) DEFAULT 0,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vet_batches (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name_ar      VARCHAR(255),
  item_id      UUID NOT NULL REFERENCES items(id),
  lot_number   VARCHAR(100),
  expiry_date  DATE NOT NULL,
  qty_on_hand  DECIMAL(18,4) DEFAULT 0,
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vet_batches_expiry ON vet_batches(tenant_id, expiry_date);

-- ============================================================
-- ROW-LEVEL SECURITY for all tables above
-- ============================================================
DO $rls$
DECLARE t TEXT;
  tbls TEXT[] := ARRAY[
    'ph_batches','ph_sales','ph_sale_lines',
    'shipping_couriers','shipments',
    'fleet_vehicles','fleet_drivers','fleet_trips','fleet_maintenance','driver_advances',
    'medical_patients','medical_appointments','medical_records','hospital_rooms','lab_tests',
    'contracting_projects','contracting_subcontractors','contracting_extractions',
    're_properties','re_units','re_installments',
    'security_sites','security_guards','security_schedules','security_contracts',
    'ngo_donors','ngo_projects','ngo_grants','ngo_donations',
    'crm_leads','crm_activities',
    'mobile_devices','maintenance_tickets','mobile_topups','mobile_wallets',
    'vet_animals','vet_visits','vet_batches'
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

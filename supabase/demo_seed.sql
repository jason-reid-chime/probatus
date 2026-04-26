-- ============================================================
-- Probatus Demo Seed
-- Run in Supabase SQL Editor after the user signs up.
-- Replace USER_ID with the new user's auth.users UUID.
-- ============================================================

DO $$
DECLARE
  v_user_id        uuid := '01128578-ce6d-42c1-b341-c2e52cd97f36';
  v_tenant_id      uuid;
  v_customer1_id   uuid;
  v_customer2_id   uuid;
  v_std1_id        uuid;
  v_std2_id        uuid;
  v_std3_id        uuid;
  v_asset1_id      uuid;
  v_asset2_id      uuid;
  v_asset3_id      uuid;
  v_asset4_id      uuid;
  v_rec1_id        uuid;
  v_rec2_id        uuid;
  v_rec3_id        uuid;
  v_portal_user_id uuid;
BEGIN

-- ============================================================
-- 1. Tenant
-- ============================================================
INSERT INTO tenants (name, slug)
VALUES ('Apex Calibration Services', 'apex-calibration')
RETURNING id INTO v_tenant_id;

-- ============================================================
-- 2. Profile for the new user (all roles)
-- ============================================================
UPDATE profiles
SET tenant_id  = v_tenant_id,
    roles      = ARRAY['technician','supervisor','admin']::user_role[],
    role       = 'admin'
WHERE id = v_user_id;

-- If profile doesn't exist yet (signup hook may not have run)
INSERT INTO profiles (id, tenant_id, full_name, role, roles)
SELECT v_user_id, v_tenant_id, 'Demo User', 'admin', ARRAY['technician','supervisor','admin']::user_role[]
WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id);

-- ============================================================
-- 3. Customers
-- ============================================================
INSERT INTO customers (id, tenant_id, name, address, contact)
VALUES
  (gen_random_uuid(), v_tenant_id, 'Probatus Inc',
   '966 Pantera Drive, Unit 34, Mississauga, ON L4W 2S1',
   'maintenance@probatuscalibration.com')
RETURNING id INTO v_customer1_id;

INSERT INTO customers (id, tenant_id, name, address, contact)
VALUES
  (gen_random_uuid(), v_tenant_id, 'ABC Manufacturing',
   '594 Newbold Street, London, ON N6E 2W9',
   'facilities@abcmfg.com')
RETURNING id INTO v_customer2_id;

-- ============================================================
-- 4. Master Standards (calibration equipment)
-- ============================================================
INSERT INTO master_standards (id, tenant_id, name, serial_number, model, manufacturer,
                               certificate_ref, calibrated_at, due_at)
VALUES
  (gen_random_uuid(), v_tenant_id,
   'Fluke 718 Pressure Calibrator', '92600602', '718', 'Fluke Corporation',
   'FLAG-6801', now() - interval '3 months', now() + interval '9 months')
RETURNING id INTO v_std1_id;

INSERT INTO master_standards (id, tenant_id, name, serial_number, model, manufacturer,
                               certificate_ref, calibrated_at, due_at)
VALUES
  (gen_random_uuid(), v_tenant_id,
   'Fluke 724 Temperature Calibrator', '84301177', '724', 'Fluke Corporation',
   'FLAG-6802', now() - interval '2 months', now() + interval '10 months')
RETURNING id INTO v_std2_id;

INSERT INTO master_standards (id, tenant_id, name, serial_number, model, manufacturer,
                               certificate_ref, calibrated_at, due_at)
VALUES
  (gen_random_uuid(), v_tenant_id,
   'Fluke 789 ProcessMeter', '77201944', '789', 'Fluke Corporation',
   'FLAG-6803', now() - interval '1 month', now() + interval '11 months')
RETURNING id INTO v_std3_id;

-- ============================================================
-- 5. Assets (equipment under calibration)
-- ============================================================
INSERT INTO assets (id, tenant_id, customer_id, tag_id, serial_number,
                    manufacturer, model, instrument_type, location,
                    range_min, range_max, range_unit, calibration_interval_days,
                    updated_at)
VALUES
  (gen_random_uuid(), v_tenant_id, v_customer1_id,
   'SA-PT-001', '04250384', 'Zurn Wilkins', 'TG-5',
   'pressure', 'Mechanical Room B',
   0, 15, 'PSID', 365, now())
RETURNING id INTO v_asset1_id;

INSERT INTO assets (id, tenant_id, customer_id, tag_id, serial_number,
                    manufacturer, model, instrument_type, location,
                    range_min, range_max, range_unit, calibration_interval_days,
                    updated_at)
VALUES
  (gen_random_uuid(), v_tenant_id, v_customer1_id,
   'SA-TT-014', '19930042', 'Rosemount', '644', 'temperature',
   'Boiler Room',
   0, 200, '°C', 365, now())
RETURNING id INTO v_asset2_id;

INSERT INTO assets (id, tenant_id, customer_id, tag_id, serial_number,
                    manufacturer, model, instrument_type, location,
                    range_min, range_max, range_unit, calibration_interval_days,
                    updated_at)
VALUES
  (gen_random_uuid(), v_tenant_id, v_customer1_id,
   'SA-FT-007', '20150883', 'Endress+Hauser', 'Promag 50', 'level_4_20ma',
   'Pump Station 3',
   4, 20, 'mA', 365, now())
RETURNING id INTO v_asset3_id;

INSERT INTO assets (id, tenant_id, customer_id, tag_id, serial_number,
                    manufacturer, model, instrument_type, location,
                    range_min, range_max, range_unit, calibration_interval_days,
                    updated_at)
VALUES
  (gen_random_uuid(), v_tenant_id, v_customer2_id,
   'ABC-PT-003', '31200491', 'Honeywell', 'STD820', 'pressure',
   'Production Floor',
   0, 100, 'PSI', 180, now())
RETURNING id INTO v_asset4_id;

-- ============================================================
-- 6. Calibration Records
-- ============================================================

-- Record 1: APPROVED (SA-PT-001 pressure gauge)
INSERT INTO calibration_records
  (id, tenant_id, asset_id, technician_id, supervisor_id, local_id,
   status, performed_at, approved_at, sales_number, flag_number,
   tech_signature, supervisor_signature, notes)
VALUES
  (gen_random_uuid(), v_tenant_id, v_asset1_id, v_user_id, v_user_id,
   'CAL-2026-0001', 'approved',
   now() - interval '5 days', now() - interval '4 days',
   'SO-10482', 'FLAG-14944',
   'Demo Tech', 'Demo Supervisor',
   'Backflow preventer test kit. Unit passed all points.')
RETURNING id INTO v_rec1_id;

-- Measurements for rec1
INSERT INTO calibration_measurements
  (record_id, point_label, standard_value, measured_value, unit, error_pct, pass, notes)
VALUES
  (v_rec1_id, '0%',   0.0,  0.0,  'PSID', 0.00,  true, ''),
  (v_rec1_id, '25%',  3.75, 3.8,  'PSID', 1.33,  true, ''),
  (v_rec1_id, '50%',  7.5,  7.5,  'PSID', 0.00,  true, ''),
  (v_rec1_id, '75%',  11.25,11.2, 'PSID', 0.44,  true, ''),
  (v_rec1_id, '100%', 15.0, 15.0, 'PSID', 0.00,  true, '');

INSERT INTO calibration_standards_used (record_id, standard_id)
VALUES (v_rec1_id, v_std1_id);

-- Record 2: PENDING APPROVAL (SA-TT-014 temperature sensor)
INSERT INTO calibration_records
  (id, tenant_id, asset_id, technician_id, local_id,
   status, performed_at, sales_number, flag_number, tech_signature, notes)
VALUES
  (gen_random_uuid(), v_tenant_id, v_asset2_id, v_user_id,
   'CAL-2026-0002', 'pending_approval',
   now() - interval '1 day',
   'SO-10491', 'FLAG-14961',
   'Demo Tech',
   'RTD sensor in boiler room. Minor drift at high range — within tolerance.')
RETURNING id INTO v_rec2_id;

INSERT INTO calibration_measurements
  (record_id, point_label, standard_value, measured_value, unit, error_pct, pass, notes)
VALUES
  (v_rec2_id, '0°C',   0.0,   0.2,   '°C', 0.10, true, ''),
  (v_rec2_id, '50°C',  50.0,  50.1,  '°C', 0.05, true, ''),
  (v_rec2_id, '100°C', 100.0, 100.3, '°C', 0.15, true, ''),
  (v_rec2_id, '150°C', 150.0, 150.4, '°C', 0.27, true, ''),
  (v_rec2_id, '200°C', 200.0, 200.6, '°C', 0.30, true, '');

INSERT INTO calibration_standards_used (record_id, standard_id)
VALUES (v_rec2_id, v_std2_id);

-- Record 3: IN PROGRESS (SA-FT-007 flow transmitter)
INSERT INTO calibration_records
  (id, tenant_id, asset_id, technician_id, local_id,
   status, performed_at, sales_number, flag_number, tech_signature)
VALUES
  (gen_random_uuid(), v_tenant_id, v_asset3_id, v_user_id,
   'CAL-2026-0003', 'in_progress',
   now(),
   'SO-10495', 'FLAG-14968', 'Demo Tech')
RETURNING id INTO v_rec3_id;

INSERT INTO calibration_measurements
  (record_id, point_label, standard_value, measured_value, unit, error_pct, pass, notes)
VALUES
  (v_rec3_id, '0%',  4.0,  4.02, 'mA', 0.10, true, ''),
  (v_rec3_id, '25%', 8.0,  7.98, 'mA', 0.25, true, '');
-- (remaining points not yet entered — in progress)

INSERT INTO calibration_standards_used (record_id, standard_id)
VALUES (v_rec3_id, v_std3_id);

-- ============================================================
-- 7. Customer Portal Demo User
-- Creates a Supabase auth user for the customer to log in.
-- Login: portal@probatuscalibration.com / Demo1234!
-- ============================================================
v_portal_user_id := gen_random_uuid();

-- Check if portal user already exists
SELECT id INTO v_portal_user_id FROM auth.users WHERE email = 'portal@probatuscalibration.com';

IF v_portal_user_id IS NULL THEN
  v_portal_user_id := gen_random_uuid();
  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    aud, role
  ) VALUES (
    v_portal_user_id,
    '00000000-0000-0000-0000-000000000000',
    'portal@probatuscalibration.com',
    crypt('Demo1234!', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Probatus Inc"}',
    'authenticated', 'authenticated'
  );
END IF;

-- Link portal user to the customer
INSERT INTO profiles (id, tenant_id, full_name, role, roles, customer_id)
SELECT v_portal_user_id, v_tenant_id, 'Probatus Inc', 'customer',
       ARRAY['customer']::user_role[], v_customer1_id
WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = v_portal_user_id)
ON CONFLICT (id) DO UPDATE SET
  tenant_id   = v_tenant_id,
  roles       = ARRAY['customer']::user_role[],
  role        = 'customer',
  customer_id = v_customer1_id;

RAISE NOTICE 'Demo seed complete for tenant: %', v_tenant_id;
RAISE NOTICE 'Customer portal login: portal@probatuscalibration.com / Demo1234!';

END $$;

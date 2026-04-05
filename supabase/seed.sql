-- =============================================================
-- Probatus — Development Seed Data
-- =============================================================
--
-- HOW TO RUN:
--   Option A (local Supabase):  supabase db reset
--   Option B (direct):          psql $DATABASE_URL < supabase/seed.sql
--
-- CREATING AUTH USERS:
--   The profiles below use fixed UUIDs. You must create matching
--   users in Supabase Dashboard > Authentication > Users (or via CLI):
--
--   Email                    Password          UUID
--   -------------------------------------------------------
--   jason@sheridan.ca        Probatus2026!     00000000-0000-0000-0000-000000000001
--   mike@sheridan.ca         Probatus2026!     00000000-0000-0000-0000-000000000002
--   sarah@sheridan.ca        Probatus2026!     00000000-0000-0000-0000-000000000003
--
--   CLI: supabase auth users create --email jason@sheridan.ca \
--          --password Probatus2026! \
--          --id 00000000-0000-0000-0000-000000000001
-- =============================================================

-- Fake auth.users rows so FK constraint is satisfied in local dev
-- (Supabase local does allow direct inserts during seed)
insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('00000000-0000-0000-0000-000000000001', 'jason@sheridan.ca',  '$2a$10$placeholder', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000002', 'mike@sheridan.ca',   '$2a$10$placeholder', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-000000000003', 'sarah@sheridan.ca',  '$2a$10$placeholder', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
on conflict (id) do nothing;

-- =============================================================
-- TENANT
-- =============================================================
insert into tenants (id, name, slug) values
  ('10000000-0000-0000-0000-000000000001', 'Sheridan Automation', 'sheridan-automation')
on conflict (id) do nothing;

-- =============================================================
-- PROFILES
-- =============================================================
insert into profiles (id, tenant_id, full_name, role) values
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Jason Reid',       'admin'),
  ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Mike Chen',        'supervisor'),
  ('00000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Sarah Kowalski',   'technician')
on conflict (id) do nothing;

-- =============================================================
-- CUSTOMERS
-- =============================================================
insert into customers (id, tenant_id, name, address) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'City of London',                    '300 Dufferin Ave, London, ON'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Thames Valley District School Board', '1250 Dundas St, London, ON')
on conflict (id) do nothing;

-- =============================================================
-- MASTER STANDARDS
-- =============================================================
insert into master_standards (id, tenant_id, name, serial_number, model, manufacturer, certificate_ref, calibrated_at, due_at) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Fluke 743B Documenting Process Calibrator', 'SA-F743-001', '743B', 'Fluke',   'NRC-2025-48271', '2025-09-15', '2026-09-15'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'Fluke 700P06 Pressure Module',              'SA-P06-003',  '700P06', 'Fluke', 'NRC-2025-48272', '2025-06-01', '2026-06-01'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   'Fluke 714 Thermocouple Calibrator',         'SA-F714-002', '714',   'Fluke',  'NRC-2025-48273', '2025-04-20', '2026-04-20'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
   'Fluke 87V Multimeter',                      'SA-87V-001',  '87V',   'Fluke',  'NRC-2024-31190', '2024-09-01', '2026-03-01')
on conflict (id) do nothing;

-- =============================================================
-- ASSETS
-- =============================================================
insert into assets (id, tenant_id, customer_id, tag_id, serial_number, manufacturer, model,
  instrument_type, range_min, range_max, range_unit,
  calibration_interval_days, last_calibrated_at, next_due_at, location) values

  -- City of London — pressure gauges
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'SHD-PRES-001', 'P-1042', 'Ashcroft', 'Type 1009', 'pressure', 0, 100, 'psi', 365,
   '2025-02-15', '2026-02-15', 'Pump Room A'),

  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'SHD-PRES-002', 'P-1089', 'Wika', 'S-10', 'pressure', 0, 200, 'psi', 365,
   '2025-07-01', '2026-07-01', 'Pump Room B'),

  -- City of London — temperature sensors
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'SHD-TEMP-001', 'T-0331', 'Endress+Hauser', 'TSM465', 'temperature', -20, 150, '°C', 365,
   '2025-04-10', '2026-04-10', 'Boiler Room'),

  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'SHD-TEMP-002', 'T-0392', 'Yokogawa', 'EJA110E', 'temperature', 0, 200, '°C', 365,
   '2025-04-20', '2026-04-20', 'Chiller Unit 2'),

  -- Thames Valley — pH meters
  ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
   'SHD-PH-001', 'H-2201', 'Hach', 'PHC101', 'ph_conductivity', 0, 14, 'pH', 180,
   '2025-10-01', '2026-04-01', 'Water Treatment Lab'),

  ('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
   'SHD-PH-002', 'H-2247', 'Mettler Toledo', 'InPro4260', 'ph_conductivity', 0, 14, 'pH', 180,
   '2025-09-15', '2026-03-15', 'Cooling Tower'),

  -- City of London — level transmitter
  ('40000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
   'SHD-LVL-001', 'L-0041', 'Rosemount', '3051', 'level_4_20ma', 0, 100, '%', 365,
   '2025-06-01', '2026-06-01', 'Storage Tank 1'),

  -- Thames Valley — pressure transmitter (due soon)
  ('40000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002',
   'SHD-PRES-003', 'P-2011', 'Emerson', 'DP15', 'pressure', 0, 50, 'psi', 365,
   '2025-04-15', '2026-04-25', 'Filter Station')

on conflict (id) do nothing;

-- =============================================================
-- CALIBRATION RECORDS
-- =============================================================
insert into calibration_records (id, tenant_id, asset_id, technician_id, supervisor_id, status,
  performed_at, approved_at, sales_number, notes, local_id) values

  -- Approved pressure calibration (6 months ago)
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002',
   'approved', '2025-08-15 09:30:00+00', '2025-08-15 14:00:00+00',
   'SA-2025-1042', 'Annual calibration — all points within tolerance', 'local-001'),

  -- Pending approval temperature calibration (last week)
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000003', null,
   'pending_approval', '2026-03-26 10:15:00+00', null,
   'SA-2026-0312', null, 'local-002'),

  -- In-progress pH calibration (today)
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000005',
   '00000000-0000-0000-0000-000000000003', null,
   'in_progress', now(), null, null, null, 'local-003')

on conflict (id) do nothing;

-- =============================================================
-- MEASUREMENTS — approved pressure calibration (SHD-PRES-001)
-- =============================================================
insert into calibration_measurements (id, record_id, point_label, standard_value, measured_value, unit, pass, error_pct) values
  ('60000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '0%',   0,   0.1, 'psi', true,  null),
  ('60000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '25%',  25,  25.2, 'psi', true, 0.800),
  ('60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', '50%',  50,  50.4, 'psi', true, 0.800),
  ('60000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001', '75%',  75,  75.1, 'psi', true, 0.133),
  ('60000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-000000000001', '100%', 100, 100.3, 'psi', true, 0.300)
on conflict (id) do nothing;

-- Standards used on the approved calibration
insert into calibration_standards_used (record_id, standard_id) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002')
on conflict do nothing;

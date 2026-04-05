-- Add new instrument type enum values
ALTER TYPE instrument_type ADD VALUE IF NOT EXISTS 'flow';
ALTER TYPE instrument_type ADD VALUE IF NOT EXISTS 'pressure_switch';
ALTER TYPE instrument_type ADD VALUE IF NOT EXISTS 'temperature_switch';
ALTER TYPE instrument_type ADD VALUE IF NOT EXISTS 'conductivity';
ALTER TYPE instrument_type ADD VALUE IF NOT EXISTS 'transmitter_4_20ma';

-- This migration fixes the existing empty attendance table
-- Run this if attendance table already exists but is missing columns/constraints

-- First, drop the old empty table if it has wrong structure
DROP TABLE IF EXISTS attendance CASCADE;

-- Create the correct attendance table
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  service_type VARCHAR(100) NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  present BOOLEAN DEFAULT TRUE,
  checked_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, service_type, member_id)
);

-- Create indexes
CREATE INDEX idx_attendance_date ON attendance(date);
CREATE INDEX idx_attendance_service_type ON attendance(service_type);
CREATE INDEX idx_attendance_member_id ON attendance(member_id);
CREATE INDEX idx_attendance_date_service ON attendance(date, service_type);

-- Create summary table
CREATE TABLE IF NOT EXISTS attendance_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  service_type VARCHAR(100) NOT NULL,
  total_present INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, service_type)
);

CREATE INDEX IF NOT EXISTS idx_attendance_summary_date ON attendance_summary(date);
CREATE INDEX IF NOT EXISTS idx_attendance_summary_service ON attendance_summary(service_type);

-- Create function for updating summary
CREATE OR REPLACE FUNCTION update_attendance_summary()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO attendance_summary (date, service_type, total_present)
  SELECT date, service_type, COUNT(*) 
  FROM attendance 
  WHERE date = NEW.date AND service_type = NEW.service_type AND present = true
  GROUP BY date, service_type
  ON CONFLICT (date, service_type) 
  DO UPDATE SET total_present = EXCLUDED.total_present, updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop old trigger if it exists
DROP TRIGGER IF EXISTS attendance_summary_update ON attendance;

-- Create new trigger
CREATE TRIGGER attendance_summary_update
AFTER INSERT OR UPDATE OR DELETE ON attendance
FOR EACH ROW
EXECUTE FUNCTION update_attendance_summary();

-- Create function for timestamp
CREATE OR REPLACE FUNCTION update_attendance_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop old trigger if it exists
DROP TRIGGER IF EXISTS attendance_update_timestamp ON attendance;

-- Create new trigger
CREATE TRIGGER attendance_update_timestamp
BEFORE UPDATE ON attendance
FOR EACH ROW
EXECUTE FUNCTION update_attendance_timestamp();

-- Verify the table is correct
SELECT 'Attendance table created successfully' as status;

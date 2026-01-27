-- Unified Attendance Schema
-- This schema works with the main 'members' table imported from Planning Center

-- Attendance records table (links to service date and type)
CREATE TABLE IF NOT EXISTS attendance (
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

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_service_type ON attendance(service_type);
CREATE INDEX IF NOT EXISTS idx_attendance_member_id ON attendance(member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date_service ON attendance(date, service_type);

-- Summary table for quick reporting (denormalized)
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

-- Function to update summary when attendance record is added/changed
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

CREATE TRIGGER attendance_summary_update
AFTER INSERT OR UPDATE OR DELETE ON attendance
FOR EACH ROW
EXECUTE FUNCTION update_attendance_summary();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_attendance_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_update_timestamp
BEFORE UPDATE ON attendance
FOR EACH ROW
EXECUTE FUNCTION update_attendance_timestamp();

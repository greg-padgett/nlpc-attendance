-- Attendance Tracker Tables
-- Created for Church Attendance Management System
-- Separate schema from ministry assignment program

-- Members table for attendance tracking
CREATE TABLE IF NOT EXISTS attendance_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  status VARCHAR(50) DEFAULT 'Active',
  join_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attendance records table
CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  service_type VARCHAR(100) NOT NULL,
  count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Attendance details (which members attended which service)
CREATE TABLE IF NOT EXISTS attendance_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id UUID NOT NULL REFERENCES attendance_records(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES attendance_members(id) ON DELETE CASCADE,
  present BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attendance_record_id, member_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON attendance_records(date);
CREATE INDEX IF NOT EXISTS idx_attendance_records_service_type ON attendance_records(service_type);
CREATE INDEX IF NOT EXISTS idx_attendance_details_record ON attendance_details(attendance_record_id);
CREATE INDEX IF NOT EXISTS idx_attendance_details_member ON attendance_details(member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_members_email ON attendance_members(email);
CREATE INDEX IF NOT EXISTS idx_attendance_members_name ON attendance_members(last_name, first_name);

-- Insert trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_attendance_members_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_members_update_timestamp
BEFORE UPDATE ON attendance_members
FOR EACH ROW
EXECUTE FUNCTION update_attendance_members_timestamp();

CREATE OR REPLACE FUNCTION update_attendance_records_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_records_update_timestamp
BEFORE UPDATE ON attendance_records
FOR EACH ROW
EXECUTE FUNCTION update_attendance_records_timestamp();

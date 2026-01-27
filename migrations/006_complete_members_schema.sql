-- Complete Members Schema with all Planning Center fields
-- Run this after the reset to add all the columns

-- Drop the incomplete members table
DROP TABLE IF EXISTS members CASCADE;

-- Create complete members table with all Planning Center fields
CREATE TABLE members (
  -- Core identification
  id TEXT PRIMARY KEY,
  person_id TEXT,
  
  -- Personal information
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  
  -- Life events
  birthdate DATE,
  anniversary DATE,
  
  -- Address
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(50),
  postal_code VARCHAR(20),
  
  -- Church info
  status VARCHAR(50) DEFAULT 'Active',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX idx_members_name ON members(first_name, last_name);
CREATE INDEX idx_members_email ON members(email);
CREATE INDEX idx_members_phone ON members(phone);
CREATE INDEX idx_members_status ON members(status);
CREATE INDEX idx_members_person_id ON members(person_id);

-- Attendance records table (unchanged, but recreate for dependency)
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

CREATE INDEX idx_attendance_date ON attendance(date);
CREATE INDEX idx_attendance_service_type ON attendance(service_type);
CREATE INDEX idx_attendance_member_id ON attendance(member_id);
CREATE INDEX idx_attendance_date_service ON attendance(date, service_type);
CREATE INDEX idx_attendance_present ON attendance(present);

-- Summary table for quick reporting
CREATE TABLE attendance_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  service_type VARCHAR(100) NOT NULL,
  total_present INTEGER DEFAULT 0,
  total_absent INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(date, service_type)
);

CREATE INDEX idx_summary_date ON attendance_summary(date);
CREATE INDEX idx_summary_service ON attendance_summary(service_type);

-- Function to update summary counts
CREATE OR REPLACE FUNCTION update_attendance_summary()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO attendance_summary (date, service_type, total_present, total_absent)
  SELECT 
    date, 
    service_type, 
    COUNT(CASE WHEN present = true THEN 1 END),
    COUNT(CASE WHEN present = false THEN 1 END)
  FROM attendance 
  WHERE date = NEW.date AND service_type = NEW.service_type
  GROUP BY date, service_type
  ON CONFLICT (date, service_type) 
  DO UPDATE SET 
    total_present = EXCLUDED.total_present,
    total_absent = EXCLUDED.total_absent,
    updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update summary when attendance changes
CREATE TRIGGER attendance_summary_update
AFTER INSERT OR UPDATE OR DELETE ON attendance
FOR EACH ROW
EXECUTE FUNCTION update_attendance_summary();

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_attendance_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update the updated_at column
CREATE TRIGGER attendance_update_timestamp
BEFORE UPDATE ON attendance
FOR EACH ROW
EXECUTE FUNCTION update_attendance_timestamp();

-- Function to update members timestamp
CREATE OR REPLACE FUNCTION update_members_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update members timestamp
CREATE TRIGGER members_update_timestamp
BEFORE UPDATE ON members
FOR EACH ROW
EXECUTE FUNCTION update_members_timestamp();

-- Verify everything is created
SELECT 'Complete schema ready for import' as status;

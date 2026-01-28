-- Absentee Check-in & Live Stream Access Schema
-- This schema supports the self-service absentee check-in system
-- and Vimeo live stream password management

-- Table for self-reported absences (members checking in as absent)
CREATE TABLE IF NOT EXISTS absentee_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  reason VARCHAR(50) NOT NULL,
  prayer_request TEXT,
  service_date DATE NOT NULL DEFAULT CURRENT_DATE,
  livestream_sent BOOLEAN DEFAULT FALSE,
  livestream_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_absentee_checkins_date ON absentee_checkins(service_date);
CREATE INDEX IF NOT EXISTS idx_absentee_checkins_reason ON absentee_checkins(reason);
CREATE INDEX IF NOT EXISTS idx_absentee_checkins_created ON absentee_checkins(created_at);

-- Table for Vimeo password management
CREATE TABLE IF NOT EXISTS vimeo_passwords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id VARCHAR(100) NOT NULL,
  password VARCHAR(100) NOT NULL,
  video_url TEXT,
  active BOOLEAN DEFAULT TRUE,
  rotation_type VARCHAR(20) DEFAULT 'manual', -- 'manual' or 'scheduled'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP
);

-- Index for active password lookup
CREATE INDEX IF NOT EXISTS idx_vimeo_passwords_active ON vimeo_passwords(active, created_at DESC);

-- Table for password rotation schedule
CREATE TABLE IF NOT EXISTS password_rotation_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week INTEGER NOT NULL, -- 0=Sunday, 1=Monday, etc.
  time_of_day TIME NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  last_run TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_absentee_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update the updated_at column
DROP TRIGGER IF EXISTS absentee_checkins_update_timestamp ON absentee_checkins;
CREATE TRIGGER absentee_checkins_update_timestamp
BEFORE UPDATE ON absentee_checkins
FOR EACH ROW
EXECUTE FUNCTION update_absentee_timestamp();

-- Insert default rotation schedule (Sunday at 8:00 AM)
INSERT INTO password_rotation_schedule (day_of_week, time_of_day, enabled)
VALUES (0, '08:00:00', false)
ON CONFLICT DO NOTHING;

-- Verify tables are created
SELECT 'Absentee/Livestream schema ready' as status;

-- Members table migration
-- Recreates the members table with the correct schema for the import function
-- This replaces the old incomplete members table

-- Drop the old members table if it exists
DROP TABLE IF EXISTS members CASCADE;

-- Create the new members table with full attendance tracking schema
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  first_name VARCHAR(255) NOT NULL,
  last_name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  birthdate DATE,
  anniversary DATE,
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  postal_code VARCHAR(20),
  status VARCHAR(50) DEFAULT 'Active',
  join_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_name ON members(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);

-- Create function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_members_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists, then create new one
DROP TRIGGER IF EXISTS members_update_timestamp ON members;
CREATE TRIGGER members_update_timestamp
BEFORE UPDATE ON members
FOR EACH ROW
EXECUTE FUNCTION update_members_timestamp();

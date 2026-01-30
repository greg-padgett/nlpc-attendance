-- Migration: Stream Access Codes
-- Creates table for managing unique access codes for livestream viewing

CREATE TABLE IF NOT EXISTS stream_access_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(8) UNIQUE NOT NULL,
    member_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    absentee_checkin_id UUID REFERENCES absentee_checkins(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    first_used_at TIMESTAMP,
    last_used_at TIMESTAMP,
    use_count INTEGER DEFAULT 0,
    revoked BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMP,
    notes TEXT
);

-- Index for quick code lookups
CREATE INDEX IF NOT EXISTS idx_stream_access_codes_code ON stream_access_codes(code);

-- Index for finding active codes
CREATE INDEX IF NOT EXISTS idx_stream_access_codes_expires ON stream_access_codes(expires_at) WHERE revoked = FALSE;

-- Index for finding codes by phone
CREATE INDEX IF NOT EXISTS idx_stream_access_codes_phone ON stream_access_codes(phone);

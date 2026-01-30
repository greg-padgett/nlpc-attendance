const { Pool } = require('pg');
const crypto = require('crypto');

let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

// Twilio setup
let twilioClient = null;
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('Twilio client initialized');
  }
} catch (e) {
  console.log('Twilio not available:', e.message);
}

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM_NUMBER;
const SITE_URL = process.env.URL || 'https://nlpc-attendance.netlify.app';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const respond = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify(body)
});

// Generate a unique 6-character access code
const generateAccessCode = () => {
  // Use uppercase letters and numbers, avoiding confusing characters (0, O, I, 1, L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return code;
};

// Format phone number for Twilio
const formatPhone = (phone) => {
  if (!phone) return null;
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return '+1' + cleaned;
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return '+' + cleaned;
  } else if (!cleaned.startsWith('+')) {
    return '+' + cleaned;
  }
  return cleaned;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (!pool) {
    return respond(503, { error: 'Database not configured' });
  }

  try {
    const { name, phone, reason, prayerRequest, serviceDate } = JSON.parse(event.body);

    // Validate required fields
    if (!name || !name.trim()) {
      return respond(400, { error: 'Name is required' });
    }

    if (!phone || !phone.trim()) {
      return respond(400, { error: 'Phone number is required for receiving live stream link' });
    }

    if (!reason) {
      return respond(400, { error: 'Reason for absence is required' });
    }

    const validReasons = ['sick', 'vacation', 'business', 'other'];
    if (!validReasons.includes(reason)) {
      return respond(400, { error: 'Invalid reason. Must be: sick, vacation, business, or other' });
    }

    // Validate phone number against members database
    // Use last 10 digits for matching to handle country code variations
    const cleanedPhone = phone.replace(/\D/g, '');
    const last10Digits = cleanedPhone.slice(-10);

    const memberResult = await pool.query(`
      SELECT id, first_name, last_name, phone
      FROM members
      WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) = $1
      LIMIT 1
    `, [last10Digits]);

    if (memberResult.rows.length === 0) {
      return respond(403, {
        error: 'Phone number not found in member directory. Please contact the church office if you believe this is an error.',
        notMember: true
      });
    }

    const member = memberResult.rows[0];
    console.log(`Validated member: ${member.first_name} ${member.last_name} (ID: ${member.id})`);

    // Determine service date (default to today)
    const effectiveDate = serviceDate || new Date().toISOString().split('T')[0];

    // Normalize phone to 10 digits for storage (strip leading 1)
    const normalizedPhone = last10Digits;

    // Save to database
    const insertResult = await pool.query(`
      INSERT INTO absentee_checkins (name, phone, reason, prayer_request, service_date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, phone, reason, prayer_request, service_date, created_at
    `, [name.trim(), normalizedPhone, reason, prayerRequest?.trim() || null, effectiveDate]);

    const checkin = insertResult.rows[0];

    // Generate access code and send SMS with watch link
    let smsSent = false;
    let smsError = null;
    let accessCode = null;

    try {
      // Check if there's an active stream configured
      const vimeoResult = await pool.query(`
        SELECT video_id, password, video_url
        FROM vimeo_passwords
        WHERE active = true
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (vimeoResult.rows.length > 0 && twilioClient && TWILIO_PHONE) {
        // Generate unique access code
        let codeGenerated = false;
        let attempts = 0;
        while (!codeGenerated && attempts < 10) {
          accessCode = generateAccessCode();
          try {
            // Set expiration to 24 hours from now
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24);

            await pool.query(`
              INSERT INTO stream_access_codes (code, member_name, phone, absentee_checkin_id, expires_at)
              VALUES ($1, $2, $3, $4, $5)
            `, [accessCode, name.trim(), normalizedPhone, checkin.id, expiresAt.toISOString()]);

            codeGenerated = true;
            console.log(`Generated access code ${accessCode} for ${name.trim()}, expires ${expiresAt.toISOString()}`);
          } catch (codeErr) {
            // Code collision, try again
            if (codeErr.code === '23505') { // unique_violation
              attempts++;
              console.log(`Code collision, attempt ${attempts}`);
            } else {
              throw codeErr;
            }
          }
        }

        if (codeGenerated) {
          // Send SMS with watch link
          const watchUrl = `${SITE_URL}/watch?code=${accessCode}`;
          const firstName = name.split(' ')[0];
          const smsMessage = `NLPC Live Stream\n\nHi ${firstName}! Your access code is:\n\n${accessCode}\n\nWatch here: ${watchUrl}\n\nCode expires in 24 hours. We're praying for you!`;

          const phoneNumber = formatPhone(phone);
          if (phoneNumber) {
            await twilioClient.messages.create({
              body: smsMessage,
              from: TWILIO_PHONE,
              to: phoneNumber
            });
            smsSent = true;

            // Update the record to indicate livestream was sent
            await pool.query(`
              UPDATE absentee_checkins
              SET livestream_sent = true, livestream_sent_at = CURRENT_TIMESTAMP
              WHERE id = $1
            `, [checkin.id]);

            console.log(`SMS sent to ${phoneNumber} with access code ${accessCode}`);
          }
        } else {
          smsError = 'Unable to generate access code';
        }
      } else if (!twilioClient || !TWILIO_PHONE) {
        smsError = 'SMS service not configured';
        console.log('Twilio not configured - SMS not sent');
      } else {
        smsError = 'No active live stream password configured';
        console.log('No active Vimeo password found');
      }
    } catch (smsErr) {
      smsError = smsErr.message;
      console.error('Error sending SMS:', smsErr.message);
    }

    return respond(200, {
      success: true,
      message: smsSent
        ? 'Check-in recorded! Live stream link sent to your phone.'
        : 'Check-in recorded! Live stream link will be sent separately.',
      checkin: {
        id: checkin.id,
        name: checkin.name,
        reason: checkin.reason,
        serviceDate: checkin.service_date,
        smsSent
      },
      smsError: smsSent ? null : smsError
    });

  } catch (error) {
    console.error('Error submitting absence:', error);
    return respond(500, {
      error: 'Failed to submit absence',
      details: error.message
    });
  }
};

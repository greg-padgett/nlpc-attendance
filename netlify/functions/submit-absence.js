const { Pool } = require('pg');

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
    const cleanedPhone = phone.replace(/\D/g, '');
    const memberResult = await pool.query(`
      SELECT id, first_name, last_name, phone
      FROM members
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, '(', ''), ')', ''), '-', ''), ' ', '') = $1
         OR REPLACE(REPLACE(REPLACE(REPLACE(phone, '(', ''), ')', ''), '-', ''), ' ', '') = $2
      LIMIT 1
    `, [cleanedPhone, '1' + cleanedPhone]);

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

    // Save to database
    const insertResult = await pool.query(`
      INSERT INTO absentee_checkins (name, phone, reason, prayer_request, service_date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, phone, reason, prayer_request, service_date, created_at
    `, [name.trim(), phone.trim(), reason, prayerRequest?.trim() || null, effectiveDate]);

    const checkin = insertResult.rows[0];

    // Try to get current Vimeo password and send SMS
    let smsSent = false;
    let smsError = null;

    try {
      // Get the current active Vimeo password
      const vimeoResult = await pool.query(`
        SELECT video_id, password, video_url
        FROM vimeo_passwords
        WHERE active = true
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (vimeoResult.rows.length > 0 && twilioClient && TWILIO_PHONE) {
        const vimeo = vimeoResult.rows[0];
        const videoUrl = vimeo.video_url || `https://vimeo.com/${vimeo.video_id}`;

        // Format the SMS message
        const smsMessage = `NLPC Live Stream Access\n\nHi ${name.split(' ')[0]}! Here's your live stream link:\n\n${videoUrl}\n\nPassword: ${vimeo.password}\n\nWe're praying for you!`;

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

          console.log(`SMS sent to ${phoneNumber} for absentee check-in ${checkin.id}`);
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

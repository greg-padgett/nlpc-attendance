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
    const {
      memberId,
      memberName,
      memberPhone,
      reason,
      serviceDate,
      serviceType,
      sendLink,
      prayerRequest
    } = JSON.parse(event.body);

    // Validate required fields
    if (!memberName) {
      return respond(400, { error: 'Member name is required' });
    }

    if (!serviceDate) {
      return respond(400, { error: 'Service date is required' });
    }

    if (!reason) {
      return respond(400, { error: 'Reason is required' });
    }

    const validReasons = ['sick', 'vacation', 'business', 'other'];
    if (!validReasons.includes(reason)) {
      return respond(400, { error: 'Invalid reason' });
    }

    // Normalize phone to 10 digits for storage
    const cleanedPhone = memberPhone ? memberPhone.replace(/\D/g, '') : '';
    const normalizedPhone = cleanedPhone.slice(-10);

    // Save to absentee_checkins database
    const insertResult = await pool.query(`
      INSERT INTO absentee_checkins (name, phone, reason, prayer_request, service_date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, phone, reason, prayer_request, service_date, created_at
    `, [memberName.trim(), normalizedPhone || null, reason, prayerRequest || null, serviceDate]);

    const checkin = insertResult.rows[0];
    console.log(`Manual absence recorded: ${memberName} for ${serviceDate}`);

    // Generate access code and send SMS if requested
    let smsSent = false;
    let smsError = null;
    let accessCode = null;

    if (sendLink && normalizedPhone) {
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
              `, [accessCode, memberName.trim(), normalizedPhone, checkin.id, expiresAt.toISOString()]);

              codeGenerated = true;
              console.log(`Generated access code ${accessCode} for ${memberName.trim()}, expires ${expiresAt.toISOString()}`);
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
            const firstName = memberName.split(' ')[0];
            const smsMessage = `NLPC Live Stream\n\nHi ${firstName}! Your access code is:\n\n${accessCode}\n\nWatch here: ${watchUrl}\n\nCode expires in 24 hours. We're praying for you!`;

            const phoneNumber = formatPhone(normalizedPhone);
            if (phoneNumber && phoneNumber.length >= 11) {
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
            } else {
              smsError = 'Invalid phone number format';
            }
          } else {
            smsError = 'Unable to generate access code';
          }
        } else if (!twilioClient || !TWILIO_PHONE) {
          smsError = 'SMS service not configured';
        } else {
          smsError = 'No active live stream password configured';
        }
      } catch (smsErr) {
        smsError = smsErr.message;
        console.error('Error sending SMS:', smsErr.message);
      }
    }

    return respond(200, {
      success: true,
      message: smsSent
        ? 'Absence recorded and livestream link sent!'
        : 'Absence recorded successfully.',
      checkin: {
        id: checkin.id,
        name: checkin.name,
        reason: checkin.reason,
        serviceDate: checkin.service_date,
        smsSent
      },
      smsSent,
      smsError: smsSent ? null : smsError
    });

  } catch (error) {
    console.error('Error recording manual absence:', error);
    return respond(500, {
      error: 'Failed to record absence',
      details: error.message
    });
  }
};

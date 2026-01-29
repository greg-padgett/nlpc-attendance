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

    // Try to send SMS if requested
    let smsSent = false;
    let smsError = null;

    if (sendLink && normalizedPhone) {
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
          const firstName = memberName.split(' ')[0];
          const smsMessage = `NLPC Live Stream Access\n\nHi ${firstName}! Here's your live stream link:\n\n${videoUrl}\n\nPassword: ${vimeo.password}\n\nWe're praying for you!`;

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

            console.log(`SMS sent to ${phoneNumber} for manual absence ${checkin.id}`);
          } else {
            smsError = 'Invalid phone number format';
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

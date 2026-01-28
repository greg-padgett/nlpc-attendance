const { Pool } = require('pg');
const https = require('https');

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
const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY;

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

// Send email via MailerSend
const sendEmail = async (to, subject, html) => {
  if (!MAILERSEND_API_KEY) {
    throw new Error('MAILERSEND_API_KEY not configured');
  }

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      from: { email: 'attendance@nlpc.net', name: 'NLPC' },
      to: [{ email: to }],
      subject: subject,
      html: html
    });

    const options = {
      hostname: 'api.mailersend.com',
      port: 443,
      path: '/v1/email',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MAILERSEND_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true });
        } else {
          reject(new Error(`MailerSend error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
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
    const { date, serviceType, method, message, memberIds } = JSON.parse(event.body);

    if (!date || !serviceType || !method) {
      return respond(400, { error: 'Missing required fields: date, serviceType, method' });
    }

    if (!['email', 'sms', 'both'].includes(method)) {
      return respond(400, { error: 'Invalid method. Use: email, sms, or both' });
    }

    const normalizedDate = date.split('T')[0];

    // Get absentees for this service
    let absentees;

    if (memberIds && memberIds.length > 0) {
      // Notify specific members
      const placeholders = memberIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await pool.query(`
        SELECT id, first_name, last_name, email, phone
        FROM members
        WHERE id IN (${placeholders}) AND status = 'Active'
      `, memberIds);
      absentees = result.rows;
    } else {
      // Get all absentees for the service
      const presentResult = await pool.query(`
        SELECT member_id FROM attendance
        WHERE date = $1 AND service_type = $2 AND present = true
      `, [normalizedDate, serviceType]);

      const presentIds = presentResult.rows.map(r => r.member_id);

      if (presentIds.length > 0) {
        const placeholders = presentIds.map((_, i) => `$${i + 1}`).join(',');
        const absentResult = await pool.query(`
          SELECT id, first_name, last_name, email, phone
          FROM members
          WHERE status = 'Active' AND id NOT IN (${placeholders})
        `, presentIds);
        absentees = absentResult.rows;
      } else {
        // No one was present, everyone is absent
        const allResult = await pool.query(`
          SELECT id, first_name, last_name, email, phone
          FROM members WHERE status = 'Active'
        `);
        absentees = allResult.rows;
      }
    }

    // Format the date nicely
    const dateObj = new Date(normalizedDate + 'T00:00:00');
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });

    const defaultMessage = message || `We missed you at ${serviceType} on ${formattedDate}. Hope to see you next time!`;

    const results = {
      emailSent: 0,
      emailFailed: 0,
      smsSent: 0,
      smsFailed: 0,
      skipped: 0
    };

    for (const member of absentees) {
      const personalMessage = `Hi ${member.first_name}, ${defaultMessage}`;

      // Send Email
      if ((method === 'email' || method === 'both') && member.email) {
        try {
          const html = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #02a2bc 0%, #0a7a92 100%); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                <h2 style="color: white; margin: 0;">We Missed You!</h2>
              </div>
              <div style="background: #f8f9fa; padding: 20px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
                <p style="font-size: 16px; line-height: 1.6; color: #333;">Hi ${member.first_name},</p>
                <p style="font-size: 16px; line-height: 1.6; color: #333;">${defaultMessage}</p>
                <p style="font-size: 14px; color: #666; margin-top: 20px;">— New Life Pentecostal Church</p>
              </div>
            </div>
          `;
          await sendEmail(member.email, `We Missed You at ${serviceType}!`, html);
          results.emailSent++;
          console.log(`Email sent to ${member.email}`);
        } catch (e) {
          results.emailFailed++;
          console.error(`Email failed for ${member.email}:`, e.message);
        }
      }

      // Send SMS
      if ((method === 'sms' || method === 'both') && member.phone && twilioClient && TWILIO_PHONE) {
        try {
          const phoneNumber = formatPhone(member.phone);
          if (phoneNumber) {
            await twilioClient.messages.create({
              body: personalMessage,
              from: TWILIO_PHONE,
              to: phoneNumber
            });
            results.smsSent++;
            console.log(`SMS sent to ${phoneNumber}`);
          } else {
            results.skipped++;
          }
        } catch (e) {
          results.smsFailed++;
          console.error(`SMS failed for ${member.phone}:`, e.message);
        }
      }

      // Track if no contact method available
      if (!member.email && !member.phone) {
        results.skipped++;
      }
    }

    return respond(200, {
      message: `Notifications sent to ${absentees.length} absentees`,
      totalAbsentees: absentees.length,
      ...results
    });

  } catch (error) {
    console.error('Error notifying absentees:', error);
    return respond(500, {
      error: 'Failed to notify absentees',
      details: error.message
    });
  }
};

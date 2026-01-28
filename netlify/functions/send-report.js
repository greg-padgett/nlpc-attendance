const { Pool } = require('pg');
const https = require('https');

let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY;
const PASTOR_EMAIL = process.env.PASTOR_EMAIL || 'pastor@nlpc.net';

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
const sendEmail = async (to, subject, html, from) => {
  if (!MAILERSEND_API_KEY) {
    throw new Error('MAILERSEND_API_KEY not configured');
  }

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      from: { email: from || 'attendance@nlpc.net', name: 'NLPC Attendance' },
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
          resolve({ success: true, statusCode: res.statusCode });
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
    const { date, serviceType, recipientEmail } = JSON.parse(event.body);

    if (!date || !serviceType) {
      return respond(400, { error: 'Missing required fields: date, serviceType' });
    }

    const normalizedDate = date.split('T')[0];
    const toEmail = recipientEmail || PASTOR_EMAIL;

    // Get attendance data for this service
    const attendanceResult = await pool.query(`
      SELECT
        a.date,
        a.service_type,
        m.id,
        m.first_name,
        m.last_name,
        m.email,
        m.phone,
        a.present,
        a.checked_in_at
      FROM attendance a
      JOIN members m ON a.member_id = m.id
      WHERE a.date = $1 AND a.service_type = $2
      ORDER BY m.last_name, m.first_name
    `, [normalizedDate, serviceType]);

    // Get all active members for absent list
    const allMembersResult = await pool.query(`
      SELECT id, first_name, last_name, email, phone
      FROM members
      WHERE status = 'Active'
      ORDER BY last_name, first_name
    `);

    const presentMembers = attendanceResult.rows.filter(r => r.present);
    const presentIds = new Set(presentMembers.map(m => m.id));
    const absentMembers = allMembersResult.rows.filter(m => !presentIds.has(m.id));

    // Format the date nicely
    const dateObj = new Date(normalizedDate + 'T00:00:00');
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Build email HTML
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #02a2bc 0%, #0a7a92 100%); padding: 20px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Attendance Report</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0;">${serviceType} - ${formattedDate}</p>
        </div>

        <div style="background: #f8f9fa; padding: 20px; border: 1px solid #e0e0e0; border-top: none;">
          <div style="display: flex; gap: 20px; margin-bottom: 20px;">
            <div style="background: #28a745; color: white; padding: 15px 20px; border-radius: 8px; text-align: center; flex: 1;">
              <div style="font-size: 28px; font-weight: bold;">${presentMembers.length}</div>
              <div style="font-size: 12px; text-transform: uppercase;">Present</div>
            </div>
            <div style="background: #dc3545; color: white; padding: 15px 20px; border-radius: 8px; text-align: center; flex: 1;">
              <div style="font-size: 28px; font-weight: bold;">${absentMembers.length}</div>
              <div style="font-size: 12px; text-transform: uppercase;">Absent</div>
            </div>
          </div>

          <h3 style="color: #28a745; margin: 20px 0 10px 0; border-bottom: 2px solid #28a745; padding-bottom: 5px;">✓ Present (${presentMembers.length})</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${presentMembers.length > 0
              ? presentMembers.map(m => `<li style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${m.first_name} ${m.last_name}</li>`).join('')
              : '<li style="padding: 8px 0; color: #666; font-style: italic;">No attendees recorded</li>'
            }
          </ul>

          <h3 style="color: #dc3545; margin: 20px 0 10px 0; border-bottom: 2px solid #dc3545; padding-bottom: 5px;">✗ Absent (${absentMembers.length})</h3>
          <ul style="list-style: none; padding: 0; margin: 0;">
            ${absentMembers.length > 0
              ? absentMembers.map(m => `<li style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">${m.first_name} ${m.last_name}</li>`).join('')
              : '<li style="padding: 8px 0; color: #666; font-style: italic;">Everyone was present!</li>'
            }
          </ul>
        </div>

        <div style="background: #333; color: white; padding: 15px; border-radius: 0 0 8px 8px; text-align: center; font-size: 12px;">
          NLPC Attendance Tracker • Generated ${new Date().toLocaleString()}
        </div>
      </div>
    `;

    const subject = `Attendance Report: ${serviceType} - ${formattedDate}`;

    await sendEmail(toEmail, subject, html);

    return respond(200, {
      message: `Report sent to ${toEmail}`,
      present: presentMembers.length,
      absent: absentMembers.length
    });

  } catch (error) {
    console.error('Error sending report:', error);
    return respond(500, {
      error: 'Failed to send report',
      details: error.message
    });
  }
};

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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
      from: { email: 'attendance@nlpc.net', name: 'NLPC Absentee Report' },
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

// Format reason for display
const formatReason = (reason) => {
  const labels = {
    sick: 'Sick / Prayer Request',
    vacation: 'Vacation',
    business: 'Business Travel',
    other: 'Other'
  };
  return labels[reason] || reason;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!pool) {
    return respond(503, { error: 'Database not configured' });
  }

  try {
    const params = event.httpMethod === 'GET'
      ? (event.queryStringParameters || {})
      : JSON.parse(event.body || '{}');

    const { fromDate, toDate, email } = params;

    // Default to current week
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);

    const effectiveFromDate = fromDate || startOfWeek.toISOString().split('T')[0];
    const effectiveToDate = toDate || endOfWeek.toISOString().split('T')[0];

    // Get all check-ins for the date range
    const result = await pool.query(`
      SELECT
        id, name, phone, reason, prayer_request, service_date,
        livestream_sent, created_at
      FROM absentee_checkins
      WHERE service_date >= $1 AND service_date <= $2
      ORDER BY reason, name
    `, [effectiveFromDate, effectiveToDate]);

    const checkins = result.rows;

    // Group by reason
    const grouped = {};
    checkins.forEach(row => {
      const reasonKey = row.reason || 'other';
      if (!grouped[reasonKey]) {
        grouped[reasonKey] = [];
      }
      grouped[reasonKey].push(row);
    });

    // Prepare report data
    const report = {
      dateRange: { from: effectiveFromDate, to: effectiveToDate },
      total: checkins.length,
      byReason: Object.entries(grouped).map(([reason, items]) => ({
        reason: formatReason(reason),
        count: items.length,
        items: items.map(item => ({
          name: item.name,
          phone: item.phone,
          prayerRequest: item.prayer_request,
          serviceDate: item.service_date,
          livestreamSent: item.livestream_sent
        }))
      })),
      prayerRequests: checkins.filter(c => c.prayer_request).map(c => ({
        name: c.name,
        request: c.prayer_request,
        date: c.service_date
      }))
    };

    // If email is provided, send the report
    if (email && event.httpMethod === 'POST') {
      const formattedFromDate = new Date(effectiveFromDate).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      });
      const formattedToDate = new Date(effectiveToDate).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      });

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #02a2bc 0%, #0a7a92 100%); padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
            <h2 style="color: white; margin: 0;">Weekly Absentee Report</h2>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
              ${formattedFromDate} - ${formattedToDate}
            </p>
          </div>

          <div style="background: #f8f9fa; padding: 20px; border: 1px solid #e0e0e0; border-top: none;">
            <!-- Summary -->
            <div style="display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap;">
              <div style="background: white; padding: 16px; border-radius: 8px; border-left: 4px solid #02a2bc; flex: 1; min-width: 120px;">
                <div style="font-size: 12px; color: #666;">Total Check-ins</div>
                <div style="font-size: 24px; font-weight: 600; color: #333;">${report.total}</div>
              </div>
              <div style="background: white; padding: 16px; border-radius: 8px; border-left: 4px solid #dc3545; flex: 1; min-width: 120px;">
                <div style="font-size: 12px; color: #666;">Prayer Requests</div>
                <div style="font-size: 24px; font-weight: 600; color: #333;">${report.prayerRequests.length}</div>
              </div>
            </div>

            <!-- By Reason -->
            ${report.byReason.map(group => `
              <div style="background: white; border-radius: 8px; padding: 16px; margin-bottom: 16px; border: 1px solid #e0e0e0;">
                <h3 style="margin: 0 0 12px 0; color: #02a2bc; font-size: 16px;">
                  ${group.reason} (${group.count})
                </h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr style="border-bottom: 1px solid #e0e0e0;">
                    <th style="text-align: left; padding: 8px; font-size: 12px; color: #666;">Name</th>
                    <th style="text-align: left; padding: 8px; font-size: 12px; color: #666;">Phone</th>
                    <th style="text-align: left; padding: 8px; font-size: 12px; color: #666;">Date</th>
                    <th style="text-align: left; padding: 8px; font-size: 12px; color: #666;">Stream Sent</th>
                  </tr>
                  ${group.items.map(item => `
                    <tr style="border-bottom: 1px solid #f0f0f0;">
                      <td style="padding: 8px; font-size: 14px;">${item.name}</td>
                      <td style="padding: 8px; font-size: 14px;">${item.phone}</td>
                      <td style="padding: 8px; font-size: 14px;">${new Date(item.serviceDate).toLocaleDateString()}</td>
                      <td style="padding: 8px; font-size: 14px;">${item.livestreamSent ? '✓' : '—'}</td>
                    </tr>
                  `).join('')}
                </table>
              </div>
            `).join('')}

            <!-- Prayer Requests Section -->
            ${report.prayerRequests.length > 0 ? `
              <div style="background: #fff3cd; border-radius: 8px; padding: 16px; border: 1px solid #ffc107;">
                <h3 style="margin: 0 0 12px 0; color: #856404; font-size: 16px;">
                  Prayer Requests
                </h3>
                ${report.prayerRequests.map(pr => `
                  <div style="background: white; border-radius: 6px; padding: 12px; margin-bottom: 8px;">
                    <div style="font-weight: 600; font-size: 14px; color: #333;">${pr.name}</div>
                    <div style="font-size: 14px; color: #666; margin-top: 4px;">${pr.request}</div>
                    <div style="font-size: 12px; color: #999; margin-top: 4px;">${new Date(pr.date).toLocaleDateString()}</div>
                  </div>
                `).join('')}
              </div>
            ` : ''}

            <p style="font-size: 12px; color: #999; margin-top: 20px; text-align: center;">
              Generated by NLPC Attendance System
            </p>
          </div>
        </div>
      `;

      await sendEmail(
        email,
        `Weekly Absentee Report: ${formattedFromDate} - ${formattedToDate}`,
        html
      );

      return respond(200, {
        success: true,
        message: `Report sent to ${email}`,
        report
      });
    }

    // Return report data (for GET requests or when no email provided)
    return respond(200, {
      success: true,
      report
    });

  } catch (error) {
    console.error('Error generating report:', error);
    return respond(500, {
      error: 'Failed to generate report',
      details: error.message
    });
  }
};

const { Pool } = require('pg');

let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

const respond = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (!pool) {
    return respond(503, { error: 'Database not configured' });
  }

  try {
    const params = event.queryStringParameters || {};
    const { fromDate, toDate, reason } = params;

    // Default to current week (Sunday to Saturday)
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const effectiveFromDate = fromDate || startOfWeek.toISOString().split('T')[0];
    const effectiveToDate = toDate || endOfWeek.toISOString().split('T')[0];

    // Build query
    let query = `
      SELECT
        id, name, phone, reason, prayer_request, service_date,
        livestream_sent, livestream_sent_at, created_at
      FROM absentee_checkins
      WHERE service_date >= $1 AND service_date <= $2
    `;
    const queryParams = [effectiveFromDate, effectiveToDate];

    if (reason && reason !== 'all') {
      query += ` AND reason = $3`;
      queryParams.push(reason);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, queryParams);

    // Group by reason for dashboard display
    const grouped = {
      sick: [],
      vacation: [],
      business: [],
      other: []
    };

    result.rows.forEach(row => {
      const reasonKey = row.reason || 'other';
      if (grouped[reasonKey]) {
        grouped[reasonKey].push(row);
      } else {
        grouped.other.push(row);
      }
    });

    // Calculate summary stats
    const summary = {
      total: result.rows.length,
      sick: grouped.sick.length,
      vacation: grouped.vacation.length,
      business: grouped.business.length,
      other: grouped.other.length,
      prayerRequests: result.rows.filter(r => r.prayer_request).length,
      livestreamSent: result.rows.filter(r => r.livestream_sent).length
    };

    return respond(200, {
      success: true,
      dateRange: {
        from: effectiveFromDate,
        to: effectiveToDate
      },
      summary,
      grouped,
      checkins: result.rows
    });

  } catch (error) {
    console.error('Error fetching dashboard:', error);
    return respond(500, {
      error: 'Failed to fetch dashboard data',
      details: error.message
    });
  }
};

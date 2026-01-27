const { Pool } = require('pg');

let pool;

// Initialize pool only if DATABASE_URL is set
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  console.warn('DATABASE_URL not set - database operations will fail');
}

async function initDatabase() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id TEXT PRIMARY KEY,
        date DATE NOT NULL,
        serviceType VARCHAR(255) NOT NULL,
        attendees TEXT,
        count INTEGER,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error('Error initializing database:', err.message);
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

  try {
    // If no database, return error
    if (!pool) {
      return respond(503, { error: 'Database not configured. Set DATABASE_URL environment variable.' });
    }

    await initDatabase();
    const method = event.httpMethod;
    const queryParams = event.queryStringParameters || {};

    // GET /attendance?from=YYYY-MM-DD&to=YYYY-MM-DD (report)
    if (method === 'GET' && queryParams.from && queryParams.to) {
      const from = queryParams.from;
      const to = queryParams.to;

      const result = await pool.query(
        'SELECT * FROM attendance WHERE date >= $1 AND date <= $2 ORDER BY date DESC',
        [from, to]
      );

      const records = result.rows;

      if (records.length === 0) {
        return respond(200, {
          totalServices: 0,
          totalAttendance: 0,
          averageAttendance: 0,
          serviceBreakdown: {}
        });
      }

      const totalServices = records.length;
      const totalAttendance = records.reduce((sum, r) => sum + (r.count || 0), 0);
      const averageAttendance = Math.round(totalAttendance / totalServices);

      const serviceBreakdown = {};
      records.forEach(r => {
        serviceBreakdown[r.serviceType] = (serviceBreakdown[r.serviceType] || 0) + r.count;
      });

      return respond(200, {
        totalServices,
        totalAttendance,
        averageAttendance,
        serviceBreakdown
      });
    }

    // GET /attendance (list all)
    if (method === 'GET') {
      const result = await pool.query(
        'SELECT * FROM attendance ORDER BY date DESC'
      );
      const parsed = result.rows.map(r => ({
        ...r,
        attendees: r.attendees ? JSON.parse(r.attendees) : []
      }));
      return respond(200, parsed);
    }

    // POST /attendance (create)
    if (method === 'POST') {
      const { date, serviceType, attendees, count } = event.body ? JSON.parse(event.body) : {};
      const id = Date.now().toString();

      if (!date || !serviceType) {
        return respond(400, { error: 'date and serviceType required' });
      }

      const result = await pool.query(
        `INSERT INTO attendance (id, date, serviceType, attendees, count)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, date, serviceType, JSON.stringify(attendees || []), count || 0]
      );

      return respond(201, {
        ...result.rows[0],
        attendees: attendees || []
      });
    }

    return respond(404, { error: 'Not found' });
  } catch (err) {
    console.error('Function error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};

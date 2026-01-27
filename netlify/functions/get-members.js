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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  if (!pool) {
    return respond(503, { error: 'Database not configured' });
  }

  try {
    const result = await pool.query(
      `SELECT id, first_name, last_name, email, phone, status, birthdate, anniversary, address_line1, city, state
       FROM members
       WHERE status = 'Active'
       ORDER BY last_name, first_name`
    );

    return respond(200, { members: result.rows });
  } catch (error) {
    console.error('Error fetching members:', error);
    return respond(500, { error: error.message });
  }
};

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
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
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
    const { memberId } = event.body ? JSON.parse(event.body) : {};

    if (!memberId) {
      return respond(400, { error: 'Member ID required' });
    }

    // Delete the member (cascading delete will handle attendance records)
    const result = await pool.query(
      'DELETE FROM members WHERE id = $1 RETURNING id, first_name, last_name',
      [memberId]
    );

    if (result.rowCount === 0) {
      return respond(404, { error: 'Member not found' });
    }

    const deleted = result.rows[0];
    return respond(200, {
      success: true,
      message: `Deleted ${deleted.first_name} ${deleted.last_name}`
    });
  } catch (error) {
    console.error('Error deleting member:', error);
    return respond(500, { error: error.message });
  }
};

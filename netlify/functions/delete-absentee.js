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

  if (event.httpMethod !== 'DELETE') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (!pool) {
    return respond(503, { error: 'Database not configured' });
  }

  try {
    const { id } = event.queryStringParameters || {};

    if (!id) {
      return respond(400, { error: 'Missing required parameter: id' });
    }

    const result = await pool.query(
      'DELETE FROM absentee_checkins WHERE id = $1 RETURNING id, name',
      [id]
    );

    if (result.rows.length === 0) {
      return respond(404, { error: 'Check-in not found' });
    }

    return respond(200, {
      success: true,
      message: `Deleted check-in for ${result.rows[0].name}`,
      deleted: result.rows[0]
    });

  } catch (error) {
    console.error('Error deleting absentee:', error);
    return respond(500, {
      error: 'Failed to delete check-in',
      details: error.message
    });
  }
};

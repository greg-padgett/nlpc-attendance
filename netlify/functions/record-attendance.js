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
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (!pool) {
    return respond(503, { error: 'Database not configured' });
  }

  const client = await pool.connect();

  try {
    const { date, serviceType, attendeeIds } = JSON.parse(event.body);

    if (!date || !serviceType || !Array.isArray(attendeeIds)) {
      return respond(400, {
        error: 'Missing required fields: date, serviceType, attendeeIds'
      });
    }

    // Normalize the date to YYYY-MM-DD format
    const normalizedDate = date.split('T')[0];

    // Start a transaction to ensure atomicity
    await client.query('BEGIN');

    // CRITICAL FIX: Delete ALL existing attendance records for this date+service first
    // This ensures unchecked members are removed from the database
    const deleteResult = await client.query(
      `DELETE FROM attendance WHERE date = $1 AND service_type = $2`,
      [normalizedDate, serviceType]
    );

    console.log(`Deleted ${deleteResult.rowCount} existing records for ${normalizedDate} ${serviceType}`);

    // Now insert fresh attendance records with only the checked-in members
    let insertedCount = 0;

    if (attendeeIds.length > 0) {
      // Build a multi-row INSERT for efficiency
      const values = attendeeIds.map((id, index) => {
        const offset = index * 3;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, TRUE, CURRENT_TIMESTAMP)`;
      }).join(', ');

      const params = attendeeIds.flatMap(id => [normalizedDate, serviceType, id]);

      const insertQuery = `
        INSERT INTO attendance (date, service_type, member_id, present, checked_in_at)
        VALUES ${values}
        ON CONFLICT (date, service_type, member_id)
        DO UPDATE SET present = TRUE, checked_in_at = CURRENT_TIMESTAMP
      `;

      const insertResult = await client.query(insertQuery, params);
      insertedCount = insertResult.rowCount;
    }

    // Commit the transaction
    await client.query('COMMIT');

    return respond(200, {
      message: `Recorded attendance for ${insertedCount} members on ${normalizedDate} for ${serviceType}`,
      date: normalizedDate,
      serviceType: serviceType,
      count: insertedCount,
      deletedPrevious: deleteResult.rowCount
    });

  } catch (error) {
    // Rollback on error
    await client.query('ROLLBACK');
    console.error('Error recording attendance:', error);
    return respond(500, {
      error: 'Failed to record attendance',
      details: error.message
    });
  } finally {
    client.release();
  }
};

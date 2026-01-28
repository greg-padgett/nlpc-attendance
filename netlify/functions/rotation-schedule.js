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
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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
    // GET - Get current schedule settings
    if (event.httpMethod === 'GET') {
      const result = await pool.query(`
        SELECT id, day_of_week, time_of_day, enabled, last_run, created_at
        FROM password_rotation_schedule
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        // Create default schedule if none exists
        const defaultResult = await pool.query(`
          INSERT INTO password_rotation_schedule (day_of_week, time_of_day, enabled)
          VALUES (0, '08:00:00', false)
          RETURNING id, day_of_week, time_of_day, enabled, last_run, created_at
        `);

        return respond(200, {
          success: true,
          schedule: defaultResult.rows[0]
        });
      }

      const schedule = result.rows[0];
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      return respond(200, {
        success: true,
        schedule: {
          ...schedule,
          dayName: dayNames[schedule.day_of_week],
          formattedTime: schedule.time_of_day
        }
      });
    }

    // PUT - Update schedule settings
    if (event.httpMethod === 'PUT') {
      const { dayOfWeek, timeOfDay, enabled } = JSON.parse(event.body || '{}');

      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (dayOfWeek !== undefined) {
        if (dayOfWeek < 0 || dayOfWeek > 6) {
          return respond(400, { error: 'dayOfWeek must be 0-6 (Sunday-Saturday)' });
        }
        updates.push(`day_of_week = $${paramIndex++}`);
        values.push(dayOfWeek);
      }

      if (timeOfDay !== undefined) {
        updates.push(`time_of_day = $${paramIndex++}`);
        values.push(timeOfDay);
      }

      if (enabled !== undefined) {
        updates.push(`enabled = $${paramIndex++}`);
        values.push(enabled);
      }

      updates.push(`updated_at = CURRENT_TIMESTAMP`);

      if (updates.length === 1) { // Only updated_at
        return respond(400, { error: 'No updates provided' });
      }

      // Update the schedule (assuming single row for now)
      const result = await pool.query(`
        UPDATE password_rotation_schedule
        SET ${updates.join(', ')}
        RETURNING id, day_of_week, time_of_day, enabled, last_run, updated_at
      `, values);

      if (result.rows.length === 0) {
        // Create if doesn't exist
        const insertResult = await pool.query(`
          INSERT INTO password_rotation_schedule (day_of_week, time_of_day, enabled)
          VALUES ($1, $2, $3)
          RETURNING id, day_of_week, time_of_day, enabled, last_run, created_at
        `, [dayOfWeek || 0, timeOfDay || '08:00:00', enabled || false]);

        return respond(200, {
          success: true,
          message: 'Schedule created',
          schedule: insertResult.rows[0]
        });
      }

      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const schedule = result.rows[0];

      return respond(200, {
        success: true,
        message: schedule.enabled ? 'Automatic rotation enabled' : 'Automatic rotation disabled',
        schedule: {
          ...schedule,
          dayName: dayNames[schedule.day_of_week],
          formattedTime: schedule.time_of_day
        }
      });
    }

    return respond(405, { error: 'Method not allowed' });

  } catch (error) {
    console.error('Error managing rotation schedule:', error);
    return respond(500, {
      error: 'Failed to manage rotation schedule',
      details: error.message
    });
  }
};

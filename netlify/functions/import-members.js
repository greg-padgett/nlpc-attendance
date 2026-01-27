const { Pool } = require('pg');

let pool;

// Initialize pool only if DATABASE_URL is set
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

async function initDatabase() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        birthdate DATE,
        anniversary DATE,
        address_line1 VARCHAR(255),
        address_line2 VARCHAR(255),
        city VARCHAR(100),
        state VARCHAR(100),
        postal_code VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    // POST /import-members (bulk import from CSV)
    if (event.httpMethod === 'POST') {
      const body = event.body ? JSON.parse(event.body) : {};
      const members = body.members || [];

      console.log('Import request received with', members.length, 'members');
      console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);
      console.log('First member sample:', JSON.stringify(members[0]));

      if (!Array.isArray(members) || members.length === 0) {
        return respond(400, { error: 'Members array required and must not be empty' });
      }

      let imported = 0;
      let errors = [];

      for (const member of members) {
        try {
          const id = member.id || `pc_${member.person_id || Date.now().toString()}`;
          const firstName = (member.first_name || '').trim();
          const lastName = (member.last_name || '').trim();

          if (!firstName || !lastName) {
            console.warn('Skipping member - missing name:', member);
            errors.push({ id, reason: 'Missing first or last name' });
            continue;
          }

          const result = await pool.query(
            `INSERT INTO members 
              (id, first_name, last_name, email, phone, birthdate, anniversary, 
               address_line1, address_line2, city, state, postal_code, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             ON CONFLICT (id) DO UPDATE SET
              first_name = $2, last_name = $3, email = $4, phone = $5,
              birthdate = $6, anniversary = $7, address_line1 = $8, address_line2 = $9,
              city = $10, state = $11, postal_code = $12, updated_at = $14
             RETURNING id`,
            [
              id,
              firstName,
              lastName,
              member.email || null,
              member.phone || null,
              member.birthdate || null,
              member.anniversary || null,
              member.address_line1 || null,
              member.address_line2 || null,
              member.city || null,
              member.state || null,
              member.postal_code || null,
              member.created_at || new Date().toISOString(),
              new Date().toISOString()
            ]
          );
          console.log('Imported member:', id, result.rows[0]);
          imported++;
        } catch (err) {
          console.error(`Error importing member ${member.id}:`, err.message, err);
          errors.push({ id: member.id, reason: err.message });
        }
      }

      console.log('Import complete:', { imported, total: members.length, errorCount: errors.length });
      return respond(200, {
        success: true,
        imported,
        total: members.length,
        errors: errors.length > 0 ? errors.slice(0, 5) : undefined,  // Return first 5 errors only
        message: `Imported ${imported} of ${members.length} members`
      });
    }

    return respond(404, { error: 'Not found' });
  } catch (err) {
    console.error('Function error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};

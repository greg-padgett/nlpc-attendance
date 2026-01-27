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
    const method = event.httpMethod;
    const path = event.path || '';
    const body = event.body ? JSON.parse(event.body) : {};

    // GET /members (list all)
    if (method === 'GET' && !path.includes('/members/')) {
      const result = await pool.query(
        'SELECT * FROM members ORDER BY first_name, last_name'
      );
      return respond(200, result.rows);
    }

    // GET /members/:id (get single)
    if (method === 'GET' && path.includes('/members/')) {
      const idMatch = path.match(/members\/([^\/]+)/);
      if (!idMatch) return respond(400, { error: 'Missing member ID' });
      const id = idMatch[1];

      const result = await pool.query('SELECT * FROM members WHERE id = $1', [id]);
      if (result.rows.length === 0) return respond(404, { error: 'Member not found' });
      return respond(200, result.rows[0]);
    }

    // POST /members (create)
    if (method === 'POST') {
      const { id, first_name, last_name, email, phone, birthdate, anniversary, address_line1, address_line2, city, state, postal_code } = body;

      if (!first_name || !last_name) {
        return respond(400, { error: 'first_name and last_name required' });
      }

      const result = await pool.query(
        `INSERT INTO members (id, first_name, last_name, email, phone, birthdate, anniversary, address_line1, address_line2, city, state, postal_code, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [id || `member_${Date.now().toString()}`, first_name, last_name, email || null, phone || null, birthdate || null, anniversary || null, address_line1 || null, address_line2 || null, city || null, state || null, postal_code || null, new Date().toISOString()]
      );

      return respond(201, result.rows[0]);
    }

    // PUT /members/:id (update)
    if (method === 'PUT' && path.includes('/members/')) {
      const idMatch = path.match(/members\/([^\/]+)/);
      if (!idMatch) return respond(400, { error: 'Missing member ID' });
      const id = idMatch[1];

      const { first_name, last_name, email, phone, birthdate, anniversary, address_line1, address_line2, city, state, postal_code } = body;

      const result = await pool.query(
        `UPDATE members SET first_name = $1, last_name = $2, email = $3, phone = $4, 
                           birthdate = $5, anniversary = $6, address_line1 = $7, 
                           address_line2 = $8, city = $9, state = $10, postal_code = $11, 
                           updated_at = $12
         WHERE id = $13 RETURNING *`,
        [first_name, last_name, email, phone, birthdate, anniversary, address_line1, address_line2, city, state, postal_code, new Date().toISOString(), id]
      );

      if (result.rows.length === 0) return respond(404, { error: 'Member not found' });
      return respond(200, result.rows[0]);
    }

    // DELETE /members/:id
    if (method === 'DELETE' && path.includes('/members/')) {
      const idMatch = path.match(/members\/([^\/]+)/);
      if (!idMatch) return respond(400, { error: 'Missing member ID' });
      const id = idMatch[1];

      await pool.query('DELETE FROM members WHERE id = $1', [id]);
      return respond(200, { success: true });
    }

    return respond(404, { error: 'Not found' });
  } catch (err) {
    console.error('Function error:', err);
    return respond(500, { error: err.message || 'Internal server error' });
  }
};

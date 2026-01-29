const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const respond = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify(body)
});

// Initialize users table if it doesn't exist
async function initUsersTable() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(100),
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error('Error initializing users table:', err.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (!pool) {
    return respond(503, { error: 'Database not configured' });
  }

  try {
    await initUsersTable();

    const body = JSON.parse(event.body || '{}');
    const { action, username, password, displayName } = body;

    // Check if any users exist
    const userCount = await pool.query('SELECT COUNT(*) as count FROM users');
    const hasUsers = parseInt(userCount.rows[0].count) > 0;

    // SETUP: Create first admin user (requires APP_PASSWORD)
    if (action === 'setup') {
      if (hasUsers) {
        return respond(400, { error: 'Setup already complete. Users exist.' });
      }

      const appPassword = process.env.APP_PASSWORD;
      if (!appPassword) {
        return respond(500, { error: 'APP_PASSWORD not configured' });
      }

      // Verify the setup password matches APP_PASSWORD
      if (password !== appPassword) {
        return respond(401, { error: 'Invalid setup password' });
      }

      if (!username || username.length < 3) {
        return respond(400, { error: 'Username must be at least 3 characters' });
      }

      const newPassword = body.newPassword;
      if (!newPassword || newPassword.length < 6) {
        return respond(400, { error: 'Password must be at least 6 characters' });
      }

      // Hash the new password and create admin user
      const passwordHash = await bcrypt.hash(newPassword, 10);
      const result = await pool.query(
        `INSERT INTO users (username, password_hash, display_name, is_admin)
         VALUES ($1, $2, $3, TRUE)
         RETURNING id, username, display_name, is_admin`,
        [username.toLowerCase(), passwordHash, displayName || username]
      );

      return respond(201, {
        success: true,
        message: 'Admin user created successfully',
        user: result.rows[0]
      });
    }

    // LOGIN: Authenticate user
    if (action === 'login') {
      // If no users exist, return special status for setup
      if (!hasUsers) {
        return respond(200, {
          success: false,
          needsSetup: true,
          message: 'No users configured. Please set up the first admin account.'
        });
      }

      if (!username || !password) {
        return respond(400, { error: 'Username and password required' });
      }

      // Find user
      const result = await pool.query(
        'SELECT * FROM users WHERE username = $1',
        [username.toLowerCase()]
      );

      if (result.rows.length === 0) {
        return respond(401, { success: false, error: 'Invalid username or password' });
      }

      const user = result.rows[0];

      // Verify password
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return respond(401, { success: false, error: 'Invalid username or password' });
      }

      // Return user info (without password hash)
      return respond(200, {
        success: true,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.display_name,
          isAdmin: user.is_admin
        }
      });
    }

    // CHECK: Check if setup is needed
    if (action === 'check') {
      return respond(200, {
        hasUsers,
        needsSetup: !hasUsers
      });
    }

    return respond(400, { error: 'Invalid action. Use: login, setup, or check' });

  } catch (err) {
    console.error('Auth error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};

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
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
    const method = event.httpMethod;
    const body = event.body ? JSON.parse(event.body) : {};

    // GET - List all users (without password hashes)
    if (method === 'GET') {
      const result = await pool.query(
        `SELECT id, username, display_name, is_admin, created_at
         FROM users
         ORDER BY created_at DESC`
      );
      return respond(200, { users: result.rows });
    }

    // POST - Create new user
    if (method === 'POST') {
      const { username, password, displayName, isAdmin } = body;

      if (!username || username.length < 3) {
        return respond(400, { error: 'Username must be at least 3 characters' });
      }

      if (!password || password.length < 6) {
        return respond(400, { error: 'Password must be at least 6 characters' });
      }

      // Check if username already exists
      const existing = await pool.query(
        'SELECT id FROM users WHERE username = $1',
        [username.toLowerCase()]
      );

      if (existing.rows.length > 0) {
        return respond(400, { error: 'Username already exists' });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const result = await pool.query(
        `INSERT INTO users (username, password_hash, display_name, is_admin)
         VALUES ($1, $2, $3, $4)
         RETURNING id, username, display_name, is_admin, created_at`,
        [username.toLowerCase(), passwordHash, displayName || username, isAdmin || false]
      );

      return respond(201, { success: true, user: result.rows[0] });
    }

    // PUT - Update user (change password or details)
    if (method === 'PUT') {
      const { userId, username, displayName, isAdmin, newPassword, currentPassword } = body;

      if (!userId) {
        return respond(400, { error: 'User ID required' });
      }

      // If changing password, verify current password first
      if (newPassword) {
        if (!currentPassword) {
          return respond(400, { error: 'Current password required to change password' });
        }

        const user = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        if (user.rows.length === 0) {
          return respond(404, { error: 'User not found' });
        }

        const validPassword = await bcrypt.compare(currentPassword, user.rows[0].password_hash);
        if (!validPassword) {
          return respond(401, { error: 'Current password is incorrect' });
        }

        if (newPassword.length < 6) {
          return respond(400, { error: 'New password must be at least 6 characters' });
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await pool.query(
          'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [passwordHash, userId]
        );
      }

      // Update other fields if provided
      if (displayName !== undefined || isAdmin !== undefined || username !== undefined) {
        const updates = [];
        const values = [];
        let paramCount = 0;

        if (displayName !== undefined) {
          paramCount++;
          updates.push(`display_name = $${paramCount}`);
          values.push(displayName);
        }

        if (isAdmin !== undefined) {
          paramCount++;
          updates.push(`is_admin = $${paramCount}`);
          values.push(isAdmin);
        }

        if (username !== undefined) {
          // Check if new username is taken
          const existing = await pool.query(
            'SELECT id FROM users WHERE username = $1 AND id != $2',
            [username.toLowerCase(), userId]
          );
          if (existing.rows.length > 0) {
            return respond(400, { error: 'Username already taken' });
          }
          paramCount++;
          updates.push(`username = $${paramCount}`);
          values.push(username.toLowerCase());
        }

        if (updates.length > 0) {
          paramCount++;
          values.push(userId);
          await pool.query(
            `UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount}`,
            values
          );
        }
      }

      // Return updated user
      const result = await pool.query(
        'SELECT id, username, display_name, is_admin, created_at FROM users WHERE id = $1',
        [userId]
      );

      return respond(200, { success: true, user: result.rows[0] });
    }

    // DELETE - Remove user
    if (method === 'DELETE') {
      const { userId } = body;

      if (!userId) {
        return respond(400, { error: 'User ID required' });
      }

      // Prevent deleting the last admin
      const adminCount = await pool.query(
        'SELECT COUNT(*) as count FROM users WHERE is_admin = TRUE'
      );
      const userToDelete = await pool.query(
        'SELECT is_admin FROM users WHERE id = $1',
        [userId]
      );

      if (userToDelete.rows.length === 0) {
        return respond(404, { error: 'User not found' });
      }

      if (userToDelete.rows[0].is_admin && parseInt(adminCount.rows[0].count) <= 1) {
        return respond(400, { error: 'Cannot delete the last admin user' });
      }

      await pool.query('DELETE FROM users WHERE id = $1', [userId]);

      return respond(200, { success: true });
    }

    return respond(404, { error: 'Not found' });

  } catch (err) {
    console.error('Users API error:', err);
    return respond(500, { error: 'Internal server error' });
  }
};

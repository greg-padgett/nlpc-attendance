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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (!pool) {
    return respond(503, { error: 'Database not configured' });
  }

  try {
    const { code } = JSON.parse(event.body);

    if (!code || code.length !== 6) {
      return respond(400, { error: 'Invalid code format', valid: false });
    }

    // Normalize code to uppercase
    const normalizedCode = code.toUpperCase();

    // Look up the code
    const codeResult = await pool.query(`
      SELECT
        id, code, member_name, phone, absentee_checkin_id,
        created_at, expires_at, first_used_at, use_count, revoked
      FROM stream_access_codes
      WHERE code = $1
    `, [normalizedCode]);

    if (codeResult.rows.length === 0) {
      return respond(404, { error: 'Access code not found', valid: false });
    }

    const accessCode = codeResult.rows[0];

    // Check if revoked
    if (accessCode.revoked) {
      return respond(403, { error: 'This access code has been revoked', valid: false, revoked: true });
    }

    // Check if expired
    const now = new Date();
    const expiresAt = new Date(accessCode.expires_at);

    if (now > expiresAt) {
      return respond(403, { error: 'This access code has expired', valid: false, expired: true });
    }

    // Get current active Vimeo password
    const vimeoResult = await pool.query(`
      SELECT video_id, password, video_url
      FROM vimeo_passwords
      WHERE active = true
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (vimeoResult.rows.length === 0) {
      return respond(503, { error: 'No active stream configured', valid: false });
    }

    const vimeo = vimeoResult.rows[0];

    // Update usage tracking
    const isFirstUse = !accessCode.first_used_at;
    await pool.query(`
      UPDATE stream_access_codes
      SET
        first_used_at = COALESCE(first_used_at, CURRENT_TIMESTAMP),
        last_used_at = CURRENT_TIMESTAMP,
        use_count = use_count + 1
      WHERE id = $1
    `, [accessCode.id]);

    // Log access
    console.log(`Stream access: ${accessCode.member_name} (code: ${normalizedCode}) - ${isFirstUse ? 'first use' : `use #${accessCode.use_count + 1}`}`);

    return respond(200, {
      valid: true,
      memberName: accessCode.member_name,
      videoId: vimeo.video_id,
      videoUrl: vimeo.video_url,
      password: vimeo.password,
      expiresAt: accessCode.expires_at
    });

  } catch (error) {
    console.error('Error verifying stream code:', error);
    return respond(500, {
      error: 'Failed to verify access code',
      valid: false
    });
  }
};

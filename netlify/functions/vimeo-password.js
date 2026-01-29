const { Pool } = require('pg');
const https = require('https');
const crypto = require('crypto');

let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

const VIMEO_ACCESS_TOKEN = process.env.VIMEO_ACCESS_TOKEN;
const VIMEO_VIDEO_ID = process.env.VIMEO_VIDEO_ID;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Content-Type': 'application/json'
};

const respond = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders,
  body: JSON.stringify(body)
});

// Generate a random secure password
const generatePassword = (length = 8) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    password += chars[randomBytes[i] % chars.length];
  }
  return password;
};

// Update Vimeo video password via API
// Note: Live events in Vimeo are accessed via /videos/ endpoint with type=live
const updateVimeoPassword = async (videoId, newPassword) => {
  if (!VIMEO_ACCESS_TOKEN) {
    throw new Error('VIMEO_ACCESS_TOKEN not configured');
  }

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      password: newPassword
    });

    const options = {
      hostname: 'api.vimeo.com',
      port: 443,
      path: `/videos/${videoId}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VIMEO_ACCESS_TOKEN}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ success: true });
          }
        } else {
          reject(new Error(`Vimeo API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
};

// Get Vimeo video details
const getVimeoVideo = async (videoId) => {
  if (!VIMEO_ACCESS_TOKEN) {
    throw new Error('VIMEO_ACCESS_TOKEN not configured');
  }

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.vimeo.com',
      port: 443,
      path: `/videos/${videoId}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${VIMEO_ACCESS_TOKEN}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        } else {
          reject(new Error(`Vimeo API error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (!pool) {
    return respond(503, { error: 'Database not configured' });
  }

  try {
    // GET - Get current password info
    if (event.httpMethod === 'GET') {
      const result = await pool.query(`
        SELECT id, video_id, password, video_url, active, rotation_type, created_at, expires_at
        FROM vimeo_passwords
        WHERE active = true
        ORDER BY created_at DESC
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return respond(200, {
          success: true,
          hasPassword: false,
          message: 'No active password configured'
        });
      }

      const current = result.rows[0];
      return respond(200, {
        success: true,
        hasPassword: true,
        current: {
          videoId: current.video_id,
          password: current.password,
          videoUrl: current.video_url || `https://vimeo.com/${current.video_id}`,
          rotationType: current.rotation_type,
          createdAt: current.created_at,
          expiresAt: current.expires_at
        }
      });
    }

    // POST - Change password (manual or scheduled)
    if (event.httpMethod === 'POST') {
      const { password, videoId, videoUrl, rotationType } = JSON.parse(event.body || '{}');

      const effectiveVideoId = videoId || VIMEO_VIDEO_ID;
      if (!effectiveVideoId) {
        return respond(400, { error: 'Video ID is required. Either provide it or set VIMEO_VIDEO_ID environment variable.' });
      }

      // Generate or use provided password
      const newPassword = password || generatePassword(8);
      const effectiveRotationType = rotationType || 'manual';

      // Update Vimeo if token is available
      let vimeoUpdated = false;
      let vimeoError = null;

      if (VIMEO_ACCESS_TOKEN) {
        try {
          await updateVimeoPassword(effectiveVideoId, newPassword);
          vimeoUpdated = true;
          console.log(`Vimeo password updated for video ${effectiveVideoId}`);
        } catch (err) {
          vimeoError = err.message;
          console.error('Failed to update Vimeo:', err.message);
        }
      } else {
        vimeoError = 'VIMEO_ACCESS_TOKEN not configured - password saved locally only';
      }

      // Deactivate old passwords
      await pool.query(`UPDATE vimeo_passwords SET active = false WHERE active = true`);

      // Save new password to database
      const effectiveUrl = videoUrl || (VIMEO_VIDEO_ID ? `https://vimeo.com/event/${effectiveVideoId}` : null);

      const insertResult = await pool.query(`
        INSERT INTO vimeo_passwords (video_id, password, video_url, active, rotation_type)
        VALUES ($1, $2, $3, true, $4)
        RETURNING id, video_id, password, video_url, rotation_type, created_at
      `, [effectiveVideoId, newPassword, effectiveUrl, effectiveRotationType]);

      const saved = insertResult.rows[0];

      return respond(200, {
        success: true,
        message: vimeoUpdated
          ? 'Password changed successfully on Vimeo and saved'
          : 'Password saved locally (Vimeo update pending)',
        password: {
          videoId: saved.video_id,
          password: saved.password,
          videoUrl: saved.video_url,
          rotationType: saved.rotation_type,
          createdAt: saved.created_at
        },
        vimeoUpdated,
        vimeoError
      });
    }

    // PUT - Update password settings or schedule
    if (event.httpMethod === 'PUT') {
      const { videoUrl, expiresAt } = JSON.parse(event.body || '{}');

      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (videoUrl !== undefined) {
        updates.push(`video_url = $${paramIndex++}`);
        values.push(videoUrl);
      }

      if (expiresAt !== undefined) {
        updates.push(`expires_at = $${paramIndex++}`);
        values.push(expiresAt);
      }

      if (updates.length === 0) {
        return respond(400, { error: 'No updates provided' });
      }

      values.push(true); // For WHERE active = $N

      const result = await pool.query(`
        UPDATE vimeo_passwords
        SET ${updates.join(', ')}
        WHERE active = $${paramIndex}
        RETURNING id, video_id, password, video_url, rotation_type, created_at, expires_at
      `, values);

      if (result.rows.length === 0) {
        return respond(404, { error: 'No active password found to update' });
      }

      return respond(200, {
        success: true,
        message: 'Password settings updated',
        password: result.rows[0]
      });
    }

    return respond(405, { error: 'Method not allowed' });

  } catch (error) {
    console.error('Error managing password:', error);
    return respond(500, {
      error: 'Failed to manage password',
      details: error.message
    });
  }
};

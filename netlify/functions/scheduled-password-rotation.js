const { Pool } = require('pg');
const https = require('https');
const crypto = require('crypto');

// This is a Netlify Scheduled Function
// Configure in netlify.toml with:
// [functions."scheduled-password-rotation"]
//   schedule = "0 8 * * 0"  # Every Sunday at 8:00 AM UTC

let pool;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

const VIMEO_ACCESS_TOKEN = process.env.VIMEO_ACCESS_TOKEN;
const VIMEO_VIDEO_ID = process.env.VIMEO_VIDEO_ID;

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
const updateVimeoPassword = async (videoId, newPassword) => {
  if (!VIMEO_ACCESS_TOKEN) {
    throw new Error('VIMEO_ACCESS_TOKEN not configured');
  }

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      privacy: {
        view: 'password'
      },
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

// Main scheduled function handler
exports.handler = async (event) => {
  console.log('Scheduled password rotation started at', new Date().toISOString());

  if (!pool) {
    console.error('Database not configured');
    return { statusCode: 503, body: 'Database not configured' };
  }

  try {
    // Check if scheduled rotation is enabled
    const scheduleResult = await pool.query(`
      SELECT enabled FROM password_rotation_schedule
      WHERE enabled = true
      LIMIT 1
    `);

    if (scheduleResult.rows.length === 0) {
      console.log('Scheduled rotation is disabled');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Scheduled rotation is disabled' })
      };
    }

    // Get current video ID (from env or database)
    const currentResult = await pool.query(`
      SELECT video_id, video_url FROM vimeo_passwords
      WHERE active = true
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const videoId = currentResult.rows.length > 0
      ? currentResult.rows[0].video_id
      : VIMEO_VIDEO_ID;

    const videoUrl = currentResult.rows.length > 0
      ? currentResult.rows[0].video_url
      : null;

    if (!videoId) {
      console.error('No video ID configured');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No video ID configured' })
      };
    }

    // Generate new password
    const newPassword = generatePassword(8);
    console.log(`Generated new password for video ${videoId}`);

    // Update Vimeo
    let vimeoUpdated = false;
    if (VIMEO_ACCESS_TOKEN) {
      try {
        await updateVimeoPassword(videoId, newPassword);
        vimeoUpdated = true;
        console.log('Vimeo password updated successfully');
      } catch (err) {
        console.error('Failed to update Vimeo:', err.message);
      }
    }

    // Deactivate old passwords
    await pool.query(`UPDATE vimeo_passwords SET active = false WHERE active = true`);

    // Save new password
    await pool.query(`
      INSERT INTO vimeo_passwords (video_id, password, video_url, active, rotation_type)
      VALUES ($1, $2, $3, true, 'scheduled')
    `, [videoId, newPassword, videoUrl]);

    // Update last run timestamp
    await pool.query(`
      UPDATE password_rotation_schedule
      SET last_run = CURRENT_TIMESTAMP
      WHERE enabled = true
    `);

    console.log('Password rotation completed successfully');

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Password rotated successfully',
        vimeoUpdated,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('Error in scheduled password rotation:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to rotate password',
        details: error.message
      })
    };
  }
};

// Export schedule config for Netlify
exports.config = {
  schedule: "@weekly"  // Runs every Sunday at midnight UTC
  // You can also use cron syntax: "0 8 * * 0" for Sunday at 8:00 AM
};

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const twilio = require('twilio');
const sgMail = require('@sendgrid/mail');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL/Neon connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Initialize database tables
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS members (
        id UUID PRIMARY KEY,
        firstName VARCHAR(255) NOT NULL,
        lastName VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        status VARCHAR(50),
        joinDate DATE,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id UUID PRIMARY KEY,
        date DATE NOT NULL,
        serviceType VARCHAR(255) NOT NULL,
        attendees TEXT,
        count INTEGER,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}

initDatabase();

// Routes

// GET all members
app.get('/api/members', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM members ORDER BY firstName, lastName');
    res.json(result.rows);
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET single member
app.get('/api/members/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM members WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST create member
app.post('/api/members', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, status, joinDate } = req.body;
    const id = uuidv4();
    const createdAt = new Date().toISOString();

    const result = await pool.query(
      `INSERT INTO members (id, firstName, lastName, email, phone, status, joinDate, createdAt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, firstName, lastName, email || null, phone || null, status, joinDate, createdAt]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE member
app.delete('/api/members/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM members WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET all attendance records
app.get('/api/attendance', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM attendance ORDER BY date DESC'
    );
    // Parse attendees JSON strings back to arrays
    const parsed = result.rows.map(r => ({
      ...r,
      attendees: r.attendees ? JSON.parse(r.attendees) : []
    }));
    res.json(parsed);
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST record attendance
app.post('/api/attendance', async (req, res) => {
  try {
    const { date, serviceType, attendees, count } = req.body;
    const id = uuidv4();
    const createdAt = new Date().toISOString();

    const result = await pool.query(
      `INSERT INTO attendance (id, date, serviceType, attendees, count, createdAt)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, date, serviceType, JSON.stringify(attendees), count, createdAt]
    );

    res.status(201).json({
      ...result.rows[0],
      attendees: attendees
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET attendance report
app.get('/api/attendance/report', async (req, res) => {
  try {
    const { from, to } = req.query;
    const result = await pool.query(
      'SELECT * FROM attendance WHERE date >= $1 AND date <= $2 ORDER BY date DESC',
      [from, to]
    );

    const records = result.rows;

    if (records.length === 0) {
      return res.json({
        totalServices: 0,
        totalAttendance: 0,
        averageAttendance: 0,
        serviceBreakdown: {}
      });
    }

    const totalServices = records.length;
    const totalAttendance = records.reduce((sum, r) => sum + (r.count || 0), 0);
    const averageAttendance = Math.round(totalAttendance / totalServices);

    const serviceBreakdown = {};
    records.forEach(r => {
      serviceBreakdown[r.serviceType] = (serviceBreakdown[r.serviceType] || 0) + r.count;
    });

    res.json({
      totalServices,
      totalAttendance,
      averageAttendance,
      serviceBreakdown
    });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST send SMS notification
app.post('/api/notifications/sms', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      return res.status(400).json({ error: 'Twilio credentials not configured' });
    }

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const result = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });

    res.json({ success: true, messageId: result.sid });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST send email notification
app.post('/api/notifications/email', async (req, res) => {
  try {
    const { email, subject, html } = req.body;
    
    if (!process.env.SENDGRID_API_KEY) {
      return res.status(400).json({ error: 'SendGrid API key not configured' });
    }

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to: email,
      from: process.env.FROM_EMAIL_ADDRESS || 'noreply@yourchurch.org',
      subject: subject,
      html: html
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Church Attendance API running on http://localhost:${PORT}`);
  console.log('Database: PostgreSQL/Neon');
  console.log('Available endpoints:');
  console.log('  GET  /api/members');
  console.log('  POST /api/members');
  console.log('  GET  /api/members/:id');
  console.log('  DELETE /api/members/:id');
  console.log('  GET  /api/attendance');
  console.log('  POST /api/attendance');
  console.log('  GET  /api/attendance/report?from=YYYY-MM-DD&to=YYYY-MM-DD');
  console.log('  POST /api/notifications/sms');
  console.log('  POST /api/notifications/email');
  console.log('  GET  /health');
});

module.exports = app;

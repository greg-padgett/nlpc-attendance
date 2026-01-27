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
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
    const { fromDate, toDate, serviceType } = event.queryStringParameters || {};

    let query = `
      SELECT 
        a.date,
        a.service_type,
        m.id,
        m.first_name,
        m.last_name,
        m.email,
        m.phone,
        a.present,
        a.checked_in_at
      FROM attendance a
      JOIN members m ON a.member_id = m.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    if (fromDate) {
      query += ` AND a.date >= $${paramIndex}`;
      params.push(fromDate);
      paramIndex++;
    }
    if (toDate) {
      query += ` AND a.date <= $${paramIndex}`;
      params.push(toDate);
      paramIndex++;
    }
    if (serviceType) {
      query += ` AND a.service_type = $${paramIndex}`;
      params.push(serviceType);
      paramIndex++;
    }

    query += ` ORDER BY a.date DESC, a.service_type ASC, m.last_name ASC, m.first_name ASC`;

    const result = await pool.query(query, params);

    // Transform into hierarchical structure
    const byService = {};
    const records = result.rows;

    records.forEach(row => {
      const key = `${row.date}-${row.service_type}`;
      if (!byService[key]) {
        byService[key] = {
          date: row.date,
          service_type: row.service_type,
          present: [],
          absent: []
        };
      }
      
      const member = {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        phone: row.phone,
        checked_in_at: row.checked_in_at
      };

      if (row.present) {
        byService[key].present.push(member);
      } else {
        byService[key].absent.push(member);
      }
    });

    // Get all possible members for generating absent list
    const allMembersResult = await pool.query(
      `SELECT id, first_name, last_name, email, phone FROM members WHERE status = 'Active' ORDER BY last_name, first_name`
    );
    const allMembers = allMembersResult.rows;

    // Enhance each service with full absent list
    Object.keys(byService).forEach(key => {
      const service = byService[key];
      const presentIds = new Set(service.present.map(m => m.id));
      service.absent = allMembers
        .filter(m => !presentIds.has(m.id))
        .map(m => ({
          id: m.id,
          first_name: m.first_name,
          last_name: m.last_name,
          email: m.email,
          phone: m.phone
        }));
    });

    return respond(200, {
      records: Object.values(byService),
      summary: {
        total_services: Object.keys(byService).length,
        total_members: allMembers.length
      }
    });
  } catch (error) {
    console.error('Error fetching attendance:', error);
    return respond(500, { error: error.message });
  }
};

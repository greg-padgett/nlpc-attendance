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

  if (event.httpMethod !== 'GET') {
    return respond(405, { error: 'Method not allowed' });
  }

  if (!pool) {
    return respond(503, { error: 'Database not configured' });
  }

  try {
    const params = event.queryStringParameters || {};
    const { memberId, fromDate, toDate } = params;

    if (!memberId) {
      return respond(400, { error: 'memberId is required' });
    }

    if (!fromDate || !toDate) {
      return respond(400, { error: 'fromDate and toDate are required' });
    }

    // Get member info
    const memberResult = await pool.query(
      'SELECT id, first_name, last_name, phone FROM members WHERE id = $1',
      [memberId]
    );

    if (memberResult.rows.length === 0) {
      return respond(404, { error: 'Member not found' });
    }

    const member = memberResult.rows[0];

    // Get all unique services that occurred during the date range
    // (based on attendance records that exist)
    const servicesResult = await pool.query(`
      SELECT DISTINCT date, service_type
      FROM attendance
      WHERE date >= $1 AND date <= $2
      ORDER BY date DESC, service_type
    `, [fromDate, toDate]);

    const allServices = servicesResult.rows;

    // Get services this member attended
    const attendedResult = await pool.query(`
      SELECT date, service_type
      FROM attendance
      WHERE member_id = $1 AND date >= $2 AND date <= $3 AND present = true
    `, [memberId, fromDate, toDate]);

    const attendedSet = new Set(
      attendedResult.rows.map(r => `${r.date.toISOString().split('T')[0]}|${r.service_type}`)
    );

    // Find absences (services that occurred but member didn't attend)
    const absences = allServices.filter(service => {
      const key = `${service.date.toISOString().split('T')[0]}|${service.service_type}`;
      return !attendedSet.has(key);
    });

    // Get absentee check-ins for this member's phone number during the period
    // Use last 10 digits for matching to handle country code variations
    const cleanedPhone = (member.phone || '').replace(/\D/g, '');
    const last10Digits = cleanedPhone.slice(-10);
    let absenteeCheckins = [];

    if (last10Digits.length === 10) {
      const absenteeResult = await pool.query(`
        SELECT id, name, phone, reason, prayer_request, service_date,
               livestream_sent, livestream_sent_at, created_at
        FROM absentee_checkins
        WHERE RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) = $1
          AND service_date >= $2 AND service_date <= $3
        ORDER BY service_date DESC
      `, [last10Digits, fromDate, toDate]);

      absenteeCheckins = absenteeResult.rows;
    }

    // Create a map of absentee check-ins by date for quick lookup
    const absenteeByDate = {};
    absenteeCheckins.forEach(checkin => {
      const dateKey = checkin.service_date.toISOString().split('T')[0];
      if (!absenteeByDate[dateKey]) {
        absenteeByDate[dateKey] = [];
      }
      absenteeByDate[dateKey].push(checkin);
    });

    // Build detailed absence list with absentee info
    const detailedAbsences = absences.map(absence => {
      const dateKey = absence.date.toISOString().split('T')[0];
      const absenteeInfo = absenteeByDate[dateKey] || [];

      return {
        date: dateKey,
        serviceType: absence.service_type,
        absenteeSubmission: absenteeInfo.length > 0 ? {
          reason: absenteeInfo[0].reason,
          reasonLabel: formatReason(absenteeInfo[0].reason),
          prayerRequest: absenteeInfo[0].prayer_request,
          livestreamSent: absenteeInfo[0].livestream_sent,
          livestreamSentAt: absenteeInfo[0].livestream_sent_at,
          submittedAt: absenteeInfo[0].created_at
        } : null
      };
    });

    // Calculate tallies by service type
    const serviceTypeTallies = {};
    absences.forEach(absence => {
      const type = absence.service_type;
      if (!serviceTypeTallies[type]) {
        serviceTypeTallies[type] = { total: 0, withAbsenteeSubmission: 0 };
      }
      serviceTypeTallies[type].total++;

      const dateKey = absence.date.toISOString().split('T')[0];
      if (absenteeByDate[dateKey]) {
        serviceTypeTallies[type].withAbsenteeSubmission++;
      }
    });

    // Calculate summary stats
    const totalServicesInPeriod = allServices.length;
    const totalAbsences = absences.length;
    const totalAttended = totalServicesInPeriod - totalAbsences;
    const attendanceRate = totalServicesInPeriod > 0
      ? Math.round((totalAttended / totalServicesInPeriod) * 100)
      : 0;
    const absencesWithSubmission = detailedAbsences.filter(a => a.absenteeSubmission).length;

    return respond(200, {
      member: {
        id: member.id,
        name: `${member.first_name} ${member.last_name}`,
        phone: member.phone
      },
      dateRange: { from: fromDate, to: toDate },
      summary: {
        totalServicesInPeriod,
        totalAttended,
        totalAbsences,
        attendanceRate,
        absencesWithSubmission,
        absencesWithoutSubmission: totalAbsences - absencesWithSubmission
      },
      serviceTypeTallies,
      absences: detailedAbsences
    });

  } catch (error) {
    console.error('Error generating member absence report:', error);
    return respond(500, { error: 'Failed to generate report', details: error.message });
  }
};

function formatReason(reason) {
  const labels = {
    'sick': 'Sick / Prayer Request',
    'vacation': 'Vacation',
    'business': 'Business Travel',
    'other': 'Other'
  };
  return labels[reason] || reason;
}

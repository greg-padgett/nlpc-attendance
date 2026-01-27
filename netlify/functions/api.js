// This file is deprecated. Use members.js and attendance.js instead.
// Keeping this file to prevent routing conflicts.

exports.handler = async (event) => {
  return {
    statusCode: 404,
    body: JSON.stringify({ error: 'Use /.netlify/functions/members or /.netlify/functions/attendance' })
  };
};

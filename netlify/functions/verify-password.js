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
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { password } = body;

    // Get the app password from environment variable
    const appPassword = process.env.APP_PASSWORD;

    if (!appPassword) {
      console.error('APP_PASSWORD environment variable not set');
      return respond(500, { error: 'Server configuration error' });
    }

    if (!password) {
      return respond(400, { error: 'Password required' });
    }

    // Compare passwords
    const isValid = password === appPassword;

    if (isValid) {
      return respond(200, { success: true });
    } else {
      return respond(401, { success: false, error: 'Invalid password' });
    }
  } catch (err) {
    console.error('Error verifying password:', err);
    return respond(500, { error: 'Internal server error' });
  }
};

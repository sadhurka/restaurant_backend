// small helper to mask URIs in logs
function maskUri(uri) {
  if (!uri) return '';
  return uri.length > 40 ? uri.slice(0, 20).replace(/:[^:@]+@/, ':***@') + '...' + uri.slice(-15) : uri.replace(/:[^:@]+@/, ':***@');
}

function safeJson(res, status, obj) {
  try {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(obj));
  } catch (e) {
    try { res.statusCode = status; res.end(String(obj)); } catch (_) {}
  }
}

export default async function handler(req, res) {
  // --- Add: Log incoming Authorization header for 401 debugging ---
  const authHeader = req.headers.authorization || null;
  const maskedAuth = authHeader ? `${authHeader.substring(0, 12)}...` : 'Not Present';
  console.log(`[serverless] Request to ${req.url}. Authorization header: ${maskedAuth}`);
  // --- End added code ---

  // --- Add: support Vercel deployment-protection bypass flow ---
  try {
    const host = req.headers.host || 'localhost';
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const url = new URL(req.url, `${proto}://${host}`);
    const setBypass = url.searchParams.get('x-vercel-set-bypass-cookie');
    const bypassToken = url.searchParams.get('x-vercel-protection-bypass');

    if (setBypass === 'true' && bypassToken) {
      const cookieVal = encodeURIComponent(bypassToken);
      const secureFlag = proto === 'https' ? 'Secure;' : '';
      // Set cookie name as Vercel expects and redirect to cleaned URL
      const cookie = `x-vercel-protection-bypass=${cookieVal}; Path=/; Max-Age=3600; HttpOnly=false; ${secureFlag} SameSite=Lax`;
      res.setHeader('Set-Cookie', cookie);
      url.searchParams.delete('x-vercel-set-bypass-cookie');
      url.searchParams.delete('x-vercel-protection-bypass');
      const cleanPath = url.pathname + (url.search ? `?${url.searchParams.toString()}` : '');
      res.statusCode = 302;
      res.setHeader('Location', cleanPath);
      res.end();
      return;
    }
  } catch (e) {
    // ignore parsing errors and continue to normal handling
    console.warn('Bypass cookie handler error (continuing):', e && e.stack ? e.stack : e);
  }

  // Early detect browser/html requests that hit Vercel Deployment Protection
  // and return a clear JSON instructing what to change (cannot bypass in code).
  const accept = req.headers['accept'] || '';
  const isBrowserHtmlRequest = accept.includes('text/html') || (req.headers['user-agent'] || '').toLowerCase().includes('mozilla');
  if (isBrowserHtmlRequest) {
    res.setHeader('content-type', 'application/json');
    res.statusCode = 403;
    res.end(JSON.stringify({
      error: 'Deployment protected by Vercel Authentication (SSO / Password).',
      message: 'Vercel has enabled Deployment Protection which shows an authentication page instead of your API JSON. To let clients load /menu directly either disable the protection for this deployment or use a protection bypass token as documented by Vercel.',
      docs: 'https://vercel.com/docs/deployment-protection',
      quick_hints: [
        'In Vercel Project Settings -> Deployments -> Protection: disable or allow this route.',
        'Or add a bypass token via Vercel MCP and call the URL with ?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=<TOKEN>',
        'For immediate testing: temporarily disable protection or whitelist 0.0.0.0/0 in Atlas to test DB reachability.'
      ]
    }));
    return;
  }

  const start = Date.now();
  console.log(`[serverless] ${req.method} ${req.url} - MONGODB_URI set? ${!!process.env.MONGODB_URI} uri: ${maskUri(process.env.MONGODB_URI)}`);

  if (!process.env.MONGODB_URI) {
    safeJson(res, 500, {
      error: 'MONGODB_URI not set in Vercel environment variables',
      hint: 'Add MONGODB_URI, MONGODB_DB and MONGODB_COLLECTION in Project Settings → Environment Variables'
    });
    return;
  }

  let mod;
  try {
    // Dynamic import so import-time errors are caught and returned
    mod = await import('../index.js');
  } catch (impErr) {
    console.error('[serverless] import ../index.js failed:', impErr && (impErr.stack || impErr));
    safeJson(res, 500, {
      error: 'Failed to import backend module',
      reason: impErr && (impErr.message || String(impErr)),
      stack: impErr && (impErr.stack || null),
      hint: 'Check Vercel function logs for import-time errors (missing files, syntax errors, or unsupported APIs).'
    });
    return;
  }

  const { expressApp: app, connectMongo, getLastMongoError } = mod;

  // attempt DB connection and return diagnostics if it fails
  try {
    await connectMongo();
  } catch (err) {
    console.error('[serverless] connectMongo() threw:', err && (err.stack || err));
    const last = typeof getLastMongoError === 'function' ? getLastMongoError() : null;
    safeJson(res, 502, {
      error: 'Failed to connect to MongoDB from serverless function',
      reason: err && (err.message || String(err)),
      lastMongoError: last || null,
      hint: 'Check MONGODB_URI, MONGODB_DB, MONGODB_COLLECTION and Atlas network access (IP whitelist / VPC).'
    });
    return;
  }

  // Delegate to Express app with defensive error handling
  try {
    const result = app(req, res);
    if (result && typeof result.then === 'function') {
      await result;
    }

    // If response not sent by Express, ensure we close connection (best-effort)
    if (!res.writableEnded) {
      try { res.end(); } catch (_) { /* ignore */ }
    }

    console.log(`[serverless] ${req.method} ${req.url} handled in ${Date.now() - start}ms`);
  } catch (err) {
    console.error('[serverless] handler caught error:', err && (err.stack || err));
    const last = typeof getLastMongoError === 'function' ? getLastMongoError() : null;
    if (!res.writableEnded) {
      safeJson(res, 500, {
        error: 'Server handler error',
        reason: err && (err.message || String(err)),
        lastMongoError: last || null,
        hint: 'Check Vercel function logs and /debug/connect output'
      });
    }
  }
}

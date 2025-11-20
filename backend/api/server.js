import { MongoClient, ObjectId } from "mongodb";

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

// This file is only for Vercel deployment routing. All CRUD logic is in index.js.
// Do not add business logic here. Use index.js for menu add/delete/update.

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

  // Early detect browser navigation that would hit Vercel Deployment Protection.
  // This should NOT block API calls (e.g., from fetch) which may also have a 'mozilla' user-agent.
  const accept = req.headers['accept'] || '';
  const isBrowserNavigation = accept.startsWith('text/html');

  if (isBrowserNavigation) {
    return safeJson(res, 403, {
      error: 'Deployment may be protected by Vercel Authentication.',
      message: 'This is an API endpoint. If you are seeing this in a browser, it might be because Vercel Deployment Protection is active. To access the API, you must either disable the protection or use a bypass token.',
      docs: 'https://vercel.com/docs/deployment-protection'
    });
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
    try {
      // lightweight diagnostics after connect
      const mod2 = await import('../index.js');
      const dbName = process.env.MONGODB_DB;
      const clientConnected = typeof mod2.connectMongo === 'function';
      if (clientConnected && process.env.LOG_MENU_DIAG === 'true') {
        const { expressApp: _app } = mod2;
        // Fire internal request to /debug/collections (non-blocking)
        fetch(`http://localhost/debug/collections`).catch(()=>{});
      }
    } catch {}
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

  // Enable CORS for all origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
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

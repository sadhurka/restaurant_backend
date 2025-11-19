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

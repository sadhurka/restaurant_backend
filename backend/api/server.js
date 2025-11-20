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

export default async function handler(req, res) {
  // --- Fix: Always delegate ALL methods except OPTIONS to Express app ---
  // Remove all direct MongoClient.connect/collection logic from this file.
  // Only handle CORS and OPTIONS here, everything else goes to Express app.

  // Enable CORS for all origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // --- Delegate all requests to Express app (index.js) ---
  let mod;
  try {
    mod = await import('../index.js');
  } catch (impErr) {
    return safeJson(res, 500, {
      error: 'Failed to import backend module',
      reason: impErr && (impErr.message || String(impErr)),
      stack: impErr && (impErr.stack || null)
    });
  }

  try {
    await mod.expressApp(req, res);
  } catch (err) {
    console.error('[serverless] expressApp handler error:', err && (err.stack || err));
    safeJson(res, 500, {
      error: 'Express app handling error',
      reason: err && (err.message || String(err)),
      stack: err && (err.stack || null)
    });
  }
}

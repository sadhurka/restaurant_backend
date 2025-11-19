import { expressApp as app, connectMongo, getLastMongoError } from '../index.js';

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
    // best-effort: if we can't send JSON, fallback to plain text
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

  try {
    // attempt connection (connectMongo is idempotent)
    await connectMongo().catch(err => {
      console.error('[serverless] connectMongo error (caught):', err && (err.stack || err));
      // let outer catch return diagnostics below
      throw err;
    });
  } catch (err) {
    const last = typeof getLastMongoError === 'function' ? getLastMongoError() : null;
    safeJson(res, 502, {
      error: 'Failed to connect to MongoDB from serverless function',
      reason: err && (err.message || String(err)),
      lastMongoError: last || null,
      hint: 'Check MONGODB_URI, MONGODB_DB, MONGODB_COLLECTION and Atlas network access (IP or VPC settings).'
    });
    console.error('[serverless] connect failed, returning 502', { reason: err && err.stack, lastMongoError: last });
    return;
  }

  // If DB connection succeeded but app can't find any collection, make that visible:
  try {
    // call Express app and let it handle the response
    const result = app(req, res);

    // If the app returned a Promise, await it to capture thrown errors
    if (result && typeof result.then === 'function') {
      await result;
    }

    // If response already sent, just log timing
    if (!res.writableEnded) {
      // ensure we do not leave request hanging
      // let express handle sending; if still not sent we'll not force a body here
    }
    console.log(`[serverless] ${req.method} ${req.url} handled in ${Date.now() - start}ms`);
  } catch (err) {
    console.error('[serverless] handler caught error:', err && (err.stack || err));
    const last = typeof getLastMongoError === 'function' ? getLastMongoError() : null;
    // If response not sent, provide diagnostic JSON
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

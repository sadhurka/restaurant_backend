import { expressApp as app, connectMongo, getLastMongoError } from '../index.js';

// small helper to mask URIs in logs
function maskUri(uri) {
  if (!uri) return '';
  return uri.length > 40 ? uri.slice(0, 20).replace(/:[^:@]+@/, ':***@') + '...' + uri.slice(-15) : uri.replace(/:[^:@]+@/, ':***@');
}

export default async function handler(req, res) {
  try {
    console.log('Serverless request:', req.url, 'MONGODB_URI set?', !!process.env.MONGODB_URI, 'uri:', maskUri(process.env.MONGODB_URI));

    if (!process.env.MONGODB_URI) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        error: 'MONGODB_URI not set in environment. Set it in Vercel Project Settings → Environment Variables.',
        hint: 'Set MONGODB_URI, MONGODB_DB and MONGODB_COLLECTION for production.'
      }));
      return;
    }

    // Ensure DB connection attempted on cold start; if it throws, respond with helpful diagnostics
    try {
      await connectMongo();
    } catch (err) {
      console.error('connectMongo() threw:', err && (err.stack || err));
      const last = typeof getLastMongoError === 'function' ? getLastMongoError() : null;
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        error: 'Failed to connect to MongoDB from serverless function',
        reason: err && (err.message || String(err)),
        lastMongoError: last || null,
        hint: 'Check MONGODB_URI, MONGODB_DB, MONGODB_COLLECTION in Vercel env vars and Atlas Network Access (IP whitelist).'
      }));
      return;
    }

    // Forward the incoming request to the Express app instance
    return app(req, res);
  } catch (err) {
    console.error('Serverless handler error:', err && (err.stack || err));
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}

import app, { connectMongo } from '../index.js';

// small helper to mask URIs in logs
function maskUri(uri) {
  if (!uri) return '';
  return uri.length > 40 ? uri.slice(0, 20).replace(/:[^:@]+@/, ':***@') + '...' + uri.slice(-15) : uri.replace(/:[^:@]+@/, ':***@');
}

// Vercel expects a default export. Forward incoming requests to the Express app.
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

    if (process.env.MONGODB_URI) {
      // ensure a DB connection is attempted on cold start or when needed
      await connectMongo().catch(err => {
        console.error('connectMongo() error (continuing to request handling):', err && err.stack ? err.stack : err);
      });
    }
    return app(req, res);
  } catch (err) {
    console.error('Serverless handler error:', err && err.stack ? err.stack : err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}

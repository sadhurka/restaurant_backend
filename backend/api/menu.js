import { expressApp as app, connectMongo, getLastMongoError } from '../index.js';

export default async function handler(req, res) {
  try {
    if (process.env.MONGODB_URI) {
      await connectMongo().catch((err) => {
        const last = typeof getLastMongoError === 'function' ? getLastMongoError() : null;
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          error: 'Failed to connect to MongoDB from serverless function',
          reason: err && (err.message || String(err)),
          lastMongoError: last || null
        }));
      });
      if (res.writableEnded) return;
    }
    // Delegate to Express app (route /api/menu is defined there)
    return app(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Internal Server Error', reason: err && (err.message || String(err)) }));
  }
}

import app, { connectMongo } from '../index.js';

// Vercel expects a default export. Forward incoming requests to the Express app.
export default async function handler(req, res) {
  try {
    if (process.env.MONGODB_URI) {
      // ensure a DB connection is attempted on cold start or when needed
      await connectMongo().catch(err => {
        console.error('connectMongo() error (ignored, request will continue):', err && err.stack ? err.stack : err);
      });
    }
    return app(req, res);
  } catch (err) {
    console.error('Serverless handler error:', err && err.stack ? err.stack : err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}

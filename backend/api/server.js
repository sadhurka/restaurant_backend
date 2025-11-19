import app from '../index.js';

// Vercel (and other serverless runtimes) will call this exported default handler.
// Express `app` is a callable function (req, res), so we can forward directly.
export default async function handler(req, res) {
  return app(req, res);
}

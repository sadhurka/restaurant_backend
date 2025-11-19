import app from '../index.js';

// Vercel expects a default export handler. Forward incoming requests to the Express app.
export default function handler(req, res) {
  return app(req, res);
}

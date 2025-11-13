// Lightweight serverless entry for Vercel that re-exports the Express app
// from the repository root `index.js`. This keeps your canonical code at
// the project root but ensures Vercel can find an `api/` function.
// Re-export to ensure /api/index.js is a simple serverless entry (kept for
// compatibility). `api/server.js` is the primary function used by vercel.json.
import app from '../index.js';

export default app;
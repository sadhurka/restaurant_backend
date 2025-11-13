// Lightweight serverless entry for Vercel that re-exports the Express app
// from the repository root `index.js`. This keeps your canonical code at
// the project root but ensures Vercel can find an `api/` function.
import app from '../index.js';

export default app;
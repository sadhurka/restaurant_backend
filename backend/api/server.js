// Serverless wrapper for Vercel: delegate to the root `index.js` Express app.
import app from '../index.js';

// Export the Express app as the default export. Vercel's @vercel/node
// will accept an Express app or a request handler function.
export default app;

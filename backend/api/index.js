// api/index.js: re-export the canonical Express app defined in ../server.js
// This avoids duplicate `app` declarations when running server.js locally
// while allowing Vercel to import an app from the api folder if needed.
import app from '../server.js';

export default app;
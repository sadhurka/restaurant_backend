import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
// Allow configuring allowed origin in production. Default to unrestricted during development.
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: CORS_ORIGIN }));

// If running behind a proxy (Vercel, Render, etc.) trust proxy headers
// so req.protocol and req.get('host') reflect the external URL.
app.set('trust proxy', true);

// Serve static images. Prefer `public/images` (build output) then fall back to `images`.
const publicImagesDir = path.join(__dirname, 'public', 'images');
const imagesDir = path.join(__dirname, 'images');
console.log('Static image dirs (prefer in this order):', publicImagesDir, imagesDir);

// Two static handlers: first serve from public/images, then from images
if (fs.existsSync(publicImagesDir)) {
  app.use('/images', express.static(publicImagesDir, { maxAge: '1d' }));
}
if (fs.existsSync(imagesDir)) {
  app.use('/images', express.static(imagesDir, { maxAge: '1d' }));
}

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Serve menu data
app.get('/api/menu', (req, res) => {
    try {
          const jsonData = fs.readFileSync(path.join(__dirname, 'data', 'menu.json'));
          const data = JSON.parse(jsonData);

      // Determine backend base URL. Preference order:
      // 1. Explicit BASE_URL environment variable (useful for frontend builds)
      // 2. VERCEL_URL provided by Vercel (when present)
      // 3. Use request headers (x-forwarded-proto / host) as a fallback
      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.get('host') || '';
      let backendUrl = '';
      if (process.env.BASE_URL) {
        backendUrl = process.env.BASE_URL.replace(/\/$/, '');
      } else if (process.env.VERCEL_URL) {
        // VERCEL_URL contains hostname (e.g. project-xyz.vercel.app)
        backendUrl = `${proto}://${process.env.VERCEL_URL}`;
      } else if (host) {
        backendUrl = `${proto}://${host}`;
      }

        // Group by category
        const groupedByCategory = data.reduce((acc, item) => {
            const category = item.category || 'Other';
            if (!acc[category]) acc[category] = [];
            acc[category].push(item);
            return acc;
        }, {});

        const allItemsFormatted = [];

        // Process each category to ensure image fallback and format data
        for (const category in groupedByCategory) {
            const items = groupedByCategory[category];
      // Format items and build full image URLs. If item.image is an absolute URL, keep it.
      const formattedItems = items.map(item => ({
        ...item,
        price: parseFloat(item.price || 0),
        badge: item.badge || '',
        category: item.category || 'Other',
        tags: item.tags || '',
        image: item.image ? (/^https?:\/\//i.test(item.image) ? item.image : (backendUrl ? `${backendUrl}/images/${item.image}` : `/images/${item.image}`)) : null
      }));
            
            allItemsFormatted.push(...formattedItems);
        }
        
        res.json(allItemsFormatted);
    } catch (error) {
        console.error('Error reading menu data:', error);
        res.status(500).json({ error: 'Failed to read menu data' });
    }
});

app.get('/', (_req, res) => res.json({ status: 'ok' }));

// Replace simple listen with resilient startServer to handle EADDRINUSE
const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 5000;
const MAX_PORT_ATTEMPTS = 10; // will try DEFAULT_PORT .. DEFAULT_PORT + 9

function startServer(port = DEFAULT_PORT, attempt = 0) {
  const server = app.listen(port, () => {
    console.log(`Backend running: http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use.`);
      if (attempt + 1 < MAX_PORT_ATTEMPTS) {
        const nextPort = port + 1;
        console.warn(`Trying port ${nextPort} (attempt ${attempt + 2}/${MAX_PORT_ATTEMPTS})...`);
        setTimeout(() => startServer(nextPort, attempt + 1), 200);
      } else {
        console.error(`All ports ${DEFAULT_PORT}..${DEFAULT_PORT + MAX_PORT_ATTEMPTS - 1} are in use. Exiting.`);
        process.exit(1);
      }
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

const IS_VERCEL = !!process.env.VERCEL;
if (!IS_VERCEL && process.env.SKIP_START !== '1') {
  startServer();
} else {
  console.log('Skipping local server start (Vercel or SKIP_START detected).');
}

// Export the Express app so serverless adapters or tests can import it.
export default app;
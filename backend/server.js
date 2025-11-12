import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(cors());

// Serve static images from the 'public' directory inside 'backend' (was 'images')
const publicPath = path.join(__dirname, 'public');
console.log('Express is serving static files from this directory:', publicPath);

// Keep the external path as /images for compatibility with frontend
app.use('/images', express.static(publicPath));

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Serve menu data
app.get('/api/menu', (req, res) => {
    try {
        const jsonData = fs.readFileSync(path.join(__dirname, 'data', 'menu.json'));
        const data = JSON.parse(jsonData);
        
        const backendUrl = `${req.protocol}://${req.get('host')}`;

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
            
            const hasImage = items.some(item => item.image);
            if (!hasImage && items.length > 0) {
                items[0].image = 'bg4.png'; // Assign fallback if no image in category
            }

            // Format items and build full image URLs
            const formattedItems = items.map(item => ({
                ...item,
                price: parseFloat(item.price || 0),
                badge: item.badge || '',
                category: item.category || 'Other',
                tags: item.tags || '',
                image: item.image ? `${backendUrl}/images/${item.image}` : null
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

// Start server with fallback attempts
startServer();
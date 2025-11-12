import fs from 'fs';
import path from 'path';

// Vercel serverless function to return menu data.
// Place your images under `public/images` so they're served at /images/<name>.

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const dataPath = path.join(process.cwd(), 'data', 'menu.json');
    const raw = fs.readFileSync(dataPath, 'utf8');
    const data = JSON.parse(raw || '[]');

    // Determine protocol + host from request headers
    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = forwardedProto || (req.headers['referer'] && req.headers['referer'].startsWith('https') ? 'https' : 'http');
    const host = req.headers.host || '';
    const backendUrl = host ? `${proto}://${host}` : '';

    // Group by category and ensure one fallback image per category if none provided
    const groupedByCategory = data.reduce((acc, item) => {
      const category = item.category || 'Other';
      if (!acc[category]) acc[category] = [];
      acc[category].push(item);
      return acc;
    }, {});

    const allItemsFormatted = [];

    for (const category in groupedByCategory) {
      const items = groupedByCategory[category];

      const hasImage = items.some(i => i.image);
      if (!hasImage && items.length > 0) {
        // Suggest a fallback image name — make sure this file exists in public/images
        items[0].image = 'bg4.png';
      }

      const formatted = items.map(item => ({
        ...item,
        price: parseFloat(item.price || 0),
        badge: item.badge || '',
        category: item.category || 'Other',
        tags: item.tags || '',
        image: item.image && backendUrl ? `${backendUrl}/images/${item.image}` : item.image ? `/images/${item.image}` : null
      }));

      allItemsFormatted.push(...formatted);
    }

    return res.status(200).json(allItemsFormatted);
  } catch (err) {
    console.error('Error in /api/menu:', err);
    return res.status(500).json({ error: 'Failed to read menu data' });
  }
}

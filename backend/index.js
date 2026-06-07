import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { MongoClient, ObjectId } from 'mongodb';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// CORS configuration - allow all origins for development
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
}));

app.options('*', cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 200
}));

const PORT = process.env.PORT || 3000;

// Directories for static files
const dataDir = path.join(__dirname, 'data');
const fallbackMenuFile = path.join(dataDir, 'menu.json');
const publicImagesDir = path.join(__dirname, 'public', 'images');
const imagesDir = path.join(__dirname, 'images');

// Serve static images
if (fs.existsSync(publicImagesDir)) {
  app.use('/images', express.static(publicImagesDir, { maxAge: '1d' }));
}
if (fs.existsSync(imagesDir)) {
  app.use('/images', express.static(imagesDir, { maxAge: '1d' }));
}

// MongoDB connection
let mongoClient = null;
let menuCollection = null;
let lastMongoError = null;

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'restaurant';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'menuitems';

// Helper: mask URI for logging
function maskUri(uri) {
  if (!uri) return '';
  if (uri.length <= 60) return uri.replace(/:[^:@]+@/, ':***@');
  return uri.slice(0, 30).replace(/:[^:@]+@/, ':***@') + '...' + uri.slice(-20);
}

console.log('MONGODB_URI configured:', !!MONGODB_URI, 'URI:', maskUri(MONGODB_URI));

// Connect to MongoDB with retry logic
async function connectMongo(force = false) {
  if (!MONGODB_URI) {
    console.log('No MONGODB_URI provided, using fallback file mode');
    return false;
  }
  
  try {
    if (mongoClient && !force) return true;
    if (mongoClient && force) {
      try { await mongoClient.close(); } catch (_) {}
      mongoClient = null;
      menuCollection = null;
    }

    const maxAttempts = 3;
    let attempt = 0;
    
    while (attempt < maxAttempts) {
      attempt++;
      try {
        console.log(`MongoDB connection attempt ${attempt}/${maxAttempts}...`);
        mongoClient = new MongoClient(MONGODB_URI, {
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 10000,
        });
        await mongoClient.connect();
        
        // Test connection
        await mongoClient.db().command({ ping: 1 });
        
        const db = mongoClient.db(MONGODB_DB);
        
        // Check if collection exists
        const collections = await db.listCollections({ name: MONGODB_COLLECTION }).toArray();
        if (collections.length > 0) {
          menuCollection = db.collection(MONGODB_COLLECTION);
          console.log(`MongoDB connected! Using collection: ${MONGODB_COLLECTION}`);
        } else {
          // Create collection if it doesn't exist
          menuCollection = db.collection(MONGODB_COLLECTION);
          console.log(`MongoDB connected! Created collection: ${MONGODB_COLLECTION}`);
        }
        
        lastMongoError = null;
        return true;
      } catch (err) {
        console.error(`MongoDB attempt ${attempt} failed:`, err.message);
        lastMongoError = err.message;
        
        if (mongoClient) {
          try { await mongoClient.close(); } catch (_) {}
          mongoClient = null;
        }
        
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      }
    }
    
    return false;
  } catch (err) {
    console.error('MongoDB connection error:', err);
    lastMongoError = err.message;
    return false;
  }
}

// Helper: normalize menu items
function normalizeMenuItem(item) {
  return {
    _id: item._id,
    id: item._id ? item._id.toString() : null,
    title: item.title || item.name || 'Untitled',
    category: item.category || 'Other',
    price: typeof item.price === 'number' ? item.price : Number(item.price) || 0,
    description: item.description || item.desc || '',
    desc: item.description || item.desc || '',
    image: item.image || null,
    badge: item.badge || '',
    tags: item.tags || '',
    available: item.available !== false,
    ...item
  };
}

// Load fallback menu from JSON file
function loadFallbackMenu() {
  if (!fs.existsSync(fallbackMenuFile)) return null;
  try {
    const raw = fs.readFileSync(fallbackMenuFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
    return null;
  } catch (err) {
    console.error('Failed to read fallback menu:', err);
    return null;
  }
}

// Health check endpoint
app.get('/', (_req, res) => {
  res.json({ 
    ok: true, 
    message: 'Restaurant API is running',
    mongodb: !!mongoClient,
    timestamp: new Date().toISOString()
  });
});

// GET /menu - Fetch all menu items
app.get('/menu', async (req, res) => {
  try {
    // Try MongoDB first
    if (MONGODB_URI) {
      const connected = await connectMongo();
      
      if (!connected || !menuCollection) {
        return res.status(502).json({
          error: 'MongoDB connection failed',
          details: lastMongoError,
          hint: 'Check your MONGODB_URI and network access'
        });
      }
      
      const items = await menuCollection.find({}).toArray();
      const formatted = items.map(normalizeMenuItem);
      
      console.log(`GET /menu: Returned ${formatted.length} items from MongoDB`);
      return res.json(formatted);
    }
    
    // Fallback to JSON file
    const fallback = loadFallbackMenu();
    if (fallback) {
      console.log(`GET /menu: Returned ${fallback.length} items from fallback file`);
      return res.json(fallback);
    }
    
    // No data source
    return res.status(500).json({ 
      error: 'No menu data available',
      hint: 'Set MONGODB_URI or create data/menu.json file'
    });
  } catch (err) {
    console.error('Error in GET /menu:', err);
    res.status(500).json({ error: 'Failed to load menu', details: err.message });
  }
});

// GET /api/menu - Alias for /menu
app.get('/api/menu', async (req, res) => {
  try {
    if (MONGODB_URI) {
      const connected = await connectMongo();
      
      if (!connected || !menuCollection) {
        return res.status(502).json({
          error: 'MongoDB connection failed',
          details: lastMongoError,
          hint: 'Check your MONGODB_URI and network access'
        });
      }
      
      const items = await menuCollection.find({}).toArray();
      const formatted = items.map(normalizeMenuItem);
      
      console.log(`GET /api/menu: Returned ${formatted.length} items from MongoDB`);
      return res.json(formatted);
    }
    
    const fallback = loadFallbackMenu();
    if (fallback) {
      console.log(`GET /api/menu: Returned ${fallback.length} items from fallback file`);
      return res.json(fallback);
    }
    
    return res.status(500).json({ 
      error: 'No menu data available',
      hint: 'Set MONGODB_URI or create data/menu.json file'
    });
  } catch (err) {
    console.error('Error in GET /api/menu:', err);
    res.status(500).json({ error: 'Failed to load menu', details: err.message });
  }
});

// POST /api/menu - Add new menu item
app.post('/api/menu', async (req, res) => {
  try {
    if (!MONGODB_URI) {
      return res.status(500).json({ error: 'MongoDB not configured' });
    }
    
    const connected = await connectMongo();
    if (!connected || !menuCollection) {
      return res.status(502).json({ error: 'MongoDB not connected' });
    }
    
    const { title, category, price, description, image, badge, tags } = req.body;
    
    // Validate required fields
    if (!title || !category || price === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        required: ['title', 'category', 'price']
      });
    }
    
    const newItem = {
      title: title.trim(),
      category,
      price: Number(price),
      description: description || '',
      desc: description || '',
      image: image || null,
      badge: badge || '',
      tags: tags || '',
      available: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const result = await menuCollection.insertOne(newItem);
    const insertedItem = await menuCollection.findOne({ _id: result.insertedId });
    
    console.log(`POST /api/menu: Added "${title}" (ID: ${result.insertedId})`);
    res.json(normalizeMenuItem(insertedItem));
  } catch (err) {
    console.error('Error in POST /api/menu:', err);
    res.status(500).json({ error: 'Failed to add menu item', details: err.message });
  }
});

// PUT /api/menu/:id - Update menu item
app.put('/api/menu/:id', async (req, res) => {
  try {
    if (!MONGODB_URI) {
      return res.status(500).json({ error: 'MongoDB not configured' });
    }
    
    const connected = await connectMongo();
    if (!connected || !menuCollection) {
      return res.status(502).json({ error: 'MongoDB not connected' });
    }
    
    const { id } = req.params;
    const { title, category, price, description, image, badge, tags, available } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: 'Missing item ID' });
    }
    
    // Build update object
    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (category !== undefined) updateData.category = category;
    if (price !== undefined) updateData.price = Number(price);
    if (description !== undefined) {
      updateData.description = description;
      updateData.desc = description;
    }
    if (image !== undefined) updateData.image = image;
    if (badge !== undefined) updateData.badge = badge;
    if (tags !== undefined) updateData.tags = tags;
    if (available !== undefined) updateData.available = available;
    
    updateData.updatedAt = new Date().toISOString();
    
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    let filter;
    try {
      filter = { _id: new ObjectId(id) };
    } catch {
      filter = { id: id };
    }
    
    const result = await menuCollection.updateOne(filter, { $set: updateData });
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
    
    const updatedItem = await menuCollection.findOne(filter);
    console.log(`PUT /api/menu/${id}: Updated item`);
    res.json(normalizeMenuItem(updatedItem));
  } catch (err) {
    console.error('Error in PUT /api/menu/:id:', err);
    res.status(500).json({ error: 'Failed to update menu item', details: err.message });
  }
});

// DELETE /api/menu/:id - Delete menu item
app.delete('/api/menu/:id', async (req, res) => {
  try {
    if (!MONGODB_URI) {
      return res.status(500).json({ error: 'MongoDB not configured' });
    }
    
    const connected = await connectMongo();
    if (!connected || !menuCollection) {
      return res.status(502).json({ error: 'MongoDB not connected' });
    }
    
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Missing item ID' });
    }
    
    let filter;
    try {
      filter = { _id: new ObjectId(id) };
    } catch {
      filter = { id: id };
    }
    
    const result = await menuCollection.deleteOne(filter);
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Menu item not found' });
    }
    
    console.log(`DELETE /api/menu/${id}: Deleted item`);
    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (err) {
    console.error('Error in DELETE /api/menu/:id:', err);
    res.status(500).json({ error: 'Failed to delete menu item', details: err.message });
  }
});

// Debug endpoint - Check MongoDB collections
app.get('/debug/mongo', async (_req, res) => {
  try {
    if (!MONGODB_URI) {
      return res.json({ 
        mongodb_configured: false, 
        message: 'MONGODB_URI not set in environment' 
      });
    }
    
    const connected = await connectMongo();
    
    if (!connected || !mongoClient) {
      return res.json({
        mongodb_configured: true,
        connected: false,
        error: lastMongoError,
        uri_mask: maskUri(MONGODB_URI)
      });
    }
    
    const db = mongoClient.db(MONGODB_DB);
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    let itemCount = 0;
    if (menuCollection) {
      itemCount = await menuCollection.countDocuments();
    }
    
    res.json({
      mongodb_configured: true,
      connected: true,
      database: MONGODB_DB,
      collection: MONGODB_COLLECTION,
      collections_available: collectionNames,
      item_count: itemCount,
      uri_mask: maskUri(MONGODB_URI)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Favicon
const faviconFile = path.join(__dirname, 'public', 'favicon.ico');
if (fs.existsSync(faviconFile)) {
  app.get('/favicon.ico', (_req, res) => res.sendFile(faviconFile));
} else {
  app.get('/favicon.ico', (_req, res) => res.status(204).end());
}

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server for local development
if (import.meta.url === `file://${process.argv[1]}`) {
  const startServer = async () => {
    if (MONGODB_URI) {
      await connectMongo().catch(console.warn);
    }
    
    const server = app.listen(PORT, () => {
      console.log(`\n🚀 Restaurant API Server running on port ${PORT}`);
      console.log(`📍 Health check: http://localhost:${PORT}/`);
      console.log(`📋 Menu endpoint: http://localhost:${PORT}/api/menu`);
      if (MONGODB_URI) {
        console.log(`🗄️  MongoDB: Connected to ${MONGODB_DB}.${MONGODB_COLLECTION}`);
      } else {
        console.log(`📁 Fallback mode: Using data/menu.json`);
      }
      console.log(`\n✅ Server ready!\n`);
    });
    
    // Graceful shutdown
    const shutdown = async () => {
      console.log('\nShutting down...');
      server.close(() => {
        if (mongoClient) {
          mongoClient.close().catch(console.error);
        }
        process.exit(0);
      });
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  };
  
  startServer();
}

export default app;
export { connectMongo };
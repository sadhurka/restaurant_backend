import { MongoClient, ObjectId } from 'mongodb';

// Helper functions
function maskUri(uri) {
  if (!uri) return '';
  if (uri.length <= 60) return uri.replace(/:[^:@]+@/, ':***@');
  return uri.slice(0, 30).replace(/:[^:@]+@/, ':***@') + '...' + uri.slice(-20);
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// Normalize menu item for frontend
function normalizeItem(item) {
  return {
    _id: item._id,
    id: item._id.toString(),
    title: item.title || item.name || 'Untitled',
    category: item.category || 'Other',
    price: typeof item.price === 'number' ? item.price : Number(item.price) || 0,
    description: item.description || item.desc || '',
    desc: item.description || item.desc || '',
    image: item.image || null,
    badge: item.badge || '',
    tags: item.tags || '',
    available: item.available !== false,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}

// Main Vercel handler
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  console.log(`[API] ${req.method} ${req.url}`);
  
  // Check MongoDB configuration
  if (!process.env.MONGODB_URI) {
    console.error('[API] MONGODB_URI not configured');
    return sendJson(res, 500, {
      error: 'MongoDB not configured',
      hint: 'Add MONGODB_URI, MONGODB_DB, MONGODB_COLLECTION to Vercel environment variables'
    });
  }
  
  let client = null;
  
  try {
    // Connect to MongoDB
    client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
    });
    
    await client.connect();
    console.log('[API] MongoDB connected');
    
    const dbName = process.env.MONGODB_DB || 'restaurant';
    const collectionName = process.env.MONGODB_COLLECTION || 'menuitems';
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
    const settingsCollection = db.collection('settings');
    
    // ========== CATEGORY ORDER ENDPOINTS ==========
    // GET /api/categories/order - Get category order
    if (req.method === 'GET' && req.url === '/api/categories/order') {
      try {
        // Find category order setting
        const setting = await settingsCollection.findOne({ key: 'categoryOrder' });
        
        if (setting && setting.value) {
          console.log('Returning saved category order:', setting.value);
          return sendJson(res, 200, { order: setting.value });
        } else {
          // Return default order (alphabetical)
          const categories = await collection.distinct('category');
          const defaultOrder = categories.filter(Boolean).sort();
          console.log('Returning default category order:', defaultOrder);
          return sendJson(res, 200, { order: defaultOrder });
        }
      } catch (err) {
        console.error('Error getting category order:', err);
        return sendJson(res, 500, { error: 'Failed to get category order' });
      }
    }
    
    // POST /api/categories/order - Save category order
    if (req.method === 'POST' && req.url === '/api/categories/order') {
      try {
        const { order } = req.body;
        
        if (!order || !Array.isArray(order)) {
          return sendJson(res, 400, { error: 'Invalid order data' });
        }
        
        // Update or insert category order
        const result = await settingsCollection.updateOne(
          { key: 'categoryOrder' },
          { 
            $set: { 
              key: 'categoryOrder', 
              value: order, 
              updatedAt: new Date().toISOString() 
            } 
          },
          { upsert: true }
        );
        
        console.log(`Category order saved: ${order.join(', ')} (matched: ${result.matchedCount}, modified: ${result.modifiedCount})`);
        return sendJson(res, 200, { success: true, order });
      } catch (err) {
        console.error('Error saving category order:', err);
        return sendJson(res, 500, { error: 'Failed to save category order' });
      }
    }
    
    // ========== MENU CRUD ENDPOINTS ==========
    // GET - Fetch all menu items
    if (req.method === 'GET' && req.url === '/api/menu') {
      const items = await collection.find({}).toArray();
      const formatted = items.map(normalizeItem);
      
      console.log(`[API] GET: Returning ${formatted.length} items`);
      return sendJson(res, 200, formatted);
    }
    
    // GET - Handle root path
    if (req.method === 'GET' && req.url === '/') {
      return sendJson(res, 200, { 
        ok: true, 
        message: 'Restaurant API is running',
        timestamp: new Date().toISOString()
      });
    }
    
    // POST - Add new menu item
    if (req.method === 'POST' && req.url === '/api/menu') {
      const payload = req.body;
      
      // Validate required fields
      if (!payload || !payload.title || !payload.category || payload.price === undefined) {
        return sendJson(res, 400, {
          error: 'Missing required fields',
          required: ['title', 'category', 'price']
        });
      }
      
      const newItem = {
        title: payload.title.trim(),
        category: payload.category,
        price: Number(payload.price),
        description: payload.description || payload.desc || '',
        desc: payload.description || payload.desc || '',
        image: payload.image || null,
        badge: payload.badge || '',
        tags: payload.tags || '',
        available: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      const result = await collection.insertOne(newItem);
      const insertedItem = await collection.findOne({ _id: result.insertedId });
      
      console.log(`[API] POST: Added "${payload.title}" (ID: ${result.insertedId})`);
      return sendJson(res, 200, normalizeItem(insertedItem));
    }
    
    // PUT - Update menu item (supports both /api/menu/:id and /api/menu?id=)
    if (req.method === 'PUT' && (req.url.startsWith('/api/menu/') || req.url.startsWith('/api/menu?id='))) {
      // Extract ID from URL path or query
      let id = req.query.id;
      if (!id && req.url) {
        const match = req.url.match(/\/api\/menu\/([^/?]+)/);
        if (match) id = match[1];
      }
      
      const payload = req.body;
      
      if (!id) {
        return sendJson(res, 400, { error: 'Missing item ID' });
      }
      
      if (!payload || Object.keys(payload).length === 0) {
        return sendJson(res, 400, { error: 'No update data provided' });
      }
      
      // Build update object
      const updateData = { updatedAt: new Date().toISOString() };
      if (payload.title !== undefined) updateData.title = payload.title.trim();
      if (payload.category !== undefined) updateData.category = payload.category;
      if (payload.price !== undefined) updateData.price = Number(payload.price);
      if (payload.description !== undefined) {
        updateData.description = payload.description;
        updateData.desc = payload.description;
      }
      if (payload.image !== undefined) updateData.image = payload.image;
      if (payload.badge !== undefined) updateData.badge = payload.badge;
      if (payload.tags !== undefined) updateData.tags = payload.tags;
      if (payload.available !== undefined) updateData.available = payload.available;
      
      // Create filter
      let filter;
      try {
        filter = { _id: new ObjectId(id) };
      } catch {
        filter = { id: id };
      }
      
      const result = await collection.updateOne(filter, { $set: updateData });
      
      if (result.matchedCount === 0) {
        return sendJson(res, 404, { error: 'Menu item not found' });
      }
      
      const updatedItem = await collection.findOne(filter);
      console.log(`[API] PUT: Updated item ${id}`);
      return sendJson(res, 200, normalizeItem(updatedItem));
    }
    
    // DELETE - Remove menu item
    if (req.method === 'DELETE' && (req.url.startsWith('/api/menu/') || req.url.startsWith('/api/menu?id='))) {
      // Extract ID from URL path
      let id = req.query.id;
      if (!id && req.url) {
        const match = req.url.match(/\/api\/menu\/([^/?]+)/);
        if (match) id = match[1];
      }
      
      if (!id) {
        return sendJson(res, 400, { error: 'Missing item ID' });
      }
      
      // Create filter
      let filter;
      try {
        filter = { _id: new ObjectId(id) };
      } catch {
        filter = { id: id };
      }
      
      const result = await collection.deleteOne(filter);
      
      if (result.deletedCount === 0) {
        return sendJson(res, 404, { error: 'Menu item not found' });
      }
      
      console.log(`[API] DELETE: Removed item ${id}`);
      return sendJson(res, 200, { success: true, message: 'Item deleted successfully' });
    }
    
    // ========== DEBUG ENDPOINT ==========
    // GET /debug/settings - Check settings collection (helpful for debugging)
    if (req.method === 'GET' && req.url === '/debug/settings') {
      try {
        const allSettings = await settingsCollection.find({}).toArray();
        return sendJson(res, 200, {
          settings: allSettings,
          collectionName: 'settings',
          count: allSettings.length
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
    
    // Method not allowed for other paths
    return sendJson(res, 404, { error: `Endpoint ${req.url} not found` });
    
  } catch (error) {
    console.error('[API] Error:', error);
    return sendJson(res, 500, {
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    if (client) {
      await client.close();
      console.log('[API] MongoDB connection closed');
    }
  }
}
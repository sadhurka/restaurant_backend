// Add POST handler for /api/menu to allow adding foods (for Vercel serverless)
import { expressApp as app, connectMongo, getLastMongoError } from '../index.js';

export default async function handler(req, res) {
  // --- Add CORS headers for all responses ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  // Handle POST /api/menu directly for add food
  if (req.method === 'POST') {
    try {
      if (process.env.MONGODB_URI) {
        await connectMongo();
      }
      const payload = req.body;
      if (!payload || !payload.title || !payload.category || !payload.price) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing required fields.' }));
        return;
      }
      // Use the same logic as in index.js
      const { MongoClient } = await import('mongodb');
      const client = await MongoClient.connect(process.env.MONGODB_URI);
      const db = client.db(process.env.MONGODB_DB);
      const collection = db.collection(process.env.MONGODB_COLLECTION);
      const doc = {
        ...payload,
        price: Number(payload.price),
        description: payload.description ?? payload.desc ?? '',
        desc: payload.description ?? payload.desc ?? ''
      };
      const result = await collection.insertOne(doc);
      const created = await collection.findOne({ _id: result.insertedId });
      await client.close();
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(created));
      return;
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Failed to add menu item.' }));
      return;
    }
  }

  // Handle PUT /api/menu/:id for updating food
  if (req.method === 'PUT') {
    try {
      // Parse body if needed (Vercel may not parse JSON automatically)
      let payload = req.body;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch {}
      }
      // Extract id from URL: /api/menu/:id
      let id = req.query.id;
      if (!id && req.url) {
        const match = req.url.match(/\/api\/menu\/([^/?]+)/);
        if (match) id = match[1];
      }
      if (!id && payload) id = payload._id || payload.id;
      if (!id) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing id for update' }));
        return;
      }
      if (process.env.MONGODB_URI) {
        await connectMongo();
      }
      if (!payload) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing payload.' }));
        return;
      }
      const { MongoClient, ObjectId } = await import('mongodb');
      const client = await MongoClient.connect(process.env.MONGODB_URI);
      const db = client.db(process.env.MONGODB_DB);
      const collection = db.collection(process.env.MONGODB_COLLECTION);

      // Convert id to ObjectId if possible, otherwise use as string
      let filter;
      let objectId = null;
      try {
        objectId = new ObjectId(id);
        filter = { _id: objectId };
      } catch {
        filter = { id: String(id) };
      }

      // Only update allowed fields
      const allowed = {};
      ['category', 'title', 'price', 'image', 'description', 'desc'].forEach(k => {
        if (payload[k] !== undefined) allowed[k] = payload[k];
      });

      // Ensure price is a number if present
      if (allowed.price !== undefined) allowed.price = Number(allowed.price);

      // Use updateOne with filter and $set
      const result = await collection.updateOne(filter, { $set: allowed });

      // Debug: log what was attempted
      console.log('PUT /api/menu/:id', { id, filter, allowed, matched: result.matchedCount, modified: result.modifiedCount });

      // If nothing was matched, return 404
      if (result.matchedCount === 0) {
        await client.close();
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Menu item not found.' }));
        return;
      }

      // Always return the updated document (even if modifiedCount is 0)
      let updated;
      if (objectId) {
        updated = await collection.findOne({ _id: objectId });
      } else {
        updated = await collection.findOne({ id: String(id) });
      }
      await client.close();

      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(updated));
      return;
    } catch (err) {
      console.error('PUT /api/menu/:id error:', err);
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Failed to update menu item.' }));
      return;
    }
  }

  // ...existing code...
  try {
    if (process.env.MONGODB_URI) {
      await connectMongo().catch((err) => {
        const last = typeof getLastMongoError === 'function' ? getLastMongoError() : null;
        res.statusCode = 502;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({
          error: 'Failed to connect to MongoDB from serverless function',
          reason: err && (err.message || String(err)),
          lastMongoError: last || null
        }));
      });
      if (res.writableEnded) return;
    }
    // Delegate to Express app (route /api/menu is defined there)
    return app(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Internal Server Error', reason: err && (err.message || String(err)) }));
  }
}

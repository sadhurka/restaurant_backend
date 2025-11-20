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
      // Extract id from URL: /api/menu/:id
      let id = req.query.id;
      if (!id && req.url) {
        const match = req.url.match(/\/api\/menu\/([^/?]+)/);
        if (match) id = match[1];
      }
      if (!id && req.body) id = req.body._id || req.body.id;
      if (!id) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing id for update' }));
        return;
      }
      if (process.env.MONGODB_URI) {
        await connectMongo();
      }
      const payload = req.body;
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
      let filter;
      try {
        filter = { _id: new ObjectId(id) };
      } catch {
        filter = { id };
      }
      // Only update allowed fields
      const allowed = {};
      ['category', 'title', 'price', 'image', 'description', 'desc'].forEach(k => {
        if (payload[k] !== undefined) allowed[k] = payload[k];
      });
      if (Object.keys(allowed).length === 0) {
        await client.close();
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'No updatable fields in payload.' }));
        return;
      }
      const result = await collection.updateOne(filter, { $set: allowed });
      if (result.matchedCount === 0) {
        await client.close();
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Menu item not found.' }));
        return;
      }
      const updated = await collection.findOne(filter);
      await client.close();
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(updated));
      return;
    } catch (err) {
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

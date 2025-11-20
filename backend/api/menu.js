import { expressApp as app, connectMongo, getLastMongoError } from '../index.js';

// Helper to parse JSON body if not already parsed (for Vercel serverless)
async function getParsedBody(req) {
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) return req.body;
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch {}
  }
  // Try to read raw body (Vercel serverless)
  if (typeof req.text === 'function') {
    try { return JSON.parse(await req.text()); } catch {}
  }
  // Try to read from stream (Node.js)
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

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

  // --- Only handle POST/PUT/DELETE here, let GET fall through to Express ---
  if (req.method === 'POST') {
    try {
      if (process.env.MONGODB_URI) {
        await connectMongo();
      }
      const payload = await getParsedBody(req);
      if (!payload || !payload.title || !payload.category || !payload.price) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing required fields.' }));
        return;
      }
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

  if (req.method === 'PUT') {
    let client;
    try {
      const payload = await getParsedBody(req);
      
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
      if (!payload) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing payload.' }));
        return;
      }

      const { MongoClient, ObjectId } = await import('mongodb');
      client = await MongoClient.connect(process.env.MONGODB_URI);
      const db = client.db(process.env.MONGODB_DB);
      const collection = db.collection(process.env.MONGODB_COLLECTION);

      let filter;
      let objectId = null;
      try {
        objectId = new ObjectId(id);
        filter = { _id: objectId };
      } catch {
        filter = { id: String(id) };
      }

      // --- Payload Construction ---
      const allowed = {};
      const fields = ['category', 'title', 'price', 'image', 'description', 'desc'];
      fields.forEach(k => {
        if (payload[k] !== undefined) allowed[k] = payload[k];
      });
      
      const descValue = payload.description ?? payload.desc ?? '';
      allowed.description = descValue;
      allowed.desc = descValue;

      // Ensure price is a valid number, otherwise delete it from the update payload
      if (allowed.price !== undefined) {
          const priceValue = Number(allowed.price);
          if (!isNaN(priceValue) && priceValue >= 0) {
              allowed.price = priceValue;
          } else {
              delete allowed.price;
          }
      }
      
      if ('_id' in allowed) delete allowed._id; 
      // --- End Payload Construction ---

      if (Object.keys(allowed).length === 0) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'No valid fields provided for update.' }));
        return;
      }
      
      const result = await collection.updateOne(filter, { $set: allowed });

      console.log('PUT /api/menu/:id', { id, filter, allowed, matched: result.matchedCount, modified: result.modifiedCount });

      if (result.matchedCount === 0) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Menu item not found.' }));
        return;
      }
      
      // 🛑 CRITICAL DEBUG STEP: Force an error if the item exists but wasn't modified.
      if (result.modifiedCount === 0) {
          res.statusCode = 409; // Conflict (or 400 Bad Request)
          res.setHeader('content-type', 'application/json');
          // This message will appear on the frontend and in your logs
          res.end(JSON.stringify({ 
              error: 'Update failed: Item found but NO fields were modified. This might mean the data is identical or a field type is blocking the update.', 
              details: allowed
          }));
          return;
      }

      // Success response: modifiedCount > 0
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ 
          ok: true, 
          message: 'Item updated successfully.',
          id: objectId ? String(objectId) : id
      }));
      return;
      
    } catch (err) {
      console.error('PUT /api/menu/:id error:', err);
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Failed to update menu item.', reason: err.message || String(err) }));
      return;
    } finally {
      if (client) {
        await client.close();
      }
    }
  }
  if (req.method === 'DELETE') {
    try {
      let id = req.query.id;
      if (!id && req.url) {
        const match = req.url.match(/\/api\/menu\/([^/?]+)/);
        if (match) id = match[1];
      }
      const payload = await getParsedBody(req);
      if (!id && payload) id = payload._id || payload.id;
      if (!id) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing id for deletion' }));
        return;
      }
      if (process.env.MONGODB_URI) {
        await connectMongo();
      }
      const { MongoClient, ObjectId } = await import('mongodb');
      const client = await MongoClient.connect(process.env.MONGODB_URI);
      const db = client.db(process.env.MONGODB_DB);
      const collection = db.collection(process.env.MONGODB_COLLECTION);
      let filter;
      try {
        filter = { _id: new ObjectId(id) };
      } catch {
        filter = { id: String(id) };
      }
      const result = await collection.deleteOne(filter);
      await client.close();
      if (result.deletedCount === 0) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Menu item not found.' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
      return;
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Failed to delete menu item.' }));
      return;
    }
  }

  // --- For GET and all other methods, delegate to Express app ---
  return app(req, res);
}

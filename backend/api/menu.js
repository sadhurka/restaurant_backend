import { expressApp as app, connectMongo, getLastMongoError } from '../index.js';

// --- FIXED: More robust helper to parse JSON body for all environments ---
async function getParsedBody(req) {
  // 1. Check if body is already parsed by middleware (local Express)
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) return req.body;
  
  // 2. Check if the body is a string that needs parsing
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch {}
  }
  
  // 3. Vercel/Serverless pattern: try to read from a text/json function
  if (typeof req.text === 'function') {
      try {
          const rawBody = await req.text();
          if (rawBody && rawBody.trim()) return JSON.parse(rawBody);
      } catch (e) {
          // Fall through to stream reading
      }
  }

  // 4. Final attempt: read from the raw stream (safest for full compatibility)
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { 
        // Resolve with an empty object if data is null/empty string
        resolve(JSON.parse(data || '{}')); 
      } catch { 
        resolve({}); 
      }
    });
    // Handle request errors that might prevent 'end' from firing
    req.on('error', () => resolve({}));
  });
}
// --- END FIXED getParsedBody ---

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

  // --- POST handler (No changes needed) ---
  if (req.method === 'POST') {
    let client;
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
      client = await MongoClient.connect(process.env.MONGODB_URI);
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
      if(client) await client.close();
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Failed to add menu item.' }));
      return;
    }
  }

  // --- PUT handler (Targeted Fixes) ---
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
      // --- FIXED: Check for empty payload explicitly ---
      if (!payload || Object.keys(payload).length === 0) { 
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing payload or payload is empty.' }));
        return;
      }
      // --- END FIXED ---
      
      const { MongoClient, ObjectId } = await import('mongodb');
      client = await MongoClient.connect(process.env.MONGODB_URI);
      const db = client.db(process.env.MONGODB_DB);
      const collection = db.collection(process.env.MONGODB_COLLECTION);

      let filter;
      try {
        filter = { _id: new ObjectId(id) };
      } catch {
        filter = { id: String(id) };
      }

      // 1. Construct the update document from the payload
      const updateDoc = {
        category: payload.category,
        title: payload.title?.trim(),
        price: Number(payload.price), // Ensure price is always stored as a Number
        description: payload.description ?? payload.desc ?? '',
        desc: payload.description ?? payload.desc ?? '' // Keep both fields in sync
      };
      if (typeof payload.image === 'string' && payload.image.trim() !== '') {
        updateDoc.image = payload.image;
      } else if (payload.image === null || payload.image === '') {
        updateDoc.image = null;
      }
      
      // 2. Perform the update
      const result = await collection.updateOne(filter, { $set: updateDoc });

      // 3. Handle the "No changes were made" scenario
      if (result.matchedCount === 0) {
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Menu item not found.' }));
          return;
      }
      
      if (result.modifiedCount === 0) {
          // This returns a 400 error which correctly triggers the frontend's error handler
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ 
              error: 'Update failed: No changes were made.',
              modified: 0 
          }));
          return;
      }

      // 4. Get the updated document and return (only if modifiedCount > 0)
      const updated = await collection.findOne(filter);
      
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(updated));
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
  
  // --- DELETE handler (No changes needed) ---
  if (req.method === 'DELETE') {
    // ... DELETE logic (kept as is) ...
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
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

// menu.js - FINAL, MOST DEFENSIVE PUT HANDLER (if previous failed due to modified: 0)

  if (req.method === 'PUT') {
    let client;
    try {
      // 1. Get the payload
      const payload = await getParsedBody(req);
      console.log('PUT /api/menu payload:', payload); 

      // 2. Identify ID
      let id = req.query.id;
      // ... (ID extraction logic remains the same) ...
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
      
      // 3. Connect to DB
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

      // 4. Retrieve the existing document to compare
      const existingDoc = await collection.findOne(filter);
      if (!existingDoc) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Menu item not found.' }));
          return;
      }
      
      const allowed = {};
      let changedCount = 0;
      
      // Define fields we can update
      const fields = ['category', 'title', 'price', 'image', 'description', 'desc'];
      
      // Compare and build update payload
      fields.forEach(k => {
          let incomingValue = payload[k];
          let existingValue = existingDoc[k];

          // Special handling for price
          if (k === 'price') {
              // Convert both to a string for comparison to avoid numeric type conflicts
              const incomingPrice = String(incomingValue);
              const existingPrice = String(existingValue);
              
              if (incomingPrice !== existingPrice) {
                  // Only convert to Number if it's a valid change. 
                  // If DB is expecting string, this will still update it as a Number.
                  // But if no change, we skip the update to avoid modified: 0.
                  allowed[k] = Number(incomingValue);
                  changedCount++;
              }
              return;
          }

          // Handle description/desc
          if (k === 'description' || k === 'desc') {
              // Ensure we are comparing the effective description
              const incomingDesc = String(payload.description ?? payload.desc ?? '');
              const existingDesc = String(existingDoc.description ?? existingDoc.desc ?? '');
              
              if (incomingDesc !== existingDesc) {
                  allowed['description'] = incomingDesc;
                  allowed['desc'] = incomingDesc;
                  changedCount++;
              }
              return;
          }

          // General fields
          if (incomingValue !== undefined && String(incomingValue) !== String(existingValue)) {
              allowed[k] = incomingValue;
              changedCount++;
          }
      });
      
      if ('_id' in allowed) delete allowed._id; 
      
      // 5. Check if any actual changes were detected
      if (changedCount === 0) {
          console.warn('PUT /api/menu/:id (SKIP): No changes detected between payload and DB.');
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ 
              ok: true, 
              modified: 0, 
              message: 'Item found, but no changes were detected.'
          }));
          return;
      }

      // 6. Perform the update
      const result = await collection.updateOne(filter, { $set: allowed });

      console.log('PUT /api/menu/:id', { id, filter, allowed, matched: result.matchedCount, modified: result.modifiedCount });

      // 7. Get the updated document and return
      const updated = await collection.findOne(filter);
      
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(updated));
      return;
      
    } catch (err) {
      // ... (Error handling) ...
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

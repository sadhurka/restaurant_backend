import { expressApp as app, connectMongo } from '../index.js';

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
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    try {
      if (!process.env.MONGODB_URI) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'MONGODB_URI not set in environment' }));
        return;
      }
      await connectMongo();

      const { MongoClient, ObjectId } = await import('mongodb');
      const client = await MongoClient.connect(process.env.MONGODB_URI);
      const db = client.db(process.env.MONGODB_DB);
      const collection = db.collection(process.env.MONGODB_COLLECTION);

      // --- POST: create ---
      if (req.method === 'POST') {
        const payload = await getParsedBody(req);
        if (!payload || !payload.title || !payload.category || !payload.price) {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing required fields.' }));
          await client.close();
          return;
        }
        const doc = {
          ...payload,
          price: Number(payload.price),
          description: payload.description ?? payload.desc ?? '',
          desc: payload.description ?? payload.desc ?? '',
          updatedAt: new Date().toISOString()
        };
        const result = await collection.insertOne(doc);
        const created = await collection.findOne({ _id: result.insertedId });
        await client.close();
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(created));
        return;
      }

      // --- PUT: update ---
      if (req.method === 'PUT') {
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
          await client.close();
          return;
        }
        if (!payload) {
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing payload.' }));
          await client.close();
          return;
        }

        let filter;
        let objectId = null;
        try {
          objectId = new ObjectId(id);
          filter = { _id: objectId };
        } catch {
          filter = { id: String(id) };
        }

        let descValue = '';
        if ('description' in payload) descValue = payload.description;
        else if ('desc' in payload) descValue = payload.desc;

        const allowed = {};
        ['category', 'title', 'price', 'image'].forEach(k => {
          if (payload[k] !== undefined) allowed[k] = payload[k];
        });
        allowed.description = descValue;
        allowed.desc = descValue;
        if (allowed.price !== undefined) allowed.price = Number(allowed.price);
        if ('_id' in allowed) delete allowed._id;
        allowed.updatedAt = new Date().toISOString();

        const result = await collection.updateOne(filter, { $set: allowed });

        if (result.matchedCount === 0) {
          // Upsert: create new if not found
          const docToInsert = { ...allowed };
          if (objectId) docToInsert._id = objectId;
          else docToInsert.id = id;
          await collection.insertOne(docToInsert);
          const created = objectId
            ? await collection.findOne({ _id: objectId })
            : await collection.findOne({ id: id });
          await client.close();
          res.statusCode = 201;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(created));
          return;
        }

        let updated = null;
        if (objectId) {
          updated = await collection.findOne({ _id: objectId });
        } else {
          updated = await collection.findOne({ id: String(id) });
        }
        await client.close();

        if (!updated) {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, message: 'Update successful but document fetch failed.', _id: objectId || id }));
          return;
        }

        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(updated));
        return;
      }

      // --- DELETE: remove ---
      if (req.method === 'DELETE') {
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
          await client.close();
          return;
        }
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
      }
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'Failed to process menu item.' }));
      return;
    }
  }

  // --- For GET and all other methods, delegate to Express app ---
  return app(req, res);
}
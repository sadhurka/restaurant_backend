import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { fileURLToPath } from 'url';

// Load local .env if present for easier local development
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// --- Replace hardcoded CORS usage with env-driven config and apply before routes ---
const CORS_ORIGIN = process.env.CORS_ORIGIN || ''; // empty means no origin restriction by default
// <-- added: allow configuring whether to send Access-Control-Allow-Credentials -->
const CORS_ALLOW_CREDENTIALS = (process.env.CORS_ALLOW_CREDENTIALS === 'true') || false;

if (CORS_ORIGIN) {
  app.use(cors({ origin: CORS_ORIGIN }));
} else {
  // if CORS_ORIGIN not set, allow all origins (explicit) to maintain previous behavior
  app.use(cors());
}

const PORT = process.env.PORT || 3000;


const dataDir = path.join(__dirname, 'data');
const fallbackMenuFile = path.join(dataDir, 'menu.json');

// --- Add: define image dirs before they're referenced to avoid ReferenceError ---
const publicImagesDir = path.join(__dirname, 'public', 'images');
const imagesDir = path.join(__dirname, 'images');
// --- end added code ---

// removed automatic creation of data directory to avoid adding files while running
// (If you want a local fallback, create data/menu.json manually — the server will read it if present.)
console.log('Static image dirs (prefer in this order):', publicImagesDir, imagesDir);

if (fs.existsSync(publicImagesDir)) {
  app.use('/images', express.static(publicImagesDir, { maxAge: '1d' }));
}
if (fs.existsSync(imagesDir)) {
  app.use('/images', express.static(imagesDir, { maxAge: '1d' }));
}

// Serve menu data: prefer MongoDB, otherwise load fallback JSON file
let mongoClient = null;
let menuCollection = null;
let resolvedCollectionName = null;
let lastMongoError = null; // <-- added to track last error

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'menu';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'menudata';

// small helper to mask URIs in logs
function maskUri(uri) {
  if (!uri) return '';
  if (uri.length <= 60) return uri.replace(/:[^:@]+@/, ':***@'); // hide password if present
  return uri.slice(0, 30).replace(/:[^:@]+@/, ':***@') + '...' + uri.slice(-20);
}

// print masked URI hint
console.log('ENV HINT: MONGODB_URI set?', !!process.env.MONGODB_URI, ' uri:', maskUri(MONGODB_URI));

// Rewritten connectMongo with retries and faster failure detection
async function connectMongo(force = false) {
  if (!MONGODB_URI) return;
  try {
    if (mongoClient && !force) return; // already connected
    if (mongoClient && force) {
      try { await mongoClient.close(); } catch (_) {}
      mongoClient = null;
      menuCollection = null;
      resolvedCollectionName = null;
    }

    const maxAttempts = 3;
    let attempt = 0;
    let lastErr = null;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        // short serverSelectionTimeout so failures return quickly
        mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
        await mongoClient.connect();
        // ping
        await mongoClient.db().command({ ping: 1 }).catch(() => {});
        const db = mongoClient.db(MONGODB_DB || undefined);

        // try configured collection first
        if (MONGODB_COLLECTION) {
          const exists = await db.listCollections({ name: MONGODB_COLLECTION }).hasNext().catch(() => false);
          if (exists) {
            menuCollection = db.collection(MONGODB_COLLECTION);
            resolvedCollectionName = MONGODB_COLLECTION;
            console.log(`Mongo: using configured collection "${resolvedCollectionName}"`);
            lastMongoError = null;
            return;
          } else {
            console.warn(`Mongo: configured collection "${MONGODB_COLLECTION}" not found in DB "${MONGODB_DB}"`);
          }
        }

        // try some common names
        const common = ['menu', 'menudata', 'menuitems', 'items', 'products'];
        for (const name of common) {
          const exists = await db.listCollections({ name }).hasNext().catch(() => false);
          if (exists) {
            menuCollection = db.collection(name);
            resolvedCollectionName = name;
            console.log(`Mongo: auto-detected collection "${resolvedCollectionName}"`);
            lastMongoError = null;
            return;
          }
        }

        // fallback to first collection
        const cols = await db.listCollections().toArray().catch(() => []);
        if (cols.length > 0) {
          resolvedCollectionName = cols[0].name;
          menuCollection = db.collection(resolvedCollectionName);
          console.log(`Mongo: falling back to first collection "${resolvedCollectionName}"`);
          lastMongoError = null;
          return;
        }

        // no collections found
        lastErr = new Error(`No collections found in DB "${MONGODB_DB}"`);
        try { await mongoClient.close(); } catch (_) {}
        mongoClient = null;
        menuCollection = null;
        resolvedCollectionName = null;
      } catch (err) {
        lastErr = err;
        lastMongoError = (err && err.stack) ? err.stack : String(err);
        try { if (mongoClient) await mongoClient.close(); } catch (_) {}
        mongoClient = null;
        menuCollection = null;
        resolvedCollectionName = null;
        const backoff = 500 * attempt;
        console.warn(`Mongo connect attempt ${attempt} failed: ${err && err.message ? err.message : err}. retrying in ${backoff}ms`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }

    lastMongoError = lastErr && lastErr.stack ? lastErr.stack : String(lastErr);
    console.error('Mongo connection failed after attempts:', lastErr && lastErr.message ? lastErr.message : lastErr);
  } catch (err) {
    lastMongoError = (err && err.stack) ? err.stack : String(err);
    console.error('connectMongo unexpected error:', err);
    try { if (mongoClient) await mongoClient.close(); } catch (_) {}
    mongoClient = null;
    menuCollection = null;
    resolvedCollectionName = null;
  }
}

// helper to load fallback menu file if present
function loadFallbackMenu() {
  if (!fs.existsSync(fallbackMenuFile)) return null;
  try {
    const raw = fs.readFileSync(fallbackMenuFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
    return null;
  } catch (err) {
    console.error('Failed to read fallback menu file:', err);
    return null;
  }
}

// root /health
app.get('/', (_req, res) => res.json({ ok: true }));

// /menu endpoint: prefer MongoDB, then fallback file, otherwise error
app.get('/menu', async (req, res) => {
  try {
    // Try MongoDB first if configured
    if (MONGODB_URI) {
      if (!mongoClient) await connectMongo();
      if (mongoClient) {
        const db = mongoClient.db(MONGODB_DB || undefined);

        // prefer already-resolved collection
        let data = null;
        if (menuCollection) {
          data = await menuCollection.find({}).toArray();
        } else {
          const result = await fetchMenuFromDB(db);
          if (result) {
            data = result.docs;
            resolvedCollectionName = result.name;
            console.log(`Fetched menu from collection "${resolvedCollectionName}"`);
          } else {
            console.warn('fetchMenuFromDB found no documents in any collection.');
          }
        }

        if (data) {
          const proto = req.headers['x-forwarded-proto'] || req.protocol;
          const host = req.get('host') || '';
          let backendUrl = '';

          if (process.env.BASE_URL) {
            backendUrl = process.env.BASE_URL.replace(/\/$/, '');
          } else if (host) {
            backendUrl = `${proto}://${host}`;
          } else if (process.env.VERCEL_URL) {
            backendUrl = `${proto}://${process.env.VERCEL_URL}`;
          }

          const imageBaseEnv = process.env.IMAGE_BASE_URL ? process.env.IMAGE_BASE_URL.replace(/\/$/, '') : '';

          const formatted = data.map(item => ({
            ...item,
            price: parseFloat(item.price || 0),
            badge: item.badge || '',
            category: item.category || 'Other',
            tags: item.tags || '',
            description: item.description || item.desc || null,
            desc: item.description || item.desc || null,
            image: item.image ? (
              /^https?:\/\//i.test(item.image)
                ? item.image
                : (imageBaseEnv ? `${imageBaseEnv}/${item.image}` : (backendUrl ? `${backendUrl}/images/${item.image}` : `/images/${item.image}`))
            ) : null
          }));

          return res.json(formatted);
        } else {
          console.error('Mongo configured but no menu documents found. Check /debug/mongo for collection names and configuration.');
        }
      } else {
        console.error('MONGODB_URI set but mongoClient is null after connect attempt.');
      }
    }

    // Fallback to data/menu.json if available
    const fallback = loadFallbackMenu();
    if (fallback) {
      return res.json(fallback);
    }

    // No data source available
    return res.status(500).json({ error: 'No menu data source available (set MONGODB_URI or provide data/menu.json). Check /debug/mongo.' });
  } catch (err) {
    console.error('Error in /menu:', err);
    res.status(500).json({ error: 'Failed to load menu' });
  }
});

// /api/menu retains Mongo-first behavior but will also use fallback file if mongo not configured
app.get('/api/menu', async (req, res) => {
    try {
        if (MONGODB_URI) {
          if (!mongoClient) await connectMongo();
          if (mongoClient) {
            const db = mongoClient.db(MONGODB_DB || undefined);
            let data = null;
            if (menuCollection) {
              data = await menuCollection.find({}).toArray();
            } else {
              const result = await fetchMenuFromDB(db);
              if (result) {
                data = result.docs;
                resolvedCollectionName = result.name;
                console.log(`Fetched menu from collection "${resolvedCollectionName}"`);
              } else {
                console.warn('fetchMenuFromDB found no documents in any collection.');
              }
            }

            if (data) {
              const proto = req.headers['x-forwarded-proto'] || req.protocol;
              const host = req.get('host') || '';
              let backendUrl = '';

              if (process.env.BASE_URL) {
                backendUrl = process.env.BASE_URL.replace(/\/$/, '');
              } else if (host) {
                backendUrl = `${proto}://${host}`;
              } else if (process.env.VERCEL_URL) {
                backendUrl = `${proto}://${process.env.VERCEL_URL}`;
              }

              const imageBaseEnv = process.env.IMAGE_BASE_URL ? process.env.IMAGE_BASE_URL.replace(/\/$/, '') : '';

              // Group by category and format
              const groupedByCategory = data.reduce((acc, item) => {
                  const category = item.category || 'Other';
                  if (!acc[category]) acc[category] = [];
                  acc[category].push(item);
                  return acc;
              }, {});

              const allItemsFormatted = [];

              for (const category in groupedByCategory) {
                  const items = groupedByCategory[category];
                  const formattedItems = items.map(item => ({
                      ...item,
                      price: parseFloat(item.price || 0),
                      badge: item.badge || '',
                      category: item.category || 'Other',
                      tags: item.tags || '',
                      description: item.description || item.desc || null,
                      desc: item.description || item.desc || null,
                      image: item.image ? (
                        /^https?:\/\//i.test(item.image)
                          ? item.image
                          : (imageBaseEnv ? `${imageBaseEnv}/${item.image}` : (backendUrl ? `${backendUrl}/images/${item.image}` : `/images/${item.image}`))
                      ) : null
                  }));

                  allItemsFormatted.push(...formattedItems);
              }

              return res.json(allItemsFormatted);
            } else {
              console.error('Mongo configured but no menu documents found. Check /debug/mongo for collection names and configuration.');
            }
          } else {
            console.error('MONGODB_URI set but mongoClient is null after connect attempt.');
          }
        }

        // Fallback to file
        const fallback = loadFallbackMenu();
        if (fallback) {
          return res.json(fallback);
        }

        return res.status(500).json({ error: 'No menu data source available (set MONGODB_URI or provide data/menu.json). Check /debug/mongo.' });
    } catch (error) {
        console.error('Error reading menu data:', error);
        res.status(500).json({ error: 'Failed to read menu data' });
    }
});

// --- after env-driven CORS and before connectMongo/startServer, add a small env hint ---
console.log('ENV HINT: MONGODB_URI set?', !!process.env.MONGODB_URI);
console.log('ENV HINT: MONGODB_DB =', process.env.MONGODB_DB || '(default: menu)');
console.log('ENV HINT: MONGODB_COLLECTION =', process.env.MONGODB_COLLECTION || '(auto-detect)');

// Add helper that tries multiple collection names (configured, common names, then any collection)
async function fetchMenuFromDB(db) {
  const tried = new Set();
  const candidateNames = [
    MONGODB_COLLECTION,
    'menu',
    'menudata',
    'menuitems',
    'items',
    'products'
  ].filter(Boolean);

  for (const name of candidateNames) {
    if (tried.has(name)) continue;
    tried.add(name);
    try {
      const exists = await db.listCollections({ name }).hasNext();
      if (!exists) continue;
      const coll = db.collection(name);
      const docs = await coll.find({}).toArray();
      if (docs && docs.length > 0) return { name, docs };
    } catch (err) {
      console.warn(`fetchMenuFromDB: error reading collection ${name}:`, err && err.message ? err.message : err);
    }
  }

  // Try every collection in DB as last resort
  try {
    const cols = await db.listCollections().toArray();
    for (const c of cols) {
      if (tried.has(c.name)) continue;
      try {
        const coll = db.collection(c.name);
        const docs = await coll.find({}).toArray();
        if (docs && docs.length > 0) return { name: c.name, docs };
      } catch (err) {
        // ignore and continue
      }
    }
  } catch (err) {
    console.warn('fetchMenuFromDB: failed listing collections:', err && err.message ? err.message : err);
  }

  return null;
}

// new debug endpoint: attempt a direct short connection and return error stack for diagnosis
app.get('/debug/connect', async (_req, res) => {
  if (!MONGODB_URI) return res.status(400).json({ ok: false, error: 'MONGODB_URI not set' });
  try {
    const testClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await testClient.connect();
    // basic info if possible
    let info = null;
    try {
      const serverStatus = await testClient.db().admin().serverStatus().catch(() => null);
      if (serverStatus) info = { host: serverStatus.host || null, uptime: serverStatus.uptime || null };
    } catch (_) {
      // ignore non-critical errors reading server status
    }
    try { await testClient.close(); } catch (_) {}
    return res.json({ ok: true, info });
  } catch (err) {
    const stack = err && err.stack ? err.stack : String(err);
    // store last error for /debug/mongo visibility
    lastMongoError = stack;
    return res.status(500).json({ ok: false, error: String(err), stack });
  }
});

// --- debug /mongo endpoint: show last MongoDB error and collection info ---
app.get('/debug/mongo', async (req, res) => {
  res.json({
    ok: true,
    lastError: lastMongoError,
    mongoClient: !!mongoClient,
    menuCollection: resolvedCollectionName || menuCollection ? true : false,
    collections: [],
    env: {
      MONGODB_URI: maskUri(MONGODB_URI),
      MONGODB_DB,
      MONGODB_COLLECTION,
      PORT,
      NODE_ENV: process.env.NODE_ENV || 'development',
      CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
    }
  });
});

// --- 404 handler ---
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// --- error handler ---
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// --- Replace the OPTIONS route (caused path-to-regexp errors) with a middleware preflight handler ---
/*
app.options('*', cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN, credentials: CORS_ALLOW_CREDENTIALS }));
*/
// instead handle CORS preflight and headers in middleware (already added below earlier)
app.use((req, res, next) => {
  const originValue = CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN;
  res.setHeader('Access-Control-Allow-Origin', originValue);
  if (CORS_ALLOW_CREDENTIALS) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Replace startServer default to use PORT (was using BASE_PORT which is undefined)
function startServer(port = Number(PORT) || 3000, attempt = 0) {
  const listenPort = Number(port) || 3000;
  const server = app.listen(listenPort, () => {
    console.log(`Server running on port ${listenPort}`);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE' && attempt < 5) {
      const nextPort = listenPort + 1;
      console.warn(`Port ${listenPort} in use, trying next port ${nextPort}...`);
      setTimeout(() => startServer(nextPort, attempt + 1), 1000);
    } else {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  });
}

// --- start server only when run directly, not when imported by Vercel ---
if (path.resolve(process.argv[1] || '') === __filename) {
  (async () => {
    if (MONGODB_URI) {
      await connectMongo().catch(() => {});
      await new Promise(r => setTimeout(r, 100));
    }
    startServer();
  })();
} else {
  console.log('Express app imported (no local listener started).');
}

// export the express app and connectMongo for serverless wrapper / local starter
export const expressApp = app;
export { connectMongo };

// add getter so serverless wrapper can report the last Mongo error
export function getLastMongoError() {
	return lastMongoError;
}

// (remove any default export to avoid circular/default-import issues)


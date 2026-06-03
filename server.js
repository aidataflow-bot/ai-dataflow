const crypto = require('crypto');
const fs = require('fs/promises');
const fsSync = require('fs');
const http = require('http');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'database.json');

loadEnvFile();

const PORT = Number(process.env.PORT || 4173);
const SESSION_SECRET = process.env.SESSION_SECRET || 'local-development-change-me';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fsSync.existsSync(envPath)) return;

  const contents = fsSync.readFileSync(envPath, 'utf8');
  contents.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) return;
    const [key, ...valueParts] = trimmed.split('=');
    if (!process.env[key]) {
      process.env[key] = valueParts.join('=').replace(/^["']|["']$/g, '');
    }
  });
}

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon'
};

let dbCache = null;
let writeQueue = Promise.resolve();

function createEmptyDb() {
  return {
    users: [],
    clients: [],
    recommendations: []
  };
}

async function readDb() {
  if (dbCache) return dbCache;

  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    dbCache = JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    dbCache = createEmptyDb();
    await writeDb(dbCache);
  }

  return dbCache;
}

async function writeDb(nextDb) {
  dbCache = nextDb;
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify(dbCache, null, 2));
  });
  return writeQueue;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function parseJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 2_000_000) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

function safeUser(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    name: user.name,
    company: user.company,
    createdAt: user.createdAt
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = hashPassword(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
}

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function createToken(userId) {
  const payload = base64Url(JSON.stringify({
    sub: userId,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7
  }));
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (signature !== sign(payload)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.sub || Date.now() > parsed.exp) return null;
    return parsed.sub;
  } catch {
    return null;
  }
}

async function requireUser(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const userId = verifyToken(token);

  if (!userId) {
    sendError(res, 401, 'Authentication required');
    return null;
  }

  const db = await readDb();
  const user = db.users.find(item => item.id === userId);
  if (!user) {
    sendError(res, 401, 'Authentication required');
    return null;
  }

  return user;
}

function normalizeClient(input, existing = {}) {
  return {
    id: existing.id || id('client'),
    company_name: String(input.company_name || '').trim(),
    contact_name: String(input.contact_name || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    phone: String(input.phone || '').trim(),
    industry: String(input.industry || '').trim(),
    company_size: String(input.company_size || '').trim(),
    location: String(input.location || '').trim(),
    status: String(input.status || 'active').trim(),
    notes: String(input.notes || '').trim(),
    created_at: existing.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    userId: existing.userId
  };
}

function validateClient(client) {
  if (!client.company_name) return 'Company name is required';
  if (!client.contact_name) return 'Contact name is required';
  if (!client.email) return 'Email is required';
  if (!client.industry) return 'Industry is required';
  return null;
}

async function createAiRecommendations(formData) {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error('AI is not configured. Set OPENAI_API_KEY before publishing.');
    error.status = 503;
    throw error;
  }

  const prompt = [
    'You are an expert AI data agency consultant.',
    'Create practical process-optimization recommendations for the client.',
    'Return strict JSON matching this shape:',
    '{"summary":{"totalRecommendations":number,"estimatedImpact":"number string 1-10","implementationTime":"string","confidenceScore":number},"recommendations":[{"title":"string","description":"string","priority":"high|medium|low","impactScore":number,"actions":["string"],"timeline":"string","estimatedCost":"string","expectedRoi":"string"}]}',
    '',
    `Focus area: ${formData.processArea}`,
    `Process description: ${formData.processDescription}`,
    `Current tools: ${formData.currentTools || 'Not provided'}`,
    `Team size: ${formData.teamSize || 'Not provided'}`,
    `Timeline: ${formData.urgency || 'Not provided'}`,
    `Goals: ${(formData.goals || []).join(', ') || 'Not provided'}`,
    `Attachments: ${(formData.attachments || []).map(file => file.name).join(', ') || 'None'}`
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: prompt,
      text: {
        format: {
          type: 'json_object'
        }
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    const error = new Error(`AI request failed: ${detail}`);
    error.status = 502;
    throw error;
  }

  const data = await response.json();
  const outputText = data.output_text || data.output?.flatMap(item => item.content || [])
    .find(item => item.type === 'output_text')?.text;

  if (!outputText) {
    const error = new Error('AI response did not include recommendation text');
    error.status = 502;
    throw error;
  }

  return JSON.parse(outputText);
}

async function handleApi(req, res, url) {
  try {
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const body = await parseJson(req);
      const firstName = String(body.firstName || '').trim();
      const lastName = String(body.lastName || '').trim();
      const company = String(body.company || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (!firstName || !lastName || !company || !email || password.length < 8) {
        sendError(res, 400, 'Please complete all required fields with a password of at least 8 characters');
        return;
      }

      const db = await readDb();
      if (db.users.some(user => user.email === email)) {
        sendError(res, 409, 'An account with that email already exists');
        return;
      }

      const user = {
        id: id('user'),
        firstName,
        lastName,
        name: `${firstName} ${lastName}`,
        company,
        email,
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString()
      };

      db.users.push(user);
      await writeDb(db);
      sendJson(res, 201, { user: safeUser(user), token: createToken(user.id) });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await parseJson(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const db = await readDb();
      const user = db.users.find(item => item.email === email);

      if (!user || !verifyPassword(password, user.passwordHash)) {
        sendError(res, 401, 'Invalid email or password');
        return;
      }

      sendJson(res, 200, { user: safeUser(user), token: createToken(user.id) });
      return;
    }

    const user = await requireUser(req, res);
    if (!user) return;

    if (req.method === 'GET' && url.pathname === '/api/me') {
      sendJson(res, 200, { user: safeUser(user) });
      return;
    }

    if (url.pathname === '/api/clients' && req.method === 'GET') {
      const db = await readDb();
      sendJson(res, 200, { clients: db.clients.filter(client => client.userId === user.id) });
      return;
    }

    if (url.pathname === '/api/clients' && req.method === 'POST') {
      const db = await readDb();
      const client = normalizeClient(await parseJson(req));
      client.userId = user.id;
      const validationError = validateClient(client);
      if (validationError) {
        sendError(res, 400, validationError);
        return;
      }
      db.clients.push(client);
      await writeDb(db);
      sendJson(res, 201, { client });
      return;
    }

    const clientMatch = url.pathname.match(/^\/api\/clients\/([^/]+)$/);
    if (clientMatch) {
      const db = await readDb();
      const client = db.clients.find(item => item.id === clientMatch[1] && item.userId === user.id);
      if (!client) {
        sendError(res, 404, 'Client not found');
        return;
      }

      if (req.method === 'PUT') {
        const updated = normalizeClient(await parseJson(req), client);
        updated.userId = user.id;
        const validationError = validateClient(updated);
        if (validationError) {
          sendError(res, 400, validationError);
          return;
        }
        Object.assign(client, updated);
        await writeDb(db);
        sendJson(res, 200, { client });
        return;
      }

      if (req.method === 'DELETE') {
        db.clients = db.clients.filter(item => item.id !== client.id);
        await writeDb(db);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET') {
        sendJson(res, 200, { client });
        return;
      }
    }

    if (url.pathname === '/api/recommendations' && req.method === 'GET') {
      const db = await readDb();
      sendJson(res, 200, {
        recommendations: db.recommendations.filter(item => item.userId === user.id)
      });
      return;
    }

    const recommendationMatch = url.pathname.match(/^\/api\/recommendations\/([^/]+)$/);
    if (recommendationMatch && ['PATCH', 'DELETE'].includes(req.method)) {
      const db = await readDb();
      const recommendation = db.recommendations.find(item => item.id === recommendationMatch[1] && item.userId === user.id);
      if (!recommendation) {
        sendError(res, 404, 'Recommendation not found');
        return;
      }

      if (req.method === 'PATCH') {
        const body = await parseJson(req);
        if (typeof body.isFavorite === 'boolean') recommendation.isFavorite = body.isFavorite;
        if (body.status) recommendation.status = String(body.status);
        recommendation.updatedAt = new Date().toISOString();
        await writeDb(db);
        sendJson(res, 200, { recommendation });
        return;
      }

      if (req.method === 'DELETE') {
        db.recommendations = db.recommendations.filter(item => item.id !== recommendation.id);
        await writeDb(db);
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    if (url.pathname === '/api/recommendations' && req.method === 'DELETE') {
      const db = await readDb();
      db.recommendations = db.recommendations.filter(item => item.userId !== user.id);
      await writeDb(db);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/recommendations/analyze' && req.method === 'POST') {
      const formData = await parseJson(req);
      if (!formData.processArea || !formData.processDescription) {
        sendError(res, 400, 'Focus area and process description are required');
        return;
      }

      const results = await createAiRecommendations(formData);
      const recommendation = {
        id: id('rec'),
        userId: user.id,
        createdAt: new Date().toISOString(),
        clientId: formData.clientId || null,
        processArea: formData.processArea,
        description: formData.processDescription,
        currentTools: formData.currentTools || '',
        teamSize: formData.teamSize || '',
        urgency: formData.urgency || '',
        goals: Array.isArray(formData.goals) ? formData.goals : [],
        attachments: Array.isArray(formData.attachments) ? formData.attachments : [],
        results,
        status: 'not-started',
        isFavorite: false,
        impactScore: parseFloat(results.summary?.estimatedImpact || results.recommendations?.[0]?.impactScore || 0),
        priority: results.recommendations?.[0]?.priority || 'medium'
      };

      const db = await readDb();
      db.recommendations.push(recommendation);
      await writeDb(db);
      sendJson(res, 201, { recommendation, results });
      return;
    }

    sendError(res, 404, 'API route not found');
  } catch (error) {
    console.error(error);
    sendError(res, error.status || 500, error.message || 'Server error');
  }
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) {
    sendError(res, 403, 'Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      res.writeHead(302, { Location: `${pathname.replace(/\/$/, '')}/index.html` });
      res.end();
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length
    });
    res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    console.error(error);
    sendError(res, 500, 'Server error');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  await serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`AI DataFlow running at http://localhost:${PORT}`);
});

const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || 'local-development-change-me';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  send(res, status, { error: message });
}

async function getBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');

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
      try {
        resolve(raw ? JSON.parse(raw) : {});
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

function assertSupabaseEnv() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const error = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    error.status = 503;
    throw error;
  }
}

async function supabaseRequest(table, { method = 'GET', query = '', body } = {}) {
  assertSupabaseEnv();
  const separator = query ? (query.startsWith('?') ? '' : '?') : '';
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}${separator}${query}`, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.hint || 'Supabase request failed');
    error.status = response.status;
    throw error;
  }

  return payload;
}

function rowToUser(row) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    name: row.name,
    company: row.company,
    createdAt: row.created_at
  };
}

function rowToClient(row) {
  return {
    id: row.id,
    company_name: row.company_name,
    contact_name: row.contact_name,
    email: row.email,
    phone: row.phone || '',
    industry: row.industry,
    company_size: row.company_size || '',
    location: row.location || '',
    status: row.status,
    notes: row.notes || '',
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function rowToRecommendation(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clientId: row.client_id,
    processArea: row.process_area,
    description: row.description,
    currentTools: row.current_tools || '',
    teamSize: row.team_size || '',
    urgency: row.urgency || '',
    goals: row.goals || [],
    attachments: row.attachments || [],
    results: row.results,
    status: row.status,
    isFavorite: row.is_favorite,
    impactScore: Number(row.impact_score || 0),
    priority: row.priority
  };
}

function clientToRow(client, userId, existingId) {
  return {
    id: existingId || id('client'),
    user_id: userId,
    company_name: String(client.company_name || '').trim(),
    contact_name: String(client.contact_name || '').trim(),
    email: String(client.email || '').trim().toLowerCase(),
    phone: String(client.phone || '').trim(),
    industry: String(client.industry || '').trim(),
    company_size: String(client.company_size || '').trim(),
    location: String(client.location || '').trim(),
    status: String(client.status || 'active').trim(),
    notes: String(client.notes || '').trim(),
    updated_at: new Date().toISOString()
  };
}

function validateClient(row) {
  if (!row.company_name) return 'Company name is required';
  if (!row.contact_name) return 'Contact name is required';
  if (!row.email) return 'Email is required';
  if (!row.industry) return 'Industry is required';
  return null;
}

async function getUserById(userId) {
  const rows = await supabaseRequest('app_users', {
    query: `?id=eq.${encodeURIComponent(userId)}&select=*`
  });
  return rows[0] || null;
}

async function requireUser(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const userId = verifyToken(token);

  if (!userId) {
    sendError(res, 401, 'Authentication required');
    return null;
  }

  const user = await getUserById(userId);
  if (!user) {
    sendError(res, 401, 'Authentication required');
    return null;
  }

  return user;
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
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || OPENAI_MODEL,
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

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const body = await getBody(req);
      const firstName = String(body.firstName || '').trim();
      const lastName = String(body.lastName || '').trim();
      const company = String(body.company || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (!firstName || !lastName || !company || !email || password.length < 8) {
        sendError(res, 400, 'Please complete all required fields with a password of at least 8 characters');
        return;
      }

      const existing = await supabaseRequest('app_users', {
        query: `?email=eq.${encodeURIComponent(email)}&select=id`
      });
      if (existing.length > 0) {
        sendError(res, 409, 'An account with that email already exists');
        return;
      }

      const row = {
        id: id('user'),
        first_name: firstName,
        last_name: lastName,
        name: `${firstName} ${lastName}`,
        company,
        email,
        password_hash: hashPassword(password)
      };

      const [created] = await supabaseRequest('app_users', {
        method: 'POST',
        query: '?select=*',
        body: row
      });
      send(res, 201, { user: rowToUser(created), token: createToken(created.id) });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const body = await getBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const [user] = await supabaseRequest('app_users', {
        query: `?email=eq.${encodeURIComponent(email)}&select=*`
      });

      if (!user || !verifyPassword(password, user.password_hash)) {
        sendError(res, 401, 'Invalid email or password');
        return;
      }

      send(res, 200, { user: rowToUser(user), token: createToken(user.id) });
      return;
    }

    const user = await requireUser(req, res);
    if (!user) return;

    if (req.method === 'GET' && pathname === '/api/me') {
      send(res, 200, { user: rowToUser(user) });
      return;
    }

    if (pathname === '/api/clients' && req.method === 'GET') {
      const rows = await supabaseRequest('clients', {
        query: `?user_id=eq.${encodeURIComponent(user.id)}&select=*&order=company_name.asc`
      });
      send(res, 200, { clients: rows.map(rowToClient) });
      return;
    }

    if (pathname === '/api/clients' && req.method === 'POST') {
      const row = clientToRow(await getBody(req), user.id);
      const validationError = validateClient(row);
      if (validationError) {
        sendError(res, 400, validationError);
        return;
      }
      const [created] = await supabaseRequest('clients', {
        method: 'POST',
        query: '?select=*',
        body: row
      });
      send(res, 201, { client: rowToClient(created) });
      return;
    }

    const clientMatch = pathname.match(/^\/api\/clients\/([^/]+)$/);
    if (clientMatch) {
      const clientId = decodeURIComponent(clientMatch[1]);
      const rows = await supabaseRequest('clients', {
        query: `?id=eq.${encodeURIComponent(clientId)}&user_id=eq.${encodeURIComponent(user.id)}&select=*`
      });
      const existing = rows[0];

      if (!existing) {
        sendError(res, 404, 'Client not found');
        return;
      }

      if (req.method === 'GET') {
        send(res, 200, { client: rowToClient(existing) });
        return;
      }

      if (req.method === 'PUT') {
        const row = clientToRow(await getBody(req), user.id, existing.id);
        const validationError = validateClient(row);
        if (validationError) {
          sendError(res, 400, validationError);
          return;
        }
        const [updated] = await supabaseRequest('clients', {
          method: 'PATCH',
          query: `?id=eq.${encodeURIComponent(existing.id)}&user_id=eq.${encodeURIComponent(user.id)}&select=*`,
          body: row
        });
        send(res, 200, { client: rowToClient(updated) });
        return;
      }

      if (req.method === 'DELETE') {
        await supabaseRequest('clients', {
          method: 'DELETE',
          query: `?id=eq.${encodeURIComponent(existing.id)}&user_id=eq.${encodeURIComponent(user.id)}`
        });
        send(res, 200, { ok: true });
        return;
      }
    }

    if (pathname === '/api/recommendations' && req.method === 'GET') {
      const rows = await supabaseRequest('recommendations', {
        query: `?user_id=eq.${encodeURIComponent(user.id)}&select=*&order=created_at.desc`
      });
      send(res, 200, { recommendations: rows.map(rowToRecommendation) });
      return;
    }

    if (pathname === '/api/recommendations' && req.method === 'DELETE') {
      await supabaseRequest('recommendations', {
        method: 'DELETE',
        query: `?user_id=eq.${encodeURIComponent(user.id)}`
      });
      send(res, 200, { ok: true });
      return;
    }

    const recommendationMatch = pathname.match(/^\/api\/recommendations\/([^/]+)$/);
    if (recommendationMatch && ['PATCH', 'DELETE'].includes(req.method)) {
      const recommendationId = decodeURIComponent(recommendationMatch[1]);
      const rows = await supabaseRequest('recommendations', {
        query: `?id=eq.${encodeURIComponent(recommendationId)}&user_id=eq.${encodeURIComponent(user.id)}&select=*`
      });
      const existing = rows[0];

      if (!existing) {
        sendError(res, 404, 'Recommendation not found');
        return;
      }

      if (req.method === 'PATCH') {
        const body = await getBody(req);
        const patch = { updated_at: new Date().toISOString() };
        if (typeof body.isFavorite === 'boolean') patch.is_favorite = body.isFavorite;
        if (body.status) patch.status = String(body.status);

        const [updated] = await supabaseRequest('recommendations', {
          method: 'PATCH',
          query: `?id=eq.${encodeURIComponent(existing.id)}&user_id=eq.${encodeURIComponent(user.id)}&select=*`,
          body: patch
        });
        send(res, 200, { recommendation: rowToRecommendation(updated) });
        return;
      }

      await supabaseRequest('recommendations', {
        method: 'DELETE',
        query: `?id=eq.${encodeURIComponent(existing.id)}&user_id=eq.${encodeURIComponent(user.id)}`
      });
      send(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/recommendations/analyze' && req.method === 'POST') {
      const formData = await getBody(req);
      if (!formData.processArea || !formData.processDescription) {
        sendError(res, 400, 'Focus area and process description are required');
        return;
      }

      const results = await createAiRecommendations(formData);
      const row = {
        id: id('rec'),
        user_id: user.id,
        client_id: formData.clientId || null,
        process_area: formData.processArea,
        description: formData.processDescription,
        current_tools: formData.currentTools || '',
        team_size: formData.teamSize || '',
        urgency: formData.urgency || '',
        goals: Array.isArray(formData.goals) ? formData.goals : [],
        attachments: Array.isArray(formData.attachments) ? formData.attachments : [],
        results,
        status: 'not-started',
        is_favorite: false,
        impact_score: parseFloat(results.summary?.estimatedImpact || results.recommendations?.[0]?.impactScore || 0),
        priority: results.recommendations?.[0]?.priority || 'medium'
      };

      const [created] = await supabaseRequest('recommendations', {
        method: 'POST',
        query: '?select=*',
        body: row
      });
      send(res, 201, { recommendation: rowToRecommendation(created), results });
      return;
    }

    sendError(res, 404, 'API route not found');
  } catch (error) {
    console.error(error);
    sendError(res, error.status || 500, error.message || 'Server error');
  }
};

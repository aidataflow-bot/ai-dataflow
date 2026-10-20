const crypto = require('crypto');

const SESSION_SECRET = process.env.SESSION_SECRET || 'local-development-change-me';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const ANTHROPIC_MODEL = 'claude-sonnet-5-5';
const AI_TIMEOUT_MS = 100000;

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

function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
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

// A login token is tied to the password it was issued under. Changing or resetting a password
// therefore signs that person out everywhere else, with no extra database column.
function passwordStamp(passwordHash) {
  return sign(`pw:${String(passwordHash || '')}`).slice(0, 22);
}

function createToken(userId, passwordHash) {
  const payload = base64Url(JSON.stringify({
    sub: userId,
    pw: passwordStamp(passwordHash),
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7
  }));
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!safeEqual(signature, sign(payload))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.sub || Date.now() > parsed.exp) return null;
    return { userId: parsed.sub, stamp: String(parsed.pw || '') };
  } catch {
    return null;
  }
}

// Temporary passwords avoid look-alike characters (0/O, 1/I) so they survive being read aloud
// or typed from a message. 12 characters from a 32-letter alphabet is 60 bits of randomness;
// 256 is divisible by 32, so mapping random bytes onto the alphabet has no bias.
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateTemporaryPassword() {
  const chars = Array.from(crypto.randomBytes(12), byte => TEMP_PASSWORD_ALPHABET[byte % 32]);
  return [0, 4, 8].map(start => chars.slice(start, start + 4).join('')).join('-');
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

const ROLES = ['admin', 'consultant', 'sales'];
const STAGES = ['lead', 'appointment-set', 'discovery', 'analysis', 'proposal-sent', 'won', 'lost'];
const STAGE_LABELS = {
  'lead': 'Lead',
  'appointment-set': 'Appointment set',
  'discovery': 'Discovery',
  'analysis': 'Analysis',
  'proposal-sent': 'Proposal sent',
  'won': 'Won',
  'lost': 'Lost'
};

// A missing or unknown role (for example before the SQL migration has run) is treated as
// the least-privileged role, never as an admin.
function roleOf(row) {
  return ROLES.includes(row && row.role) ? row.role : 'sales';
}

// Admins and consultants run and manage analyses; sales can read them but not change them.
function isConsultant(row) {
  const role = roleOf(row);
  return role === 'admin' || role === 'consultant';
}

function rowToUser(row) {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    name: row.name,
    company: row.company,
    role: roleOf(row),
    active: row.active !== false,
    createdAt: row.created_at
  };
}

async function loadStaff() {
  const rows = await supabaseRequest('app_users', { query: '?select=*' });
  return new Map(rows.map(row => [row.id, {
    id: row.id,
    name: row.name,
    email: row.email,
    role: roleOf(row),
    active: row.active !== false,
    createdAt: row.created_at
  }]));
}

function rowToClient(row, staff) {
  const nameOf = userId => (userId && staff && staff.get(userId) ? staff.get(userId).name : '');
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
    stage: STAGES.includes(row.stage) ? row.stage : 'lead',
    assigned_to: row.assigned_to || '',
    assigned_to_name: nameOf(row.assigned_to),
    appointment_at: row.appointment_at || null,
    appointment_notes: row.appointment_notes || '',
    created_by: row.user_id,
    created_by_name: nameOf(row.user_id),
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

// Customer-information fields only. Workflow fields (stage, assignment, appointment) go through
// applyWorkflow so every change is logged, and ownership (user_id) is never overwritten by an edit.
function clientInfoFromBody(client) {
  return {
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

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const WORKFLOW_KEYS = ['stage', 'assignedTo', 'appointmentAt', 'appointmentNotes'];

function hasWorkflowFields(body) {
  return WORKFLOW_KEYS.some(key => Object.prototype.hasOwnProperty.call(body, key));
}

// Validates stage / assignment / appointment changes and returns the database patch plus
// the human-readable timeline events. Dates in event text use {{date:ISO}} so each viewer
// sees them in their own time zone.
function applyWorkflow(existing, body, staff) {
  const patch = {};
  const events = [];
  const has = key => Object.prototype.hasOwnProperty.call(body, key);

  if (has('stage')) {
    const stage = String(body.stage || '');
    if (!STAGES.includes(stage)) throw httpError(400, 'Unknown pipeline stage');
    const current = STAGES.includes(existing.stage) ? existing.stage : 'lead';
    if (stage !== current) {
      patch.stage = stage;
      events.push(`Stage changed from ${STAGE_LABELS[current]} to ${STAGE_LABELS[stage]}`);
    }
  }

  if (has('assignedTo')) {
    const target = String(body.assignedTo || '');
    if (!target) {
      if (existing.assigned_to) {
        patch.assigned_to = null;
        events.push('Unassigned');
      }
    } else {
      const person = staff.get(target);
      if (!person || !person.active || person.role === 'sales') {
        throw httpError(400, 'Clients can only be assigned to an active consultant or admin');
      }
      if (target !== existing.assigned_to) {
        patch.assigned_to = target;
        events.push(`Assigned to ${person.name}`);
      }
    }
  }

  if (has('appointmentAt')) {
    const raw = body.appointmentAt;
    if (!raw) {
      if (existing.appointment_at) {
        patch.appointment_at = null;
        events.push('Appointment cleared');
      }
    } else {
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) throw httpError(400, 'The appointment date is not valid');
      const iso = date.toISOString();
      const before = existing.appointment_at ? new Date(existing.appointment_at).toISOString() : null;
      if (iso !== before) {
        patch.appointment_at = iso;
        events.push(`Appointment set for {{date:${iso}}}`);
      }
    }
  }

  if (has('appointmentNotes')) {
    const notes = clip(body.appointmentNotes, 1000);
    if (notes !== (existing.appointment_notes || '')) {
      patch.appointment_notes = notes;
      if (!events.some(text => text.startsWith('Appointment'))) events.push('Appointment notes updated');
    }
  }

  return { patch, events };
}

async function logClientEvents(clientId, authorId, kind, texts) {
  for (const text of texts) {
    await supabaseRequest('client_notes', {
      method: 'POST',
      query: '?select=*',
      body: { id: id('note'), client_id: clientId, author_id: authorId, kind, body: text }
    });
  }
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
  const session = verifyToken(token);

  if (!session) {
    sendError(res, 401, 'Authentication required');
    return null;
  }

  const user = await getUserById(session.userId);
  if (!user) {
    sendError(res, 401, 'Authentication required');
    return null;
  }

  // The token must match the account's current password (see passwordStamp).
  if (!safeEqual(session.stamp, passwordStamp(user.password_hash))) {
    sendError(res, 401, 'Your session has ended. Please sign in again.');
    return null;
  }

  if (user.active === false) {
    sendError(res, 401, 'This account has been deactivated. Ask your agency admin.');
    return null;
  }

  return user;
}

const ANALYSIS_SYSTEM_PROMPT = [
  'You are a senior process-improvement and AI automation consultant at an AI data agency.',
  'You write recommendations that a client executive can act on: specific, practical, and honest about uncertainty.',
  'Base every recommendation on the information provided. Do not invent facts, statistics, or tools the client did not mention.',
  'Cost and ROI figures are planning estimates; state them as ranges.',
  'Respond with a single JSON object and nothing else: no markdown, no code fences, no commentary.'
].join(' ');

function clip(value, max) {
  return String(value || '').trim().slice(0, max);
}

function buildAnalysisPrompt(formData, client) {
  const lines = [
    'Create 3 to 5 prioritized process-optimization recommendations, most important first.',
    'Keep each description to 2-3 sentences and give at most 4 concrete actions per recommendation.',
    'challengeSummary restates the process description for the client report in 1 to 3 sentences of clear, grammatically correct business English, in the third person about the client company (use "the client" if no company is given). Keep the original meaning and intent but do not copy the wording. The description was typed quickly, so fix grammar, missing words and slips; when a phrase contradicts the rest of the text or looks like a missing word (for example "why listings are moving" in a text about a sales problem), choose the most plausible business meaning. Do not add facts, numbers or tools that were not provided, and never mention that it was rewritten.',
    'executiveSummary is the opening paragraph of a report the client\'s owner will read: 3 to 4 sentences, professional and neutral. Name the company when one is given, restate the challenge in plain business language (never "he", "she" or shorthand copied from the notes), state the most important finding, and say which recommendation to act on first.',
    'Return JSON in exactly this shape:',
    '{"summary":{"executiveSummary":"string","challengeSummary":"string","totalRecommendations":number,"estimatedImpact":"average impact score as a string, 1-10","implementationTime":"string","confidenceScore":number from 1-10 reflecting how well the provided information supports the advice},"recommendations":[{"title":"string","description":"string","priority":"high|medium|low","impactScore":number from 1-10,"actions":["string"],"timeline":"string","estimatedCost":"string","expectedRoi":"string"}]}',
    ''
  ];

  if (client) {
    lines.push(
      `Client company: ${clip(client.company_name, 200)}`,
      `Client industry: ${clip(client.industry, 100)}`,
      `Client size: ${clip(client.company_size, 100) || 'Not provided'}`,
      `Client location: ${clip(client.location, 200) || 'Not provided'}`,
      `Client notes (internal background only; never quote, paraphrase or hint at them in any text): ${clip(client.notes, 600) || 'None'}`,
      ''
    );
  }

  lines.push(
    `Focus area: ${clip(formData.processArea, 100)}`,
    `Process description: ${clip(formData.processDescription, 8000)}`,
    `Current tools: ${clip(formData.currentTools, 500) || 'Not provided'}`,
    `Team size: ${clip(formData.teamSize, 100) || 'Not provided'}`,
    `Timeline: ${clip(formData.urgency, 100) || 'Not provided'}`,
    `Goals: ${(Array.isArray(formData.goals) ? formData.goals : []).map(goal => clip(goal, 100)).join(', ') || 'Not provided'}`,
    `Attached file names (contents were not provided): ${(Array.isArray(formData.attachments) ? formData.attachments : []).map(file => clip(file && file.name, 200)).join(', ') || 'None'}`
  );

  return lines.join('\n');
}

function aiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function extractJsonObject(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw aiError(502, 'The AI returned an unreadable response. Please try again.');
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw aiError(502, 'The AI returned an unreadable response. Please try again.');
  }
}

function normalizeResults(raw) {
  const list = Array.isArray(raw && raw.recommendations) ? raw.recommendations : [];
  if (list.length === 0) {
    throw aiError(502, 'The AI returned no recommendations. Please try again.');
  }

  const recommendations = list.slice(0, 8).map(item => {
    const impact = Number(item && item.impactScore);
    const priority = String((item && item.priority) || '').toLowerCase();
    return {
      title: String((item && item.title) || 'Untitled recommendation'),
      description: String((item && item.description) || ''),
      priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
      impactScore: Number.isFinite(impact) ? Math.min(10, Math.max(0, impact)) : 5,
      actions: (Array.isArray(item && item.actions) ? item.actions : []).map(String),
      timeline: String((item && item.timeline) || 'To be determined'),
      estimatedCost: String((item && item.estimatedCost) || 'To be determined'),
      expectedRoi: String((item && item.expectedRoi) || 'To be determined')
    };
  });

  const average = recommendations.reduce((sum, rec) => sum + rec.impactScore, 0) / recommendations.length;
  const confidence = Number(raw.summary && raw.summary.confidenceScore);

  return {
    summary: {
      executiveSummary: String((raw.summary && raw.summary.executiveSummary) || raw.executiveSummary || '').trim().slice(0, 1500),
      challengeSummary: String((raw.summary && raw.summary.challengeSummary) || raw.challengeSummary || '').trim().slice(0, 1200),
      totalRecommendations: recommendations.length,
      estimatedImpact: average.toFixed(1),
      implementationTime: String((raw.summary && raw.summary.implementationTime) || ''),
      confidenceScore: Number.isFinite(confidence) ? Math.min(10, Math.max(0, confidence)) : 7
    },
    recommendations
  };
}

async function callAnthropic(formData, client) {
  const model = process.env.ANTHROPIC_MODEL || ANTHROPIC_MODEL;
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        system: ANALYSIS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildAnalysisPrompt(formData, client) }]
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS)
    });
  } catch (error) {
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw aiError(504, 'The AI took too long to respond. Please try again.');
    }
    throw error;
  }

  if (!response.ok) {
    const detail = await response.text();
    console.error('Anthropic request failed', response.status, detail);
    if (response.status === 401 || response.status === 403) {
      throw aiError(503, 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel.');
    }
    if (response.status === 402 || /credit balance/i.test(detail)) {
      throw aiError(503, 'The Anthropic account has no credits. Add billing at console.anthropic.com.');
    }
    if (response.status === 429 || response.status === 529) {
      throw aiError(503, 'The AI is busy right now. Please try again in a minute.');
    }
    throw aiError(502, 'The AI request failed. Please try again.');
  }

  const data = await response.json();
  const text = (data.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  return { raw: extractJsonObject(text), provider: 'anthropic', model: data.model || model };
}

async function callOpenAi(formData, client) {
  const model = process.env.OPENAI_MODEL || OPENAI_MODEL;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: `${ANALYSIS_SYSTEM_PROMPT}\n\n${buildAnalysisPrompt(formData, client)}`,
      text: {
        format: {
          type: 'json_object'
        }
      }
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS)
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('OpenAI request failed', response.status, detail);
    throw aiError(502, 'The AI request failed. Please try again.');
  }

  const data = await response.json();
  const outputText = data.output_text || data.output?.flatMap(item => item.content || [])
    .find(item => item.type === 'output_text')?.text;

  return { raw: extractJsonObject(outputText), provider: 'openai', model: data.model || model };
}

async function createAiRecommendations(formData, client = null) {
  let generated;

  if (process.env.ANTHROPIC_API_KEY) {
    generated = await callAnthropic(formData, client);
  } else if (process.env.OPENAI_API_KEY) {
    generated = await callOpenAi(formData, client);
  } else {
    throw aiError(503, 'AI is not configured. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY) in Vercel.');
  }

  return {
    ...normalizeResults(generated.raw),
    meta: {
      provider: generated.provider,
      model: generated.model,
      generatedAt: new Date().toISOString()
    }
  };
}

async function getClientById(clientId) {
  const rows = await supabaseRequest('clients', {
    query: `?id=eq.${encodeURIComponent(clientId)}&select=*`
  });
  return rows[0] || null;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  const rewrittenPath = url.searchParams.get('path');
  const pathname = rewrittenPath ? `/api/${rewrittenPath}` : url.pathname;

  try {
    if (req.method === 'POST' && pathname === '/api/auth/register') {
      const body = await getBody(req);

      // Agency staff only: sign-up needs the shared invite code from AGENCY_INVITE_CODE.
      // With no code configured, registration stays closed (fail closed). The code is
      // checked before anything else so strangers learn nothing about existing accounts.
      const expectedInvite = String(process.env.AGENCY_INVITE_CODE || '').trim();
      if (!expectedInvite) {
        sendError(res, 403, 'Sign-up is closed. Ask your agency admin for access.');
        return;
      }
      if (!safeEqual(String(body.inviteCode || '').trim(), expectedInvite)) {
        sendError(res, 403, 'That invite code is not valid. Ask your agency admin for the current code.');
        return;
      }
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

      // New accounts start with the least-privileged role (database default: sales);
      // an admin promotes them from the Team page.
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
      send(res, 201, { user: rowToUser(created), token: createToken(created.id, row.password_hash) });
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

      if (user.active === false) {
        sendError(res, 403, 'This account has been deactivated. Ask your agency admin.');
        return;
      }

      send(res, 200, { user: rowToUser(user), token: createToken(user.id, user.password_hash) });
      return;
    }

    const user = await requireUser(req, res);
    if (!user) return;

    if (req.method === 'GET' && pathname === '/api/me') {
      send(res, 200, { user: rowToUser(user) });
      return;
    }

    // Change your own password. Wrong-current-password is a 400, not a 401, because a 401
    // makes the browser sign you out. Every other session is ended; this one gets a new token.
    if (req.method === 'POST' && pathname === '/api/me/password') {
      const body = await getBody(req);
      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');

      if (!verifyPassword(currentPassword, user.password_hash)) {
        sendError(res, 400, 'Your current password is not correct');
        return;
      }
      if (newPassword.length < 8) {
        sendError(res, 400, 'The new password must be at least 8 characters');
        return;
      }
      if (newPassword.length > 200) {
        sendError(res, 400, 'The new password is too long');
        return;
      }
      if (safeEqual(newPassword, currentPassword)) {
        sendError(res, 400, 'The new password must be different from the current one');
        return;
      }

      const passwordHash = hashPassword(newPassword);
      await supabaseRequest('app_users', {
        method: 'PATCH',
        query: `?id=eq.${encodeURIComponent(user.id)}`,
        body: { password_hash: passwordHash }
      });
      send(res, 200, { ok: true, token: createToken(user.id, passwordHash) });
      return;
    }

    // Admin: set a one-time temporary password for a teammate who is locked out. The app sends
    // no email, so the admin passes it on personally. The password is returned once, never stored
    // in readable form, and the person is signed out everywhere.
    const resetMatch = pathname.match(/^\/api\/team\/([^/]+)\/reset-password$/);
    if (resetMatch && req.method === 'POST') {
      if (roleOf(user) !== 'admin') {
        sendError(res, 403, 'Only an admin can reset a password');
        return;
      }
      const memberId = decodeURIComponent(resetMatch[1]);
      if (memberId === user.id) {
        sendError(res, 400, 'Use Change password on your Account page for your own password');
        return;
      }
      const staff = await loadStaff();
      const target = staff.get(memberId);
      if (!target) {
        sendError(res, 404, 'Team member not found');
        return;
      }

      const temporaryPassword = generateTemporaryPassword();
      await supabaseRequest('app_users', {
        method: 'PATCH',
        query: `?id=eq.${encodeURIComponent(memberId)}`,
        body: { password_hash: hashPassword(temporaryPassword) }
      });
      res.setHeader('Cache-Control', 'no-store');
      send(res, 200, { temporaryPassword, member: { id: target.id, name: target.name, email: target.email } });
      return;
    }

    // ----- Team (agency staff) -----
    if (pathname === '/api/team' && req.method === 'GET') {
      const staff = await loadStaff();
      const isAdmin = roleOf(user) === 'admin';
      const members = [...staff.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(member => ({
          id: member.id,
          name: member.name,
          role: member.role,
          active: member.active,
          ...(isAdmin ? { email: member.email, createdAt: member.createdAt } : {})
        }));
      send(res, 200, { team: members });
      return;
    }

    const teamMatch = pathname.match(/^\/api\/team\/([^/]+)$/);
    if (teamMatch && req.method === 'PATCH') {
      if (roleOf(user) !== 'admin') {
        sendError(res, 403, 'Only an admin can manage the team');
        return;
      }
      const memberId = decodeURIComponent(teamMatch[1]);
      const body = await getBody(req);
      const staff = await loadStaff();
      const target = staff.get(memberId);
      if (!target) {
        sendError(res, 404, 'Team member not found');
        return;
      }

      const patch = {};
      if (Object.prototype.hasOwnProperty.call(body, 'role')) {
        if (!ROLES.includes(body.role)) {
          sendError(res, 400, 'Role must be admin, consultant or sales');
          return;
        }
        patch.role = body.role;
      }
      if (typeof body.active === 'boolean') patch.active = body.active;
      if (Object.keys(patch).length === 0) {
        sendError(res, 400, 'Nothing to change');
        return;
      }

      const nextRole = patch.role || target.role;
      const nextActive = patch.active === undefined ? target.active : patch.active;
      const activeAdmins = [...staff.values()].filter(member => member.role === 'admin' && member.active);
      const losesAdmin = target.role === 'admin' && target.active && (nextRole !== 'admin' || !nextActive);
      if (losesAdmin && activeAdmins.length <= 1) {
        sendError(res, 400, 'There must be at least one active admin');
        return;
      }

      await supabaseRequest('app_users', {
        method: 'PATCH',
        query: `?id=eq.${encodeURIComponent(memberId)}`,
        body: patch
      });
      const refreshed = await loadStaff();
      const member = refreshed.get(memberId);
      send(res, 200, { member: { id: member.id, name: member.name, email: member.email, role: member.role, active: member.active } });
      return;
    }

    // ----- Clients (shared across the agency) -----
    if (pathname === '/api/clients' && req.method === 'GET') {
      const [rows, staff] = await Promise.all([
        supabaseRequest('clients', { query: '?select=*&order=company_name.asc' }),
        loadStaff()
      ]);
      send(res, 200, { clients: rows.map(row => rowToClient(row, staff)) });
      return;
    }

    if (pathname === '/api/clients' && req.method === 'POST') {
      const body = await getBody(req);
      const row = { id: id('client'), user_id: user.id, stage: 'lead', ...clientInfoFromBody(body) };
      const validationError = validateClient(row);
      if (validationError) {
        sendError(res, 400, validationError);
        return;
      }

      const staff = await loadStaff();
      let workflow = { patch: {}, events: [] };
      if (hasWorkflowFields(body)) {
        workflow = applyWorkflow({ stage: 'lead' }, body, staff);
      }

      const [created] = await supabaseRequest('clients', {
        method: 'POST',
        query: '?select=*',
        body: { ...row, ...workflow.patch }
      });
      await logClientEvents(created.id, user.id, 'event', ['Client created', ...workflow.events]);
      send(res, 201, { client: rowToClient(created, staff) });
      return;
    }

    const clientMatch = pathname.match(/^\/api\/clients\/([^/]+)(?:\/(workflow|notes))?$/);
    if (clientMatch) {
      const clientId = decodeURIComponent(clientMatch[1]);
      const sub = clientMatch[2] || '';
      const existing = await getClientById(clientId);

      if (!existing) {
        sendError(res, 404, 'Client not found');
        return;
      }

      if (sub === 'workflow' && req.method === 'PATCH') {
        const staff = await loadStaff();
        const { patch, events } = applyWorkflow(existing, await getBody(req), staff);
        let saved = existing;
        if (Object.keys(patch).length > 0) {
          [saved] = await supabaseRequest('clients', {
            method: 'PATCH',
            query: `?id=eq.${encodeURIComponent(existing.id)}&select=*`,
            body: { ...patch, updated_at: new Date().toISOString() }
          });
          await logClientEvents(existing.id, user.id, 'event', events);
        }
        send(res, 200, { client: rowToClient(saved, staff) });
        return;
      }

      if (sub === 'notes') {
        if (req.method === 'GET') {
          const [rows, staff] = await Promise.all([
            supabaseRequest('client_notes', {
              query: `?client_id=eq.${encodeURIComponent(existing.id)}&select=*&order=created_at.desc&limit=300`
            }),
            loadStaff()
          ]);
          send(res, 200, {
            notes: rows.map(note => ({
              id: note.id,
              kind: note.kind,
              body: note.body,
              createdAt: note.created_at,
              authorId: note.author_id,
              authorName: staff.get(note.author_id) ? staff.get(note.author_id).name : 'Former team member'
            }))
          });
          return;
        }
        if (req.method === 'POST') {
          const text = clip((await getBody(req)).body, 2000);
          if (!text) {
            sendError(res, 400, 'Write a note first');
            return;
          }
          const [created] = await supabaseRequest('client_notes', {
            method: 'POST',
            query: '?select=*',
            body: { id: id('note'), client_id: existing.id, author_id: user.id, kind: 'note', body: text }
          });
          send(res, 201, {
            note: { id: created.id, kind: created.kind, body: created.body, createdAt: created.created_at, authorId: user.id, authorName: user.name }
          });
          return;
        }
      }

      if (!sub && req.method === 'GET') {
        send(res, 200, { client: rowToClient(existing, await loadStaff()) });
        return;
      }

      if (!sub && req.method === 'PUT') {
        const patch = clientInfoFromBody(await getBody(req));
        const validationError = validateClient(patch);
        if (validationError) {
          sendError(res, 400, validationError);
          return;
        }
        const [updated] = await supabaseRequest('clients', {
          method: 'PATCH',
          query: `?id=eq.${encodeURIComponent(existing.id)}&select=*`,
          body: patch
        });
        send(res, 200, { client: rowToClient(updated, await loadStaff()) });
        return;
      }

      if (!sub && req.method === 'DELETE') {
        if (!isConsultant(user)) {
          sendError(res, 403, 'Only a consultant or admin can delete clients');
          return;
        }
        await supabaseRequest('clients', {
          method: 'DELETE',
          query: `?id=eq.${encodeURIComponent(existing.id)}`
        });
        send(res, 200, { ok: true });
        return;
      }
    }

    // ----- Analyses (everyone can read; consultants and admins change them) -----
    if (pathname === '/api/recommendations' && req.method === 'GET') {
      const rows = await supabaseRequest('recommendations', {
        query: '?select=*&order=created_at.desc'
      });
      send(res, 200, { recommendations: rows.map(rowToRecommendation) });
      return;
    }

    if (pathname === '/api/recommendations' && req.method === 'DELETE') {
      if (roleOf(user) !== 'admin') {
        sendError(res, 403, 'Only an admin can clear the whole analysis history');
        return;
      }
      await supabaseRequest('recommendations', {
        method: 'DELETE',
        query: '?id=not.is.null'
      });
      send(res, 200, { ok: true });
      return;
    }

    const recommendationMatch = pathname.match(/^\/api\/recommendations\/([^/]+)$/);
    if (recommendationMatch && ['PATCH', 'DELETE'].includes(req.method)) {
      if (!isConsultant(user)) {
        sendError(res, 403, 'Your role can view analyses but not change them');
        return;
      }
      const recommendationId = decodeURIComponent(recommendationMatch[1]);
      const rows = await supabaseRequest('recommendations', {
        query: `?id=eq.${encodeURIComponent(recommendationId)}&select=*`
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

        if (Object.prototype.hasOwnProperty.call(body, 'clientId')) {
          if (!body.clientId) {
            patch.client_id = null;
          } else {
            const linkedClient = await getClientById(String(body.clientId));
            if (!linkedClient) {
              sendError(res, 404, 'Client not found');
              return;
            }
            patch.client_id = linkedClient.id;
          }
        }

        const [updated] = await supabaseRequest('recommendations', {
          method: 'PATCH',
          query: `?id=eq.${encodeURIComponent(existing.id)}&select=*`,
          body: patch
        });
        send(res, 200, { recommendation: rowToRecommendation(updated) });
        return;
      }

      await supabaseRequest('recommendations', {
        method: 'DELETE',
        query: `?id=eq.${encodeURIComponent(existing.id)}`
      });
      send(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/recommendations/analyze' && req.method === 'POST') {
      if (!isConsultant(user)) {
        sendError(res, 403, 'Only a consultant or admin can run analyses');
        return;
      }
      const formData = await getBody(req);
      if (!formData.processArea || !formData.processDescription) {
        sendError(res, 400, 'Focus area and process description are required');
        return;
      }

      let client = null;
      if (formData.clientId) {
        client = await getClientById(String(formData.clientId));
        if (!client) {
          sendError(res, 400, 'The selected client was not found. Refresh the page and try again.');
          return;
        }
      }

      const results = await createAiRecommendations(formData, client);
      const row = {
        id: id('rec'),
        user_id: user.id,
        client_id: client ? client.id : null,
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

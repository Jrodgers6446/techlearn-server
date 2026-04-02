process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err.message);
  console.error(err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
  process.exit(1);
});

const express    = require('express');
const cors       = require('cors');
const { Pool }   = require('pg');
const crypto     = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

const API_KEY    = process.env.API_KEY    || 'changeme';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';

// ── DATABASE ──────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS results (
      id           SERIAL PRIMARY KEY,
      username     TEXT        NOT NULL,
      full_name    TEXT        NOT NULL,
      module_id    INTEGER     NOT NULL,
      module_title TEXT        NOT NULL,
      score        INTEGER     NOT NULL,
      passed       BOOLEAN     NOT NULL,
      attempt      INTEGER     NOT NULL DEFAULT 1,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS training_html (
      id         SERIAL PRIMARY KEY,
      content    TEXT        NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_html (
      id         SERIAL PRIMARY KEY,
      content    TEXT        NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_data (
      id         SERIAL PRIMARY KEY,
      key        TEXT        NOT NULL UNIQUE,
      value      TEXT        NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id         SERIAL PRIMARY KEY,
      type       TEXT        NOT NULL,
      username   TEXT        NOT NULL,
      full_name  TEXT        NOT NULL,
      message    TEXT        NOT NULL,
      status     TEXT        NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS changelog (
      id         SERIAL PRIMARY KEY,
      version    TEXT        NOT NULL,
      title      TEXT        NOT NULL,
      body       TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Insert placeholder training page if empty
  const tc = await pool.query('SELECT COUNT(*) as cnt FROM training_html');
  if (parseInt(tc.rows[0].cnt) === 0) {
    await pool.query("INSERT INTO training_html (content) VALUES ($1)", [
      '<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0d0e14;color:#e8e9f0"><div style="text-align:center"><h1>TechLearn</h1><p style="color:#7c7d8a;margin-top:1rem">No training file deployed yet.</p></div></body></html>'
    ]);
  }
  console.log('Database ready');
}

// ── SIMPLE SESSION STORE ──────────────────────────────────────────────────────
const sessions = new Map();

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { created: Date.now() });
  return token;
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  // Expire sessions after 8 hours
  const session = sessions.get(token);
  if (Date.now() - session.created > 8 * 60 * 60 * 1000) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Session expired' });
  }
  next();
}

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Admin-Token']
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

function requireKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireKeyOrAdmin(req, res, next) {
  const key   = req.headers['x-api-key'];
  const token = req.headers['x-admin-token'];
  if (key && key === API_KEY) return next();
  if (token && sessions.has(token)) {
    const session = sessions.get(token);
    if (Date.now() - session.created < 8 * 60 * 60 * 1000) return next();
    sessions.delete(token);
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

// ── ADMIN LOGIN ───────────────────────────────────────────────────────────────
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = createSession();
    res.json({ ok: true, token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

app.get('/admin/verify', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'Invalid token' });
  const session = sessions.get(token);
  if (Date.now() - session.created > 8 * 60 * 60 * 1000) {
    sessions.delete(token);
    return res.status(401).json({ error: 'Session expired' });
  }
  res.json({ ok: true });
});

// ── ADMIN DATA ───────────────────────────────────────────────────────────────

app.get('/admin/data', requireAdmin, async (req, res) => {
  try {
    const rows = await pool.query('SELECT key, value FROM admin_data');
    const result = {};
    rows.rows.forEach(r => { result[r.key] = JSON.parse(r.value); });
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/admin/data', requireKeyOrAdmin, async (req, res) => {
  const { key, value } = req.body;
  if (!key || value === undefined) return res.status(400).json({ error: 'Missing key or value' });
  try {
    await pool.query(
      `INSERT INTO admin_data (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    );
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN HTML ────────────────────────────────────────────────────────────────
app.get('/admin', async (req, res) => {
  try {
    const result = await pool.query('SELECT content FROM admin_html ORDER BY id DESC LIMIT 1');
    if (result.rows.length === 0) {
      return res.send(getAdminPlaceholder());
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.rows[0].content);
  } catch (e) {
    res.status(500).send('Error loading admin: ' + e.message);
  }
});

app.post('/admin/deploy', requireKeyOrAdmin, async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: 'No HTML provided' });
  try {
    await pool.query('DELETE FROM admin_html');
    await pool.query('INSERT INTO admin_html (content) VALUES ($1)', [html]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function getAdminPlaceholder() {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0d0e14;color:#e8e9f0"><div style="text-align:center"><h1>TechLearn Admin</h1><p style="color:#7c7d8a;margin-top:1rem">Admin panel not deployed yet.<br>Open your local training_admin.html and click Deploy Admin.</p></div></body></html>`;
}

// ── TRAINING HTML ─────────────────────────────────────────────────────────────
app.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT content FROM training_html ORDER BY id DESC LIMIT 1');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.rows[0].content);
  } catch (e) {
    res.status(500).send('Error loading training file');
  }
});

app.post('/deploy', requireKeyOrAdmin, async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: 'No HTML provided' });
  try {
    await pool.query('DELETE FROM training_html');
    await pool.query('INSERT INTO training_html (content) VALUES ($1)', [html]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── RESULTS ───────────────────────────────────────────────────────────────────
app.post('/result', requireKey, async (req, res) => {
  const { username, fullName, moduleId, moduleTitle, score, passed } = req.body;
  if (!username || fullName === undefined || moduleId === undefined || score === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const prev = await pool.query(
      'SELECT COUNT(*) as cnt FROM results WHERE username = $1 AND module_id = $2',
      [username, moduleId]
    );
    const attempt = parseInt(prev.rows[0].cnt) + 1;
    await pool.query(
      `INSERT INTO results (username, full_name, module_id, module_title, score, passed, attempt)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [username, fullName, moduleId, moduleTitle, score, !!passed, attempt]
    );
    res.json({ ok: true, attempt });
  } catch (e) {
    console.error('POST /result error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PROGRESS ──────────────────────────────────────────────────────────────────
app.get('/progress', requireKeyOrAdmin, async (req, res) => {
  try {
    const summary = await pool.query(`
      SELECT username, full_name,
             COUNT(DISTINCT module_id) AS modules_attempted,
             SUM(CASE WHEN passed = true THEN 1 ELSE 0 END) AS modules_passed,
             ROUND(AVG(score)::numeric, 1) AS avg_score,
             MAX(created_at) AS last_activity
      FROM results GROUP BY username, full_name ORDER BY last_activity DESC
    `);
    const best = await pool.query(`
      SELECT username, module_id, module_title,
             MAX(score) as best_score,
             SUM(CASE WHEN passed = true THEN 1 ELSE 0 END) as passed,
             COUNT(*) as attempts
      FROM results GROUP BY username, module_id, module_title ORDER BY username, module_id
    `);
    const attempts = await pool.query('SELECT * FROM results ORDER BY created_at DESC LIMIT 500');
    res.json({ summary: summary.rows, best: best.rows, attempts: attempts.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/progress/:username', requireKeyOrAdmin, async (req, res) => {
  try {
    const rows = await pool.query(
      'SELECT * FROM results WHERE username = $1 ORDER BY created_at DESC',
      [req.params.username]
    );
    res.json(rows.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/result/:id', requireKey, async (req, res) => {
  try {
    await pool.query('DELETE FROM results WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GEMINI GUIDEBOOK ─────────────────────────────────────────────────────────
app.post('/guidebook', requireKey, async (req, res) => {
  const { question, modules } = req.body;
  if (!question) return res.status(400).json({ error: 'No question provided' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

  const context = (modules || []).map(m => {
    const parts = [];
    if (m.content) parts.push(m.content.replace(/<[^>]*>/g, ''));
    if (m.questions) {
      m.questions.forEach(q => {
        parts.push('Q: ' + q.q);
        if (q.explanation) parts.push('A: ' + q.explanation);
      });
    }
    return '=== ' + m.title + ' ===\n' + parts.join('\n');
  }).join('\n\n');

  const prompt = 'You are a helpful training assistant for remote technicians. '
    + 'Answer questions based ONLY on the training material provided below. '
    + 'If the answer is not in the training material, say so clearly. Be concise and practical.\n\n'
    + 'TRAINING MATERIAL:\n' + context + '\n\n'
    + 'QUESTION: ' + question + '\n\nAnswer:';

  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, temperature: 0.3 }
      })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error((err.error && err.error.message) || 'Gemini API error ' + r.status);
    }
    const data = await r.json();
    const answer = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) || 'No response generated.';
    res.json({ answer });
  } catch(e) {
    console.error('Guidebook error:', e.message);
    res.status(500).json({ error: e.message });
  }
});
// ── CHANGELOG ────────────────────────────────────────────────────────────────
// ── LEGAL PAGE ───────────────────────────────────────────────────────────────
app.get('/legal', async (req, res) => {
  try {
    const r = await pool.query("SELECT value FROM admin_data WHERE key = 'legal_page'");
    if (!r.rows.length) return res.json({ content: '' });
    res.json({ content: JSON.parse(r.rows[0].value) });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/changelog', async (req, res) => {
  try {
    const rows = await pool.query('SELECT * FROM changelog ORDER BY created_at DESC');
    res.json(rows.rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/changelog', requireKeyOrAdmin, async (req, res) => {
  const { version, title, body } = req.body;
  if (!version || !title || !body) return res.status(400).json({ error: 'Missing fields' });
  try {
    await pool.query(
      'INSERT INTO changelog (version, title, body) VALUES ($1, $2, $3)',
      [version, title, body]
    );
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/changelog/:id', requireKeyOrAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM changelog WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── REQUESTS ─────────────────────────────────────────────────────────────────
app.get('/requests', requireKeyOrAdmin, async (req, res) => {
  try {
    const type = req.query.type;
    const query = type
      ? 'SELECT * FROM requests WHERE type = $1 ORDER BY created_at DESC'
      : 'SELECT * FROM requests ORDER BY created_at DESC';
    const params = type ? [type] : [];
    const rows = await pool.query(query, params);
    res.json(rows.rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/requests/:id', requireKeyOrAdmin, async (req, res) => {
  const { status } = req.body;
  try {
    await pool.query('UPDATE requests SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/requests/:id', requireKeyOrAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM requests WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/request-access', requireKey, async (req, res) => {
  const { username, fullName, message, type } = req.body;
  const reqType = type || 'access';
  if (!username || !message) return res.status(400).json({ error: 'Missing fields' });

  // Always save to database first
  try {
    await pool.query(
      'INSERT INTO requests (type, username, full_name, message) VALUES ($1, $2, $3, $4)',
      [reqType, username, fullName, message]
    );
  } catch(dbErr) {
    console.error('DB save error:', dbErr.message);
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_PASS;
  const notifyEmails = process.env.NOTIFY_EMAILS || gmailUser;

  if (!gmailUser || !gmailPass) {
    return res.json({ ok: true, note: 'Saved to inbox but email not configured' });
  }

  const typeLabels = { access: 'Access Request', tool: 'Tool Request', reschedule: 'Reschedule Request', bug: 'Bug Report' };
  const typeLabel = typeLabels[reqType] || reqType;
  const recipients = (notifyEmails || '').split(',').map(e => e.trim()).filter(Boolean);
  const safeMessage = message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const emailBody = [
    '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#0d0e14;color:#e8e9f0;border-radius:12px">',
    '<div style="background:linear-gradient(135deg,#8b5cf6,#22d3ee);padding:3px;border-radius:10px;margin-bottom:24px">',
    '<div style="background:#13141c;border-radius:8px;padding:20px">',
    '<h2 style="margin:0;font-size:20px">' + typeLabel + '</h2>',
    '<p style="margin:4px 0 0;color:#7c7d8a;font-size:13px">TechLearn Training Platform</p>',
    '</div></div>',
    '<p style="font-size:14px;color:#7c7d8a;margin-bottom:8px">From</p>',
    '<p style="font-size:16px;font-weight:600;margin:0 0 20px">' + fullName + ' <span style="color:#7c7d8a;font-weight:400;font-size:13px">(' + username + ')</span></p>',
    '<p style="font-size:14px;color:#7c7d8a;margin-bottom:8px">Message</p>',
    '<div style="background:#1a1b26;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:16px;font-size:14px;line-height:1.7;white-space:pre-wrap">' + safeMessage + '</div>',
    '<p style="font-size:11px;color:#7c7d8a;margin-top:24px;text-align:center">Sent via TechLearn &mdash; Lupaservices LLC</p>',
    '</div>'
  ].join('');

  // Respond immediately — send email in background so request never times out
  res.json({ ok: true });

  try {
    let nm;
    try { nm = require('nodemailer'); } catch(e) { console.warn('nodemailer not available:', e.message); return; }
    const transporter = nm.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });
    await transporter.sendMail({
      from: '"TechLearn" <' + gmailUser + '>',
      to: recipients.join(', '),
      subject: 'TechLearn ' + typeLabel + ' from ' + fullName,
      html: emailBody
    });
    console.log('Email sent for request from', fullName);
  } catch(e) {
    console.error('Email error:', e.message);
  }
});



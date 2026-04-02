const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');
const crypto  = require('crypto');

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

// ── START ─────────────────────────────────────────────────────────────────────
initDb().then(() => {
  app.listen(PORT, () => console.log(`TechLearn API running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to init database:', err.message);
  process.exit(1);
});

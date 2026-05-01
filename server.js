
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

// ── EMAIL HELPER (Resend) ─────────────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) { console.warn('RESEND_API_KEY not set'); return false; }
  const toArr = Array.isArray(to) ? to : [to];
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + resendKey },
      body: JSON.stringify({
        from: 'TechLearn <noreply@techlearn-lupa.com>',
        to: toArr,
        subject,
        html
      })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.message || 'Resend error ' + r.status);
    }
    console.log('Email sent to', toArr.join(', '));
    return true;
  } catch(e) {
    console.error('Email error:', e.message);
    return false;
  }
}
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
  // Add columns to account_requests if they don't exist (migration)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS managers (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      username    TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS preview_html (
      id SERIAL PRIMARY KEY,
      content TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS preview_html (
      id      SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id         SERIAL PRIMARY KEY,
      username   TEXT NOT NULL,
      token      TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_requests (
      id                SERIAL PRIMARY KEY,
      full_name         TEXT        NOT NULL DEFAULT '',
      store             TEXT        NOT NULL DEFAULT '',
      email             TEXT        NOT NULL DEFAULT '',
      requested_username TEXT       NOT NULL DEFAULT '',
      requested_password TEXT       NOT NULL DEFAULT '',
      status            TEXT        NOT NULL DEFAULT 'pending',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  // Add missing columns for existing tables
  const acctMigrations = [
    "ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS full_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS store TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS requested_username TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS requested_password TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE account_requests ALTER COLUMN username DROP NOT NULL",
    "ALTER TABLE account_requests ALTER COLUMN password DROP NOT NULL",
    "ALTER TABLE account_requests ALTER COLUMN message DROP NOT NULL",
    "ALTER TABLE account_requests ALTER COLUMN type DROP NOT NULL"
  ];
  for (const m of acctMigrations) {
    await pool.query(m).catch(() => {});
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS managers (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      username    TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS preview_html (
      id      SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_requests (
      id           SERIAL PRIMARY KEY,
      full_name    TEXT        NOT NULL,
      store        TEXT        NOT NULL,
      email        TEXT        NOT NULL,
      username     TEXT        NOT NULL,
      password     TEXT        NOT NULL,
      status       TEXT        NOT NULL DEFAULT 'pending',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Add columns to account_requests if they don't exist (migration)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS managers (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      username    TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS preview_html (
      id      SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_requests (
      id                SERIAL PRIMARY KEY,
      full_name         TEXT        NOT NULL DEFAULT '',
      store             TEXT        NOT NULL DEFAULT '',
      email             TEXT        NOT NULL DEFAULT '',
      requested_username TEXT       NOT NULL DEFAULT '',
      requested_password TEXT       NOT NULL DEFAULT '',
      status            TEXT        NOT NULL DEFAULT 'pending',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
  // Add missing columns for existing tables
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS managers (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      username    TEXT NOT NULL UNIQUE,
      password    TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS preview_html (
      id      SERIAL PRIMARY KEY,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_requests (
      id                SERIAL PRIMARY KEY,
      full_name         TEXT        NOT NULL,
      store             TEXT        NOT NULL,
      email             TEXT        NOT NULL,
      requested_username TEXT       NOT NULL,
      requested_password TEXT       NOT NULL,
      status            TEXT        NOT NULL DEFAULT 'pending',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
const harborSessions = new Map();

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
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'X-Admin-Token', 'X-Harbor-Token']
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

// ── HARBOR AUTH ──────────────────────────────────────────────────────────────
function requireHarbor(req, res, next) {
  const token = req.headers['x-harbor-token'];
  if (token && harborSessions.has(token)) return next();
  res.status(401).json({ error: 'Harbor authentication required' });
}

function requireKeyOrHarbor(req, res, next) {
  const harborTok = req.headers['x-harbor-token'];
  if (harborTok && harborSessions.has(harborTok)) return next();
  const apiKey = req.headers['x-api-key'] || req.query.key;
  const adminTok = req.headers['x-admin-token'];
  if (apiKey && apiKey === process.env.API_KEY) return next();
  if (adminTok && sessions.get(adminTok) && Date.now() < sessions.get(adminTok).expires) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

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

app.get('/admin/data', async (req, res) => {
  // Allow fetching admin_users without auth (needed for client login)
  const key = req.query.key;
  if (key === 'admin_users') {
    try {
      const r = await pool.query("SELECT value FROM admin_data WHERE key = 'admin_users'");
      if (!r.rows.length) return res.json({ admin_users: [] });
      return res.json({ admin_users: JSON.parse(r.rows[0].value) });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }
  // Full data - accept admin token OR API key
  const token = req.headers['x-admin-token'];
  const apiKey = req.headers['x-api-key'];
  const validToken = token && sessions.get(token) && Date.now() < sessions.get(token).expires;
  const validKey = apiKey && apiKey === API_KEY;
  if (!validToken && !validKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const rows = await pool.query('SELECT key, value FROM admin_data');
    const result = {};
    rows.rows.forEach(r => { try { result[r.key] = JSON.parse(r.value); } catch(e) { result[r.key] = r.value; } });
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
    // Serve Harbor if request is from harbor domain
    const host = req.hostname || '';
    if (host.includes('techlearn-harbor') || host.includes('harbor.techlearn')) {
      const harborResult = await pool.query("SELECT value FROM admin_data WHERE key = 'harbor_html'");
      if (harborResult.rows.length && harborResult.rows[0].value) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(harborResult.rows[0].value);
      }
      return res.setHeader('Content-Type', 'text/html').status(200).send('<div style="font-family:sans-serif;padding:2rem;background:#0d0e14;color:#e8e9f0;min-height:100vh"><h2>Harbor not deployed yet.</h2><p style="color:#7c7d8a;margin-top:.5rem">Deploy Harbor from the admin panel first.</p></div>');
    }

    // Check maintenance mode
    const maint = await pool.query("SELECT value FROM admin_data WHERE key = 'maintenance_mode'");
    if (maint.rows.length && JSON.parse(maint.rows[0].value) === true) {
      return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Under Maintenance</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',sans-serif;background:#0d0e14;color:#e8e9f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem}.card{text-align:center;max-width:480px}.icon{font-size:4rem;margin-bottom:1.5rem}.title{font-size:2rem;font-weight:700;margin-bottom:1rem;background:linear-gradient(135deg,#8b5cf6,#22d3ee);-webkit-background-clip:text;-webkit-text-fill-color:transparent}.msg{font-size:1rem;color:#7c7d8a;line-height:1.7}</style></head><body><div class="card"><div class="icon">🔧</div><div class="title">Under Maintenance</div><p class="msg">TechLearn is currently undergoing scheduled maintenance. We'll be back shortly. Thank you for your patience.</p></div></body></html>`);
    }
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
app.get('/progress', async (req, res) => {
  // Allow harbor token OR admin/key auth
  const harborTok = req.headers['x-harbor-token'];
  if (!harborTok || !harborSessions.has(harborTok)) {
    const apiKey = req.headers['x-api-key'] || req.query.key;
    const adminTok = req.headers['x-admin-token'];
    if (!apiKey && !adminTok) return res.status(401).json({ error: 'Unauthorized' });
    if (apiKey && apiKey !== process.env.API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  }
  // eslint-disable-next-line no-unused-vars
  const _skip = null;
  try {
    // Get hidden users list from admin_users
    const adminUsersRow = await pool.query("SELECT value FROM admin_data WHERE key = 'admin_users'").catch(() => ({ rows: [] }));
    const adminUsers = adminUsersRow.rows.length ? JSON.parse(adminUsersRow.rows[0].value) : [];
    const hiddenUsernames = new Set(adminUsers.filter(u => u.hideFromLeaderboard).map(u => u.username));

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
    const summaryWithHidden = summary.rows.map(u => ({
      ...u,
      hide_from_leaderboard: hiddenUsernames.has(u.username)
    }));
    res.json({ summary: summaryWithHidden, best: best.rows, attempts: attempts.rows });
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

// ── HARBOR PORTAL ────────────────────────────────────────────────────────────

// Harbor login
app.post('/harbor/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  try {
    const result = await pool.query('SELECT * FROM managers WHERE username = $1 AND password = $2', [username.toLowerCase(), password]);
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid username or password' });
    const manager = result.rows[0];
    const token = require('crypto').randomBytes(32).toString('hex');
    harborSessions.set(token, { id: manager.id, name: manager.name, username: manager.username });
    res.json({ ok: true, token, name: manager.name });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Harbor logout
app.post('/harbor/logout', (req, res) => {
  const token = req.headers['x-harbor-token'];
  if (token) harborSessions.delete(token);
  res.json({ ok: true });
});

// Harbor verify
app.get('/harbor/verify', requireHarbor, (req, res) => {
  const token = req.headers['x-harbor-token'];
  const session = harborSessions.get(token);
  res.json({ ok: true, name: session.name, username: session.username });
});

// Harbor get data (modules, settings)
app.get('/harbor/data', requireHarbor, async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM admin_data WHERE key = 'admin_data'");
    let data = {};
    if (result.rows.length) {
      try { data = JSON.parse(result.rows[0].value); } catch(e) { console.error('harbor/data parse error:', e.message); }
    }
    console.log('harbor/data - modules count:', data.modules ? data.modules.length : 0);
    res.json({ ok: true, data });
  } catch(e) {
    console.error('harbor/data error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Harbor save modules
app.post('/harbor/modules', requireHarbor, async (req, res) => {
  const { modules, availableDates, timeSlots } = req.body;
  if (!modules) return res.status(400).json({ error: 'No modules provided' });
  try {
    const existing = await pool.query("SELECT value FROM admin_data WHERE key = 'admin_data'");
    const data = existing.rows.length ? JSON.parse(existing.rows[0].value) : {};
    data.modules = modules;
    if (availableDates !== undefined) data.availableDates = availableDates;
    if (timeSlots !== undefined) data.timeSlots = timeSlots;
    await pool.query(
      "INSERT INTO admin_data (key, value) VALUES ('admin_data', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify(data)]
    );
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Harbor deploy to client
app.post('/harbor/deploy', requireHarbor, async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: 'No HTML provided' });
  try {
    await pool.query(
      "INSERT INTO training_html (content) VALUES ($1)",
      [html]
    );
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Harbor get requests
app.get('/harbor/requests', requireHarbor, async (req, res) => {
  try {
    const type = req.query.type;
    let query = 'SELECT * FROM requests ORDER BY created_at DESC LIMIT 100';
    let params = [];
    if (type && type !== 'all') {
      query = 'SELECT * FROM requests WHERE type = $1 ORDER BY created_at DESC LIMIT 100';
      params = [type];
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Harbor update request status
app.patch('/harbor/requests/:id', requireHarbor, async (req, res) => {
  const { status } = req.body;
  try {
    await pool.query('UPDATE requests SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Harbor send request to developer
app.post('/harbor/dev-request', requireHarbor, async (req, res) => {
  const token = req.headers['x-harbor-token'];
  const session = harborSessions.get(token);
  const { message, type } = req.body;
  if (!message) return res.status(400).json({ error: 'No message provided' });
  try {
    await pool.query(
      'INSERT INTO requests (type, username, full_name, message) VALUES ($1, $2, $3, $4)',
      [type || 'manager-request', session.username, session.name + ' (Manager)', message]
    );
    // Notify admin
    const notifyEmails = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    if (notifyEmails.length) {
      setImmediate(() => sendEmail(
        notifyEmails,
        'Harbor Request from ' + session.name,
        '<div style="font-family:sans-serif;padding:24px"><h2>Manager Request</h2><p><strong>From:</strong> ' + session.name + '</p><p><strong>Type:</strong> ' + (type || 'General') + '</p><p><strong>Message:</strong></p><pre style="font-size:13px">' + message + '</pre></div>'
      ));
    }
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── MANAGER MANAGEMENT (admin only) ──────────────────────────────────────────
app.get('/managers', requireKeyOrAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, username, created_at FROM managers ORDER BY created_at DESC');
    res.json(result.rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/managers', requireKeyOrAdmin, async (req, res) => {
  const { name, username, password } = req.body;
  if (!name || !username || !password) return res.status(400).json({ error: 'All fields required' });
  try {
    await pool.query('INSERT INTO managers (name, username, password) VALUES ($1, $2, $3)', [name, username.toLowerCase(), password]);
    res.json({ ok: true });
  } catch(e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Username already taken' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/managers/:id', requireKeyOrAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM managers WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── HARBOR DEPLOY (admin deploys harbor HTML) ─────────────────────────────────
app.post('/admin/deploy-harbor', requireKeyOrAdmin, async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: 'No HTML' });
  try {
    await pool.query(
      "INSERT INTO admin_data (key, value) VALUES ('harbor_html', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [html]
    );
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PREVIEW ──────────────────────────────────────────────────────────────────
app.get('/preview', async (req, res) => {
  try {
    const result = await pool.query('SELECT content FROM preview_html ORDER BY id DESC LIMIT 1');
    if (!result.rows.length) return res.send('<div style="font-family:sans-serif;padding:2rem;background:#0d0e14;color:#e8e9f0;min-height:100vh"><h2>No preview deployed yet.</h2><p style="color:#7c7d8a;margin-top:.5rem">Click "Deploy to Preview" in the admin panel.</p></div>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.rows[0].content);
  } catch(e) { res.status(500).send('Preview error'); }
});

app.post('/preview/deploy', requireKeyOrAdmin, async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: 'No HTML' });
  try {
    await pool.query('DELETE FROM preview_html');
    await pool.query('INSERT INTO preview_html (content) VALUES ($1)', [html]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PREVIEW SYSTEM ───────────────────────────────────────────────────────────
app.get('/preview', async (req, res) => {
  try {
    const result = await pool.query('SELECT content FROM preview_html ORDER BY id DESC LIMIT 1');
    if (!result.rows.length) {
      return res.send('<div style="font-family:sans-serif;padding:2rem;background:#0d0e14;color:#e8e9f0;min-height:100vh"><h2>No preview deployed yet.</h2><p style="color:#7c7d8a;margin-top:.5rem">Click Deploy to Preview in the admin panel.</p></div>');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.rows[0].content);
  } catch(e) {
    res.status(500).send('Error loading preview');
  }
});

app.post('/admin/deploy-preview', requireKeyOrAdmin, async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: 'No HTML provided' });
  try {
    await pool.query('DELETE FROM preview_html');
    await pool.query('INSERT INTO preview_html (content) VALUES ($1)', [html]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SPANKY EXTENSION DOWNLOAD ────────────────────────────────────────────────
const SPANKY_ZIP_B64 = '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';

app.get('/spanky', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spanky - TechLearn Assistant</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',sans-serif;background:#0d0e14;color:#e8e9f0;min-height:100vh}
.hero{background:linear-gradient(135deg,rgba(139,92,246,.15),rgba(34,211,238,.08));border-bottom:1px solid rgba(255,255,255,.07);padding:3rem 2rem;text-align:center}
.hero-icon{font-size:5rem;margin-bottom:1rem;display:block}
.hero-title{font-size:2.5rem;font-weight:800;letter-spacing:-.03em;background:linear-gradient(135deg,#a78bfa,#22d3ee);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:.75rem}
.hero-sub{font-size:1rem;color:#7c7d8a;max-width:480px;margin:0 auto 2rem;line-height:1.7}
.dl-btn{display:inline-flex;align-items:center;gap:10px;background:linear-gradient(135deg,#8b5cf6,#22d3ee);color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-size:16px;font-weight:700;transition:opacity .15s;margin-bottom:.75rem}
.dl-btn:hover{opacity:.85}
.dl-note{font-size:12px;color:#7c7d8a}
.content{max-width:640px;margin:0 auto;padding:3rem 2rem}
.section-title{font-size:.75rem;text-transform:uppercase;letter-spacing:.1em;color:#7c7d8a;margin-bottom:1.25rem;font-weight:600}
.steps{display:flex;flex-direction:column;gap:0}
.step{display:flex;gap:16px;padding:1.25rem 0;border-bottom:1px solid rgba(255,255,255,.06)}
.step:last-child{border-bottom:none}
.step-num{background:linear-gradient(135deg,#8b5cf6,#22d3ee);color:#fff;font-weight:800;font-size:13px;min-width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}
.step-content{}
.step-title{font-size:14px;font-weight:600;margin-bottom:4px}
.step-desc{font-size:13px;color:#7c7d8a;line-height:1.6}
.step-desc code{background:rgba(139,92,246,.15);color:#a78bfa;padding:2px 6px;border-radius:4px;font-family:monospace;font-size:12px}
.features{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:2rem}
.feature{background:#13141c;border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:1.25rem}
.feature-icon{font-size:1.5rem;margin-bottom:.5rem}
.feature-title{font-size:13px;font-weight:600;margin-bottom:4px}
.feature-desc{font-size:12px;color:#7c7d8a;line-height:1.5}
.shortcut-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(34,211,238,.08);border:1px solid rgba(34,211,238,.2);border-radius:8px;padding:6px 12px;font-size:13px;color:#22d3ee;margin-top:1.5rem}
kbd{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:2px 7px;font-family:monospace;font-size:12px;color:#e8e9f0}
.footer{text-align:center;padding:2rem;font-size:12px;color:#4a4b57;border-top:1px solid rgba(255,255,255,.05)}
</style>
</head>
<body>
<div class="hero">
  <span class="hero-icon">🐕</span>
  <h1 class="hero-title">Meet Spanky</h1>
  <p class="hero-sub">Your TechLearn AI assistant, always one shortcut away. Ask questions about your training modules from any Chrome tab.</p>
  <a href="/spanky/download" class="dl-btn" download="spanky_extension.zip">
    <span>⬇</span> Download Spanky
  </a><br>
  <span class="dl-note">Free · Works in Chrome · API key pre-configured</span>
</div>

<div class="content">
  <div class="shortcut-badge">Press <kbd>Alt</kbd> + <kbd>2</kbd> from any tab to open Spanky</div>

  <div style="margin-top:2.5rem">
    <div class="section-title">How to install</div>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-content">
          <div class="step-title">Download the extension</div>
          <div class="step-desc">Click the Download button above. A zip file named <code>spanky_extension.zip</code> will save to your computer.</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-content">
          <div class="step-title">Unzip the file</div>
          <div class="step-desc">Right-click <code>spanky_extension.zip</code> and select <strong>Extract All</strong>. Choose a permanent location like your Documents folder — don't delete it after installing.</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-content">
          <div class="step-title">Open Chrome Extensions</div>
          <div class="step-desc">In Chrome, type <code>chrome://extensions</code> in the address bar and press Enter.</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-content">
          <div class="step-title">Enable Developer Mode</div>
          <div class="step-desc">Toggle the <strong>Developer mode</strong> switch in the top-right corner of the Extensions page.</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">5</div>
        <div class="step-content">
          <div class="step-title">Load the extension</div>
          <div class="step-desc">Click <strong>Load unpacked</strong> and select the unzipped <code>spanky_extension</code> folder.</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">6</div>
        <div class="step-content">
          <div class="step-title">You're ready!</div>
          <div class="step-desc">Press <kbd>Alt</kbd> + <kbd>2</kbd> from any Chrome tab to open Spanky. Your API key is already configured — just start asking questions!</div>
        </div>
      </div>
    </div>
  </div>

  <div style="margin-top:2.5rem">
    <div class="section-title">What Spanky can do</div>
    <div class="features">
      <div class="feature">
        <div class="feature-icon">🔍</div>
        <div class="feature-title">Instant answers</div>
        <div class="feature-desc">Ask anything about your training modules and get answers in seconds</div>
      </div>
      <div class="feature">
        <div class="feature-icon">⌨️</div>
        <div class="feature-title">Keyboard shortcut</div>
        <div class="feature-desc">Open Spanky from any tab with Alt+2 — no clicking around</div>
      </div>
      <div class="feature">
        <div class="feature-icon">🔄</div>
        <div class="feature-title">Always up to date</div>
        <div class="feature-desc">Spanky pulls from your live TechLearn content automatically</div>
      </div>
      <div class="feature">
        <div class="feature-icon">🔒</div>
        <div class="feature-title">Secure</div>
        <div class="feature-desc">Your API key is stored locally on your device only</div>
      </div>
    </div>
  </div>
</div>
<div class="footer">Spanky by Lupaservices LLC · TechLearn Training Platform</div>
</body>
</html>`);
});


app.get('/spanky/download', (req, res) => {
  try {
    const apiKey = process.env.API_KEY || '';
    const AdmZip = require('adm-zip');
    const baseZip = Buffer.from(SPANKY_ZIP_B64, 'base64');
    const zip = new AdmZip(baseZip);
    if (apiKey) {
      const entry = zip.getEntry('popup.js');
      if (entry) {
        let js = entry.getData().toString('utf8');
        js = js.replace('__BAKED_API_KEY__', apiKey);
        zip.updateFile('popup.js', Buffer.from(js, 'utf8'));
      }
    }
    const out = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="spanky_extension.zip"');
    res.setHeader('Content-Length', out.length);
    res.send(out);
  } catch(e) {
    console.error('Spanky download error:', e.message);
    res.status(500).send('Download failed: ' + e.message);
  }
});

// ── LUPA AI (GROQ) ───────────────────────────────────────────────────────────
app.post('/guidebook', requireKey, async (req, res) => {
  const { question, modules } = req.body;
  if (!question) return res.status(400).json({ error: 'No question provided' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Lupa AI not configured' });

  // Keep context tight - titles + key questions only, max 1500 chars total
  const context = (modules || []).map(m => {
    const parts = [];
    if (m.content) parts.push(m.content.replace(/<[^>]*>/g, '').slice(0, 200));
    if (m.questions) {
      m.questions.slice(0, 2).forEach(q => {
        parts.push('Q: ' + q.q.slice(0, 80));
      });
    }
    return m.title + ': ' + parts.join(' | ');
  }).join('\n').slice(0, 1500);

  const prompt = 'You are Lupa, a helpful training assistant for remote technicians. Answer questions based ONLY on the training material provided below. If the answer is not in the training material, say so clearly. Be concise and practical.\n\nTRAINING MATERIAL:\n' + context + '\n\nQUESTION: ' + question + '\n\nAnswer:';

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.3
      })
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      const errMsg = (err.error && err.error.message) || 'Groq API error ' + r.status;
      console.error('Lupa error:', errMsg);
      throw new Error(errMsg);
    }

    const data = await r.json();
    const answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
      ? data.choices[0].message.content
      : 'No response generated.';
    res.json({ answer });
  } catch(e) {
    console.error('Lupa error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PASSWORD RESET ───────────────────────────────────────────────────────────


// ── HARBOR PASSWORD RESET ─────────────────────────────────────────────────────


// ── ACCOUNT REQUESTS// ── PASSWORD RESET ───────────────────────────────────────────────────────────


// ── HARBOR PASSWORD RESET ─────────────────────────────────────────────────────


// ── ACCOUNT REQUESTS ─────────────────────────────────────────────────────────
app.post('/account-request', async (req, res) => {
  const { fullName, store, email, requestedUsername, requestedPassword } = req.body;
  if (!fullName || !store || !email || !requestedUsername || !requestedPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  try {
    const existing = await pool.query("SELECT value FROM admin_data WHERE key = 'admin_users'");
    if (existing.rows.length) {
      const existingUsers = JSON.parse(existing.rows[0].value);
      if (existingUsers.find(u => u.username === requestedUsername.toLowerCase())) {
        return res.status(400).json({ error: 'Username already taken' });
      }
    }
    await pool.query(
      'INSERT INTO account_requests (full_name, store, email, requested_username, requested_password) VALUES ($1, $2, $3, $4, $5)',
      [fullName, store, email, requestedUsername.toLowerCase(), requestedPassword]
    );
    res.json({ ok: true });

    // Notify admins
    const notifyEmails = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    if (notifyEmails.length) {
      setImmediate(() => sendEmail(
        notifyEmails,
        'New Account Request from ' + fullName,
        '<div style="font-family:sans-serif;max-width:600px;padding:24px">'
        + '<h2>New Account Request</h2>'
        + '<p><strong>Name:</strong> ' + fullName + '</p>'
        + '<p><strong>Store:</strong> ' + store + '</p>'
        + '<p><strong>Email:</strong> ' + email + '</p>'
        + '<p><strong>Username:</strong> ' + requestedUsername + '</p>'
        + '<p>Log in to the admin panel to approve or deny.</p>'
        + '</div>'
      ));
    }
  } catch(e) {
    console.error('Account request error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


app.get('/account-requests', requireKeyOrAdmin, async (req, res) => {
  try {
    const rows = await pool.query('SELECT * FROM account_requests ORDER BY created_at DESC');
    res.json(rows.rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/account-requests/:id/approve', requireKeyOrAdmin, async (req, res) => {
  try {
    const row = await pool.query('SELECT * FROM account_requests WHERE id = $1', [req.params.id]);
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    const r = row.rows[0];

    // Add user to admin_users
    const existing = await pool.query("SELECT value FROM admin_data WHERE key = 'admin_users'");
    let users = existing.rows.length ? JSON.parse(existing.rows[0].value) : [];
    users.push({ id: Date.now(), name: r.full_name, username: r.requested_username, password: r.requested_password });
    await pool.query(
      "INSERT INTO admin_data (key, value) VALUES ('admin_users', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify(users)]
    );
    await pool.query("UPDATE account_requests SET status = 'approved' WHERE id = $1", [req.params.id]);
    res.json({ ok: true });

    // Send approval email to trainee
    if (r.email) {
      setImmediate(() => sendEmail(
        r.email,
        'Your TechLearn Account Has Been Approved',
        '<div style="font-family:sans-serif;max-width:600px;padding:24px;background:#0d0e14;color:#e8e9f0;border-radius:12px">'
        + '<h2 style="color:#8b5cf6">Account Approved!</h2>'
        + '<p>Hi ' + r.full_name + ', your TechLearn account has been approved.</p>'
        + '<p><strong>Username:</strong> ' + r.requested_username + '</p>'
        + '<p><strong>Password:</strong> ' + r.requested_password + '</p>'
        + '<p>Visit <a href="https://www.techlearn-lupa.com" style="color:#8b5cf6">techlearn-lupa.com</a> to log in.</p>'
        + '<p style="font-size:11px;color:#7c7d8a;margin-top:24px">TechLearn &mdash; Lupaservices LLC</p>'
        + '</div>'
      ));
    }
  } catch(e) {
    console.error('Approve error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


app.post('/account-requests/:id/deny', requireKeyOrAdmin, async (req, res) => {
  try {
    const row = await pool.query('SELECT * FROM account_requests WHERE id = $1', [req.params.id]);
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    const r = row.rows[0];
    await pool.query("UPDATE account_requests SET status = 'denied' WHERE id = $1", [req.params.id]);
    res.json({ ok: true });

    // Send denial email
    if (r.email) {
      setImmediate(() => sendEmail(
        r.email,
        'Your TechLearn Account Request',
        '<div style="font-family:sans-serif;max-width:600px;padding:24px">'
        + '<h2>Account Request Update</h2>'
        + '<p>Hi ' + r.full_name + ', unfortunately your account request was not approved at this time.</p>'
        + '<p>Please contact your manager for more information.</p>'
        + '<p style="font-size:11px;color:#999;margin-top:24px">TechLearn &mdash; Lupaservices LLC</p>'
        + '</div>'
      ));
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


app.delete('/account-requests/:id', requireKeyOrAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM account_requests WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE USER PROGRESS ─────────────────────────────────────────────────────
app.delete('/progress/:username', requireKeyOrAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM results WHERE username = $1', [req.params.username]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ANNOUNCEMENT ─────────────────────────────────────────────────────────────
app.get('/announcement', async (req, res) => {
  try {
    const result = await pool.query("SELECT value FROM admin_data WHERE key = 'announcement'");
    const text = result.rows.length ? JSON.parse(result.rows[0].value) : '';
    res.json({ announcement: text });
  } catch(e) { res.json({ announcement: '' }); }
});

app.post('/announcement', requireKeyOrAdmin, async (req, res) => {
  const { text } = req.body;
  try {
    await pool.query(
      "INSERT INTO admin_data (key, value) VALUES ('announcement', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify(text || '')]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Also allow harbor to set announcement
app.post('/harbor/announcement', requireHarbor, async (req, res) => {
  const { text } = req.body;
  try {
    await pool.query(
      "INSERT INTO admin_data (key, value) VALUES ('announcement', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify(text || '')]
    );
    // Also update admin_data.announcement
    const existing = await pool.query("SELECT value FROM admin_data WHERE key = 'admin_data'");
    if (existing.rows.length) {
      const data = JSON.parse(existing.rows[0].value);
      data.announcement = text || '';
      await pool.query(
        "INSERT INTO admin_data (key, value) VALUES ('admin_data', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
        [JSON.stringify(data)]
      );
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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

app.post('/changelog', requireKeyOrHarbor, async (req, res) => {
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

app.delete('/changelog/:id', requireKeyOrHarbor, async (req, res) => {
  try {
    await pool.query('DELETE FROM changelog WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PASSWORD RESET ───────────────────────────────────────────────────────────


// ── HARBOR PASSWORD RESET ─────────────────────────────────────────────────────


// ── ACCOUNT REQUESTS ─────────────────────────────────────────────────────────
app.post('/account-request', async (req, res) => {
  const { fullName, store, email, username, password } = req.body;
  if (!fullName || !store || !email || !username || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  try {
    // Check if username already exists in admin_data
    const existing = await pool.query(
      "SELECT value FROM admin_data WHERE key = 'admin_users'"
    );
    if (existing.rows.length) {
      const users = JSON.parse(existing.rows[0].value);
      if (users.find(u => u.username === username.toLowerCase())) {
        return res.status(400).json({ error: 'Username already taken' });
      }
    }
    await pool.query(
      'INSERT INTO account_requests (full_name, store, email, username, password) VALUES ($1,$2,$3,$4,$5)',
      [fullName, store, email, username.toLowerCase(), password]
    );

    // Notify admins by email
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_PASS;
    const notifyEmails = process.env.NOTIFY_EMAILS || gmailUser;
    if (gmailUser && gmailPass && notifyEmails) {
      const recipients = notifyEmails.split(',').map(e => e.trim()).filter(Boolean);
      setImmediate(async () => {
        try {
          let nm; try { nm = require('nodemailer'); } catch(e) { return; }
          const t = nm.createTransport({ host: process.env.SMTP_HOST||'smtp.gmail.com', port: parseInt(process.env.SMTP_PORT||'587'), secure: false, auth: { user: gmailUser, pass: gmailPass }, tls: { rejectUnauthorized: false } });
          await t.sendMail({
            from: '"TechLearn" <' + gmailUser + '>',
            to: recipients.join(', '),
            subject: 'TechLearn Account Request from ' + fullName,
            html: '<div style="font-family:sans-serif;padding:24px;background:#0d0e14;color:#e8e9f0;border-radius:12px;max-width:600px">'
              + '<h2 style="margin:0 0 16px">New Account Request</h2>'
              + '<p><strong>Name:</strong> ' + fullName + '</p>'
              + '<p><strong>Store:</strong> ' + store + '</p>'
              + '<p><strong>Email:</strong> ' + email + '</p>'
              + '<p><strong>Username:</strong> ' + username + '</p>'
              + '<p><strong>Password:</strong> ' + password + '</p>'
              + '<p style="margin-top:16px;color:#7c7d8a;font-size:12px">Log in to the admin panel to approve or deny this request.</p>'
              + '</div>'
          });
        } catch(e) { console.error('Account request email error:', e.message); }
      });
    }
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/account-requests', requireKeyOrAdmin, async (req, res) => {
  try {
    const rows = await pool.query('SELECT * FROM account_requests ORDER BY created_at DESC');
    res.json(rows.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/account-requests/:id/approve', requireKeyOrAdmin, async (req, res) => {
  try {
    const row = await pool.query('SELECT * FROM account_requests WHERE id=$1', [req.params.id]);
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    const r = row.rows[0];

    // Add user to admin_users
    const existing = await pool.query("SELECT value FROM admin_data WHERE key='admin_users'");
    const users = existing.rows.length ? JSON.parse(existing.rows[0].value) : [];
    users.push({ id: Date.now(), name: r.full_name, username: r.username, password: r.password });
    await pool.query(
      "INSERT INTO admin_data (key,value) VALUES ('admin_users',$1) ON CONFLICT(key) DO UPDATE SET value=$1",
      [JSON.stringify(users)]
    );

    // Update status
    await pool.query("UPDATE account_requests SET status='approved' WHERE id=$1", [req.params.id]);

    // Send approval email to user
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_PASS;
    const appUrl = process.env.APP_URL || '';
    if (gmailUser && gmailPass && r.email) {
      setImmediate(async () => {
        try {
          let nm; try { nm = require('nodemailer'); } catch(e) { return; }
          const t = nm.createTransport({ host: process.env.SMTP_HOST||'smtp.gmail.com', port: parseInt(process.env.SMTP_PORT||'587'), secure: false, auth: { user: gmailUser, pass: gmailPass }, tls: { rejectUnauthorized: false } });
          await t.sendMail({
            from: '"TechLearn" <' + gmailUser + '>',
            to: r.email,
            subject: 'Your TechLearn Account is Approved!',
            html: '<div style="font-family:sans-serif;padding:24px;background:#0d0e14;color:#e8e9f0;border-radius:12px;max-width:600px">'
              + '<div style="background:linear-gradient(135deg,#8b5cf6,#22d3ee);padding:3px;border-radius:10px;margin-bottom:24px"><div style="background:#13141c;border-radius:8px;padding:20px">'
              + '<h2 style="margin:0">Your account has been approved!</h2></div></div>'
              + '<p>Hi <strong>' + r.full_name + '</strong>, your TechLearn training account is ready.</p>'
              + '<div style="background:#1a1b26;border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:16px;margin:16px 0">'
              + '<p style="margin:0 0 8px"><strong>Username:</strong> ' + r.username + '</p>'
              + '<p style="margin:0 0 8px"><strong>Password:</strong> ' + r.password + '</p>'
              + (appUrl ? '<p style="margin:8px 0 0"><strong>Login at:</strong> <a href="' + appUrl + '" style="color:#a78bfa">' + appUrl + '</a></p>' : '')
              + '</div>'
              + '<p style="color:#7c7d8a;font-size:12px">Sent via TechLearn &mdash; Lupaservices LLC</p>'
              + '</div>'
          });
        } catch(e) { console.error('Approval email error:', e.message); }
      });
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/account-requests/:id/deny', requireKeyOrAdmin, async (req, res) => {
  try {
    const row = await pool.query('SELECT * FROM account_requests WHERE id=$1', [req.params.id]);
    if (!row.rows.length) return res.status(404).json({ error: 'Not found' });
    const r = row.rows[0];
    await pool.query("UPDATE account_requests SET status='denied' WHERE id=$1", [req.params.id]);

    // Send denial email
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_PASS;
    if (gmailUser && gmailPass && r.email) {
      setImmediate(async () => {
        try {
          let nm; try { nm = require('nodemailer'); } catch(e) { return; }
          const t = nm.createTransport({ host: process.env.SMTP_HOST||'smtp.gmail.com', port: parseInt(process.env.SMTP_PORT||'587'), secure: false, auth: { user: gmailUser, pass: gmailPass }, tls: { rejectUnauthorized: false } });
          await t.sendMail({
            from: '"TechLearn" <' + gmailUser + '>',
            to: r.email,
            subject: 'TechLearn Account Request Update',
            html: '<div style="font-family:sans-serif;padding:24px;background:#0d0e14;color:#e8e9f0;border-radius:12px;max-width:600px">'
              + '<h2 style="margin:0 0 16px">Account Request Update</h2>'
              + '<p>Hi <strong>' + r.full_name + '</strong>, unfortunately your account request was not approved at this time.</p>'
              + '<p style="color:#7c7d8a">Please contact your manager for more information.</p>'
              + '<p style="color:#7c7d8a;font-size:12px;margin-top:24px">Sent via TechLearn &mdash; Lupaservices LLC</p>'
              + '</div>'
          });
        } catch(e) { console.error('Denial email error:', e.message); }
      });
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/account-requests/:id', requireKeyOrAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM account_requests WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
  const role = req.body.role || null;
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

  const typeLabels = { access: 'Access Request', tool: 'Tool Request', reschedule: 'Reschedule Request', clothes: 'Clothing Order', bug: 'Bug Report' };
  // Role-based routing: managers go to admin inbox, techs go to manager inbox
  const isManagerRole = role === 'manager';
  const roleLabel = role === 'technician' ? 'In Store Technician' : role === 'remote' ? 'Remote Technician' : role === 'manager' ? 'Store Manager' : null;
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

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn('RESEND_API_KEY not set - email not sent');
    return;
  }

  try {
    const emailResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + resendKey
      },
      body: JSON.stringify({
        from: 'TechLearn <noreply@techlearn-lupa.com>',
        reply_to: process.env.GMAIL_USER || 'noreply@techlearn-lupa.com',
        to: recipients,
        subject: 'TechLearn ' + typeLabel + ' from ' + fullName,
        html: emailBody
      })
    });
    if (!emailResp.ok) {
      const err = await emailResp.json().catch(() => ({}));
      throw new Error(err.message || 'Resend error ' + emailResp.status);
    }
    console.log('Email sent via Resend for request from', fullName);
  } catch(e) {
    console.error('Email error:', e.message);
  }
});

// ── PREVIEW ───────────────────────────────────────────────────────────────────
app.get('/preview', async (req, res) => {
  try {
    const result = await pool.query('SELECT content FROM preview_html ORDER BY id DESC LIMIT 1');
    if (!result.rows.length) return res.send('<h2 style="font-family:sans-serif;padding:2rem;background:#0d0e14;color:#e8e9f0">No preview deployed yet.</h2>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.rows[0].content);
  } catch(e) { res.status(500).send('Error loading preview'); }
});

app.post('/admin/deploy-preview', requireKeyOrAdmin, async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: 'No HTML provided' });
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS preview_html (id SERIAL PRIMARY KEY, content TEXT NOT NULL)');
    await pool.query('DELETE FROM preview_html');
    await pool.query('INSERT INTO preview_html (content) VALUES ($1)', [html]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── PREVIEW ───────────────────────────────────────────────────────────────────
app.get('/preview', async (req, res) => {
  try {
    const result = await pool.query('SELECT content FROM preview_html ORDER BY id DESC LIMIT 1');
    if (!result.rows.length) return res.send('<h2 style="font-family:sans-serif;padding:2rem;background:#0d0e14;color:#e8e9f0">No preview deployed yet.</h2>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.rows[0].content);
  } catch(e) { res.status(500).send('Error'); }
});


// ── PASSWORD RESET ───────────────────────────────────────────────────────────
app.post('/reset-password', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  try {
    const result = await pool.query("SELECT value FROM admin_data WHERE key = 'admin_users'");
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    const users = JSON.parse(result.rows[0].value);
    const user = users.find(u => u.username === username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Username not found' });

    // Find email
    const acctResult = await pool.query(
      "SELECT email FROM account_requests WHERE requested_username = $1 AND email IS NOT NULL AND email != '' ORDER BY created_at DESC LIMIT 1",
      [username.toLowerCase()]
    );

    if (!acctResult.rows.length || !acctResult.rows[0].email) {
      const notifyEmails = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
      if (notifyEmails.length) {
        setImmediate(() => sendEmail(notifyEmails, 'Password Reset Request - ' + username,
          '<div style="font-family:sans-serif;padding:24px"><h2>Password Reset Request</h2><p><strong>' + username + '</strong> requested a password reset but has no email on file. Please reset their password manually.</p></div>'
        ));
      }
      return res.json({ ok: true, message: 'A reset request has been sent to your administrator.' });
    }

    const email = acctResult.rows[0].email;
    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'INSERT INTO password_resets (username, token, expires_at) VALUES ($1, $2, $3)',
      [username.toLowerCase(), token, expires]
    );

    const resetLink = 'https://www.techlearn-lupa.com/reset?token=' + token;
    setImmediate(() => sendEmail(email, 'TechLearn Password Reset',
      '<div style="font-family:sans-serif;max-width:480px;padding:24px;background:#0d0e14;color:#e8e9f0;border-radius:12px">' +
      '<h2 style="color:#8b5cf6">Password Reset</h2>' +
      '<p>Hi ' + (user.name || username) + ',</p>' +
      '<p>Click the button below to reset your password. This link expires in 1 hour.</p>' +
      '<a href="' + resetLink + '" style="display:inline-block;margin:16px 0;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a>' +
      '<p style="font-size:12px;color:#7c7d8a">If you did not request this, ignore this email.</p></div>'
    ));

    res.json({ ok: true, message: 'A password reset link has been sent to your email.' });
  } catch(e) {
    console.error('Reset error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Reset password page
app.get('/reset', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('<h2>Invalid reset link.</h2>');
  try {
    const result = await pool.query(
      'SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [token]
    );
    if (!result.rows.length) {
      return res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TechLearn Reset</title><style>body{font-family:sans-serif;background:#0d0e14;color:#e8e9f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.card{background:#13141c;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:2rem;max-width:400px;width:90%;text-align:center}h2{color:#f87171}</style></head><body><div class="card"><h2>Link Expired</h2><p>This reset link has expired or already been used.</p><a href="https://www.techlearn-lupa.com" style="color:#8b5cf6">Back to login</a></div></body></html>');
    }
    const username = result.rows[0].username;
    res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reset Password</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:sans-serif;background:#0d0e14;color:#e8e9f0;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#13141c;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:2rem;max-width:400px;width:90%}h2{color:#8b5cf6;margin-bottom:.5rem}p{color:#7c7d8a;font-size:14px;margin-bottom:1.5rem}input{width:100%;background:#1a1b26;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:.75rem 1rem;color:#e8e9f0;font-size:14px;margin-bottom:1rem;outline:none}input:focus{border-color:#8b5cf6}button{width:100%;background:#8b5cf6;color:#fff;border:none;border-radius:8px;padding:.75rem;font-size:14px;font-weight:600;cursor:pointer}.msg{margin-top:1rem;font-size:13px;text-align:center}</style></head><body><div class="card"><h2>Reset Password</h2><p>Enter your new password below.</p><input type="password" id="pw" placeholder="New password"><input type="password" id="pw2" placeholder="Confirm password"><button onclick="doReset()">Set New Password</button><div class="msg" id="msg"></div></div><script>function doReset(){var pw=document.getElementById("pw").value;var pw2=document.getElementById("pw2").value;var msg=document.getElementById("msg");if(!pw||pw.length<6){msg.style.color="#f87171";msg.textContent="Password must be at least 6 characters.";return;}if(pw!==pw2){msg.style.color="#f87171";msg.textContent="Passwords do not match.";return;}fetch("/reset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:"' + token + '",password:pw})}).then(function(r){return r.json();}).then(function(d){if(d.ok){msg.style.color="#4ade80";msg.textContent="Password updated! Redirecting...";setTimeout(function(){window.location="https://www.techlearn-lupa.com";},2000);}else{msg.style.color="#f87171";msg.textContent=d.error||"Failed.";}}).catch(function(){msg.style.color="#f87171";msg.textContent="Could not connect.";});}</script></body></html>');
  } catch(e) {
    res.status(500).send('Error');
  }
});

app.post('/reset', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 6) return res.status(400).json({ error: 'Password too short' });
  try {
    const result = await pool.query(
      'SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [token]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Invalid or expired link' });
    const username = result.rows[0].username;

    // Update password
    const usersResult = await pool.query("SELECT value FROM admin_data WHERE key = 'admin_users'");
    const users = JSON.parse(usersResult.rows[0].value);
    const user = users.find(u => u.username === username);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.password = password;
    await pool.query(
      "INSERT INTO admin_data (key, value) VALUES ('admin_users', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
      [JSON.stringify(users)]
    );

    // Mark token as used
    await pool.query('UPDATE password_resets SET used = TRUE WHERE token = $1', [token]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PWA ───────────────────────────────────────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    name: 'TechLearn', short_name: 'TechLearn',
    description: 'Remote Technician Training by Lupaservices LLC',
    start_url: '/', display: 'standalone', orientation: 'portrait',
    background_color: '#0d0e14', theme_color: '#8b5cf6',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
    ]
  });
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(`const CACHE='techlearn-v1';
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.add('/')).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(['/result','/progress','/request','/admin','/reset'].some(p=>u.pathname.startsWith(p)))return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(CACHE).then(ca=>ca.put(e.request,c));}return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))));});`);
});

const ICON_SVG = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><rect width="${s}" height="${s}" rx="${Math.round(s*0.2)}" fill="#0d0e14"/><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#8b5cf6"/><stop offset="100%" stop-color="#22d3ee"/></linearGradient></defs><rect width="${s}" height="${s}" rx="${Math.round(s*0.2)}" fill="url(#g)" opacity="0.15"/><text x="50%" y="55%" font-size="${Math.round(s*0.55)}" text-anchor="middle" dominant-baseline="middle">🔧</text></svg>`;
app.get('/icon-192.png', (req, res) => { res.setHeader('Content-Type','image/svg+xml'); res.send(ICON_SVG(192)); });
app.get('/icon-512.png', (req, res) => { res.setHeader('Content-Type','image/svg+xml'); res.send(ICON_SVG(512)); });
// ── START ─────────────────────────────────────────────────────────────────────
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log('Database ready');
      console.log('TechLearn API running on port ' + PORT);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

app.get('/preview', async (req, res) => { try { const result = await pool.query('SELECT content FROM preview_html ORDER BY id DESC LIMIT 1'); if (!result.rows.length) return res.send('<h2>No preview yet.</h2>'); res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.send(result.rows[0].content); } catch(e) { res.status(500).send('Error'); } });

app.get('/preview', async (req, res) => { try { const result = await pool.query('SELECT content FROM preview_html ORDER BY id DESC LIMIT 1'); if (!result.rows.length) return res.send('<h2>No preview yet.</h2>'); res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.send(result.rows[0].content); } catch(e) { res.status(500).send('Error'); } });

app.get('/preview',async(req,res)=>{try{const r=await pool.query('SELECT content FROM preview_html ORDER BY id DESC LIMIT 1');if(!r.rows.length)return res.send('<h2>No preview</h2>');res.setHeader('Content-Type','text/html');res.send(r.rows[0].content);}catch(e){res.status(500).send('error');}});

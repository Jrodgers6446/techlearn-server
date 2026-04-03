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
app.get('/progress', requireKeyOrAdmin, async (req, res) => {
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

// ── SPANKY EXTENSION DOWNLOAD ────────────────────────────────────────────────
const SPANKY_ZIP_B64 = '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';

app.get('/spanky', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spanky - TechLearn</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',sans-serif;background:#0d0e14;color:#e8e9f0;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:2rem}.card{max-width:480px;width:100%;text-align:center}.icon{font-size:4rem;margin-bottom:1rem}.title{font-size:2rem;font-weight:700;background:linear-gradient(135deg,#8b5cf6,#22d3ee);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:.5rem}.sub{font-size:.95rem;color:#7c7d8a;margin-bottom:2rem;line-height:1.7}.steps{text-align:left;background:#13141c;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.5rem;margin-bottom:2rem}.steps h3{font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:#7c7d8a;margin-bottom:1rem}.step{display:flex;gap:12px;align-items:flex-start;margin-bottom:1rem;font-size:13px;line-height:1.6}.step:last-child{margin-bottom:0}.step-num{background:rgba(139,92,246,.2);color:#a78bfa;font-weight:700;font-size:12px;min-width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin-top:1px}.dl-btn{display:inline-block;background:linear-gradient(135deg,#8b5cf6,#22d3ee);color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;margin-bottom:1rem;transition:opacity .15s}.dl-btn:hover{opacity:.85}.shortcut{display:inline-block;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:3px 8px;font-family:monospace;font-size:12px;color:#a78bfa}</style>
  </head><body><div class="card"><div class="icon">🐈‍⬛</div><h1 class="title">Spanky</h1><p class="sub">Your TechLearn AI assistant, always one click away in Chrome.</p>
  <a href="/spanky/download" class="dl-btn" download="spanky_extension.zip">⬇ Download Spanky</a>
  <div class="steps"><h3>How to install</h3>
  <div class="step"><div class="step-num">1</div><div>Click the download button above and save the zip file</div></div>
  <div class="step"><div class="step-num">2</div><div>Unzip the file into a folder on your computer</div></div>
  <div class="step"><div class="step-num">3</div><div>Open Chrome and go to <strong>chrome://extensions</strong></div></div>
  <div class="step"><div class="step-num">4</div><div>Enable <strong>Developer Mode</strong> (toggle in the top right)</div></div>
  <div class="step"><div class="step-num">5</div><div>Click <strong>Load Unpacked</strong> and select the unzipped folder</div></div>
  <div class="step"><div class="step-num">6</div><div>Enter your API key when prompted, then press <span class="shortcut">Alt+2</span> from any tab to open Spanky!</div></div>
  </div></div></body></html>`);
});

app.get('/spanky/download', (req, res) => {
  const buf = Buffer.from(SPANKY_ZIP_B64, 'base64');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="spanky_extension.zip"');
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
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

// ── ACCOUNT REQUESTS// ── ACCOUNT REQUESTS ─────────────────────────────────────────────────────────
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

const express = require('express');
const cors    = require('cors');
const Database = require('better-sqlite3');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SECRET KEY ────────────────────────────────────────────────────────────────
// Set this as an environment variable in Render: API_KEY=somesecretvalue
// The training file must send this same value in the X-API-Key header
const API_KEY = process.env.API_KEY || 'changeme';

// ── DATABASE ──────────────────────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'progress.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL,
    full_name   TEXT    NOT NULL,
    module_id   INTEGER NOT NULL,
    module_title TEXT   NOT NULL,
    score       INTEGER NOT NULL,
    passed      INTEGER NOT NULL,
    attempt     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Auth middleware — checks X-API-Key header
function requireKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

// Health check — Render uses this to confirm the service is up
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'TechLearn API' });
});

// POST /result — called by the training file when a user finishes a quiz
// Body: { username, fullName, moduleId, moduleTitle, score, passed }
app.post('/result', requireKey, (req, res) => {
  const { username, fullName, moduleId, moduleTitle, score, passed } = req.body;

  if (!username || fullName === undefined || moduleId === undefined || score === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Count prior attempts for this user + module
  const prev = db.prepare(
    'SELECT COUNT(*) as cnt FROM results WHERE username = ? AND module_id = ?'
  ).get(username, moduleId);

  const attempt = (prev?.cnt || 0) + 1;

  db.prepare(`
    INSERT INTO results (username, full_name, module_id, module_title, score, passed, attempt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(username, fullName, moduleId, moduleTitle, score, passed ? 1 : 0, attempt);

  res.json({ ok: true, attempt });
});

// GET /progress — called by the admin panel to view all results
// Returns summary per user + detailed attempt log
app.get('/progress', requireKey, (req, res) => {
  // Per-user summary: best score per module
  const summary = db.prepare(`
    SELECT
      username,
      full_name,
      COUNT(DISTINCT module_id)                        AS modules_attempted,
      SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END)     AS modules_passed,
      ROUND(AVG(score), 1)                             AS avg_score,
      MAX(created_at)                                  AS last_activity
    FROM results
    GROUP BY username
    ORDER BY last_activity DESC
  `).all();

  // All individual attempts (for the detail view)
  const attempts = db.prepare(`
    SELECT * FROM results ORDER BY created_at DESC LIMIT 500
  `).all();

  // Per-user per-module best score
  const best = db.prepare(`
    SELECT username, module_id, module_title,
           MAX(score) as best_score,
           SUM(CASE WHEN passed=1 THEN 1 ELSE 0 END) as passed,
           COUNT(*) as attempts
    FROM results
    GROUP BY username, module_id
    ORDER BY username, module_id
  `).all();

  res.json({ summary, attempts, best });
});

// GET /progress/:username — single user detail
app.get('/progress/:username', requireKey, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM results WHERE username = ? ORDER BY created_at DESC'
  ).all(req.params.username);
  res.json(rows);
});

// DELETE /result/:id — admin can remove a single record
app.delete('/result/:id', requireKey, (req, res) => {
  db.prepare('DELETE FROM results WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`TechLearn API running on port ${PORT}`);
});

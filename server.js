const express = require('express');
const cors    = require('cors');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.API_KEY || 'changeme';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS results (
      id           SERIAL PRIMARY KEY,
      username     TEXT    NOT NULL,
      full_name    TEXT    NOT NULL,
      module_id    INTEGER NOT NULL,
      module_title TEXT    NOT NULL,
      score        INTEGER NOT NULL,
      passed       BOOLEAN NOT NULL,
      attempt      INTEGER NOT NULL DEFAULT 1,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('Database ready');
}

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key']
}));
app.options('*', cors());
app.use(express.json());

function requireKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/', (req, res) => res.json({ status: 'ok', service: 'TechLearn API' }));

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

app.get('/progress', requireKey, async (req, res) => {
  try {
    const summary = await pool.query(`
      SELECT username, full_name,
             COUNT(DISTINCT module_id) AS modules_attempted,
             SUM(CASE WHEN passed = true THEN 1 ELSE 0 END) AS modules_passed,
             ROUND(AVG(score)::numeric, 1) AS avg_score,
             MAX(created_at) AS last_activity
      FROM results
      GROUP BY username, full_name
      ORDER BY last_activity DESC
    `);
    const best = await pool.query(`
      SELECT username, module_id, module_title,
             MAX(score) as best_score,
             SUM(CASE WHEN passed = true THEN 1 ELSE 0 END) as passed,
             COUNT(*) as attempts
      FROM results
      GROUP BY username, module_id, module_title
      ORDER BY username, module_id
    `);
    const attempts = await pool.query('SELECT * FROM results ORDER BY created_at DESC LIMIT 500');
    res.json({ summary: summary.rows, best: best.rows, attempts: attempts.rows });
  } catch (e) {
    console.error('GET /progress error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/progress/:username', requireKey, async (req, res) => {
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

initDb().then(() => {
  app.listen(PORT, () => console.log(`TechLearn API running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to init database:', err.message);
  process.exit(1);
});

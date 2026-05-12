
import re, sys

with open('server.js', 'r', encoding='utf-8') as f:
    c = f.read()

# ── Patch 1: /admin/data GET - accept harbor token ───────────────────────────
OLD1 = """  const validToken = token && sessions.get(token) && Date.now() < sessions.get(token).expires;
  const validKey = apiKey && apiKey === API_KEY;
  if (!validToken && !validKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }"""
NEW1 = """  const validToken = token && sessions.get(token) && Date.now() < sessions.get(token).expires;
  const validKey = apiKey && apiKey === API_KEY;
  const harborTokH = req.headers['x-harbor-token'];
  const validHarbor = harborTokH && harborSessions.has(harborTokH);
  if (!validToken && !validKey && !validHarbor) {
    return res.status(401).json({ error: 'Unauthorized' });
  }"""
if OLD1 in c:
    c = c.replace(OLD1, NEW1, 1)
    print('✓ Patch 1: /admin/data harbor auth')
else:
    print('⚠ Patch 1 not found - may already be patched')

# ── Patch 2: /account-requests GET - accept harbor token ─────────────────────
OLD2 = "app.get('/account-requests', requireKeyOrAdmin, async (req, res) => {"
NEW2 = """app.get('/account-requests', async (req, res) => {
  const _k=req.headers['x-api-key'],_t=req.headers['x-admin-token'],_h=req.headers['x-harbor-token'];
  if(!(_k&&_k===process.env.API_KEY||_t&&sessions.has(_t)||_h&&harborSessions.has(_h)))return res.status(401).json({error:'Unauthorized'});"""
# Only replace first occurrence
c = c.replace(OLD2, NEW2, 1)
print('✓ Patch 2: /account-requests harbor auth')

# ── Patch 3: Add /manager routes before // ── START ──────────────────────────
MANAGER_ROUTES = """
// ── MANAGER PORTAL ────────────────────────────────────────────────────────────
app.get('/manager', async (req, res) => {
  try {
    const r = await pool.query("SELECT value FROM admin_data WHERE key = 'manager_html'");
    if (r.rows.length) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(JSON.parse(r.rows[0].value));
    }
  } catch(e) {}
  res.status(404).send('<div style="font-family:sans-serif;padding:2rem;background:#0d0e14;color:#e8e9f0;min-height:100vh"><h2>Manager portal not deployed yet.</h2><p style="color:#7c7d8a;margin-top:.5rem">Ask your admin to deploy it.</p></div>');
});

app.post('/manager/deploy', requireKeyOrAdmin, async (req, res) => {
  const { html } = req.body;
  if (!html) return res.status(400).json({ error: 'No HTML provided' });
  try {
    await pool.query(
      "INSERT INTO admin_data (key, value) VALUES ('manager_html', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
      [JSON.stringify(html)]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

"""

if "// ── START" in c:
    c = c.replace("// ── START", MANAGER_ROUTES + "// ── START", 1)
    print('✓ Patch 3: /manager routes added')
else:
    print('⚠ Could not find // ── START anchor')

with open('server.js', 'w', encoding='utf-8') as f:
    f.write(c)
print('Done! Run: git add server.js && git commit -m "Add manager portal" && git push')

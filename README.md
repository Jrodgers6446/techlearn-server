# TechLearn Server

API backend for TechLearn training progress tracking.

## Deploy to Render

1. Push this folder to a GitHub repo
2. Go to render.com → New → Web Service → connect your repo
3. Set these values in Render:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment Variable:** `API_KEY` = any secret string you choose (e.g. `tl-secret-abc123`)

Render gives you a URL like `https://your-app.onrender.com` — paste that into the admin panel.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | / | Health check |
| POST | /result | Save a quiz result |
| GET | /progress | All user progress (admin) |
| GET | /progress/:username | Single user detail |
| DELETE | /result/:id | Remove a record |

All endpoints except `/` require the `X-API-Key` header.

## Local dev

```bash
npm install
API_KEY=test node server.js
```

---
name: run-red-peppa
description: Start the Red Peppa class chat app locally (FastAPI backend on :8002 + Vite frontend on :5174)
triggers:
  - user
  - model
---

# Run Red Peppa locally

This repo has two parts that must run together:

- `backend/` — FastAPI app (`main.py`), serves the API on port **8002**, persists to `backend/data.json`
- `frontend/` — Vite + React app, dev server on port **5174**, calls `http://localhost:8002/api` by default (`VITE_API_URL` env var overrides)

## Before you start

Check the ports aren't already taken — an older copy of this app may be running from `~/Documents/shali work yisrael/shali-and-yisrael/class-app/`:

```bash
lsof -nP -iTCP:8002 -sTCP:LISTEN
lsof -nP -iTCP:5174 -sTCP:LISTEN
```

If something is listening, either stop it or run this clone on alternate ports (see Notes).

**No system Node.js on this machine.** A local install lives at `~/.local/node/v22.21.1/bin` — prepend it to `PATH` for any `npm`/`node` command:

```bash
export PATH="$HOME/.local/node/v22.21.1/bin:$PATH"
```

## One-time setup

Skip steps that are already done (check for `backend/venv` and `frontend/node_modules`).

```bash
# Backend
cd backend
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# Frontend
cd ../frontend
export PATH="$HOME/.local/node/v22.21.1/bin:$PATH"
npm install
```

## Start the app

Run each in its own shell / background process.

```bash
# Terminal 1 — backend (repo root: <repo>/backend)
cd backend && venv/bin/uvicorn main:app --port 8002

# Terminal 2 — frontend (repo root: <repo>/frontend)
cd frontend && PATH="$HOME/.local/node/v22.21.1/bin:$PATH" npm run dev
```

When launching via the agent's `exec` tool, start each as a background command (e.g. `timeout: 0` or `nohup ... &`) so they keep running, then verify readiness:

```bash
curl -s http://localhost:8002/api/version   # → {"version":"1.0.0","env":"local"}
curl -s -o /dev/null -w '%{http_code}' http://localhost:5174   # → 200
```

## Access

- App: http://localhost:5174
- API docs: http://localhost:8002/docs

## Notes

- Ports are intentionally 8002/5174 so the app can run alongside the portfolio app (8000/8001/5173).
- First visit asks for name + password; new users join with name, password, phone, email, birthday (MM-DD).
- To wipe all data: stop the backend and delete `backend/data.json`.
- To point the frontend at a different backend: `VITE_API_URL=http://host:port/api npm run dev`. Vite auto-bumps to 5175+ if 5174 is taken, so always check the vite log for the real port.
- To run a second copy alongside another instance: backend `venv/bin/uvicorn main:app --port 8012`, frontend `VITE_API_URL=http://localhost:8012/api npm run dev`.
- Logs when launched in background: `/tmp/redpeppa-backend.log`, `/tmp/redpeppa-frontend.log`.
- `backend/data.json` should not be committed (check `.gitignore`).

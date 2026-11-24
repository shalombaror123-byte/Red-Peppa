# Class Chat

A WhatsApp-style website for your class.

- **Chats** — private 1-on-1 chat with each classmate
- **Class Group** — one big group chat for everyone
- **Directory** — everybody's phone numbers and emails (edit your own row)
- **News** — class announcements anyone can post
- **Study Help** — ask homework questions and share notes by subject
- **Jokes** — a Joke of the Day picked daily, plus the full joke pile
- **Birthdays** — upcoming birthdays sorted by days away

**Login:** no passwords — you pick your name from the class list. New people
join with their name + phone + email + birthday (MM-DD).

## Run it locally

Ports are chosen so it can run next to the portfolio app (which uses
backend `8000`/`8001` and frontend `5173`).

### Backend (port 8002)

```bash
cd class-app/backend
python3 -m venv venv           # or reuse ../../backend/venv
venv/bin/pip install -r requirements.txt
venv/bin/uvicorn main:app --port 8002
```

### Frontend (port 5174)

```bash
cd class-app/frontend
npm install
npm run dev
```

Open http://localhost:5174

Data is stored in `class-app/backend/data.json`. Delete that file to wipe
everything and start fresh. API docs: http://localhost:8002/docs

## Put it online for the whole class

The backend needs somewhere it can save data. Two options:

### Option A — Vercel + Upstash KV (like the portfolio app)

1. Deploy `class-app/backend` as a Vercel Python project.
2. Link an **Upstash Redis** store to it — the code automatically uses
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`)
   instead of `data.json`, because Vercel's filesystem is read-only.
3. Set env vars on the backend project:
   - `FRONTEND_URL` = your frontend URL (e.g. `https://class-app.vercel.app`)
   - `FRONTEND_ORIGIN_REGEX` = e.g. `https://class-app[a-z0-9-]*\.vercel\.app`
4. Deploy `class-app/frontend` as a separate Vercel project with env var
   `VITE_API_URL` = `https://<your-backend>/api`.

### Option B — any host with a persistent disk (Render, Railway…)

Run `uvicorn main:app --port 8002` there; `data.json` persists on disk.
Set `FRONTEND_URL` on the backend and `VITE_API_URL` on the frontend the
same way.

## API

| Method | Endpoint                     | Description                          |
| ------ | ---------------------------- | ------------------------------------ |
| GET    | `/api/users`                 | Class list (directory)               |
| POST   | `/api/users`                 | Join `{name, phone, email, birthday}`|
| PUT    | `/api/users/{id}`            | Update your phone/email/birthday     |
| GET    | `/api/chats/{user_id}`       | Chat list: group + each classmate    |
| GET    | `/api/messages/group`        | Group chat messages                  |
| GET    | `/api/messages/dm/{id}?me=`  | Messages between you and `{id}`      |
| POST   | `/api/messages`              | Send `{sender, to, text}` (`to` = `"group"` or a user id) |
| GET/POST | `/api/news`                | Class news                           |
| GET/POST | `/api/study`               | Study board `{author, subject, text}`|
| GET/POST | `/api/jokes`               | Jokes; GET also returns `joke_of_the_day` |
| GET    | `/api/birthdays`             | Upcoming birthdays, sorted           |

"""Class chat backend.

A WhatsApp-style app for one class: 1-on-1 chats, a group chat, a class
directory (phone + email), class news, a study/homework board, a joke of
the day, and a birthday list.

Data is persisted to data.json locally. When deployed on Vercel (read-only
filesystem) it uses an Upstash KV (Redis) store if the env vars are set —
same pattern as the portfolio backend.
"""

import base64
import hashlib
import json
import os
import secrets
import threading
import time
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import requests
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DATA_FILE = Path(__file__).parent / "data.json"
_lock = threading.Lock()

app = FastAPI(title="Red Peppa API")

allowed_origins = [
    "http://localhost:5174",
    "http://127.0.0.1:5174",
]
if extra_origin := os.environ.get("FRONTEND_URL"):
    allowed_origins.append(extra_origin)

# Any local port is allowed so dev tools / preview proxies work. In
# production, FRONTEND_ORIGIN_REGEX can whitelist the deployed frontend.
local_origin_regex = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"
origin_regex = local_origin_regex
if env_regex := os.environ.get("FRONTEND_ORIGIN_REGEX"):
    origin_regex = f"(?:{local_origin_regex})|(?:{env_regex})"

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=origin_regex,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- persistence ----------

KV_URL = (
    os.environ.get("KV_REST_API_URL")
    or os.environ.get("UPSTASH_REDIS_REST_URL")
    or ""
).rstrip("/")
KV_TOKEN = os.environ.get("KV_REST_API_TOKEN") or os.environ.get(
    "UPSTASH_REDIS_REST_TOKEN"
) or ""
USE_KV = bool(KV_URL and KV_TOKEN)
KV_KEY = os.environ.get("KV_KEY", "red-peppa-data")
_KV_HEADERS = {"Authorization": f"Bearer {KV_TOKEN}"}

EMPTY_DATA = {
    "users": [],      # {id, name, phone, email, birthday: "MM-DD"}
    "messages": [],   # {id, sender, to ("group" or user id), text, ts}
    "news": [],       # {id, author, text, ts}
    "jokes": [],      # {id, author, text, ts}
    "study": [],      # {id, author, subject, text, ts}
    "announcements": [],  # {id, author, text, ts}
    "calls": [],      # {id, caller, callee, offer, answer, state, cand_caller, cand_callee, ts}
    "call_log": [],   # {id, caller, callee, video, ts, answered, ended_ts}
    "reports": [],    # {id, reporter, reported, message_id, message_text, ts, status}
    "warnings": [],   # {id, user, text, ts, seen}
    "typing": {},     # {chat_id: {user_id: ts}}
}


def load_data() -> dict:
    if not USE_KV:
        if not DATA_FILE.exists():
            return json.loads(json.dumps(EMPTY_DATA))
        data = json.loads(DATA_FILE.read_text())
    else:
        r = requests.get(f"{KV_URL}/get/{KV_KEY}", headers=_KV_HEADERS, timeout=10)
        r.raise_for_status()
        result = r.json().get("result")
        data = json.loads(result) if result else json.loads(json.dumps(EMPTY_DATA))
    for key, default in EMPTY_DATA.items():
        data.setdefault(key, default)
    return data


def save_data(data: dict) -> None:
    if not USE_KV:
        DATA_FILE.write_text(json.dumps(data, indent=2))
        return
    r = requests.post(
        f"{KV_URL}/set/{KV_KEY}",
        headers={**_KV_HEADERS, "Content-Type": "application/json"},
        data=json.dumps(data),
        timeout=10,
    )
    r.raise_for_status()


def now_ts() -> float:
    return time.time()


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def get_user_or_404(data: dict, user_id: str) -> dict:
    for u in data["users"]:
        if u["id"] == user_id:
            return u
    raise HTTPException(status_code=404, detail="User not found")


def public_user(u: dict) -> dict:
    """User record without the password hash/salt."""
    return {
        "id": u["id"],
        "name": u["name"],
        "phone": u["phone"],
        "email": u["email"],
        "birthday": u["birthday"],
        "status": u.get("status", ""),
        "status_ts": u.get("status_ts", 0),
        "admin": bool(u.get("admin")),
        "last_seen": u.get("last_seen", 0),
    }


def touch_user(data: dict, uid: str) -> bool:
    """Stamp last_seen on a user (throttled to ~15s). Returns True if changed."""
    if not uid:
        return False
    for u in data["users"]:
        if u["id"] == uid:
            if now_ts() - u.get("last_seen", 0) > 15:
                u["last_seen"] = now_ts()
                return True
            return False
    return False


def hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), 60_000
    ).hex()


# ---------- models ----------


class UserIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=1, max_length=100)
    phone: str = Field(min_length=1, max_length=30)
    email: str = Field(min_length=1, max_length=120)
    birthday: str = Field(min_length=1, max_length=10)  # "MM-DD"


class UserUpdate(BaseModel):
    phone: Optional[str] = Field(default=None, max_length=30)
    email: Optional[str] = Field(default=None, max_length=120)
    birthday: Optional[str] = Field(default=None, max_length=10)
    password: Optional[str] = Field(default=None, max_length=100)
    status: Optional[str] = Field(default=None, max_length=120)


class LoginIn(BaseModel):
    name: str = Field(min_length=1)
    password: str = Field(min_length=1)


class MessageIn(BaseModel):
    sender: str
    to: str  # "group" or a user id
    text: str = Field(default="", max_length=2000)
    kind: str = Field(default="text", max_length=10)
    media: str = Field(default="", max_length=2000)
    reply_to: Optional[dict] = None  # {name, text} snapshot of quoted message


class MediaIn(BaseModel):
    data: str = Field(min_length=10, max_length=3_000_000)  # data URL


class PostIn(BaseModel):
    author: str
    text: str = Field(min_length=1, max_length=2000)


class StudyIn(BaseModel):
    author: str
    subject: str = Field(default="", max_length=60)
    text: str = Field(min_length=1, max_length=2000)


# ---------- users / directory ----------


@app.get("/api/users")
def list_users():
    data = load_data()
    return {
        "users": sorted(
            (public_user(u) for u in data["users"]), key=lambda u: u["name"].lower()
        )
    }


@app.post("/api/login")
def login(creds: LoginIn):
    data = load_data()
    for u in data["users"]:
        if u["name"].lower() == creds.name.strip().lower():
            if hash_password(creds.password, u["pw_salt"]) == u["pw_hash"]:
                return public_user(u)
            break
    raise HTTPException(status_code=401, detail="Wrong name or password")


@app.post("/api/users", status_code=201)
def create_user(user: UserIn):
    with _lock:
        data = load_data()
        name = user.name.strip()
        if any(u["name"].lower() == name.lower() for u in data["users"]):
            raise HTTPException(status_code=409, detail="That name is already taken")
        if user.birthday:
            try:
                datetime.strptime(user.birthday, "%m-%d")
            except ValueError:
                raise HTTPException(
                    status_code=400, detail="Birthday must be MM-DD (e.g. 03-14)"
                )
        salt = secrets.token_hex(16)
        record = {
            "id": new_id(),
            "name": name,
            "phone": user.phone.strip(),
            "email": user.email.strip(),
            "birthday": user.birthday.strip(),
            "pw_salt": salt,
            "pw_hash": hash_password(user.password, salt),
        }
        data["users"].append(record)
        save_data(data)
    return public_user(record)


@app.put("/api/users/{user_id}")
def update_user(user_id: str, update: UserUpdate):
    with _lock:
        data = load_data()
        user = get_user_or_404(data, user_id)
        if update.birthday is not None:
            if update.birthday:
                try:
                    datetime.strptime(update.birthday, "%m-%d")
                except ValueError:
                    raise HTTPException(
                        status_code=400, detail="Birthday must be MM-DD (e.g. 03-14)"
                    )
            user["birthday"] = update.birthday.strip()
        if update.phone is not None:
            user["phone"] = update.phone.strip()
        if update.email is not None:
            user["email"] = update.email.strip()
        if update.password:
            user["pw_salt"] = secrets.token_hex(16)
            user["pw_hash"] = hash_password(update.password, user["pw_salt"])
        if update.status is not None:
            user["status"] = update.status.strip()
            user["status_ts"] = now_ts()
        save_data(data)
    return public_user(user)


@app.delete("/api/users/{user_id}", status_code=204)
def delete_user(user_id: str):
    with _lock:
        data = load_data()
        get_user_or_404(data, user_id)
        data["users"] = [u for u in data["users"] if u["id"] != user_id]
        save_data(data)


# ---------- messages ----------


@app.get("/api/messages/group")
def group_messages(since: float = 0, me: str = ""):
    data = load_data()
    names = {u["id"]: u["name"] for u in data["users"]}
    all_ids = set(names)
    changed = touch_user(data, me)
    msgs = []
    for m in data["messages"]:
        if m["to"] != "group" or m["ts"] <= since:
            continue
        seen_by = m.setdefault("seen_by", {})
        if me and me in all_ids and me != m["sender"] and me not in seen_by:
            seen_by[me] = now_ts()
            changed = True
        seen = all(uid == m["sender"] or uid in seen_by for uid in all_ids)
        msgs.append({**m, "sender_name": names.get(m["sender"], "?"), "seen": seen})
    if changed:
        save_data(data)
    cutoff = now_ts() - 8
    typing = [
        names.get(uid, "?")
        for uid, ts in data.get("typing", {}).get("group", {}).items()
        if ts > cutoff and uid != me
    ]
    return {"messages": msgs, "typing": typing}


@app.get("/api/messages/dm/{other_id}")
def dm_messages(other_id: str, me: str, since: float = 0):
    data = load_data()
    users = {u["id"]: u for u in data["users"]}
    names = {uid: u["name"] for uid, u in users.items()}
    pair = {me, other_id}
    changed = touch_user(data, me)
    msgs = []
    for m in data["messages"]:
        if m["to"] == "group" or {m["sender"], m["to"]} != pair or m["ts"] <= since:
            continue
        seen_by = m.setdefault("seen_by", {})
        if m["to"] == me and me not in seen_by:
            seen_by[me] = now_ts()
            changed = True
        msgs.append(
            {**m, "sender_name": names.get(m["sender"], "?"), "seen": other_id in seen_by}
        )
    if changed:
        save_data(data)
    cutoff = now_ts() - 8
    ts = data.get("typing", {}).get(me, {}).get(other_id, 0)
    typing = [names.get(other_id, "?")] if ts > cutoff else []
    peer = users.get(other_id, {})
    return {
        "messages": msgs,
        "typing": typing,
        "peer_last_seen": peer.get("last_seen", 0),
    }


class TypingIn(BaseModel):
    user: str
    to: str


@app.post("/api/typing", status_code=204)
def set_typing(body: TypingIn):
    with _lock:
        data = load_data()
        touch_user(data, body.user)
        t = data.setdefault("typing", {})
        cutoff = now_ts() - 30
        for chat_key in t:
            t[chat_key] = {
                uid: ts for uid, ts in t[chat_key].items() if ts > cutoff
            }
        t.setdefault(body.to, {})[body.user] = now_ts()
        save_data(data)


# ---------- media (photos / gifs) ----------

MEDIA_DIR = Path(__file__).parent / "media"
MEDIA_PREFIX = "red-peppa-media:"


@app.post("/api/media", status_code=201)
def upload_media(media: MediaIn):
    if not media.data.startswith("data:image/"):
        raise HTTPException(status_code=400, detail="Only image data is allowed")
    mid = new_id()
    blob = json.dumps(media.data)
    if USE_KV:
        r = requests.post(
            f"{KV_URL}/set/{MEDIA_PREFIX}{mid}",
            headers={**_KV_HEADERS, "Content-Type": "application/json"},
            data=blob,
            timeout=15,
        )
        r.raise_for_status()
    else:
        MEDIA_DIR.mkdir(exist_ok=True)
        (MEDIA_DIR / mid).write_text(media.data)
    return {"id": mid}


@app.get("/api/media/{media_id}")
def get_media(media_id: str):
    if not media_id.isalnum() or len(media_id) > 20:
        raise HTTPException(status_code=404, detail="Not found")
    if USE_KV:
        r = requests.get(
            f"{KV_URL}/get/{MEDIA_PREFIX}{media_id}", headers=_KV_HEADERS, timeout=10
        )
        result = r.json().get("result")
        if result is None:
            raise HTTPException(status_code=404, detail="Not found")
        data_url = json.loads(result)
    else:
        f = MEDIA_DIR / media_id
        if not f.exists():
            raise HTTPException(status_code=404, detail="Not found")
        data_url = f.read_text().strip()
    try:
        header, b64 = data_url.split(",", 1)
        mime = header[5:].split(";")[0] or "image/jpeg"
        return Response(content=base64.b64decode(b64), media_type=mime)
    except Exception:
        raise HTTPException(status_code=404, detail="Not found")


@app.post("/api/messages", status_code=201)
def send_message(msg: MessageIn):
    with _lock:
        data = load_data()
        get_user_or_404(data, msg.sender)
        touch_user(data, msg.sender)
        if msg.to != "group":
            get_user_or_404(data, msg.to)
        text = msg.text.strip()
        kind = msg.kind if msg.kind in ("text", "image", "sticker") else "text"
        media = msg.media.strip()
        if kind in ("text", "sticker") and not text:
            raise HTTPException(status_code=400, detail="Message text is required")
        if kind == "image" and not (
            media.startswith("media:")
            or media.startswith("http://")
            or media.startswith("https://")
            or media.startswith("/")
        ):
            raise HTTPException(status_code=400, detail="Image needs a media id or URL")
        record = {
            "id": new_id(),
            "sender": msg.sender,
            "to": msg.to,
            "text": text,
            "kind": kind,
            "media": media if kind == "image" else "",
            "reactions": [],  # [{user, emoji}]
            "reply_to": msg.reply_to,
            "ts": now_ts(),
        }
        data["messages"].append(record)
        save_data(data)
    return record


class MessageEdit(BaseModel):
    text: str = Field(min_length=1)


@app.patch("/api/messages/{message_id}")
def edit_message(message_id: str, body: MessageEdit):
    with _lock:
        data = load_data()
        msg = next(
            (m for m in data["messages"] if m["id"] == message_id), None
        )
        if msg is None:
            raise HTTPException(status_code=404, detail="Message not found")
        if msg.get("kind", "text") != "text":
            raise HTTPException(
                status_code=400, detail="Only text messages can be edited"
            )
        msg["text"] = body.text
        msg["edited"] = True
        save_data(data)
        return msg


@app.delete("/api/messages/{message_id}", status_code=204)
def delete_message(message_id: str):
    with _lock:
        data = load_data()
        msg = next(
            (m for m in data["messages"] if m["id"] == message_id), None
        )
        if msg is None:
            raise HTTPException(status_code=404, detail="Message not found")
        data["messages"] = [
            m for m in data["messages"] if m["id"] != message_id
        ]
        save_data(data)
    media = msg.get("media", "")
    if media.startswith("media:"):
        mid = media[6:]
        if USE_KV:
            requests.post(
                f"{KV_URL}/del/{MEDIA_PREFIX}{mid}", headers=_KV_HEADERS, timeout=10
            )
        else:
            (MEDIA_DIR / mid).unlink(missing_ok=True)


@app.get("/api/chats/{user_id}")
def chat_list(user_id: str):
    """For the chat list tab: every classmate + the group, with the last
    message and unread-ish info (just last message + timestamp)."""
    data = load_data()
    users = {u["id"]: u for u in data["users"]}
    get_user_or_404(data, user_id)
    if touch_user(data, user_id):
        save_data(data)

    last_group = None
    last_dm: dict[str, dict] = {}
    for m in data["messages"]:
        if m["to"] == "group":
            last_group = m
        elif m["sender"] == user_id:
            last_dm[m["to"]] = m
        elif m["to"] == user_id:
            last_dm[m["sender"]] = m

    all_ids = set(users)
    chats = []
    for uid, u in users.items():
        if uid == user_id:
            continue
        last = last_dm.get(uid)
        chats.append(
            {
                "id": uid,
                "name": u["name"],
                "group": False,
                "last_text": last["text"] if last else "",
                "last_ts": last["ts"] if last else 0,
                "last_kind": last.get("kind", "text") if last else "text",
                "last_mine": bool(last and last["sender"] == user_id),
                "seen": bool(last and last["sender"] == user_id and uid in last.get("seen_by", {})),
                "last_seen": u.get("last_seen", 0),
            }
        )
    group_seen = bool(
        last_group
        and last_group["sender"] == user_id
        and all(
            uid == user_id or uid in last_group.get("seen_by", {}) for uid in all_ids
        )
    )
    chats.insert(
        0,
        {
            "id": "group",
            "name": "Class Group",
            "group": True,
            "last_text": last_group["text"] if last_group else "",
            "last_ts": last_group["ts"] if last_group else 0,
            "last_kind": last_group.get("kind", "text") if last_group else "text",
            "last_mine": bool(last_group and last_group["sender"] == user_id),
            "seen": group_seen,
        },
    )
    return {"chats": chats}


# ---------- news ----------


@app.get("/api/news")
def list_news():
    data = load_data()
    names = {u["id"]: u["name"] for u in data["users"]}
    items = [
        {**n, "author_name": names.get(n["author"], "?")}
        for n in data["news"]
    ]
    items.sort(key=lambda n: n["ts"], reverse=True)
    return {"news": items}


@app.post("/api/news", status_code=201)
def post_news(post: PostIn):
    with _lock:
        data = load_data()
        get_user_or_404(data, post.author)
        record = {
            "id": new_id(),
            "author": post.author,
            "text": post.text.strip(),
            "ts": now_ts(),
        }
        data["news"].append(record)
        save_data(data)
    return record


# ---------- announcements ----------


@app.get("/api/announcements")
def list_announcements():
    data = load_data()
    names = {u["id"]: u["name"] for u in data["users"]}
    items = [
        {**a, "author_name": names.get(a["author"], "?")}
        for a in data["announcements"]
    ]
    items.sort(key=lambda a: a["ts"], reverse=True)
    return {"announcements": items}


@app.post("/api/announcements", status_code=201)
def post_announcement(post: PostIn):
    with _lock:
        data = load_data()
        get_user_or_404(data, post.author)
        record = {
            "id": new_id(),
            "author": post.author,
            "text": post.text.strip(),
            "ts": now_ts(),
        }
        data["announcements"].append(record)
        save_data(data)
    return record


# ---------- study board ----------


@app.get("/api/study")
def list_study():
    data = load_data()
    names = {u["id"]: u["name"] for u in data["users"]}
    items = [
        {**s, "author_name": names.get(s["author"], "?")}
        for s in data["study"]
    ]
    items.sort(key=lambda s: s["ts"], reverse=True)
    return {"posts": items}


@app.post("/api/study", status_code=201)
def post_study(post: StudyIn):
    with _lock:
        data = load_data()
        get_user_or_404(data, post.author)
        record = {
            "id": new_id(),
            "author": post.author,
            "subject": post.subject.strip(),
            "text": post.text.strip(),
            "ts": now_ts(),
        }
        data["study"].append(record)
        save_data(data)
    return record


# ---------- jokes ----------


@app.get("/api/jokes")
def list_jokes():
    data = load_data()
    names = {u["id"]: u["name"] for u in data["users"]}
    jokes = [{**j, "author_name": names.get(j["author"], "?")} for j in data["jokes"]]
    jokes.sort(key=lambda j: j["ts"], reverse=True)

    joke_of_the_day = None
    if jokes:
        idx = date.today().toordinal() % len(jokes)
        # jokes is newest-first; index into the chronological list instead
        chronological = list(reversed(jokes))
        joke_of_the_day = chronological[idx]

    return {"joke_of_the_day": joke_of_the_day, "jokes": jokes}


@app.post("/api/jokes", status_code=201)
def post_joke(post: PostIn):
    with _lock:
        data = load_data()
        get_user_or_404(data, post.author)
        record = {
            "id": new_id(),
            "author": post.author,
            "text": post.text.strip(),
            "ts": now_ts(),
        }
        data["jokes"].append(record)
        save_data(data)
    return record


# ---------- birthdays ----------


@app.get("/api/birthdays")
def list_birthdays():
    data = load_data()
    today = date.today()
    result = []
    for u in data["users"]:
        if not u.get("birthday"):
            continue
        try:
            month, day = (int(p) for p in u["birthday"].split("-"))
        except ValueError:
            continue
        try:
            next_bday = date(today.year, month, day)
        except ValueError:
            continue  # e.g. Feb 29 stored as 02-29 on a non-leap year edge
        if next_bday < today:
            try:
                next_bday = date(today.year + 1, month, day)
            except ValueError:
                continue
        result.append(
            {
                "id": u["id"],
                "name": u["name"],
                "birthday": u["birthday"],
                "days_until": (next_bday - today).days,
                "today": next_bday == today,
            }
        )
    result.sort(key=lambda b: b["days_until"])
    return {"birthdays": result}


class ReactIn(BaseModel):
    user: str
    emoji: str = Field(min_length=1, max_length=8)


@app.post("/api/messages/{message_id}/react")
def react_message(message_id: str, body: ReactIn):
    with _lock:
        data = load_data()
        msg = next(
            (m for m in data["messages"] if m["id"] == message_id), None
        )
        if msg is None:
            raise HTTPException(status_code=404, detail="Message not found")
        get_user_or_404(data, body.user)
        reactions = msg.setdefault("reactions", [])
        existing = next(
            (r for r in reactions if r["user"] == body.user), None
        )
        if existing:
            reactions.remove(existing)
            if existing["emoji"] == body.emoji:
                save_data(data)
                return msg  # same emoji again = toggle off
        reactions.append({"user": body.user, "emoji": body.emoji})
        save_data(data)
        return msg


# ---------- voice calls (WebRTC signaling via polling) ----------

CALL_TTL = 120  # seconds before a stale call doc is dropped


def _log_call(data: dict, call: dict) -> None:
    """Append a finished call to the call log (deduped, capped at 100)."""
    log = data.setdefault("call_log", [])
    if any(e["id"] == call["id"] for e in log):
        return
    log.append(
        {
            "id": call["id"],
            "caller": call["caller"],
            "callee": call["callee"],
            "video": bool(call.get("video")),
            "ts": call["ts"],
            "answered": call["state"] == "active",
            "ended_ts": now_ts(),
        }
    )
    del log[:-100]


def _prune_calls(data: dict) -> None:
    cutoff = now_ts() - CALL_TTL
    dropped = [
        c for c in data["calls"]
        if c["state"] == "ended"
        or (c["state"] == "ringing" and c["ts"] < cutoff)
    ]
    data["calls"] = [c for c in data["calls"] if c not in dropped]
    for c in dropped:
        _log_call(data, c)


def _find_call(data: dict, call_id: str) -> dict:
    for c in data["calls"]:
        if c["id"] == call_id:
            return c
    raise HTTPException(status_code=404, detail="Call not found")


class CallStart(BaseModel):
    caller: str
    callee: str
    offer: dict
    video: bool = False


class CallAnswer(BaseModel):
    answer: dict


class CallCand(BaseModel):
    who: str  # "caller" or "callee"
    candidate: dict


@app.post("/api/calls", status_code=201)
def start_call(body: CallStart):
    with _lock:
        data = load_data()
        get_user_or_404(data, body.caller)
        get_user_or_404(data, body.callee)
        _prune_calls(data)
        pair = {body.caller, body.callee}
        replaced = [
            c for c in data["calls"]
            if {c["caller"], c["callee"]} == pair
        ]
        data["calls"] = [
            c for c in data["calls"]
            if {c["caller"], c["callee"]} != pair
        ]
        for c in replaced:
            _log_call(data, c)
        call = {
            "id": new_id(),
            "caller": body.caller,
            "callee": body.callee,
            "offer": body.offer,
            "answer": None,
            "offer2": None,  # renegotiation offer (voice -> video upgrade)
            "answer2": None,
            "state": "ringing",
            "video": body.video,
            "hand_caller": False,
            "hand_callee": False,
            "chat": [],  # [{who, name, text, ts}]
            "cand_caller": [],
            "cand_callee": [],
            "ts": now_ts(),
        }
        data["calls"].append(call)
        save_data(data)
    return {"id": call["id"]}


@app.get("/api/calls/incoming/{user_id}")
def incoming_call(user_id: str):
    data = load_data()
    ringing = [
        c for c in data["calls"]
        if c["callee"] == user_id and c["state"] == "ringing"
    ]
    if not ringing:
        return {"call": None}
    call = ringing[-1]
    names = {u["id"]: u["name"] for u in data["users"]}
    return {"call": {**call, "caller_name": names.get(call["caller"], "?")}}


@app.get("/api/calls/{call_id}")
def get_call(call_id: str):
    data = load_data()
    return _find_call(data, call_id)


@app.post("/api/calls/{call_id}/answer")
def answer_call(call_id: str, body: CallAnswer):
    with _lock:
        data = load_data()
        call = _find_call(data, call_id)
        call["answer"] = body.answer
        call["state"] = "active"
        save_data(data)
    return {"ok": True}


class SdpIn(BaseModel):
    sdp: dict


@app.post("/api/calls/{call_id}/offer2")
def reoffer_call(call_id: str, body: SdpIn):
    """Mid-call renegotiation offer — used to upgrade voice -> video."""
    with _lock:
        data = load_data()
        call = _find_call(data, call_id)
        call["offer2"] = body.sdp
        call["video"] = True
        save_data(data)
    return {"ok": True}


@app.post("/api/calls/{call_id}/answer2")
def reanswer_call(call_id: str, body: SdpIn):
    with _lock:
        data = load_data()
        call = _find_call(data, call_id)
        call["answer2"] = body.sdp
        save_data(data)
    return {"ok": True}


@app.post("/api/calls/{call_id}/candidate")
def add_candidate(call_id: str, body: CallCand):
    with _lock:
        data = load_data()
        call = _find_call(data, call_id)
        key = "cand_caller" if body.who == "caller" else "cand_callee"
        call[key].append(body.candidate)
        save_data(data)
    return {"ok": True}


@app.post("/api/calls/{call_id}/end")
def end_call(call_id: str):
    with _lock:
        data = load_data()
        for c in data["calls"]:
            if c["id"] == call_id:
                _log_call(data, c)
                c["state"] = "ended"
                save_data(data)
                break
    return {"ok": True}


@app.get("/api/calls/log/{user_id}")
def call_log(user_id: str):
    """Recent calls involving this user, newest first."""
    data = load_data()
    get_user_or_404(data, user_id)
    names = {u["id"]: u["name"] for u in data["users"]}
    entries = [
        {
            **e,
            "caller_name": names.get(e["caller"], "?"),
            "callee_name": names.get(e["callee"], "?"),
        }
        for e in reversed(data.get("call_log", []))
        if user_id in (e["caller"], e["callee"])
    ]
    return {"calls": entries}


class HandIn(BaseModel):
    who: str
    up: bool


class CallChatIn(BaseModel):
    who: str
    name: str
    text: str = Field(min_length=1, max_length=500)


@app.post("/api/calls/{call_id}/hand")
def raise_hand(call_id: str, body: HandIn):
    with _lock:
        data = load_data()
        call = _find_call(data, call_id)
        key = "hand_caller" if body.who == "caller" else "hand_callee"
        call[key] = body.up
        save_data(data)
    return {"ok": True}


@app.post("/api/calls/{call_id}/chat")
def call_chat(call_id: str, body: CallChatIn):
    with _lock:
        data = load_data()
        call = _find_call(data, call_id)
        call.setdefault("chat", []).append(
            {
                "who": body.who,
                "name": body.name,
                "text": body.text.strip(),
                "ts": now_ts(),
            }
        )
        save_data(data)
    return {"ok": True}


# ---------- reports & warnings ----------


class ReportIn(BaseModel):
    reporter: str
    message_id: str


class ResolveIn(BaseModel):
    warn: bool = False
    text: str = Field(default="", max_length=500)


@app.post("/api/reports", status_code=201)
def create_report(body: ReportIn):
    with _lock:
        data = load_data()
        get_user_or_404(data, body.reporter)
        msg = next(
            (m for m in data["messages"] if m["id"] == body.message_id), None
        )
        if msg is None:
            raise HTTPException(status_code=404, detail="Message not found")
        dup = any(
            r["reporter"] == body.reporter
            and r["message_id"] == body.message_id
            and r["status"] == "pending"
            for r in data["reports"]
        )
        if dup:
            raise HTTPException(status_code=409, detail="Already reported")
        record = {
            "id": new_id(),
            "reporter": body.reporter,
            "reported": msg["sender"],
            "message_id": msg["id"],
            "message_text": (msg.get("text") or "📷 Photo")[:300],
            "ts": now_ts(),
            "status": "pending",
        }
        data["reports"].append(record)
        save_data(data)
    return record


@app.get("/api/reports")
def list_reports():
    data = load_data()
    names = {u["id"]: u["name"] for u in data["users"]}
    items = [
        {
            **r,
            "reporter_name": names.get(r["reporter"], "?"),
            "reported_name": names.get(r["reported"], "?"),
        }
        for r in data["reports"]
    ]
    items.sort(key=lambda r: r["ts"], reverse=True)
    return {"reports": items}


@app.post("/api/reports/{report_id}/resolve")
def resolve_report(report_id: str, body: ResolveIn):
    with _lock:
        data = load_data()
        rep = next(
            (r for r in data["reports"] if r["id"] == report_id), None
        )
        if rep is None:
            raise HTTPException(status_code=404, detail="Report not found")
        rep["status"] = "resolved"
        if body.warn:
            data["warnings"].append(
                {
                    "id": new_id(),
                    "user": rep["reported"],
                    "text": body.text.strip()
                    or "You received a warning for a reported message.",
                    "ts": now_ts(),
                    "seen": False,
                }
            )
        save_data(data)
    return {"ok": True}


@app.get("/api/warnings/{user_id}")
def get_warnings(user_id: str):
    data = load_data()
    return {
        "warnings": [
            w
            for w in data["warnings"]
            if w["user"] == user_id and not w["seen"]
        ]
    }


@app.post("/api/warnings/{warning_id}/seen")
def ack_warning(warning_id: str):
    with _lock:
        data = load_data()
        for w in data["warnings"]:
            if w["id"] == warning_id:
                w["seen"] = True
        save_data(data)
    return {"ok": True}


@app.get("/api/version")
def version():
    return {
        "version": "1.0.0",
        "env": "vercel" if os.environ.get("VERCEL") else "local",
        "storage": "kv" if USE_KV else "file",
    }

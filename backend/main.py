"""Class chat backend.

A WhatsApp-style app for one class: 1-on-1 chats, a group chat, a class
directory (phone + email), class news, a study/homework board, a joke of
the day, and a birthday list.

Data is persisted to data.json locally. When deployed on Vercel (read-only
filesystem) it uses an Upstash KV (Redis) store if the env vars are set —
same pattern as the portfolio backend.
"""

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
from fastapi import FastAPI, HTTPException
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
KV_KEY = "class-app-data"
_KV_HEADERS = {"Authorization": f"Bearer {KV_TOKEN}"}

EMPTY_DATA = {
    "users": [],      # {id, name, phone, email, birthday: "MM-DD"}
    "messages": [],   # {id, sender, to ("group" or user id), text, ts}
    "news": [],       # {id, author, text, ts}
    "jokes": [],      # {id, author, text, ts}
    "study": [],      # {id, author, subject, text, ts}
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
        headers=_KV_HEADERS,
        json={"value": json.dumps(data)},
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
    }


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
    text: str = Field(min_length=1, max_length=2000)


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
def group_messages(since: float = 0):
    data = load_data()
    names = {u["id"]: u["name"] for u in data["users"]}
    msgs = [
        {**m, "sender_name": names.get(m["sender"], "?")}
        for m in data["messages"]
        if m["to"] == "group" and m["ts"] > since
    ]
    return {"messages": msgs}


@app.get("/api/messages/dm/{other_id}")
def dm_messages(other_id: str, me: str, since: float = 0):
    data = load_data()
    names = {u["id"]: u["name"] for u in data["users"]}
    pair = {me, other_id}
    msgs = [
        {**m, "sender_name": names.get(m["sender"], "?")}
        for m in data["messages"]
        if m["to"] != "group" and {m["sender"], m["to"]} == pair and m["ts"] > since
    ]
    return {"messages": msgs}


@app.post("/api/messages", status_code=201)
def send_message(msg: MessageIn):
    with _lock:
        data = load_data()
        get_user_or_404(data, msg.sender)
        if msg.to != "group":
            get_user_or_404(data, msg.to)
        record = {
            "id": new_id(),
            "sender": msg.sender,
            "to": msg.to,
            "text": msg.text.strip(),
            "ts": now_ts(),
        }
        data["messages"].append(record)
        save_data(data)
    return record


@app.get("/api/chats/{user_id}")
def chat_list(user_id: str):
    """For the chat list tab: every classmate + the group, with the last
    message and unread-ish info (just last message + timestamp)."""
    data = load_data()
    users = {u["id"]: u for u in data["users"]}
    get_user_or_404(data, user_id)

    last_group = None
    last_dm: dict[str, dict] = {}
    for m in data["messages"]:
        if m["to"] == "group":
            last_group = m
        elif m["sender"] == user_id:
            last_dm[m["to"]] = m
        elif m["to"] == user_id:
            last_dm[m["sender"]] = m

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
            }
        )
    chats.insert(
        0,
        {
            "id": "group",
            "name": "Class Group",
            "group": True,
            "last_text": last_group["text"] if last_group else "",
            "last_ts": last_group["ts"] if last_group else 0,
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


@app.get("/api/version")
def version():
    return {
        "version": "1.0.0",
        "env": "vercel" if os.environ.get("VERCEL") else "local",
        "storage": "kv" if USE_KV else "file",
    }

"""AUSTIN-Lang Database Service.

FastAPI service backed by two SQLite files:
  - users.db    identity (login, profiles, clients, local session metadata)
  - platform.db everything else (groups, datasets, transcripts, metrics, ...)

Phase 1 scope (auth pilot):
  POST /auth/login    verify email + password against users.db, set JWT cookie
  POST /auth/logout   clear JWT cookie
  GET  /auth/me       return the caller's user record

Transcript endpoints (pre-existing) are kept and now read from platform.db:
  /audio-files/ ...
  /raw-transcripts/ ...
  /edited-transcripts/ ...

JWT is issued as an HttpOnly cookie named `token` with a 12-hour expiry.
Signing key is read from env var JWT_SECRET (fallback for dev only).
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, List, Optional

import bcrypt
from fastapi import Cookie, Depends, FastAPI, HTTPException, Response, status
from jose import JWTError, jwt
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware

HERE = Path(__file__).resolve().parent
USERS_DB = HERE / "users.db"
PLATFORM_DB = HERE / "platform.db"

JWT_SECRET = os.environ.get(
    "JWT_SECRET",
    "dev-only-not-for-production-please-set-JWT_SECRET",
)
JWT_ALGORITHM = "HS256"
JWT_TTL = timedelta(hours=12)
COOKIE_NAME = "token"

app = FastAPI(title="AUSTIN-Lang Database Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost", "http://localhost:3000"],
    allow_credentials=True,  # required for cookie-based auth
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Connection helpers ────────────────────────────────────────────────────

@contextmanager
def _connect(path: Path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def fetch_all(path: Path, sql: str, params: Iterable[Any] = ()) -> List[dict]:
    with _connect(path) as conn:
        return [dict(r) for r in conn.execute(sql, tuple(params)).fetchall()]


def fetch_one(path: Path, sql: str, params: Iterable[Any] = ()) -> Optional[dict]:
    with _connect(path) as conn:
        row = conn.execute(sql, tuple(params)).fetchone()
        return dict(row) if row else None


def execute(path: Path, sql: str, params: Iterable[Any] = ()) -> int:
    with _connect(path) as conn:
        with conn:
            cur = conn.execute(sql, tuple(params))
            return cur.lastrowid


# ─── Auth ──────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class AuthUser(BaseModel):
    id: str
    email: str
    name: str
    role: str


def _verify_password(plaintext: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plaintext.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _issue_jwt(user_id: str) -> str:
    now = datetime.now(tz=timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + JWT_TTL).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_jwt(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


def _load_user_by_id(user_id: str) -> Optional[dict]:
    return fetch_one(
        USERS_DB,
        'SELECT id, email, name, role FROM "user" WHERE id = ?',
        (user_id,),
    )


def get_current_user(token: Optional[str] = Cookie(default=None)) -> AuthUser:
    """Dependency that verifies the JWT cookie and returns the current user."""
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No session")
    try:
        payload = _decode_jwt(token)
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session")
    user = _load_user_by_id(user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown user")
    return AuthUser(**user)


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=int(JWT_TTL.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=False,  # dev; flip to True behind HTTPS
        path="/",
    )


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/")


@app.post("/auth/login", response_model=AuthUser)
def login(data: LoginRequest, response: Response) -> AuthUser:
    row = fetch_one(
        USERS_DB,
        'SELECT id, email, name, role, password_hash FROM "user" WHERE email = ?',
        (data.email,),
    )
    if not row or not _verify_password(data.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

    token = _issue_jwt(row["id"])
    _set_auth_cookie(response, token)
    return AuthUser(id=row["id"], email=row["email"], name=row["name"], role=row["role"])


@app.post("/auth/logout")
def logout(response: Response) -> dict:
    _clear_auth_cookie(response)
    return {"ok": True}


@app.get("/auth/me", response_model=AuthUser)
def me(current_user: AuthUser = Depends(get_current_user)) -> AuthUser:
    return current_user


# ─── Pre-existing transcript endpoints (now on platform.db) ────────────────
# NOTE: Kept compatible with the v1 signatures. For routes that write, auth is
# enforced via Depends(get_current_user) so unauthenticated callers can't
# mutate data.

class AudioFileBase(BaseModel):
    file_name: str


class AudioFileCreate(AudioFileBase):
    pass


class AudioFile(AudioFileBase):
    id: int
    uploaded_at: str


class RawTranscriptSegment(BaseModel):
    id: Optional[int] = None
    start: float
    end: float
    text: str


class RawTranscriptBase(BaseModel):
    rating: Optional[int] = None
    audio_file_id: int
    transcript_segments: List[RawTranscriptSegment]


class RawTranscriptCreate(RawTranscriptBase):
    pass


class RawTranscript(RawTranscriptBase):
    id: int
    created_at: str


class TranscriptSegment(BaseModel):
    id: Optional[int] = None
    start: float
    end: float
    text: str


class EditedTranscriptBase(BaseModel):
    raw_transcript_id: int
    transcript_segments: List[TranscriptSegment]


class EditedTranscriptCreate(EditedTranscriptBase):
    pass


class EditedTranscript(EditedTranscriptBase):
    id: int
    created_at: str


@app.get("/audio-files/", response_model=List[AudioFile])
def get_audio_files(_: AuthUser = Depends(get_current_user)) -> List[dict]:
    return fetch_all(PLATFORM_DB, "SELECT id, file_name, uploaded_at FROM audio_file")


@app.get("/audio-files/{file_id}", response_model=AudioFile)
def get_audio_file(file_id: int, _: AuthUser = Depends(get_current_user)) -> dict:
    row = fetch_one(
        PLATFORM_DB,
        "SELECT id, file_name, uploaded_at FROM audio_file WHERE id = ?",
        (file_id,),
    )
    if not row:
        raise HTTPException(404, "Audio file not found")
    return row


@app.post("/audio-files/", response_model=int)
def create_audio_file(data: AudioFileCreate, _: AuthUser = Depends(get_current_user)) -> int:
    return execute(
        PLATFORM_DB,
        "INSERT INTO audio_file (file_name) VALUES (?)",
        (data.file_name,),
    )


@app.put("/audio-files/{file_id}")
def update_audio_file(
    file_id: int,
    data: AudioFileCreate,
    _: AuthUser = Depends(get_current_user),
) -> dict:
    execute(
        PLATFORM_DB,
        "UPDATE audio_file SET file_name = ? WHERE id = ?",
        (data.file_name, file_id),
    )
    return {"message": "Updated successfully"}


@app.get("/raw-transcripts/", response_model=List[RawTranscript])
def get_raw_transcripts(
    audio_file_id: Optional[int] = None,
    _: AuthUser = Depends(get_current_user),
) -> List[dict]:
    if audio_file_id is not None:
        rows = fetch_all(
            PLATFORM_DB,
            "SELECT * FROM raw_transcript WHERE audio_file_id = ?",
            (audio_file_id,),
        )
    else:
        rows = fetch_all(PLATFORM_DB, "SELECT * FROM raw_transcript")

    out = []
    for rt in rows:
        segs = fetch_all(
            PLATFORM_DB,
            "SELECT id, start, end, text FROM raw_transcript_segment WHERE raw_transcript_id = ?",
            (rt["id"],),
        )
        out.append({**rt, "transcript_segments": segs})
    return out


@app.post("/raw-transcripts/", response_model=int)
def create_raw_transcript(
    data: RawTranscriptCreate,
    _: AuthUser = Depends(get_current_user),
) -> int:
    raw_id = execute(
        PLATFORM_DB,
        "INSERT INTO raw_transcript (rating, audio_file_id) VALUES (?, ?)",
        (data.rating, data.audio_file_id),
    )
    for seg in data.transcript_segments:
        execute(
            PLATFORM_DB,
            """INSERT INTO raw_transcript_segment
               (raw_transcript_id, start, end, text) VALUES (?, ?, ?, ?)""",
            (raw_id, seg.start, seg.end, seg.text),
        )
    return raw_id


@app.put("/raw-transcripts/{transcript_id}")
def update_raw_transcript(
    transcript_id: int,
    data: RawTranscriptCreate,
    _: AuthUser = Depends(get_current_user),
) -> dict:
    execute(
        PLATFORM_DB,
        "UPDATE raw_transcript SET rating = ? WHERE id = ?",
        (data.rating, transcript_id),
    )
    execute(
        PLATFORM_DB,
        "DELETE FROM raw_transcript_segment WHERE raw_transcript_id = ?",
        (transcript_id,),
    )
    for seg in data.transcript_segments:
        execute(
            PLATFORM_DB,
            """INSERT INTO raw_transcript_segment
               (raw_transcript_id, start, end, text) VALUES (?, ?, ?, ?)""",
            (transcript_id, seg.start, seg.end, seg.text),
        )
    return {"message": "Updated successfully"}


@app.get("/edited-transcripts/", response_model=List[EditedTranscript])
def get_edited_transcripts(
    raw_transcript_id: Optional[int] = None,
    _: AuthUser = Depends(get_current_user),
) -> List[dict]:
    if raw_transcript_id is not None:
        rows = fetch_all(
            PLATFORM_DB,
            "SELECT * FROM edited_transcript WHERE raw_transcript_id = ?",
            (raw_transcript_id,),
        )
    else:
        rows = fetch_all(PLATFORM_DB, "SELECT * FROM edited_transcript")

    out = []
    for et in rows:
        segs = fetch_all(
            PLATFORM_DB,
            "SELECT id, start, end, text FROM edited_transcript_segment WHERE edited_transcript_id = ?",
            (et["id"],),
        )
        out.append({**et, "transcript_segments": segs})
    return out


@app.post("/edited-transcripts/", response_model=int)
def create_edited_transcript(
    data: EditedTranscriptCreate,
    _: AuthUser = Depends(get_current_user),
) -> int:
    edited_id = execute(
        PLATFORM_DB,
        "INSERT INTO edited_transcript (raw_transcript_id) VALUES (?)",
        (data.raw_transcript_id,),
    )
    for seg in data.transcript_segments:
        execute(
            PLATFORM_DB,
            """INSERT INTO edited_transcript_segment
               (edited_transcript_id, start, end, text) VALUES (?, ?, ?, ?)""",
            (edited_id, seg.start, seg.end, seg.text),
        )
    return edited_id


@app.put("/edited-transcripts/{transcript_id}")
def update_edited_transcript(
    transcript_id: int,
    data: EditedTranscriptCreate,
    _: AuthUser = Depends(get_current_user),
) -> dict:
    execute(
        PLATFORM_DB,
        "DELETE FROM edited_transcript_segment WHERE edited_transcript_id = ?",
        (transcript_id,),
    )
    for seg in data.transcript_segments:
        execute(
            PLATFORM_DB,
            """INSERT INTO edited_transcript_segment
               (edited_transcript_id, start, end, text) VALUES (?, ?, ?, ?)""",
            (transcript_id, seg.start, seg.end, seg.text),
        )
    return {"message": "Updated successfully"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)

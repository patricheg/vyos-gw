"""Web-UI authentication: local admin password + signed session cookie.

The password gate protects the console only — all device operations are
performed by the backend through the VyOS API key regardless of who logged
in. Password hash (pbkdf2) and the session secret live in backend/data/.
"""
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Optional, Tuple

from fastapi import HTTPException, Request

from app.config import settings

_DATA_DIR = settings.data_dir or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
_AUTH_PATH = os.path.join(_DATA_DIR, "auth.json")
_SECRET_PATH = os.path.join(_DATA_DIR, "secret.key")

COOKIE_NAME = "vgw_session"
SESSION_TTL = 24 * 3600
_PBKDF2_ROUNDS = 200_000

_MAX_FAILURES = 5
_LOCKOUT_SECONDS = 60
_failures: list = []  # timestamps of recent failed logins
_locked_until: float = 0.0


def _secret() -> bytes:
    os.makedirs(_DATA_DIR, exist_ok=True)
    if not os.path.exists(_SECRET_PATH):
        with open(_SECRET_PATH, "w") as f:
            f.write(secrets.token_hex(32))
        try:
            os.chmod(_SECRET_PATH, 0o600)
        except OSError:
            pass
    with open(_SECRET_PATH) as f:
        return f.read().strip().encode()


def is_configured() -> bool:
    return os.path.exists(_AUTH_PATH)


def set_password(username: str, password: str) -> None:
    os.makedirs(_DATA_DIR, exist_ok=True)
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ROUNDS)
    tmp = _AUTH_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"username": username, "salt": salt, "hash": digest.hex()}, f)
    os.replace(tmp, _AUTH_PATH)
    try:
        os.chmod(_AUTH_PATH, 0o600)
    except OSError:
        pass


def _load() -> Optional[dict]:
    try:
        with open(_AUTH_PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def verify_password(username: str, password: str) -> bool:
    data = _load()
    if not data:
        return False
    if username != data.get("username"):
        return False
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(data["salt"]), _PBKDF2_ROUNDS
    )
    return hmac.compare_digest(digest.hex(), data["hash"])


# ─── Brute-force guard ────────────────────────────────────────────


def lockout_remaining() -> int:
    return max(0, int(_locked_until - time.time()))


def record_failure() -> None:
    global _locked_until
    now = time.time()
    _failures[:] = [t for t in _failures if now - t < 600]
    _failures.append(now)
    if len(_failures) >= _MAX_FAILURES:
        _failures.clear()
        _locked_until = now + _LOCKOUT_SECONDS


def record_success() -> None:
    global _locked_until
    _failures.clear()
    _locked_until = 0.0


# ─── Session tokens ───────────────────────────────────────────────


def _sign(payload: str) -> str:
    return hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()


def make_token(username: str) -> str:
    payload = f"{username}:{int(time.time()) + SESSION_TTL}"
    return f"{payload}:{_sign(payload)}"


def check_token(token: str) -> bool:
    try:
        username, expiry, sig = token.rsplit(":", 2)
    except ValueError:
        return False
    if not hmac.compare_digest(sig, _sign(f"{username}:{expiry}")):
        return False
    data = _load()
    if not data or username != data.get("username"):
        return False
    return int(expiry) > time.time()


def require_auth(request: Request) -> None:
    """FastAPI dependency — 401 unless a valid session cookie is present."""
    token = request.cookies.get(COOKIE_NAME, "")
    if not token or not check_token(token):
        raise HTTPException(status_code=401, detail="Not authenticated")

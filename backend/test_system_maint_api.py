"""Smoke-test /api/system save + backup against the live router via TestClient."""
import io
import sys

sys.path.insert(0, ".")
from fastapi.testclient import TestClient
from app.main import app
from app.services import auth

with TestClient(app) as c:
    # bypass the login form: mint a session cookie directly
    username = (auth._load() or {}).get("username", "admin")
    c.cookies.set(auth.COOKIE_NAME, auth.make_token(username))

    r = c.get("/api/health")
    print("health:", r.status_code, r.json())

    r = c.post("/api/system/save")
    print("save:", r.status_code, r.json())

    r = c.get("/api/system/backup")
    print("backup:", r.status_code, r.headers.get("content-disposition"))
    text = r.text
    lines = [l for l in text.splitlines() if l.strip()]
    print("backup lines:", len(lines), "first:", lines[0][:80] if lines else None)

    # restore validation: garbage file must be rejected with 400
    r = c.post("/api/system/restore", files={"file": ("bad.txt", io.BytesIO(b"hello world\n"))})
    print("restore garbage:", r.status_code, r.json().get("detail"))

    # restore validation: empty file must be rejected with 400
    r = c.post("/api/system/restore", files={"file": ("empty.txt", io.BytesIO(b"# only a comment\n\n"))})
    print("restore empty:", r.status_code, r.json().get("detail"))

print("OK")

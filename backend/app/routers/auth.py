from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.services import auth

router = APIRouter(prefix="/api/auth", tags=["auth"])


class Credentials(BaseModel):
    username: str = "admin"
    password: str = Field(min_length=1)


class PasswordChange(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8)


def _set_cookie(response: Response, username: str):
    response.set_cookie(
        auth.COOKIE_NAME,
        auth.make_token(username),
        max_age=auth.SESSION_TTL,
        httponly=True,
        samesite="lax",
    )


@router.get("/status")
async def status(request: Request):
    token = request.cookies.get(auth.COOKIE_NAME, "")
    return {
        "configured": auth.is_configured(),
        "authenticated": bool(token) and auth.check_token(token),
    }


@router.post("/setup")
async def setup(data: Credentials, response: Response):
    if auth.is_configured():
        raise HTTPException(status_code=409, detail="Password is already set")
    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    auth.set_password(data.username, data.password)
    _set_cookie(response, data.username)
    return {"status": "ok"}


@router.post("/login")
async def login(data: Credentials, response: Response):
    remaining = auth.lockout_remaining()
    if remaining:
        raise HTTPException(status_code=429, detail=f"Too many attempts — try again in {remaining}s")
    if not auth.verify_password(data.username, data.password):
        auth.record_failure()
        raise HTTPException(status_code=401, detail="Invalid username or password")
    auth.record_success()
    _set_cookie(response, data.username)
    return {"status": "ok"}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME)
    return {"status": "ok"}


@router.post("/password")
async def change_password(data: PasswordChange, request: Request, response: Response):
    auth.require_auth(request)
    stored = auth._load() or {}
    if not auth.verify_password(stored.get("username", "admin"), data.old_password):
        raise HTTPException(status_code=401, detail="Current password is wrong")
    auth.set_password(stored.get("username", "admin"), data.new_password)
    _set_cookie(response, stored.get("username", "admin"))
    return {"status": "ok"}

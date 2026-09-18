import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.routers import interfaces, firewall, staging, logs, system, services, nat, haproxy, pki, routes, auth as auth_router
from app.services import auth

app = FastAPI(title="VyOS Web Gateway", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:7100"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_AUTH_OPEN_PREFIXES = ("/api/auth/", "/api/health")


@app.middleware("http")
async def require_session(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and not path.startswith(_AUTH_OPEN_PREFIXES):
        token = request.cookies.get(auth.COOKIE_NAME, "")
        if not token or not auth.check_token(token):
            return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
    return await call_next(request)


app.include_router(auth_router.router)
app.include_router(interfaces.router)
app.include_router(firewall.router)
app.include_router(staging.router)
app.include_router(logs.router)
app.include_router(system.router)
app.include_router(services.router)
app.include_router(nat.router)
app.include_router(routes.router)
app.include_router(haproxy.router)
app.include_router(pki.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Serve the built frontend (SPA) when frontend/dist exists; API routes win
# because they are registered above.
_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend", "dist",
)
if os.path.isdir(_DIST):
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="spa")

    from fastapi.responses import FileResponse

    _INDEX = os.path.join(_DIST, "index.html")

    @app.exception_handler(404)
    async def spa_fallback(request: Request, exc):
        if not request.url.path.startswith("/api/") and os.path.isfile(_INDEX):
            return FileResponse(_INDEX)
        return JSONResponse(status_code=404, content={"detail": "Not Found"})

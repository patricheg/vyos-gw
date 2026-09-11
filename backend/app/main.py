from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import interfaces, firewall, staging, logs, system, services, nat, haproxy, pki, routes, connection
from app.services.connections import connection_manager

app = FastAPI(title="VyOS Web Gateway", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(interfaces.router)
app.include_router(connection.router)
app.include_router(firewall.router)
app.include_router(staging.router)
app.include_router(logs.router)
app.include_router(system.router)
app.include_router(services.router)
app.include_router(nat.router)
app.include_router(routes.router)
app.include_router(haproxy.router)
app.include_router(pki.router)

@app.on_event("startup")
def autoconnect_default_device():
    connection_manager.autoconnect_from_settings()


@app.get("/api/health")
def health():
    return {"status": "ok"}


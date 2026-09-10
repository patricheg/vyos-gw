from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import interfaces, firewall, staging, logs, system, services, nat

app = FastAPI(title="VyOS Web Gateway", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(interfaces.router)
app.include_router(firewall.router)
app.include_router(staging.router)
app.include_router(logs.router)
app.include_router(system.router)
app.include_router(services.router)
app.include_router(nat.router)

@app.get("/api/health")
def health():
    return {"status": "ok"}


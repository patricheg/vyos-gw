import asyncio
import re

from fastapi import APIRouter, HTTPException

from app.models import HaproxyConfig, HaproxyService, HaproxyBackend, HaproxyGlobals
from app.services import haproxy_container
from app.services.vyos_client import VyOSError

router = APIRouter(prefix="/api/haproxy", tags=["haproxy"])


def _validate_service(svc: HaproxyService):
    if svc.port is None or not (1 <= svc.port <= 65535):
        raise HTTPException(status_code=400, detail="Service port (1-65535) is required")
    rule_backends = [r for r in svc.rules if r.backend]
    if not svc.backends and not rule_backends:
        raise HTTPException(
            status_code=400,
            detail="Service needs at least one backend (default or via a routing rule)",
        )
    for r in svc.rules:
        if not r.domain_name and not r.url_path:
            raise HTTPException(status_code=400, detail=f"Rule {r.number}: set a domain name or a URL path to match")
        if r.url_path and not r.url_path_match:
            raise HTTPException(status_code=400, detail=f"Rule {r.number}: URL path needs a match type (begin/end/exact)")
        if bool(r.backend) == bool(r.redirect_location):
            raise HTTPException(
                status_code=400,
                detail=f"Rule {r.number}: needs exactly one action — backend or redirect location",
            )
    if svc.rules and svc.mode == "tcp":
        raise HTTPException(status_code=400, detail="Routing rules require HTTP mode (TCP mode cannot inspect URLs)")


_ADDR_PORT_RE = re.compile(r"^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$")


def _validate_backend(be: HaproxyBackend):
    if not be.servers:
        raise HTTPException(status_code=400, detail="Backend needs at least one server")
    if be.ssl_no_verify and be.ssl_ca_certificate:
        raise HTTPException(status_code=400, detail="SSL: choose either no-verify or a CA certificate, not both")
    for srv in be.servers:
        # Forgiving input: "10.0.0.1:8080" is split into address + port
        if srv.address:
            m = _ADDR_PORT_RE.match(srv.address.strip())
            if m:
                srv.address = m.group(1)
                if srv.port is None:
                    srv.port = int(m.group(2))
        if not srv.address or srv.port is None or not (1 <= srv.port <= 65535):
            raise HTTPException(
                status_code=400,
                detail=f"Server {srv.name!r} needs an address (IP only) and a port (1-65535)",
            )


def _engine_call(fn, *args):
    try:
        return fn(*args)
    except VyOSError as e:
        raise HTTPException(status_code=502, detail=str(e))


def _apply_or_502(model: HaproxyConfig):
    try:
        haproxy_container.apply_model(model)
    except VyOSError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "staged", "changes": 1}


@router.get("/status")
async def get_status():
    return await asyncio.to_thread(_engine_call, haproxy_container.get_status)


@router.post("/provision")
async def provision():
    """Install SSH key + entrypoint on the device, pull the haproxy image and
    stage the container config."""
    await asyncio.to_thread(_engine_call, haproxy_container.provision_files)
    await asyncio.to_thread(_engine_call, haproxy_container.pull_image)
    model = await asyncio.to_thread(_engine_call, haproxy_container.get_model)
    return _apply_or_502(model)


@router.post("/migrate")
async def migrate():
    """Convert the built-in haproxy config into the container model and stage
    removal of the built-in config."""
    return await asyncio.to_thread(_engine_call, haproxy_container.migrate_from_builtin)


@router.delete("/container")
async def remove_container():
    await asyncio.to_thread(_engine_call, haproxy_container.stage_container_removal)
    return {"status": "staged", "changes": 1}


@router.get("", response_model=HaproxyConfig)
async def get_haproxy():
    return await asyncio.to_thread(_engine_call, haproxy_container.get_model)


@router.post("/services")
async def add_service(svc: HaproxyService):
    _validate_service(svc)
    model = await asyncio.to_thread(_engine_call, haproxy_container.get_model)
    if any(s.name == svc.name for s in model.services):
        raise HTTPException(status_code=409, detail=f"Service {svc.name!r} already exists")
    if svc.backends:
        known = {b.name for b in model.backends}
        missing = [b for b in svc.backends if b not in known]
        if missing:
            raise HTTPException(status_code=400, detail=f"Unknown backend(s): {', '.join(missing)}")
    model.services.append(svc)
    return _apply_or_502(model)


@router.put("/services/{name}")
async def update_service(name: str, svc: HaproxyService):
    _validate_service(svc)
    model = await asyncio.to_thread(_engine_call, haproxy_container.get_model)
    model.services = [s for s in model.services if s.name != name]
    model.services.append(svc)
    return _apply_or_502(model)


@router.delete("/services/{name}")
async def delete_service(name: str):
    model = await asyncio.to_thread(_engine_call, haproxy_container.get_model)
    model.services = [s for s in model.services if s.name != name]
    return _apply_or_502(model)


@router.post("/backends")
async def add_backend(be: HaproxyBackend):
    _validate_backend(be)
    model = await asyncio.to_thread(_engine_call, haproxy_container.get_model)
    if any(b.name == be.name for b in model.backends):
        raise HTTPException(status_code=409, detail=f"Backend {be.name!r} already exists")
    model.backends.append(be)
    return _apply_or_502(model)


@router.put("/backends/{name}")
async def update_backend(name: str, be: HaproxyBackend):
    _validate_backend(be)
    model = await asyncio.to_thread(_engine_call, haproxy_container.get_model)
    model.backends = [b for b in model.backends if b.name != name]
    model.backends.append(be)
    return _apply_or_502(model)


@router.delete("/backends/{name}")
async def delete_backend(name: str):
    model = await asyncio.to_thread(_engine_call, haproxy_container.get_model)
    model.backends = [b for b in model.backends if b.name != name]
    # services must not reference a removed backend
    for svc in model.services:
        svc.backends = [b for b in svc.backends if b != name]
    return _apply_or_502(model)


@router.put("/globals")
async def update_globals(data: HaproxyGlobals):
    model = await asyncio.to_thread(_engine_call, haproxy_container.get_model)
    model.max_connections = data.max_connections
    model.timeout_client = data.timeout_client
    model.timeout_connect = data.timeout_connect
    model.timeout_server = data.timeout_server
    return _apply_or_502(model)

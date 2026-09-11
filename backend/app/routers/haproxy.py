import asyncio
import re

from fastapi import APIRouter, HTTPException

from app.models import HaproxyConfig, HaproxyService, HaproxyBackend, HaproxyGlobals
from app.services.vyos_client import vyos_client
from app.services.staging import staging_area

router = APIRouter(prefix="/api/haproxy", tags=["haproxy"])

_BASE = "load-balancing haproxy"


def _effective_names(kind: str, live_names) -> set:
    """Names that will exist after the staged changes commit: live + staged-set − staged-delete."""
    names = set(live_names)
    set_prefix = f"set {_BASE} {kind} "
    del_prefix = f"delete {_BASE} {kind} "
    for ch in staging_area.list():
        cmd = ch.command
        if cmd.startswith(del_prefix):
            rest = cmd[len(del_prefix):]
            # a bare `delete ... <kind> <name>` (no deeper path) removes the whole node
            if " " not in rest:
                names.discard(rest)
        elif cmd.startswith(set_prefix):
            rest = cmd[len(set_prefix):]
            if " " in rest:
                names.add(rest.split(" ", 1)[0])
    return names


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


def _stage_service_commands(svc: HaproxyService):
    base = f"set {_BASE} service {svc.name}"
    if svc.description:
        staging_area.add(f"{base} description '{svc.description}'", f"HAProxy service {svc.name} description", "haproxy")
    if svc.mode:
        staging_area.add(f"{base} mode {svc.mode}", f"HAProxy service {svc.name} mode", "haproxy")
    staging_area.add(f"{base} port '{svc.port}'", f"HAProxy service {svc.name} port {svc.port}", "haproxy")
    for addr in svc.listen_addresses:
        staging_area.add(f"{base} listen-address '{addr}'", f"HAProxy service {svc.name} listen {addr}", "haproxy")
    for be in svc.backends:
        staging_area.add(f"{base} backend '{be}'", f"HAProxy service {svc.name} -> backend {be}", "haproxy")
    if svc.redirect_http_to_https:
        staging_area.add(f"{base} redirect-http-to-https", f"HAProxy service {svc.name} HTTP->HTTPS redirect", "haproxy")
    if svc.ssl_certificate:
        staging_area.add(f"{base} ssl certificate '{svc.ssl_certificate}'", f"HAProxy service {svc.name} TLS certificate", "haproxy")
    if svc.logging_facility:
        staging_area.add(f"{base} logging facility '{svc.logging_facility}'", f"HAProxy service {svc.name} logging", "haproxy")
    for r in sorted(svc.rules, key=lambda x: x.number):
        rbase = f"{base} rule {r.number}"
        if r.domain_name:
            staging_area.add(f"{rbase} domain-name '{r.domain_name}'", f"HAProxy {svc.name} rule {r.number} domain {r.domain_name}", "haproxy")
            if r.wildcard_domain:
                staging_area.add(f"{rbase} wildcard-domain", f"HAProxy {svc.name} rule {r.number} wildcard domain", "haproxy")
        if r.url_path and r.url_path_match:
            staging_area.add(f"{rbase} url-path {r.url_path_match} '{r.url_path}'", f"HAProxy {svc.name} rule {r.number} path {r.url_path_match} {r.url_path}", "haproxy")
        if r.backend:
            staging_area.add(f"{rbase} set backend '{r.backend}'", f"HAProxy {svc.name} rule {r.number} -> backend {r.backend}", "haproxy")
        if r.redirect_location:
            staging_area.add(f"{rbase} set redirect-location '{r.redirect_location}'", f"HAProxy {svc.name} rule {r.number} redirect {r.redirect_location}", "haproxy")


def _stage_backend_commands(be: HaproxyBackend):
    base = f"set {_BASE} backend {be.name}"
    if be.description:
        staging_area.add(f"{base} description '{be.description}'", f"HAProxy backend {be.name} description", "haproxy")
    if be.mode:
        staging_area.add(f"{base} mode {be.mode}", f"HAProxy backend {be.name} mode", "haproxy")
    if be.balance:
        staging_area.add(f"{base} balance {be.balance}", f"HAProxy backend {be.name} balance {be.balance}", "haproxy")
    if be.logging_facility:
        staging_area.add(f"{base} logging facility '{be.logging_facility}'", f"HAProxy backend {be.name} logging", "haproxy")
    if be.ssl_no_verify:
        staging_area.add(f"{base} ssl no-verify", f"HAProxy backend {be.name} TLS to servers (no verify)", "haproxy")
    if be.ssl_ca_certificate:
        staging_area.add(f"{base} ssl ca-certificate '{be.ssl_ca_certificate}'", f"HAProxy backend {be.name} TLS to servers (CA {be.ssl_ca_certificate})", "haproxy")
    for srv in be.servers:
        sbase = f"{base} server {srv.name}"
        staging_area.add(f"{sbase} address '{srv.address}'", f"HAProxy server {be.name}/{srv.name} address", "haproxy")
        staging_area.add(f"{sbase} port '{srv.port}'", f"HAProxy server {be.name}/{srv.name} port {srv.port}", "haproxy")
        if srv.check:
            staging_area.add(f"{sbase} check", f"HAProxy server {be.name}/{srv.name} health check", "haproxy")
            if srv.check_port:
                staging_area.add(f"{sbase} check port '{srv.check_port}'", f"HAProxy server {be.name}/{srv.name} check port", "haproxy")
        if srv.backup:
            staging_area.add(f"{sbase} backup", f"HAProxy server {be.name}/{srv.name} backup", "haproxy")
        if srv.send_proxy:
            staging_area.add(f"{sbase} send-proxy", f"HAProxy server {be.name}/{srv.name} PROXY v1", "haproxy")
        if srv.send_proxy_v2:
            staging_area.add(f"{sbase} send-proxy-v2", f"HAProxy server {be.name}/{srv.name} PROXY v2", "haproxy")


@router.get("", response_model=HaproxyConfig)
async def get_haproxy():
    return await asyncio.to_thread(vyos_client.get_haproxy)


@router.post("/services")
async def add_service(svc: HaproxyService):
    _validate_service(svc)
    cfg = await asyncio.to_thread(vyos_client.get_haproxy)
    if svc.name in _effective_names("service", (s.name for s in cfg.services)):
        raise HTTPException(status_code=409, detail=f"Service {svc.name!r} already exists")
    _stage_service_commands(svc)
    return {"status": "staged", "changes": 1}


@router.put("/services/{name}")
async def update_service(name: str, svc: HaproxyService):
    _validate_service(svc)
    staging_area.add(f"delete {_BASE} service {name}", f"Update: remove old HAProxy service {name}", "haproxy")
    _stage_service_commands(svc)
    return {"status": "staged", "changes": 1}


@router.delete("/services/{name}")
async def delete_service(name: str):
    # VyOS verify(): haproxy must have BOTH a service and a backend, or nothing.
    # Removing the last link of either side means dropping the whole haproxy node.
    cfg = await asyncio.to_thread(vyos_client.get_haproxy)
    remaining = [s for s in cfg.services if s.name != name]
    if not remaining:
        staging_area.add(
            f"delete {_BASE}",
            f"Delete HAProxy service {name} (last one — whole haproxy config removed)",
            "haproxy",
        )
    else:
        staging_area.add(f"delete {_BASE} service {name}", f"Delete HAProxy service {name}", "haproxy")
    return {"status": "staged", "changes": 1}


@router.post("/backends")
async def add_backend(be: HaproxyBackend):
    _validate_backend(be)
    cfg = await asyncio.to_thread(vyos_client.get_haproxy)
    if be.name in _effective_names("backend", (b.name for b in cfg.backends)):
        raise HTTPException(status_code=409, detail=f"Backend {be.name!r} already exists")
    _stage_backend_commands(be)
    return {"status": "staged", "changes": 1}


@router.put("/backends/{name}")
async def update_backend(name: str, be: HaproxyBackend):
    _validate_backend(be)
    staging_area.add(f"delete {_BASE} backend {name}", f"Update: remove old HAProxy backend {name}", "haproxy")
    _stage_backend_commands(be)
    return {"status": "staged", "changes": 1}


@router.delete("/backends/{name}")
async def delete_backend(name: str):
    cfg = await asyncio.to_thread(vyos_client.get_haproxy)
    remaining = [b for b in cfg.backends if b.name != name]
    if not remaining:
        staging_area.add(
            f"delete {_BASE}",
            f"Delete HAProxy backend {name} (last one — whole haproxy config removed)",
            "haproxy",
        )
    else:
        staging_area.add(f"delete {_BASE} backend {name}", f"Delete HAProxy backend {name}", "haproxy")
    return {"status": "staged", "changes": 1}


class HaproxyGlobalsUpdate(HaproxyGlobals):
    pass


@router.put("/globals")
async def update_globals(data: HaproxyGlobalsUpdate):
    current = await asyncio.to_thread(vyos_client.get_haproxy)
    pairs = [
        ("global-parameters max-connections", current.max_connections, data.max_connections, "max connections"),
        ("timeout client", current.timeout_client, data.timeout_client, "client timeout"),
        ("timeout connect", current.timeout_connect, data.timeout_connect, "connect timeout"),
        ("timeout server", current.timeout_server, data.timeout_server, "server timeout"),
    ]
    for path, old, new, label in pairs:
        if new == old:
            continue
        if new is None:
            staging_area.add(f"delete {_BASE} {path}", f"HAProxy: reset {label}", "haproxy")
        else:
            staging_area.add(f"set {_BASE} {path} '{new}'", f"HAProxy: {label} = {new}", "haproxy")
    return {"status": "staged", "changes": 1}

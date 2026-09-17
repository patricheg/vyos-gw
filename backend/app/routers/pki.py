import asyncio
import base64
import binascii

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from app.models import PkiConfig, PkiCertificateImport, PkiCaImport, PkiAcmeCreate
from app.services.vyos_client import vyos_client, VyOSError
from app.services.staging import staging_area

router = APIRouter(prefix="/api/pki", tags=["pki"])

_BASE = "pki"


def _pem_body(pem_text: str, what: str) -> str:
    """PEM text -> bare base64 body as VyOS stores it; 400 on garbage input."""
    body = vyos_client.pem_to_store_body(pem_text or "")
    if not body:
        raise HTTPException(status_code=400, detail=f"{what} is empty or missing PEM headers")
    try:
        base64.b64decode(body, validate=True)
    except binascii.Error:
        raise HTTPException(status_code=400, detail=f"{what} is not valid base64 PEM content")
    return body


def _effective_names(kind: str, live_names) -> set:
    names = set(live_names)
    set_prefix = f"set {_BASE} {kind} "
    del_prefix = f"delete {_BASE} {kind} "
    for ch in staging_area.list():
        cmd = ch.command
        if cmd.startswith(del_prefix):
            rest = cmd[len(del_prefix):]
            if " " not in rest:
                names.discard(rest)
        elif cmd.startswith(set_prefix):
            rest = cmd[len(set_prefix):]
            if " " in rest:
                names.add(rest.split(" ", 1)[0])
    return names


@router.get("", response_model=PkiConfig)
async def get_pki():
    return await asyncio.to_thread(vyos_client.get_pki)


@router.post("/certificates")
async def import_certificate(data: PkiCertificateImport):
    cfg = await asyncio.to_thread(vyos_client.get_pki)
    if data.name in _effective_names("certificate", (c.name for c in cfg.certificates)):
        raise HTTPException(status_code=409, detail=f"Certificate {data.name!r} already exists")
    cert_body = _pem_body(data.certificate, "Certificate")
    key_body = _pem_body(data.private_key, "Private key") if data.private_key else None

    base = f"set {_BASE} certificate {data.name}"
    staging_area.add(f"{base} certificate '{cert_body}'", f"PKI certificate {data.name}", "pki")
    if key_body:
        staging_area.add(f"{base} private key '{key_body}'", f"PKI certificate {data.name} private key", "pki")
    if data.description:
        staging_area.add(f"{base} description '{data.description}'", f"PKI certificate {data.name} description", "pki")
    return {"status": "staged", "changes": 1}


@router.delete("/certificates/{name}")
async def delete_certificate(name: str):
    staging_area.add(f"delete {_BASE} certificate {name}", f"Delete PKI certificate {name}", "pki")
    return {"status": "staged", "changes": 1}


@router.get("/certificates/{name}/export", response_class=PlainTextResponse)
async def export_certificate(name: str, include_key: bool = False):
    pem = await asyncio.to_thread(vyos_client._show_pem, ["pki", "certificate", name, "pem"])
    if not pem:
        raise HTTPException(status_code=404, detail=f"Certificate {name!r} not found or has no certificate body")
    if include_key:
        key_pem = await asyncio.to_thread(vyos_client._show_pem, ["pki", "certificate", name, "private", "pem"])
        if not key_pem:
            raise HTTPException(status_code=404, detail=f"Certificate {name!r} has no private key")
        pem = pem.rstrip() + "\n" + key_pem
    return pem


@router.get("/certificates/{name}/text", response_class=PlainTextResponse)
async def certificate_text(name: str):
    try:
        out = await asyncio.to_thread(
            vyos_client._post, "/show", {"op": "show", "path": ["pki", "certificate", name, "text"]}
        )
    except VyOSError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return out or ""


@router.post("/ca")
async def import_ca(data: PkiCaImport):
    cfg = await asyncio.to_thread(vyos_client.get_pki)
    if data.name in _effective_names("ca", (c.name for c in cfg.ca_certificates)):
        raise HTTPException(status_code=409, detail=f"CA {data.name!r} already exists")
    cert_body = _pem_body(data.certificate, "CA certificate")

    base = f"set {_BASE} ca {data.name}"
    staging_area.add(f"{base} certificate '{cert_body}'", f"PKI CA {data.name}", "pki")
    if data.description:
        staging_area.add(f"{base} description '{data.description}'", f"PKI CA {data.name} description", "pki")
    return {"status": "staged", "changes": 1}


@router.delete("/ca/{name}")
async def delete_ca(name: str):
    staging_area.add(f"delete {_BASE} ca {name}", f"Delete PKI CA {name}", "pki")
    return {"status": "staged", "changes": 1}


@router.get("/ca/{name}/export", response_class=PlainTextResponse)
async def export_ca(name: str):
    pem = await asyncio.to_thread(vyos_client._show_pem, ["pki", "ca", name, "pem"])
    if not pem:
        raise HTTPException(status_code=404, detail=f"CA {name!r} not found or has no certificate body")
    return pem


@router.post("/acme")
async def create_acme(data: PkiAcmeCreate):
    if not data.domains:
        raise HTTPException(status_code=400, detail="At least one domain name is required")
    cfg = await asyncio.to_thread(vyos_client.get_pki)
    if data.name in _effective_names("certificate", (c.name for c in cfg.certificates)):
        raise HTTPException(status_code=409, detail=f"Certificate {data.name!r} already exists")

    base = f"set {_BASE} certificate {data.name}"

    from app.services import haproxy_container
    container_haproxy = haproxy_container.is_provisioned()
    if container_haproxy:
        wildcard80 = [
            s.name for s in haproxy_container.get_model().services
            if s.port == 80 and not s.ssl_certificate and not s.listen_addresses
        ]
        if wildcard80:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"HAProxy service(s) {', '.join(wildcard80)} listen on *:80 — ACME issuance "
                    "needs port 80 bound to specific external addresses so certbot can use "
                    "127.0.0.1:80. Set listen addresses on the HTTP service first."
                ),
            )

    for domain in data.domains:
        staging_area.add(f"{base} acme domain-name '{domain.strip()}'", f"ACME {data.name} domain {domain.strip()}", "pki")
    staging_area.add(f"{base} acme email '{data.email}'", f"ACME {data.name} email", "pki")
    staging_area.add(f"{base} acme rsa-key-size '{data.rsa_key_size}'", f"ACME {data.name} key size", "pki")
    listen_address = data.listen_address
    if not listen_address and container_haproxy:
        # With the container-based haproxy, certbot binds 127.0.0.1:80 so the
        # VyOS port-80 availability check probes loopback instead of the public
        # address held by the container.
        listen_address = "127.0.0.1"
    if listen_address:
        staging_area.add(f"{base} acme listen-address '{listen_address}'", f"ACME {data.name} listen address", "pki")
    if data.url:
        staging_area.add(f"{base} acme url '{data.url}'", f"ACME {data.name} directory URL", "pki")
    if data.description:
        staging_area.add(f"{base} description '{data.description}'", f"ACME {data.name} description", "pki")
    return {"status": "staged", "changes": 1}


@router.post("/renew")
async def renew_acme():
    """Run `renew certbot force` — immediate op-mode call, not staged."""
    try:
        output = await asyncio.to_thread(vyos_client.renew_certbot)
    except VyOSError as e:
        raise HTTPException(status_code=502, detail=str(e))
    # refreshed certs must reach the container: re-stage the model (new env
    # values) so the next commit restarts haproxy with the renewed PEMs
    from app.services import haproxy_container
    if haproxy_container.is_provisioned():
        await asyncio.to_thread(haproxy_container.apply_model, haproxy_container.get_model())
    return {"status": "ok", "output": output}

"""On-device deployment: package the app and run it as a VyOS container.

The build context (backend app + built frontend + Dockerfile) is tarred
locally, pushed to the device over SSH (the only remaining SSH use — deploy
and upgrades, never runtime), built there with podman and staged as
`container name vyos-gw` through the regular VyOS API / commit flow.
"""
import base64
import hashlib
import io
import os
import tarfile
from typing import Any, Dict, Optional

from app.config import settings
from app.services import fileaccess, ssh_keys
from app.services.staging import staging_area
from app.services.vyos_client import vyos_client, VyOSError

CONTAINER_NAME = "vyos-gw"
IMAGE_REF = "localhost/vyos-gw:local"
_BUILD_DIR_HOST = "/config/auth/vyos-gw-build"
_DATA_DIR_HOST = "/config/auth/vyos-gw-data"
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_DIST_LOCAL = os.path.join(_BACKEND_ROOT, "..", "frontend", "dist")


def build_context_tar() -> bytes:
    """tar.gz with Dockerfile, requirements.txt, app/ and dist/."""
    dist = settings.dist_dir or _DIST_LOCAL
    if not os.path.isfile(os.path.join(dist, "index.html")):
        raise VyOSError("frontend/dist not found — run `npm run build` in frontend/ first")
    dockerfile = os.path.join(_BACKEND_ROOT, "deploy", "Dockerfile")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(dockerfile, arcname="Dockerfile")
        tar.add(os.path.join(_BACKEND_ROOT, "requirements.txt"), arcname="requirements.txt")
        app_dir = os.path.join(_BACKEND_ROOT, "app")
        for root, dirs, files in os.walk(app_dir):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            for fn in files:
                if fn.endswith((".pyc", ".pyo")):
                    continue
                full = os.path.join(root, fn)
                tar.add(full, arcname=os.path.join("app", os.path.relpath(full, app_dir)))
        for root, dirs, files in os.walk(dist):
            for fn in files:
                full = os.path.join(root, fn)
                tar.add(full, arcname=os.path.join("dist", os.path.relpath(full, dist)))
    return buf.getvalue()


def _write_remote_bytes(path: str, data: bytes, timeout: float = 300) -> None:
    ssh_keys.run_remote(f"sudo mkdir -p {os.path.dirname(path)}")
    ssh_keys.run_remote(f"sudo sh -c 'base64 -d > {path}'",
                        input_text=base64.b64encode(data).decode(), timeout=timeout)


def _seed_data() -> bool:
    """Copy local auth/secret/geoip/acme-cache to the device data dir, but
    never overwrite an existing password (upgrades keep device state)."""
    seeded = False
    local_data = settings.data_dir or os.path.join(_BACKEND_ROOT, "data")
    for name in ("auth.json", "secret.key"):
        src = os.path.join(local_data, name)
        dst = f"{_DATA_DIR_HOST}/{name}"
        if os.path.isfile(src) and ssh_keys.remote_md5(dst) is None:
            with open(src) as f:
                ssh_keys.write_remote_file(dst, f.read(), mode=0o600)
            seeded = True
    return seeded


def _stage_container(build_id: str) -> None:
    base = f"set container name {CONTAINER_NAME}"
    staging_area.add(f"{base} image {IMAGE_REF}", "Web console: image", "webui")
    staging_area.add(f"{base} allow-host-networks", "Web console: host networking", "webui")
    staging_area.add(f"{base} restart always", "Web console: restart always", "webui")
    for vol, src, dst, mode in (
        ("le", "/config/auth/letsencrypt", "/config/auth/letsencrypt", "ro"),
        ("haproxy", "/config/auth/haproxy", "/config/auth/haproxy", "rw"),
        ("data", _DATA_DIR_HOST, "/data", "rw"),
    ):
        v = f"{base} volume {vol}"
        staging_area.add(f"{v} source {src}", f"Web console: {vol} volume", "webui")
        staging_area.add(f"{v} destination {dst}", f"Web console: {vol} volume", "webui")
        staging_area.add(f"{v} mode {mode}", f"Web console: {vol} volume", "webui")
    env_base = f"{base} environment"
    staging_area.add(f"{env_base} VGW_API_URL value https://127.0.0.1:8443",
                     "Web console: API URL", "webui")
    staging_area.add(f"{env_base} VGW_API_KEY value {settings.vyos_api_key}",
                     "Web console: API key", "webui")
    staging_area.add(f"{env_base} VGW_BUILD value {build_id}",
                     "Web console: build marker (forces restart on upgrade)", "webui")


def provision() -> Dict[str, Any]:
    """Build the image on the device and stage the container config.

    The staged changes still need a commit (pending changes panel)."""
    if fileaccess.is_on_device():
        raise VyOSError(
            "Build/upgrade from the on-device instance is not supported — "
            "run the deploy from your workstation instance"
        )
    tar = build_context_tar()
    build_id = hashlib.md5(tar).hexdigest()[:12]

    _write_remote_bytes(f"{_BUILD_DIR_HOST}/ctx.tar.gz", tar)
    ssh_keys.run_remote(
        f"sudo rm -rf {_BUILD_DIR_HOST}/ctx && sudo mkdir -p {_BUILD_DIR_HOST}/ctx && "
        f"sudo tar xzf {_BUILD_DIR_HOST}/ctx.tar.gz -C {_BUILD_DIR_HOST}/ctx",
        timeout=120,
    )
    ssh_keys.run_remote(
        f"sudo podman build --pull=missing -t {IMAGE_REF} {_BUILD_DIR_HOST}/ctx",
        timeout=900,
    )
    seeded = _seed_data()
    _stage_container(build_id)
    return {"build": build_id, "image": IMAGE_REF, "data_seeded": seeded, "staged": True}


def status() -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "on_device": fileaccess.is_on_device(),
        "container_configured": False,
        "image_present": None,
        "data_seeded": None,
    }
    try:
        data = vyos_client._post(
            "/retrieve", {"op": "showConfig", "path": ["container", "name", CONTAINER_NAME]}
        )
        result["container_configured"] = bool(data)
    except VyOSError:
        pass
    try:
        out = vyos_client._post("/container-image", {"op": "show"}) or ""
        result["image_present"] = "vyos-gw" in out
    except VyOSError:
        pass
    try:
        result["data_seeded"] = fileaccess.file_md5(f"{_DATA_DIR_HOST}/auth.json") is not None
    except VyOSError:
        pass
    return result

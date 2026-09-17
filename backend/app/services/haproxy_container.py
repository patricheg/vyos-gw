"""Container-based HAProxy engine.

HAProxy runs as a VyOS container (podman via `container name haproxy`) instead
of the built-in `load-balancing haproxy` service. The generated haproxy.cfg,
the UI model (as JSON) and imported certificates travel inside container
environment variables stored in config.boot, so everything is managed through
the regular VyOS API and the staging/commit flow.

VyOS forbids quote characters in config values, so the startup script cannot
be inline: it is written once as a file on the device (via an SSH key
installed through the API — see app.services.ssh_keys) and mounted read-only
into the container. ACME (certbot) certificates are read from a mounted volume
and assembled into PEM files by that entrypoint.

Environment variables used:
  HAPROXY_MODEL          base64(JSON model: services/backends/globals)
  HAPROXY_CFG            base64(generated haproxy.cfg)
  HAPROXY_CERT_<name>    base64(PEM cert+key or CA cert) for PKI-stored certs
"""
import base64
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from app.models import HaproxyConfig, HaproxyService, HaproxyBackend
from app.services.staging import staging_area
from app.services.vyos_client import vyos_client, VyOSError

CONTAINER_NAME = "haproxy"
IMAGE = "docker.io/library/haproxy:3.0-alpine"
ENV_MODEL = "HAPROXY_MODEL"
ENV_CFG = "HAPROXY_CFG"
ENV_CERT_PREFIX = "HAPROXY_CERT_"
_ACME_VOLUME_SOURCE = "/config/auth/letsencrypt"
_ACME_VOLUME_DEST = "/acme"
_ACME_BACKEND_PORT = 65080  # must match vyos.defaults internal_ports['certbot_haproxy']
_FILES_DIR_HOST = "/config/auth/haproxy"   # persistent + writable by vyattacfg group
_ENTRYPOINT_HOST = f"{_FILES_DIR_HOST}/entrypoint.sh"
_ENTRYPOINT_CTR = "/entrypoint/entrypoint.sh"

# The official haproxy image runs as the unprivileged "haproxy" user, so all
# generated files live under /tmp (root filesystem is not writable).
_CTR_WORKDIR = "/tmp/haproxy"

# Written to the device once at provision time. Decodes config + certs from
# env, assembles ACME PEMs from the mounted letsencrypt volume, execs haproxy.
_ENTRYPOINT_SCRIPT = """#!/bin/sh
set -e
mkdir -p /tmp/haproxy/certs
printf %s "$HAPROXY_CFG" | base64 -d > /tmp/haproxy/haproxy.cfg
env | grep ^HAPROXY_CERT_ | while read line; do
  name=$(echo "$line" | cut -d= -f1 | cut -c14-)
  echo "$line" | cut -d= -f2- | base64 -d > "/tmp/haproxy/certs/${name}.pem"
done
for d in /acme/live/*; do
  if [ -f "$d/fullchain.pem" ]; then
    cat "$d/fullchain.pem" "$d/privkey.pem" > "/tmp/haproxy/certs/$(basename $d).pem"
  fi
done
exec haproxy -W -db -f /tmp/haproxy/haproxy.cfg
"""

_NAME_SAFE_RE = re.compile(r"[^A-Za-z0-9_]")


def _b64(text: str) -> str:
    return base64.b64encode(text.encode()).decode()


def _unb64(text: str) -> str:
    return base64.b64decode(text.encode()).decode()


def _env_safe(name: str) -> str:
    return _NAME_SAFE_RE.sub("_", name)


def _pem_wrap(header: str, body_b64: str) -> str:
    wrapped = "\n".join(body_b64[i:i + 64] for i in range(0, len(body_b64), 64))
    return f"-----BEGIN {header}-----\n{wrapped}\n-----END {header}-----\n"


# ─── State ────────────────────────────────────────────────────────


def _raw_container_config() -> Dict[str, Any]:
    try:
        data = vyos_client._post(
            "/retrieve", {"op": "showConfig", "path": ["container", "name", CONTAINER_NAME]}
        )
    except VyOSError as e:
        if "empty" in str(e).lower() or "not valid" in str(e).lower():
            return {}
        raise
    return data if isinstance(data, dict) else {}


def _raw_env() -> Dict[str, str]:
    env = _raw_container_config().get("environment") or {}
    return {k: str(v.get("value", "")) for k, v in env.items() if isinstance(v, dict)}


def is_provisioned() -> bool:
    return bool(_raw_container_config())


def builtin_config_exists() -> bool:
    try:
        data = vyos_client._post(
            "/retrieve", {"op": "showConfig", "path": ["load-balancing", "haproxy"]}
        )
        return bool(data)
    except VyOSError:
        return False


def _staged_model_b64() -> Optional[str]:
    """Latest HAPROXY_MODEL value waiting in the staging area, if any."""
    prefix = f"set container name {CONTAINER_NAME} environment {ENV_MODEL} value "
    deleted = False
    value: Optional[str] = None
    for ch in staging_area.list():
        cmd = ch.command
        if cmd.startswith(prefix):
            value = cmd[len(prefix):].strip().strip("'")
            deleted = False
        elif cmd == f"delete container name {CONTAINER_NAME} environment {ENV_MODEL}":
            deleted = True
        elif cmd == f"delete container name {CONTAINER_NAME}":
            deleted = True
    return None if deleted else value


def get_model() -> HaproxyConfig:
    """Current model: staged env value if there are pending changes, else the
    live container env, else mirrored from the built-in haproxy config
    (pre-migration view)."""
    raw = _staged_model_b64() or _raw_env().get(ENV_MODEL)
    if raw:
        try:
            return HaproxyConfig(**json.loads(_unb64(raw)))
        except (ValueError, TypeError):
            pass
    if not is_provisioned():
        return vyos_client.get_haproxy()
    return HaproxyConfig()


def get_status() -> Dict[str, Any]:
    status: Dict[str, Any] = {
        "provisioned": is_provisioned(),
        "builtin_active": builtin_config_exists(),
        "image": IMAGE,
        "image_present": None,
        "running": None,
    }
    try:
        out = vyos_client._post("/container-image", {"op": "show"}) or ""
        status["image_present"] = "haproxy" in out
    except VyOSError:
        pass
    try:
        out = vyos_client._post("/show", {"op": "show", "path": ["container"]}) or ""
        for line in out.splitlines():
            if CONTAINER_NAME in line:
                status["running"] = "Up" in line
                break
    except VyOSError:
        pass
    return status


def pull_image() -> str:
    """Pull the haproxy image via the VyOS API (may take minutes)."""
    import requests
    try:
        resp = vyos_client._session.post(
            f"{vyos_client.base_url}/container-image",
            data={"data": json.dumps({"op": "add", "name": IMAGE}), "key": vyos_client.key},
            verify=vyos_client.verify,
            timeout=900,
        )
        body = resp.json()
    except (requests.RequestException, ValueError) as e:
        raise VyOSError(f"Image pull request failed: {e}") from e
    if not body.get("success"):
        raise VyOSError(f"Image pull failed: {body.get('error')}")
    data = str(body.get("data") or "")
    # VyOS reports pull failures as success=true with the error text in data
    if "Error" in data or "error" in data.split("\n")[0]:
        raise VyOSError(f"Image pull failed: {data.strip()[:500]}")
    return data or "image pulled"


# ─── haproxy.cfg generation ───────────────────────────────────────


def _pem_ref(name: str, acme: bool) -> str:
    # ACME certs keep their on-disk directory name; PKI certs use env-safe names
    return f"{_CTR_WORKDIR}/certs/{name if acme else _env_safe(name)}.pem"


def render_cfg(model: HaproxyConfig, acme_certs: Dict[str, bool]) -> str:
    L: List[str] = []
    facility = next(
        (x.logging_facility for x in (*model.services, *model.backends) if x.logging_facility),
        "local0",
    )
    L += [
        "global",
        "    log /dev/log {} info".format(facility or "local0"),
        f"    maxconn {model.max_connections or 20000}",
        f"    stats socket {_CTR_WORKDIR}/admin.sock mode 600 level admin",
        "",
        "defaults",
        "    log global",
        "    mode http",
        "    option httplog",
        "    option dontlognull",
        "    option redispatch",
        "    retries 3",
        f"    timeout connect {model.timeout_connect or 5}s",
        f"    timeout client {model.timeout_client or 50}s",
        f"    timeout server {model.timeout_server or 50}s",
        "",
    ]

    has_acme = any(acme_certs.get(s.ssl_certificate or "") for s in model.services)

    for svc in model.services:
        mode = svc.mode or "http"
        L.append(f"frontend {svc.name}")
        L.append(f"    mode {mode}")
        binds = svc.listen_addresses or ["*"]
        for addr in binds:
            bind = f"    bind {addr}:{svc.port}"
            if svc.ssl_certificate:
                bind += f" ssl crt {_pem_ref(svc.ssl_certificate, acme_certs.get(svc.ssl_certificate, False))}"
            L.append(bind)
        if svc.logging_facility and svc.logging_facility != facility:
            L.append(f"    log /dev/log {svc.logging_facility} info")
        if mode == "http":
            L.append("    option httplog")
            if svc.redirect_http_to_https:
                L.append("    http-request redirect scheme https code 301 unless { ssl_fc }")
            # ACME HTTP-01 passthrough to certbot (runs on the host)
            if has_acme and not svc.ssl_certificate:
                L.append("    acl acme_challenge path_beg /.well-known/acme-challenge/")
                L.append("    use_backend acme-certbot if acme_challenge")
            for r in sorted(svc.rules, key=lambda x: x.number):
                conds = []
                if r.domain_name:
                    acls = [f"    acl rule{r.number}_host hdr(host) -i {r.domain_name}"]
                    if r.wildcard_domain:
                        acls.append(f"    acl rule{r.number}_host hdr_end(host) -i .{r.domain_name}")
                    L.extend(acls)
                    conds.append(f"rule{r.number}_host")
                if r.url_path and r.url_path_match:
                    fetch = {"begin": "path_beg", "end": "path_end", "exact": "path"}[r.url_path_match]
                    L.append(f"    acl rule{r.number}_path {fetch} {r.url_path}")
                    conds.append(f"rule{r.number}_path")
                cond = " ".join(conds) if conds else "TRUE"
                if r.backend:
                    L.append(f"    use_backend {r.backend} if {cond}")
                elif r.redirect_location:
                    L.append(f"    http-request redirect location {r.redirect_location} if {cond}")
        else:
            L.append("    option tcplog")
        if svc.backends:
            L.append(f"    default_backend {svc.backends[0]}")
        L.append("")

    if has_acme:
        L += [
            "backend acme-certbot",
            "    mode http",
            f"    server certbot 127.0.0.1:{_ACME_BACKEND_PORT}",
            "",
        ]

    for be in model.backends:
        mode = be.mode or "http"
        L.append(f"backend {be.name}")
        L.append(f"    mode {mode}")
        balance = {"round-robin": "roundrobin", "least-connection": "leastconn", "source-address": "source"}
        L.append(f"    balance {balance.get(be.balance or '', be.balance or 'roundrobin')}")
        if be.logging_facility and be.logging_facility != facility:
            L.append(f"    log /dev/log {be.logging_facility} info")
        for srv in be.servers:
            line = f"    server {srv.name} {srv.address}:{srv.port}"
            if srv.check:
                line += " check"
                if srv.check_port:
                    line += f" port {srv.check_port}"
            if srv.backup:
                line += " backup"
            if srv.send_proxy:
                line += " send-proxy"
            if srv.send_proxy_v2:
                line += " send-proxy-v2"
            if be.ssl_no_verify:
                line += " ssl verify none"
            elif be.ssl_ca_certificate:
                line += f" ssl verify required ca-file {_CTR_WORKDIR}/certs/ca_{_env_safe(be.ssl_ca_certificate)}.pem"
            L.append(line)
        L.append("")

    return "\n".join(L)


# ─── Certificate collection ───────────────────────────────────────


def _collect_cert_env(model: HaproxyConfig) -> Tuple[Dict[str, str], Dict[str, bool]]:
    """Build HAPROXY_CERT_* env values from VyOS PKI; return (env, acme_map)."""
    pki = vyos_client.get_pki()
    acme_map = {c.name: c.acme for c in pki.certificates}
    env: Dict[str, str] = {}

    def fetch(path: List[str]) -> Optional[Dict[str, Any]]:
        try:
            data = vyos_client._post("/retrieve", {"op": "showConfig", "path": path})
            return data if isinstance(data, dict) else None
        except VyOSError:
            return None

    for svc in model.services:
        name = svc.ssl_certificate
        if not name or acme_map.get(name):
            continue  # ACME certs come from the mounted volume
        node = fetch(["pki", "certificate", name]) or {}
        cert_body = node.get("certificate")
        key_body = (node.get("private") or {}).get("key") if isinstance(node.get("private"), dict) else None
        if not cert_body or not key_body:
            raise VyOSError(
                f"Certificate {name!r} has no private key in VyOS PKI — import it or use an ACME certificate"
            )
        pem = _pem_wrap("CERTIFICATE", cert_body) + _pem_wrap("PRIVATE KEY", key_body)
        env[ENV_CERT_PREFIX + _env_safe(name)] = pem

    for be in model.backends:
        ca = be.ssl_ca_certificate
        if not ca or be.ssl_no_verify:
            continue
        node = fetch(["pki", "ca-certificate", ca]) or {}
        cert_body = node.get("certificate")
        if not cert_body:
            raise VyOSError(f"CA certificate {ca!r} not found in VyOS PKI")
        env[ENV_CERT_PREFIX + "ca_" + _env_safe(ca)] = _pem_wrap("CERTIFICATE", cert_body)

    return env, acme_map


# ─── Apply (stage container commands) ─────────────────────────────


def _stage_base_config():
    base = f"set container name {CONTAINER_NAME}"
    staging_area.add(f"{base} image {IMAGE}", "HAProxy container image", "haproxy")
    staging_area.add(f"{base} allow-host-networks", "HAProxy container: host networking", "haproxy")
    # the image runs as the unprivileged haproxy user; allow binding to ports <1024
    staging_area.add(
        "set system sysctl parameter net.ipv4.ip_unprivileged_port_start value 0",
        "HAProxy container: allow binding to ports <1024", "haproxy",
    )
    staging_area.add(f"{base} restart always", "HAProxy container: restart always", "haproxy")
    staging_area.add(
        f"{base} entrypoint /bin/sh",
        "HAProxy container entrypoint", "haproxy",
    )
    staging_area.add(
        f"{base} command {_ENTRYPOINT_CTR}",
        "HAProxy container entrypoint", "haproxy",
    )
    vol = f"{base} volume files"
    staging_area.add(f"{vol} source {_FILES_DIR_HOST}", "HAProxy container: files volume", "haproxy")
    staging_area.add(f"{vol} destination /entrypoint", "HAProxy container: files volume", "haproxy")
    staging_area.add(f"{vol} mode ro", "HAProxy container: files volume", "haproxy")
    vol = f"{base} volume acme"
    staging_area.add(f"{vol} source {_ACME_VOLUME_SOURCE}", "HAProxy container: ACME volume", "haproxy")
    staging_area.add(f"{vol} destination {_ACME_VOLUME_DEST}", "HAProxy container: ACME volume", "haproxy")
    staging_area.add(f"{vol} mode ro", "HAProxy container: ACME volume", "haproxy")
    vol = f"{base} volume devlog"
    staging_area.add(f"{vol} source /dev/log", "HAProxy container: syslog socket", "haproxy")
    staging_area.add(f"{vol} destination /dev/log", "HAProxy container: syslog socket", "haproxy")


def provision_files() -> None:
    """One-time device-side setup: install our SSH key via the API, then write
    the entrypoint script and create the ACME dir through SFTP."""
    from app.services import ssh_keys
    ssh_keys.install_pubkey()
    ssh_keys.write_remote_file(_ENTRYPOINT_HOST, _ENTRYPOINT_SCRIPT, mode=0o755)
    # the ACME volume source must exist or the container commit fails
    ssh_keys.write_remote_file(f"{_ACME_VOLUME_SOURCE}/.keep", "", mode=0o644)


def apply_model(model: HaproxyConfig) -> int:
    """Stage all commands needed to run the given model in the container."""
    cert_env, acme_map = _collect_cert_env(model)
    cfg_text = render_cfg(model, acme_map)

    new_env: Dict[str, str] = {
        ENV_MODEL: _b64(model.model_dump_json()),
        ENV_CFG: _b64(cfg_text),
    }
    for key, pem in cert_env.items():
        new_env[key] = _b64(pem)

    _stage_base_config()
    env_base = f"set container name {CONTAINER_NAME} environment"
    old_env = _raw_env()
    for key in old_env:
        if key not in new_env and (key.startswith(ENV_CERT_PREFIX) or key in (ENV_MODEL, ENV_CFG)):
            staging_area.add(
                f"delete container name {CONTAINER_NAME} environment {key}",
                f"HAProxy container: drop {key}", "haproxy",
            )
    for key, value in new_env.items():
        if old_env.get(key) != value:
            staging_area.add(
                f"{env_base} {key} value {value}",
                f"HAProxy container: update {key}", "haproxy",
            )
    return 1


def stage_container_removal():
    staging_area.add(
        f"delete container name {CONTAINER_NAME}",
        "Remove HAProxy container", "haproxy",
    )


def stage_builtin_removal():
    staging_area.add(
        "delete load-balancing haproxy",
        "Remove built-in HAProxy config (replaced by container)", "haproxy",
    )


def migrate_from_builtin() -> int:
    """Convert the built-in haproxy config into the container model and stage
    the removal of the built-in config."""
    model = vyos_client.get_haproxy()
    apply_model(model)
    stage_builtin_removal()
    return 1

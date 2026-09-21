"""Container-based HAProxy engine.

HAProxy runs as a VyOS container (podman via `container name haproxy`) instead
of the built-in `load-balancing haproxy` service. The generated haproxy.cfg,
the UI model (JSON) and the referenced certificates are written as plain files
into /config/auth/haproxy/ on the device (via app.services.fileaccess) and
mounted read-only into the container at /entrypoint. Earlier revisions shipped
the same data base64-encoded in container environment variables stored in
config.boot — multi-KB env values crashed the config parser (cli-shell-api
`realloc(): invalid next size`), so config.boot now carries only the small
container definition (image, entrypoint/command, restart, volumes,
allow-host-networks) plus one 32-char marker.

The marker env var HAPROXY_FILES_MD5 is kept on purpose: the VyOS REST API
exposes no `restart container` op, so a changing env value is the only way to
make a commit recreate the container after the files changed (same trick the
old HAPROXY_GEOIP_MD5 used for the GeoIP map).

Device files (host paths under /config/auth/haproxy, container: /entrypoint):
  haproxy.cfg       generated config
  model.json        UI model (services/backends/globals)
  certs/<name>.pem  PEM cert+key (or CA cert) referenced by the model
  geoip.map         GeoIP map (written by _push_geoip_map)
  entrypoint.sh     startup script (written at provision time / on change)

Legacy environment variables (deleted from the device config on apply):
  HAPROXY_MODEL, HAPROXY_CFG, HAPROXY_CERT_<name>, HAPROXY_GEOIP_MD5
"""
import base64
import hashlib
import json
import re
from typing import Any, Dict, List, Optional, Tuple

from app.models import HaproxyConfig, HaproxyService, HaproxyBackend
from app.services.staging import staging_area
from app.services.vyos_client import vyos_client, VyOSError

CONTAINER_NAME = "haproxy"
IMAGE = "docker.io/library/haproxy:3.0-alpine"
ENV_MODEL = "HAPROXY_MODEL"  # legacy: read-only fallback for pre-file configs
ENV_FILES_MD5 = "HAPROXY_FILES_MD5"  # commit recreates the container on change
_ACME_VOLUME_SOURCE = "/config/auth/letsencrypt"
_ACME_VOLUME_DEST = "/acme"
# Without built-in haproxy (used_by is never set) certbot standalone binds
# 127.0.0.1:80 directly — the container must forward ACME challenges there.
_ACME_BACKEND_PORT = 80
_FILES_DIR_HOST = "/config/auth/haproxy"   # persistent + writable by vyattacfg group
_ENTRYPOINT_HOST = f"{_FILES_DIR_HOST}/entrypoint.sh"
_ENTRYPOINT_CTR = "/entrypoint/entrypoint.sh"
_CFG_HOST = f"{_FILES_DIR_HOST}/haproxy.cfg"
_MODEL_HOST = f"{_FILES_DIR_HOST}/model.json"
_CERTS_DIR_HOST = f"{_FILES_DIR_HOST}/certs"
_GEOIP_MAP_HOST = f"{_FILES_DIR_HOST}/geoip.map"
_GEOIP_MAP_CTR = "/entrypoint/geoip.map"   # "files" volume is mounted at /entrypoint

# The official haproxy image runs as the unprivileged "haproxy" user, so all
# generated files live under /tmp (root filesystem is not writable).
_CTR_WORKDIR = "/tmp/haproxy"

# Written to the device at provision time (and re-written by apply_model when
# it changes). Reads config + certs from the mounted /entrypoint volume,
# assembles ACME PEMs from the mounted letsencrypt volume, execs haproxy.
_ENTRYPOINT_SCRIPT = """#!/bin/sh
set -e
mkdir -p /tmp/haproxy/certs
cp /entrypoint/haproxy.cfg /tmp/haproxy/haproxy.cfg
for f in /entrypoint/certs/*.pem; do
  if [ -f "$f" ]; then
    cp "$f" /tmp/haproxy/certs/
  fi
done
for d in /acme/live/*; do
  if [ -f "$d/fullchain.pem" ]; then
    cat "$d/fullchain.pem" "$d/privkey.pem" > "/tmp/haproxy/certs/$(basename $d).pem"
  fi
done
exec haproxy -W -db -f /tmp/haproxy/haproxy.cfg
"""

_NAME_SAFE_RE = re.compile(r"[^A-Za-z0-9_]")


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


def get_model() -> HaproxyConfig:
    """Current model: model.json on the device, else the legacy HAPROXY_MODEL
    env value (pre file-based configs), else mirrored from the built-in
    haproxy config (pre-migration view)."""
    from app.services import fileaccess
    try:
        raw = fileaccess.read_file(_MODEL_HOST)
        if raw.strip():
            return HaproxyConfig(**json.loads(raw))
    except (VyOSError, ValueError, TypeError):
        pass
    raw = _raw_env().get(ENV_MODEL)
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


def geoip_used(model: HaproxyConfig) -> bool:
    """True when any service or rule has a GeoIP restriction configured."""
    for svc in model.services:
        if svc.geoip_mode in ("allow", "deny") and svc.geoip_countries:
            return True
        if any(r.geoip_mode and r.geoip_countries for r in svc.rules):
            return True
    return False


def _pem_ref(name: str, acme: bool) -> str:
    # all certs (PKI and ACME) arrive as files under /config/auth/haproxy/certs
    return f"{_CTR_WORKDIR}/certs/{_env_safe(name)}.pem"


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

    # ACME passthrough is rendered whenever there is a plain-HTTP frontend:
    # a certificate must be issuable before any service references it.
    has_http_frontend = any((s.mode or "http") == "http" and not s.ssl_certificate for s in model.services)

    for svc in model.services:
        mode = svc.mode or "http"
        L.append(f"frontend {svc.name}")
        L.append(f"    mode {mode}")
        binds = svc.listen_addresses or ["*"]
        for addr in binds:
            bind = f"    bind {addr}:{svc.port}"
            if svc.ssl_certificate:
                # multiple crt entries: the first is the default, the rest are
                # picked by SNI (HAProxy builds the SNI map automatically)
                certs = [svc.ssl_certificate] + [c for c in svc.ssl_certificates if c != svc.ssl_certificate]
                for crt in certs:
                    bind += f" ssl crt {_pem_ref(crt, acme_certs.get(crt, False))}" if crt == certs[0] else f" crt {_pem_ref(crt, acme_certs.get(crt, False))}"
            L.append(bind)
        if svc.logging_facility and svc.logging_facility != facility:
            L.append(f"    log /dev/log {svc.logging_facility} info")
        if mode == "http":
            L.append("    option httplog")
            if not svc.ssl_certificate:
                L.append("    acl acme_challenge path_beg /.well-known/acme-challenge/")
            # GeoIP: resolve the client country once per request, then enforce
            # service-level and per-rule restrictions. ACME challenges must
            # never be blocked — Let's Encrypt validates from anywhere.
            svc_geoip = svc.geoip_mode in ("allow", "deny") and bool(svc.geoip_countries)
            rules_geoip = [r for r in svc.rules if r.geoip_mode and r.geoip_countries]
            acme_guard = " !acme_challenge" if not svc.ssl_certificate else ""
            if svc_geoip or rules_geoip:
                L.append(f"    http-request set-var(txn.geoip_cc) src,map_ip({_GEOIP_MAP_CTR},ZZ)")
            if svc_geoip:
                ccs = " ".join(c.upper() for c in svc.geoip_countries)
                L.append(f"    acl geoip_svc_match var(txn.geoip_cc) -m str {ccs}")
                if svc.geoip_mode == "allow":
                    L.append(f"    http-request deny deny_status 403 if !geoip_svc_match{acme_guard}")
                else:
                    L.append(f"    http-request deny deny_status 403 if geoip_svc_match{acme_guard}")
            if svc.redirect_http_to_https:
                if svc.ssl_certificate:
                    L.append("    http-request redirect scheme https code 301 unless { ssl_fc }")
                else:
                    L.append("    http-request redirect scheme https code 301 if !{ ssl_fc } !acme_challenge")
            ordered_rules = sorted(svc.rules, key=lambda x: x.number)
            for r in ordered_rules:
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
                if r.geoip_mode and r.geoip_countries and conds:
                    ccs = " ".join(c.upper() for c in r.geoip_countries)
                    L.append(f"    acl rule{r.number}_cc var(txn.geoip_cc) -m str {ccs}")
                    if r.geoip_mode == "allow":
                        L.append(f"    http-request deny deny_status 403 if {cond} !rule{r.number}_cc")
                    else:
                        L.append(f"    http-request deny deny_status 403 if {cond} rule{r.number}_cc")
                if r.redirect_location:
                    L.append(f"    http-request redirect location {r.redirect_location} if {cond}")
            # ACME HTTP-01 passthrough to certbot (runs on the host); first
            # among use_backend lines so challenges always win
            if has_http_frontend and not svc.ssl_certificate:
                L.append("    use_backend acme-certbot if acme_challenge")
            for r in ordered_rules:
                if r.backend:
                    conds = []
                    if r.domain_name:
                        conds.append(f"rule{r.number}_host")
                    if r.url_path and r.url_path_match:
                        conds.append(f"rule{r.number}_path")
                    L.append(f"    use_backend {r.backend} if {' '.join(conds) if conds else 'TRUE'}")
        else:
            L.append("    option tcplog")
            if svc.geoip_mode in ("allow", "deny") and svc.geoip_countries:
                ccs = " ".join(c.upper() for c in svc.geoip_countries)
                expr = f"src,map_ip({_GEOIP_MAP_CTR},ZZ) -m str {ccs}"
                if svc.geoip_mode == "allow":
                    L.append(f"    tcp-request content reject unless {{ {expr} }}")
                else:
                    L.append(f"    tcp-request content reject if {{ {expr} }}")
        if svc.backends:
            L.append(f"    default_backend {svc.backends[0]}")
        L.append("")

    if has_http_frontend:
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


def _read_acme_pem(name: str) -> str:
    """Read an issued ACME cert (fullchain+key) from the letsencrypt dir via SSH.

    The volume is root:vyattacfg 700, so the unprivileged container cannot read
    it directly — the PEM is written to /config/auth/haproxy/certs/ like the
    PKI certs. sshd often bounces right after a commit, so a successful read is
    cached locally and the cache is used when SSH is temporarily unreachable.
    """
    from app.services import fileaccess, ssh_keys
    base = f"{_ACME_VOLUME_SOURCE}/live/{name}"
    try:
        fullchain = fileaccess.read_file(f"{base}/fullchain.pem")
        privkey = fileaccess.read_file(f"{base}/privkey.pem")
    except VyOSError as e:
        if "No such file" in str(e):
            raise VyOSError(
                f"ACME certificate {name!r} is not issued yet (no files under {base})"
            ) from e
        cached = ssh_keys.acme_cache_read(name, "combined")
        if cached:
            return cached
        raise VyOSError(
            f"Cannot read ACME certificate {name!r} via SSH and no local cache "
            f"exists yet — retry in a few seconds: {e}"
        ) from e
    pem = fullchain.rstrip() + "\n" + privkey.rstrip() + "\n"
    ssh_keys.acme_cache_write(name, "combined", pem)
    return pem


def _collect_cert_pems(model: HaproxyConfig) -> Tuple[Dict[str, str], Dict[str, bool]]:
    """Collect PEM files for the certs referenced by the model from VyOS PKI;
    return ({safe_name: pem}, acme_map)."""
    pki = vyos_client.get_pki()
    acme_map = {c.name: c.acme for c in pki.certificates}
    pems: Dict[str, str] = {}

    def fetch(path: List[str]) -> Optional[Dict[str, Any]]:
        try:
            data = vyos_client._post("/retrieve", {"op": "showConfig", "path": path})
            return data if isinstance(data, dict) else None
        except VyOSError:
            return None

    for svc in model.services:
        for name in [svc.ssl_certificate, *svc.ssl_certificates]:
            if not name or _env_safe(name) in pems:
                continue
            if acme_map.get(name):
                pems[_env_safe(name)] = _read_acme_pem(name)
                continue
            node = fetch(["pki", "certificate", name]) or {}
            cert_body = node.get("certificate")
            key_body = (node.get("private") or {}).get("key") if isinstance(node.get("private"), dict) else None
            if not cert_body or not key_body:
                raise VyOSError(
                    f"Certificate {name!r} has no private key in VyOS PKI — import it or use an ACME certificate"
                )
            pem = _pem_wrap("CERTIFICATE", cert_body) + _pem_wrap("PRIVATE KEY", key_body)
            pems[_env_safe(name)] = pem

    for be in model.backends:
        ca = be.ssl_ca_certificate
        if not ca or be.ssl_no_verify:
            continue
        node = fetch(["pki", "ca-certificate", ca]) or {}
        cert_body = node.get("certificate")
        if not cert_body:
            raise VyOSError(f"CA certificate {ca!r} not found in VyOS PKI")
        pems["ca_" + _env_safe(ca)] = _pem_wrap("CERTIFICATE", cert_body)

    return pems, acme_map


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
    """One-time device-side setup: write the entrypoint script and create the
    ACME dir. Off-device the entrypoint goes through an SSH key installed via
    the API; on-device it's a plain local file."""
    from app.services import fileaccess
    if not fileaccess.is_on_device():
        from app.services import ssh_keys
        ssh_keys.install_pubkey()
    fileaccess.write_file(_ENTRYPOINT_HOST, _ENTRYPOINT_SCRIPT, mode=0o755)
    # the ACME volume source must exist or the container commit fails
    fileaccess.write_file(f"{_ACME_VOLUME_SOURCE}/.keep", "", mode=0o644)


def _push_text_file(path: str, content: str, mode: int = 0o644) -> str:
    """Write content to a device file if it changed; return the content md5."""
    from app.services import fileaccess
    digest = hashlib.md5(content.encode()).hexdigest()
    if fileaccess.file_md5(path) != digest:
        fileaccess.write_file(path, content, mode=mode)
    return digest


def _push_cert_files(cert_pems: Dict[str, str]) -> List[str]:
    """Write certs/<name>.pem files, drop stale ones; return content md5s.

    Files must be world-readable (0o644): the container entrypoint runs as the
    unprivileged haproxy user and copies them from the read-only volume.
    """
    from app.services import fileaccess
    wanted = {f"{name}.pem" for name in cert_pems}
    for fn in fileaccess.list_dir(_CERTS_DIR_HOST):
        if fn.endswith(".pem") and fn not in wanted:
            fileaccess.delete_file(f"{_CERTS_DIR_HOST}/{fn}")
    digests = []
    for name, pem in sorted(cert_pems.items()):
        digests.append(_push_text_file(f"{_CERTS_DIR_HOST}/{name}.pem", pem, mode=0o644))
    return digests


def _push_geoip_map() -> str:
    """Push the local GeoIP map to the device if it changed; return its md5."""
    from app.services import geoip

    content = geoip.read_map()
    if content is None:
        raise VyOSError(
            "GeoIP is enabled but the database is not downloaded yet — "
            "use 'Update GeoIP DB' on the HAProxy page first"
        )
    return _push_text_file(_GEOIP_MAP_HOST, content, mode=0o644)


def _ensure_entrypoint() -> None:
    """Re-write the entrypoint script when it differs (migrates devices that
    still have the env-decoding version)."""
    from app.services import fileaccess
    if fileaccess.file_md5(_ENTRYPOINT_HOST) == hashlib.md5(_ENTRYPOINT_SCRIPT.encode()).hexdigest():
        return
    if not fileaccess.is_on_device():
        from app.services import ssh_keys
        ssh_keys.install_pubkey()
    fileaccess.write_file(_ENTRYPOINT_HOST, _ENTRYPOINT_SCRIPT, mode=0o755)


def apply_model(model: HaproxyConfig) -> int:
    """Write the model files to the device and stage the container config.

    The files take effect on commit: the HAPROXY_FILES_MD5 env marker changes
    whenever any file changes, and changing a container's env makes the VyOS
    commit script recreate the container (the REST API has no restart op).
    """
    cert_pems, acme_map = _collect_cert_pems(model)
    cfg_text = render_cfg(model, acme_map)

    digests = [
        _push_text_file(_CFG_HOST, cfg_text),
        _push_text_file(_MODEL_HOST, model.model_dump_json()),
        *_push_cert_files(cert_pems),
    ]
    if geoip_used(model):
        digests.append(_push_geoip_map())
    files_md5 = hashlib.md5("".join(sorted(digests)).encode()).hexdigest()

    _ensure_entrypoint()
    _stage_base_config()
    env_base = f"container name {CONTAINER_NAME} environment"
    old_env = _raw_env()
    # drop every legacy env value (the base64 blobs that broke config.boot)
    for key in old_env:
        if key != ENV_FILES_MD5:
            staging_area.add(
                f"delete {env_base} {key}",
                f"HAProxy container: drop env {key}", "haproxy",
            )
    if old_env.get(ENV_FILES_MD5) != files_md5:
        staging_area.add(
            f"set {env_base} {ENV_FILES_MD5} value {files_md5}",
            "HAProxy container: files marker (recreates the container on change)", "haproxy",
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

"""SSH key-based access to the connected VyOS device.

Used for one-time provisioning files (e.g. the HAProxy container entrypoint
script) that cannot be represented in config.boot. The keypair is generated
locally, the public key is installed on the device through the REST API
(`system login user <u> authentication public-keys`), so no SSH password is
ever stored.
"""
import os
import threading
import time
from typing import Optional, Tuple

import paramiko

from app.config import settings
from app.services.vyos_client import vyos_client, VyOSError

_DATA_DIR = settings.data_dir or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
_KEY_PATH = os.path.join(_DATA_DIR, "webui_ssh_key")
_KEY_ID = "vyos-gw-webui"


def _keypair() -> paramiko.RSAKey:
    os.makedirs(_DATA_DIR, exist_ok=True)
    if os.path.exists(_KEY_PATH):
        return paramiko.RSAKey.from_private_key_file(_KEY_PATH)
    key = paramiko.RSAKey.generate(2048)
    key.write_private_key_file(_KEY_PATH)
    try:
        os.chmod(_KEY_PATH, 0o600)
    except OSError:
        pass
    return key


def public_key_parts() -> Tuple[str, str]:
    """(base64 blob, key type) suitable for VyOS public-keys config."""
    key = _keypair()
    return key.get_base64(), "ssh-rsa"


def _device_host_port() -> Tuple[str, int]:
    from urllib.parse import urlparse

    from app.config import settings

    host = urlparse(settings.vyos_api_url).hostname or settings.vyos_host
    port = 22
    try:
        ssh_cfg = vyos_client._post("/retrieve", {"op": "showConfig", "path": ["service", "ssh"]})
        if isinstance(ssh_cfg, dict) and ssh_cfg.get("port"):
            port = int(ssh_cfg["port"])
    except (VyOSError, ValueError, TypeError):
        pass
    return host, port


def _pick_login_user() -> str:
    data = vyos_client._post("/retrieve", {"op": "showConfig", "path": ["system", "login", "user"]})
    users = list(data.keys()) if isinstance(data, dict) else []
    if not users:
        raise VyOSError("No login users found on the device")
    return "vyos" if "vyos" in users else users[0]


def install_pubkey() -> str:
    """Install our public key on the device via the REST API; returns the user."""
    user = _pick_login_user()
    blob, ktype = public_key_parts()
    # already installed?
    try:
        existing = vyos_client._post(
            "/retrieve",
            {"op": "showConfig", "path": ["system", "login", "user", user,
                                          "authentication", "public-keys", _KEY_ID]},
        )
        if isinstance(existing, dict) and existing.get("key") == blob:
            return user
    except VyOSError:
        pass
    vyos_client.exec_config([
        f"set system login user {user} authentication public-keys {_KEY_ID} key {blob}",
        f"set system login user {user} authentication public-keys {_KEY_ID} type {ktype}",
    ])
    return user


def ssh_connect(timeout: float = 15, retries: int = 4) -> paramiko.SSHClient:
    global _cooldown_until
    now = time.time()
    if now < _cooldown_until:
        raise VyOSError(
            f"SSH is cooling down after repeated failures — retry in "
            f"{int(_cooldown_until - now)}s (protecting sshd from MaxStartups)"
        )
    host, port = _device_host_port()
    key = _keypair()
    user = _pick_login_user()
    last: Optional[Exception] = None
    for attempt in range(retries):
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            ssh.connect(host, port=port, username=user, pkey=key, timeout=timeout,
                        banner_timeout=timeout, auth_timeout=timeout,
                        look_for_keys=False, allow_agent=False)
            _cooldown_until = 0.0
            return ssh
        except Exception as e:
            last = e
            try:
                ssh.close()
            except Exception:
                pass
            time.sleep(min(1 + attempt * 2, 10))  # sshd bounces during commits
    _cooldown_until = time.time() + 60
    raise VyOSError(f"SSH key auth to {host}:{port} failed: {last}")


_cooldown_until = 0.0


def _exec(ssh: paramiko.SSHClient, cmd: str, input_text: str = "", timeout: float = 30) -> str:
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    if input_text:
        stdin.write(input_text)
    stdin.channel.shutdown_write()
    err = stderr.read().decode(errors="ignore").strip()
    rc = stdout.channel.recv_exit_status()
    if rc != 0:
        raise VyOSError(f"Remote command failed (rc={rc}): {cmd}\n{err}")
    return stdout.read().decode(errors="ignore")


# ─── Shared connection ────────────────────────────────────────────
# sshd on VyOS throttles with MaxStartups: opening a fresh TCP connection
# per file operation quickly trips it ("Exceeded MaxStartups" resets). All
# remote file operations below reuse one long-lived connection instead.

_ssh_lock = threading.RLock()
_shared_ssh: Optional[paramiko.SSHClient] = None


def _get_shared() -> paramiko.SSHClient:
    global _shared_ssh
    if _shared_ssh is not None:
        transport = _shared_ssh.get_transport()
        if transport is not None and transport.is_active():
            return _shared_ssh
        try:
            _shared_ssh.close()
        except Exception:
            pass
        _shared_ssh = None
    _shared_ssh = ssh_connect()
    try:
        transport = _shared_ssh.get_transport()
        if transport is not None:
            transport.set_keepalive(30)
    except Exception:
        pass
    return _shared_ssh


def _drop_shared() -> None:
    global _shared_ssh
    if _shared_ssh is not None:
        try:
            _shared_ssh.close()
        except Exception:
            pass
        _shared_ssh = None


def run_remote(cmd: str, input_text: str = "", timeout: float = 30) -> str:
    """Run a command on the device over the shared connection; reconnect once
    if the connection died (e.g. sshd restarted by a commit)."""
    for attempt in (1, 2):
        with _ssh_lock:
            try:
                return _exec(_get_shared(), cmd, input_text, timeout)
            except (paramiko.SSHException, OSError, EOFError) as e:
                _drop_shared()
                if attempt == 2:
                    raise VyOSError(f"SSH command failed ({cmd}): {e}")


def read_remote_file(path: str) -> str:
    """Read a root-owned file from the device (sudo cat)."""
    return run_remote(f"sudo cat {path}")


def remote_md5(path: str) -> Optional[str]:
    """md5 of a root-owned file on the device; None if it does not exist."""
    try:
        out = run_remote(f"sudo md5sum {path}")
    except VyOSError:
        return None
    return out.split()[0] if out.split() else None


def write_remote_file(path: str, content: str, mode: int = 0o644) -> None:
    """Write a file on the device. Uses sudo — the login user is in the sudo
    group on stock VyOS, and /config is root-owned."""
    import base64 as _b64mod
    b64 = _b64mod.b64encode(content.encode()).decode()
    run_remote(f"sudo mkdir -p {os.path.dirname(path)}")
    run_remote(f"sudo sh -c 'base64 -d > {path}'", input_text=b64)
    run_remote(f"sudo chmod {mode:o} {path}")


# ─── ACME certificate cache ───────────────────────────────────────
# Reading /config/auth/letsencrypt over SSH races with sshd restarts after
# commits. Certificates change only on renewal, so every successful read is
# cached locally and reused when SSH is temporarily unreachable.

_ACME_CACHE_DIR = os.path.join(_DATA_DIR, "acme_cache")


def acme_cache_write(name: str, suffix: str, pem: str) -> None:
    try:
        os.makedirs(_ACME_CACHE_DIR, exist_ok=True)
        with open(os.path.join(_ACME_CACHE_DIR, f"{name}.{suffix}.pem"), "w") as f:
            f.write(pem)
    except OSError:
        pass


def acme_cache_read(name: str, suffix: str) -> Optional[str]:
    try:
        with open(os.path.join(_ACME_CACHE_DIR, f"{name}.{suffix}.pem")) as f:
            data = f.read()
        return data if "BEGIN" in data else None
    except OSError:
        return None


def acme_cache_age(name: str, suffix: str) -> Optional[float]:
    """Seconds since the cache entry was written; None if absent."""
    try:
        return time.time() - os.path.getmtime(os.path.join(_ACME_CACHE_DIR, f"{name}.{suffix}.pem"))
    except OSError:
        return None

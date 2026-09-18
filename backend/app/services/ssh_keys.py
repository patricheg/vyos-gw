"""SSH key-based access to the connected VyOS device.

Used for one-time provisioning files (e.g. the HAProxy container entrypoint
script) that cannot be represented in config.boot. The keypair is generated
locally, the public key is installed on the device through the REST API
(`system login user <u> authentication public-keys`), so no SSH password is
ever stored.
"""
import os
import time
from typing import Optional, Tuple

import paramiko

from app.services.vyos_client import vyos_client, VyOSError

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
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
    from app.services.connections import connection_manager
    dev = connection_manager.active_device()
    host = dev["host"]
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


def ssh_connect(timeout: float = 15, retries: int = 8) -> paramiko.SSHClient:
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
            return ssh
        except Exception as e:
            last = e
            try:
                ssh.close()
            except Exception:
                pass
            time.sleep(min(1 + attempt * 2, 10))  # sshd bounces during commits
    raise VyOSError(f"SSH key auth to {host}:{port} failed: {last}")


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


def read_remote_file(path: str) -> str:
    """Read a root-owned file from the device (sudo cat)."""
    ssh = ssh_connect()
    try:
        return _exec(ssh, f"sudo cat {path}")
    finally:
        ssh.close()


def write_remote_file(path: str, content: str, mode: int = 0o644) -> None:
    """Write a file on the device. Uses sudo — the login user is in the sudo
    group on stock VyOS, and /config is root-owned."""
    import base64 as _b64mod
    ssh = ssh_connect()
    try:
        b64 = _b64mod.b64encode(content.encode()).decode()
        _exec(ssh, f"sudo mkdir -p {os.path.dirname(path)}")
        _exec(ssh, f"sudo sh -c 'base64 -d > {path}'", input_text=b64)
        _exec(ssh, f"sudo chmod {mode:o} {path}")
    finally:
        ssh.close()

"""Device file access: local when running on the router, SSH otherwise.

When the app runs as a container on the VyOS device itself
(`VGW_ON_DEVICE=1`), the host paths (/config/auth/...) are mounted into the
container and plain filesystem calls are used. Off-device (development on a
workstation) the same operations go through the SSH key channel in
app.services.ssh_keys. All paths are identical in both modes.
"""
import hashlib
import os
from typing import List, Optional

from app.config import settings
from app.services.vyos_client import VyOSError


def is_on_device() -> bool:
    return settings.on_device


def read_file(path: str) -> str:
    """Read a file from the device; raises VyOSError when absent."""
    if is_on_device():
        try:
            with open(path, errors="ignore") as f:
                return f.read()
        except OSError as e:
            raise VyOSError(f"Cannot read {path}: {e}") from e
    from app.services import ssh_keys
    return ssh_keys.read_remote_file(path)


def write_file(path: str, content: str, mode: int = 0o644) -> None:
    if is_on_device():
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            f.write(content)
        os.replace(tmp, path)
        os.chmod(path, mode)
        return
    from app.services import ssh_keys
    ssh_keys.write_remote_file(path, content, mode)


def file_md5(path: str) -> Optional[str]:
    """md5 of a file on the device; None if it does not exist."""
    if is_on_device():
        try:
            with open(path, "rb") as f:
                return hashlib.md5(f.read()).hexdigest()
        except OSError:
            return None
    from app.services import ssh_keys
    return ssh_keys.remote_md5(path)


def ensure_dir(path: str) -> None:
    if is_on_device():
        os.makedirs(path, exist_ok=True)
        return
    from app.services import ssh_keys
    ssh_keys.run_remote(f"sudo mkdir -p {path}")


def delete_file(path: str) -> None:
    """Delete a file on the device; no error if it does not exist."""
    if is_on_device():
        try:
            os.remove(path)
        except OSError:
            pass
        return
    from app.services import ssh_keys
    ssh_keys.run_remote(f"sudo rm -f {path}")


def list_dir(path: str) -> List[str]:
    """Names of the entries in a device directory; [] if it does not exist."""
    if is_on_device():
        try:
            return os.listdir(path)
        except OSError:
            return []
    from app.services import ssh_keys
    try:
        out = ssh_keys.run_remote(f"sudo ls -1 {path}")
    except VyOSError:
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]

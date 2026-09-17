"""Multi-device connection manager.

Holds the currently active VyOSClient and a list of saved devices
(backend/connections.json). Supports SSH bootstrap: when the REST API is not
configured on a device yet, we log in via SSH, enable `service https` on the
chosen port with a generated API key, then connect through the API.
"""
import json
import secrets
import socket
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any
from urllib.parse import urlparse

from app.config import settings
from app.services.staging import staging_area
from app.services.vyos_client import VyOSClient, VyOSError

STORE_PATH = Path(__file__).resolve().parent.parent.parent / "connections.json"


class ConnectionManager:
    def __init__(self):
        self._client: Optional[VyOSClient] = None
        self._device: Optional[Dict[str, Any]] = None
        self._lock = threading.Lock()
        self._devices: List[Dict[str, Any]] = self._load()

    # ─── Storage ──────────────────────────────────────────────────

    def _load(self) -> List[Dict[str, Any]]:
        try:
            data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except (OSError, ValueError):
            return []

    def _save(self):
        tmp = STORE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._devices, indent=2), encoding="utf-8")
        tmp.replace(STORE_PATH)

    def list_devices(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": d["id"],
                "host": d["host"],
                "port": d["port"],
                "label": d.get("label"),
                "last_used": d.get("last_used"),
            }
            for d in sorted(self._devices, key=lambda x: x.get("last_used") or "", reverse=True)
        ]

    # ─── Active connection ────────────────────────────────────────

    @property
    def client(self) -> Optional[VyOSClient]:
        return self._client

    def active_device(self) -> Dict[str, Any]:
        if not self._device:
            raise VyOSError("Not connected to any VyOS device")
        return self._device

    def status(self) -> Dict[str, Any]:
        d = self._device
        return {
            "connected": self._client is not None,
            "host": d.get("host") if d else None,
            "port": d.get("port") if d else None,
            "label": d.get("label") if d else None,
            "host_name": d.get("host_name") if d else None,
            "version": d.get("version") if d else None,
        }

    @staticmethod
    def _test(client: VyOSClient) -> Dict[str, Any]:
        """Verify the API is reachable and the key is valid; return device info."""
        host_name = None
        data = client._post("/retrieve", {"op": "showConfig", "path": ["system"]})
        if isinstance(data, dict):
            host_name = VyOSClient._scalar(data.get("host-name"))
        version = None
        try:
            out = client._post("/show", {"op": "show", "path": ["version"]}) or ""
            for line in out.splitlines():
                if line.strip().startswith("Version:"):
                    version = line.split(":", 1)[1].strip()
                    break
        except VyOSError:
            pass
        return {"host_name": host_name, "version": version}

    def connect(self, host: str, port: int, api_key: str,
                label: Optional[str] = None, save: bool = True) -> Dict[str, Any]:
        client = VyOSClient(base_url=f"https://{host}:{port}", key=api_key, verify=False)
        info = self._test(client)  # raises VyOSError on failure
        with self._lock:
            self._client = client
            self._device = {"host": host, "port": port, "label": label, **info}
            staging_area.clear()  # pending changes belong to the previous device
            if save:
                existing = next((d for d in self._devices if d["host"] == host and d["port"] == port), None)
                if existing:
                    existing.update(api_key=api_key, label=label or existing.get("label"),
                                    last_used=datetime.now(timezone.utc).isoformat())
                else:
                    self._devices.append({
                        "id": secrets.token_hex(4),
                        "host": host, "port": port, "api_key": api_key,
                        "label": label,
                        "last_used": datetime.now(timezone.utc).isoformat(),
                    })
                self._save()
        return info

    def connect_saved(self, device_id: str) -> Dict[str, Any]:
        device = next((d for d in self._devices if d["id"] == device_id), None)
        if not device:
            raise VyOSError("Saved device not found")
        return self.connect(device["host"], device["port"], device["api_key"],
                            label=device.get("label"), save=True)

    def disconnect(self):
        with self._lock:
            self._client = None
            self._device = None
            staging_area.clear()

    def remove_device(self, device_id: str):
        self._devices = [d for d in self._devices if d["id"] != device_id]
        self._save()

    def autoconnect_from_settings(self):
        """Backward compatibility: connect to the device from config.py settings."""
        if self._client is not None or not settings.vyos_api_key:
            return
        try:
            url = urlparse(settings.vyos_api_url)
            if not url.hostname:
                return
            self.connect(url.hostname, url.port or 443, settings.vyos_api_key,
                         label="default", save=True)
        except Exception:
            pass  # device may be offline — the user will log in manually

    # ─── SSH bootstrap ────────────────────────────────────────────

    @staticmethod
    def check_ssh(host: str, ssh_port: int = 22, timeout: float = 5):
        """Return (reachable, banner)."""
        try:
            with socket.create_connection((host, ssh_port), timeout=timeout) as s:
                s.settimeout(timeout)
                banner = s.recv(256).decode(errors="ignore").strip()
                return True, banner
        except OSError:
            return False, None

    def setup_via_ssh(self, host: str, ssh_user: str, ssh_password: str,
                      api_port: int = 8443, label: Optional[str] = None,
                      ssh_port: int = 22) -> Dict[str, Any]:
        """Enable the REST API on the device via SSH, then connect.

        Returns the generated API key — it is shown to the user exactly once.
        """
        import paramiko

        api_key = secrets.token_hex(20)
        key_id = "webui"

        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            ssh.connect(host, port=ssh_port, username=ssh_user, password=ssh_password,
                        timeout=10, banner_timeout=10, auth_timeout=10,
                        look_for_keys=False, allow_agent=False)
        except paramiko.AuthenticationException as e:
            raise VyOSError("SSH authentication failed — check username and password") from e
        except (paramiko.SSHException, OSError) as e:
            raise VyOSError(f"SSH connection failed: {e}") from e

        output = ""
        try:
            chan = ssh.invoke_shell()
            chan.settimeout(15)

            def _pump(seconds: float):
                nonlocal output
                end = time.time() + seconds
                while time.time() < end:
                    if chan.recv_ready():
                        output += chan.recv(65535).decode(errors="ignore")
                    else:
                        time.sleep(0.1)

            def send(cmd: str, wait: float = 0.7):
                chan.send(cmd + "\n")
                _pump(wait)

            send("", 1.0)  # wake the prompt
            send("configure", 1.5)
            send(f"set service https port {api_port}")
            send("set service https api rest")
            send(f"set service https api keys id {key_id} key {api_key}")
            send("commit", 25.0)
            if "Commit failed" in output or "Set failed" in output:
                tail = "\n".join(output.strip().splitlines()[-15:])
                raise VyOSError(f"Commit on the device failed:\n{tail}")
            send("save", 8.0)
            send("exit", 0.5)
            send("exit", 0.5)
        finally:
            ssh.close()

        # nginx may need a moment to start serving the API after the commit
        last_err: Optional[Exception] = None
        for _ in range(5):
            try:
                info = self.connect(host, api_port, api_key, label=label, save=True)
                return {"api_key": api_key, **info}
            except Exception as e:
                last_err = e
                time.sleep(2)
        raise VyOSError(
            f"API was configured via SSH but the device is not answering on port {api_port} yet: {last_err}"
        )


connection_manager = ConnectionManager()

"""Smoke-test multi-device connection flow against the live router.

Tests SSH bootstrap for real (creates a temporary API key id 'webui'),
then removes the key from the router and restores connections.json.
"""
import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

STORE = Path(__file__).parent / "connections.json"
BACKUP = Path(__file__).parent / "connections.json.bak"


def main():
    if STORE.exists():
        shutil.copy(STORE, BACKUP)

    with TestClient(app) as client:
        try:
            # startup autoconnect should have connected to the default device
            r = client.get("/api/connection/status")
            print("status:", r.json())
            assert r.json()["connected"], "autoconnect failed"

            r = client.get("/api/connection/devices")
            print("saved devices:", r.json())

            # existing functionality still works through the proxy
            r = client.get("/api/interfaces/")
            assert r.status_code == 200, r.text
            print("interfaces via proxy:", len(r.json()))

            # wrong key -> api_failed + ssh availability info
            r = client.post("/api/connection/connect", json={
                "host": "10.11.12.4", "port": 8443, "api_key": "wrong-key", "save": False,
            })
            d = r.json()
            print("bad key:", d["status"], "| ssh_available:", d.get("ssh_available"), "| banner:", d.get("ssh_banner"))
            assert d["status"] == "api_failed"
            assert d["ssh_available"] is True

            # full SSH bootstrap on the live router
            r = client.post("/api/connection/setup-ssh", json={
                "host": settings.vyos_host,
                "ssh_user": settings.vyos_username,
                "ssh_password": settings.vyos_password,
                "api_port": 8443,
                "label": "ssh-bootstrap-test",
            })
            print("setup-ssh:", r.status_code,
                  r.json() if r.status_code != 200 else {**r.json(), "api_key": r.json()["api_key"][:8] + "…"})
            assert r.status_code == 200, r.text
            new_key = r.json()["api_key"]

            # the console is now connected with the generated key
            r = client.get("/api/connection/status")
            print("status after setup:", r.json())
            assert r.json()["connected"]

            # cleanup: remove the generated key from the router
            from app.services.vyos_client import VyOSClient
            cleaner = VyOSClient(base_url=settings.vyos_api_url, key=new_key, verify=False)
            print("cleanup:", cleaner.exec_config(["delete service https api keys id webui"]))
            print("saved:", cleaner.save_config())
        finally:
            if BACKUP.exists():
                shutil.move(BACKUP, STORE)
                print("connections.json restored")


if __name__ == "__main__":
    main()

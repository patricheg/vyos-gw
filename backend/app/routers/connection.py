import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.connections import connection_manager
from app.services.vyos_client import VyOSError

router = APIRouter(prefix="/api/connection", tags=["connection"])


class ConnectRequest(BaseModel):
    host: Optional[str] = None
    port: int = 8443
    api_key: Optional[str] = None
    device_id: Optional[str] = None   # connect to a saved device
    label: Optional[str] = None
    save: bool = True


class SshSetupRequest(BaseModel):
    host: str
    ssh_user: str = "vyos"
    ssh_password: str
    api_port: int = 8443
    label: Optional[str] = None


@router.get("/status")
async def connection_status():
    return connection_manager.status()


@router.get("/devices")
async def list_devices():
    return connection_manager.list_devices()


@router.post("/connect")
async def connect(req: ConnectRequest):
    if req.device_id:
        try:
            info = await asyncio.to_thread(connection_manager.connect_saved, req.device_id)
            return {"status": "ok", **info}
        except VyOSError as e:
            raise HTTPException(status_code=400, detail=str(e))

    if not req.host or not req.api_key:
        raise HTTPException(status_code=400, detail="host and api_key are required (or device_id)")
    if not 1 <= req.port <= 65535:
        raise HTTPException(status_code=400, detail="port must be 1-65535")

    try:
        info = await asyncio.to_thread(
            connection_manager.connect, req.host, req.port, req.api_key, req.label, req.save
        )
        return {"status": "ok", **info}
    except VyOSError as e:
        # API did not answer — check whether the device is at least reachable via SSH
        ssh_ok, banner = await asyncio.to_thread(connection_manager.check_ssh, req.host)
        return {
            "status": "api_failed",
            "detail": str(e),
            "ssh_available": ssh_ok,
            "ssh_banner": banner,
        }


@router.post("/setup-ssh")
async def setup_ssh(req: SshSetupRequest):
    if not req.host or not req.ssh_password:
        raise HTTPException(status_code=400, detail="host and ssh_password are required")
    if not 1 <= req.api_port <= 65535:
        raise HTTPException(status_code=400, detail="api_port must be 1-65535")
    try:
        result = await asyncio.to_thread(
            connection_manager.setup_via_ssh,
            req.host, req.ssh_user, req.ssh_password, req.api_port, req.label,
        )
        return {"status": "ok", **result}
    except VyOSError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/disconnect")
async def disconnect():
    connection_manager.disconnect()
    return {"status": "disconnected"}


@router.delete("/devices/{device_id}")
async def remove_device(device_id: str):
    connection_manager.remove_device(device_id)
    return {"status": "removed"}

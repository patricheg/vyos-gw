import asyncio

from fastapi import APIRouter, HTTPException

from app.services import ondevice
from app.services.vyos_client import VyOSError

router = APIRouter(prefix="/api/deploy", tags=["deploy"])


@router.get("/status")
async def deploy_status():
    return await asyncio.to_thread(ondevice.status)


@router.post("/provision")
async def deploy_provision():
    """Build the app image on the device and stage the vyos-gw container.
    Long-running (image build); staged changes still need a commit."""
    try:
        return await asyncio.to_thread(ondevice.provision)
    except VyOSError as e:
        raise HTTPException(status_code=502, detail=str(e))

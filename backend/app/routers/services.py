import asyncio
from typing import List

from fastapi import APIRouter

from app.models import ServiceInfo
from app.services.vyos_client import vyos_client

router = APIRouter(prefix="/api/services", tags=["services"])


@router.get("/", response_model=List[ServiceInfo])
async def list_services():
    return await asyncio.to_thread(vyos_client.get_services)

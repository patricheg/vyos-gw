import asyncio
from fastapi import APIRouter
from app.services.staging import staging_area
from app.services.vyos_client import vyos_client

router = APIRouter(prefix="/api/staged", tags=["staging"])

@router.get("/")
async def list_staged():
    return staging_area.list()

@router.post("/commit")
async def commit_staged():
    try:
        result = await asyncio.to_thread(staging_area.commit, vyos_client)
        return {"status": "success", "result": result}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

@router.delete("/")
async def discard_staged():
    staging_area.discard()
    return {"status": "discarded"}

@router.delete("/{change_id}")
async def remove_staged(change_id: str):
    if staging_area.remove(change_id):
        return {"status": "removed"}
    return {"status": "not_found"}

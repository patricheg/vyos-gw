import asyncio

from fastapi import APIRouter, Query

from app.services import metrics

router = APIRouter(prefix="/api/metrics", tags=["metrics"])


@router.get("/current")
async def metrics_current():
    """Latest sample: system stats and per-interface rates."""
    return await asyncio.to_thread(metrics.get_current)


@router.get("/history")
async def metrics_history(minutes: int = Query(default=60, ge=5, le=10080)):
    """Time series for the last N minutes (auto downsampled)."""
    return await asyncio.to_thread(metrics.get_history, minutes)

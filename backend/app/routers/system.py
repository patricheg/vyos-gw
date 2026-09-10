import asyncio

from fastapi import APIRouter

from app.models import SystemConfig, SystemResources
from app.services.vyos_client import vyos_client
from app.services.staging import staging_area

router = APIRouter(prefix="/api/system", tags=["system"])

_SCALARS = (
    ("host_name", "host-name"),
    ("domain_search", "domain-search"),
    ("time_zone", "time-zone"),
)
_LISTS = (
    ("name_servers", "name-server"),
    ("ntp_servers", "ntp server"),
)


@router.get("/", response_model=SystemConfig)
async def get_system():
    return await asyncio.to_thread(vyos_client.get_system_config)


@router.get("/resources", response_model=SystemResources)
async def get_resources():
    return await asyncio.to_thread(vyos_client.get_system_resources)


@router.put("/")
async def update_system(data: SystemConfig):
    """Stage set/delete commands for fields that actually changed."""
    current = await asyncio.to_thread(vyos_client.get_system_config)
    commands = []

    for field, node in _SCALARS:
        new = (getattr(data, field) or "").strip() or None
        if new != getattr(current, field):
            if new:
                commands.append((f"set system {node} '{new}'", f"Set system {node}"))
            else:
                commands.append((f"delete system {node}", f"Remove system {node}"))

    for field, node in _LISTS:
        old = set(getattr(current, field))
        new = {v.strip() for v in getattr(data, field) if v.strip()}
        for v in sorted(old - new):
            commands.append((f"delete system {node} '{v}'", f"Remove {node} {v}"))
        for v in sorted(new - old):
            commands.append((f"set system {node} '{v}'", f"Add {node} {v}"))

    for cmd, desc in commands:
        staging_area.add(cmd, desc, "system")
    return {"status": "staged", "changes": len(commands)}

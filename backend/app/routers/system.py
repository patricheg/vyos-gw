import asyncio
import re
from datetime import datetime

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse

from app.models import SystemConfig, SystemResources
from app.services.vyos_client import vyos_client, VyOSError
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


@router.post("/save")
async def save_config():
    """Write the running configuration to /config/config.boot on the device."""
    try:
        result = await asyncio.to_thread(vyos_client.save_config)
    except VyOSError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "saved", "detail": result}


@router.get("/backup")
async def backup_config():
    """Download the running configuration as a text file of set-commands."""
    try:
        text = await asyncio.to_thread(vyos_client.get_config_commands)
    except VyOSError as e:
        raise HTTPException(status_code=502, detail=str(e))
    if not text.strip():
        raise HTTPException(status_code=502, detail="Device returned an empty configuration")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return PlainTextResponse(
        text,
        headers={"Content-Disposition": f'attachment; filename="vyos-backup-{stamp}.txt"'},
    )


@router.post("/restore")
async def restore_config(file: UploadFile):
    """Apply a backup file (set/delete commands, one per line) to the device."""
    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Backup file is not valid UTF-8 text")

    commands = []
    for lineno, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue
        if not re.match(r"^(set|delete)\s+\S", line):
            raise HTTPException(
                status_code=400,
                detail=f"Line {lineno} is not a set/delete command: {line[:120]!r}",
            )
        commands.append(line)

    if not commands:
        raise HTTPException(status_code=400, detail="Backup file contains no commands")

    try:
        result = await asyncio.to_thread(vyos_client.restore_config_commands, commands)
    except VyOSError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"status": "restored", "commands": len(commands), "detail": result}

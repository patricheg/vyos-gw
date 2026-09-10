import asyncio
from fastapi import APIRouter, HTTPException
from typing import List
from app.models import Interface, InterfacePatch
from app.services.vyos_client import vyos_client
from app.services.staging import staging_area

router = APIRouter(prefix="/api/interfaces", tags=["interfaces"])

@router.get("/", response_model=List[Interface])
async def list_interfaces():
    return await asyncio.to_thread(vyos_client.get_interfaces)

@router.get("/{name}")
async def get_interface(name: str):
    detail = await asyncio.to_thread(vyos_client.get_interface_detail, name)
    if not detail:
        raise HTTPException(status_code=404, detail="Interface not found")
    return detail

@router.put("/{name}")
async def update_interface(name: str, data: InterfacePatch):
    commands = []
    desc = (data.description or '').strip()
    addr = (data.address or '').strip()

    if not data.enabled:
        commands.append(f"set interfaces ethernet {name} disable")
    else:
        commands.append(f"delete interfaces ethernet {name} disable")

    if desc:
        commands.append(f"set interfaces ethernet {name} description '{desc}'")
    else:
        commands.append(f"delete interfaces ethernet {name} description")

    if addr:
        commands.append(f"set interfaces ethernet {name} address {addr}")

    if data.mtu is not None:
        commands.append(f"set interfaces ethernet {name} mtu '{data.mtu}'")

    for cmd in commands:
        staging_area.add(cmd, f"Update interface {name}", "interfaces")

    return {"status": "staged", "changes": len(commands)}

@router.delete("/{name}/address/{address:path}")
async def delete_address(name: str, address: str):
    cmd = f"delete interfaces ethernet {name} address {address}"
    staging_area.add(cmd, f"Remove address {address} from {name}", "interfaces")
    return {"status": "staged", "changes": 1}

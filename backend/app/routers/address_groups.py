import asyncio
from typing import List

from fastapi import APIRouter, HTTPException

from app.models import AddressGroup
from app.services.vyos_client import vyos_client
from app.services.staging import staging_area
# Reuse the firewall router's validation/staging helpers — same config path
from app.routers.firewall import _validate_group, _stage_group_commands

router = APIRouter(prefix="/api/address-groups", tags=["address-groups"])


@router.get("/", response_model=List[AddressGroup])
async def list_address_groups():
    return await asyncio.to_thread(vyos_client.get_address_groups)


@router.post("/")
async def add_address_group(group: AddressGroup):
    _validate_group(group)
    _stage_group_commands(group)
    return {"status": "staged", "changes": 1}


@router.put("/{name}")
async def update_address_group(name: str, group: AddressGroup):
    """Replace group `name` (delete + full re-set inside one commit)."""
    _validate_group(group)
    staging_area.add(
        f"delete firewall group address-group {name}",
        f"Update: remove old address group {name}",
        "firewall"
    )
    _stage_group_commands(group)
    return {"status": "staged", "changes": 1}


@router.delete("/{name}")
async def delete_address_group(name: str):
    chains, nat_rules, snat_rules = await asyncio.gather(
        asyncio.to_thread(vyos_client.get_firewall_chains),
        asyncio.to_thread(vyos_client.get_nat_rules),
        asyncio.to_thread(vyos_client.get_source_nat_rules),
    )
    used_by = [
        f"{c.name} rule {r.number}"
        for c in chains for r in c.rules
        if r.source_group == name or r.destination_group == name
    ]
    used_by += [
        f"NAT destination rule {r.number}"
        for r in nat_rules
        if r.source_address_group == name or r.destination_address_group == name
    ]
    used_by += [
        f"NAT source rule {r.number}"
        for r in snat_rules
        if r.source_address_group == name or r.destination_address_group == name
    ]
    if used_by:
        raise HTTPException(
            status_code=400,
            detail=f"Group {name} is used by: {', '.join(used_by)} — remove it from those rules first",
        )
    staging_area.add(
        f"delete firewall group address-group {name}",
        f"Delete address group {name}",
        "firewall"
    )
    return {"status": "staged", "changes": 1}

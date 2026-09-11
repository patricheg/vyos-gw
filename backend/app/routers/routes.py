import asyncio
import ipaddress
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models import RouteEntry, StaticRoute
from app.services.vyos_client import vyos_client
from app.services.staging import staging_area

router = APIRouter(prefix="/api/routes", tags=["routes"])


def _validate(route: StaticRoute) -> str:
    """Validate the route; return the canonical prefix."""
    try:
        net = ipaddress.ip_network(route.prefix)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"'{route.prefix}' is not a valid network (e.g. 192.168.0.0/24)",
        )
    if net.version != 4:
        raise HTTPException(status_code=400, detail="Only IPv4 static routes are supported here")
    if route.blackhole and route.next_hops:
        raise HTTPException(status_code=400, detail="Choose either next-hop(s) or blackhole, not both")
    if not route.blackhole and not route.next_hops:
        raise HTTPException(status_code=400, detail="Add at least one next-hop, or enable blackhole")
    for nh in route.next_hops:
        try:
            ipaddress.ip_address(nh.address)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Next-hop '{nh.address}' is not a valid IP address")
        if nh.distance is not None and not 1 <= nh.distance <= 255:
            raise HTTPException(status_code=400, detail=f"Next-hop {nh.address}: distance must be 1-255")
    if route.blackhole_distance is not None and not 1 <= route.blackhole_distance <= 255:
        raise HTTPException(status_code=400, detail="Blackhole distance must be 1-255")
    return str(net)


def _stage_route_commands(route: StaticRoute, prefix: str):
    base = f"set protocols static route {prefix}"
    if route.description:
        staging_area.add(f"{base} description '{route.description}'", f"Static route {prefix} description", "routes")
    for nh in route.next_hops:
        staging_area.add(f"{base} next-hop {nh.address}", f"Static route {prefix} via {nh.address}", "routes")
        if nh.distance is not None:
            staging_area.add(f"{base} next-hop {nh.address} distance {nh.distance}", f"Static route {prefix} via {nh.address} distance {nh.distance}", "routes")
    if route.blackhole:
        staging_area.add(f"{base} blackhole", f"Static route {prefix} blackhole", "routes")
        if route.blackhole_distance is not None:
            staging_area.add(f"{base} blackhole distance {route.blackhole_distance}", f"Static route {prefix} blackhole distance {route.blackhole_distance}", "routes")
    if route.disabled:
        staging_area.add(f"{base} disable", f"Static route {prefix} disabled", "routes")


@router.get("/table", response_model=List[RouteEntry])
async def routing_table():
    return await asyncio.to_thread(vyos_client.get_routing_table)


@router.get("/static", response_model=List[StaticRoute])
async def list_static_routes():
    return await asyncio.to_thread(vyos_client.get_static_routes)


@router.post("/static")
async def add_static_route(route: StaticRoute):
    prefix = _validate(route)
    _stage_route_commands(route, prefix)
    return {"status": "staged", "changes": 1, "prefix": prefix}


class StaticRouteToggle(BaseModel):
    disabled: bool


@router.put("/static/{prefix:path}/disabled")
async def toggle_static_route(prefix: str, data: StaticRouteToggle):
    if data.disabled:
        cmd = f"set protocols static route {prefix} disable"
        desc = f"Disable static route {prefix}"
    else:
        cmd = f"delete protocols static route {prefix} disable"
        desc = f"Enable static route {prefix}"
    staging_area.add(cmd, desc, "routes")
    return {"status": "staged", "changes": 1}


@router.put("/static/{prefix:path}")
async def update_static_route(prefix: str, route: StaticRoute):
    """Replace route `prefix` (delete + full re-set inside one commit)."""
    new_prefix = _validate(route)
    staging_area.add(
        f"delete protocols static route {prefix}",
        f"Update: remove old static route {prefix}",
        "routes"
    )
    _stage_route_commands(route, new_prefix)
    return {"status": "staged", "changes": 1, "prefix": new_prefix}


@router.delete("/static/{prefix:path}")
async def delete_static_route(prefix: str):
    staging_area.add(
        f"delete protocols static route {prefix}",
        f"Delete static route {prefix}",
        "routes"
    )
    return {"status": "staged", "changes": 1}

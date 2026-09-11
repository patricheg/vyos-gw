import asyncio
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from app.models import LogEntry, FirewallLogEntry
from app.services.vyos_client import vyos_client, VyOSError

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("/", response_model=List[LogEntry])
async def list_logs(
    source: str = Query(
        "all",
        pattern="^(all|kernel|firewall|nat|authorization|https|openvpn|vpn|wireguard|lldp|snmp|vrrp|conntrack-sync|zebra|cluster|haproxy|certbot)$",
    ),
    severity: Optional[str] = Query(None, pattern="^(error|warning|info)$"),
    search: Optional[str] = None,
    lines: int = Query(200, ge=1, le=2000),
):
    try:
        entries = await asyncio.to_thread(vyos_client.get_logs, source, lines)
    except VyOSError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if severity:
        entries = [e for e in entries if e.severity == severity]
    if search:
        needle = search.lower()
        entries = [e for e in entries if needle in e.raw.lower()]

    return list(reversed(entries[-lines:]))


@router.get("/firewall", response_model=List[FirewallLogEntry])
async def firewall_logs(
    action: Optional[str] = Query(None, pattern="^(accept|drop|reject)$"),
    chain: Optional[str] = None,
    src: Optional[str] = None,
    dst: Optional[str] = None,
    proto: Optional[str] = None,
    port: Optional[str] = None,
    lines: int = Query(500, ge=1, le=5000),
):
    try:
        entries = await asyncio.to_thread(vyos_client.get_firewall_logs)
    except VyOSError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if action:
        entries = [e for e in entries if e.action == action]
    if chain:
        needle = chain.lower()
        entries = [e for e in entries if e.chain and needle in e.chain.lower()]
    if src:
        entries = [e for e in entries if e.src and src in e.src]
    if dst:
        entries = [e for e in entries if e.dst and dst in e.dst]
    if proto:
        entries = [e for e in entries if e.proto and e.proto.lower() == proto.lower()]
    if port:
        entries = [e for e in entries if e.spt == port or e.dpt == port]

    return list(reversed(entries[-lines:]))

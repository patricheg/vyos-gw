import asyncio
from typing import List

from fastapi import APIRouter, HTTPException

from app.models import NatRule, NatRuleCreate
from app.services.vyos_client import vyos_client
from app.services.staging import staging_area

router = APIRouter(prefix="/api/nat", tags=["nat"])


def _norm_opt(value, sentinel: str):
    if value is None:
        return None
    v = str(value).strip()
    if not v or v.lower() == sentinel:
        return None
    return v


def _validate(rule: NatRuleCreate):
    protocol = _norm_opt(rule.protocol, "all")
    if (rule.destination_port or rule.translation_port) and protocol not in ("tcp", "udp", "tcp_udp"):
        raise HTTPException(
            status_code=400,
            detail="VyOS requires protocol tcp/udp/tcp_udp when a port is specified",
        )
    if not rule.translation_address and not rule.translation_port:
        raise HTTPException(
            status_code=400,
            detail="A port-forward rule needs a translation address and/or port",
        )


def _stage_rule_commands(rule: NatRule):
    base = f"set nat destination rule {rule.number}"
    protocol = _norm_opt(rule.protocol, "all")
    src_addr = _norm_opt(rule.source_address, "any")
    dst_addr = _norm_opt(rule.destination_address, "any")
    if rule.description:
        staging_area.add(f"{base} description '{rule.description}'", f"NAT rule {rule.number} description", "nat")
    if protocol:
        staging_area.add(f"{base} protocol '{protocol}'", f"NAT rule {rule.number} protocol", "nat")
    if src_addr:
        staging_area.add(f"{base} source address '{src_addr}'", f"NAT rule {rule.number} source", "nat")
    if dst_addr:
        staging_area.add(f"{base} destination address '{dst_addr}'", f"NAT rule {rule.number} dest", "nat")
    if rule.destination_port:
        staging_area.add(f"{base} destination port '{rule.destination_port}'", f"NAT rule {rule.number} dst port", "nat")
    if rule.inbound_interface:
        staging_area.add(f"{base} inbound-interface name '{rule.inbound_interface}'", f"NAT rule {rule.number} inbound interface", "nat")
    if rule.translation_address:
        staging_area.add(f"{base} translation address '{rule.translation_address}'", f"NAT rule {rule.number} translate to {rule.translation_address}", "nat")
    if rule.translation_port:
        staging_area.add(f"{base} translation port '{rule.translation_port}'", f"NAT rule {rule.number} translate port", "nat")
    if rule.log:
        staging_area.add(f"{base} log", f"NAT rule {rule.number} logging", "nat")


@router.get("/destination", response_model=List[NatRule])
async def list_nat_rules():
    return await asyncio.to_thread(vyos_client.get_nat_rules)


@router.post("/destination/rules")
async def add_nat_rule(rule: NatRuleCreate):
    _validate(rule)
    _stage_rule_commands(rule)
    return {"status": "staged", "changes": 1}


@router.put("/destination/rules/{number}")
async def update_nat_rule(number: int, rule: NatRuleCreate):
    """Replace rule `number` (delete + full re-set inside one commit)."""
    _validate(rule)
    staging_area.add(
        f"delete nat destination rule {number}",
        f"Update: remove old NAT rule {number}",
        "nat"
    )
    _stage_rule_commands(rule)
    return {"status": "staged", "changes": 1}


@router.delete("/destination/rules/{number}")
async def delete_nat_rule(number: int):
    staging_area.add(
        f"delete nat destination rule {number}",
        f"Delete NAT rule {number}",
        "nat"
    )
    return {"status": "staged", "changes": 1}

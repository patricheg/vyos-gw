import asyncio
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models import NatRule, NatRuleCreate, SourceNatRule, SourceNatRuleCreate
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
    if rule.disabled:
        staging_area.add(f"{base} disable", f"NAT rule {rule.number} disabled", "nat")


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


class NatRuleToggle(BaseModel):
    disabled: bool


@router.put("/destination/rules/{number}/disabled")
async def toggle_nat_rule(number: int, data: NatRuleToggle):
    if data.disabled:
        cmd = f"set nat destination rule {number} disable"
        desc = f"Disable NAT rule {number}"
    else:
        cmd = f"delete nat destination rule {number} disable"
        desc = f"Enable NAT rule {number}"
    staging_area.add(cmd, desc, "nat")
    return {"status": "staged", "changes": 1}


# ─── Source NAT (masquerade / SNAT) ─────────────────────────────


def _validate_source(rule: SourceNatRuleCreate):
    protocol = _norm_opt(rule.protocol, "all")
    if rule.destination_port and protocol not in ("tcp", "udp", "tcp_udp"):
        raise HTTPException(
            status_code=400,
            detail="VyOS requires protocol tcp/udp/tcp_udp when a port is specified",
        )
    if not rule.translation_address:
        raise HTTPException(
            status_code=400,
            detail="A source NAT rule needs a translation address (or 'masquerade')",
        )


def _stage_source_rule_commands(rule: SourceNatRule):
    base = f"set nat source rule {rule.number}"
    protocol = _norm_opt(rule.protocol, "all")
    src_addr = _norm_opt(rule.source_address, "any")
    dst_addr = _norm_opt(rule.destination_address, "any")
    if rule.description:
        staging_area.add(f"{base} description '{rule.description}'", f"SNAT rule {rule.number} description", "nat")
    if protocol:
        staging_area.add(f"{base} protocol '{protocol}'", f"SNAT rule {rule.number} protocol", "nat")
    if src_addr:
        staging_area.add(f"{base} source address '{src_addr}'", f"SNAT rule {rule.number} source", "nat")
    if dst_addr:
        staging_area.add(f"{base} destination address '{dst_addr}'", f"SNAT rule {rule.number} dest", "nat")
    if rule.destination_port:
        staging_area.add(f"{base} destination port '{rule.destination_port}'", f"SNAT rule {rule.number} dst port", "nat")
    if rule.outbound_interface:
        staging_area.add(f"{base} outbound-interface name '{rule.outbound_interface}'", f"SNAT rule {rule.number} outbound interface", "nat")
    if rule.translation_address:
        staging_area.add(f"{base} translation address '{rule.translation_address}'", f"SNAT rule {rule.number} translate to {rule.translation_address}", "nat")
    if rule.translation_port:
        staging_area.add(f"{base} translation port '{rule.translation_port}'", f"SNAT rule {rule.number} translate port", "nat")
    if rule.log:
        staging_area.add(f"{base} log", f"SNAT rule {rule.number} logging", "nat")
    if rule.disabled:
        staging_area.add(f"{base} disable", f"SNAT rule {rule.number} disabled", "nat")


@router.get("/source", response_model=List[SourceNatRule])
async def list_source_nat_rules():
    return await asyncio.to_thread(vyos_client.get_source_nat_rules)


@router.post("/source/rules")
async def add_source_nat_rule(rule: SourceNatRuleCreate):
    _validate_source(rule)
    _stage_source_rule_commands(rule)
    return {"status": "staged", "changes": 1}


@router.put("/source/rules/{number}")
async def update_source_nat_rule(number: int, rule: SourceNatRuleCreate):
    """Replace source rule `number` (delete + full re-set inside one commit)."""
    _validate_source(rule)
    staging_area.add(
        f"delete nat source rule {number}",
        f"Update: remove old SNAT rule {number}",
        "nat"
    )
    _stage_source_rule_commands(rule)
    return {"status": "staged", "changes": 1}


@router.delete("/source/rules/{number}")
async def delete_source_nat_rule(number: int):
    staging_area.add(
        f"delete nat source rule {number}",
        f"Delete SNAT rule {number}",
        "nat"
    )
    return {"status": "staged", "changes": 1}


@router.put("/source/rules/{number}/disabled")
async def toggle_source_nat_rule(number: int, data: NatRuleToggle):
    if data.disabled:
        cmd = f"set nat source rule {number} disable"
        desc = f"Disable SNAT rule {number}"
    else:
        cmd = f"delete nat source rule {number} disable"
        desc = f"Enable SNAT rule {number}"
    staging_area.add(cmd, desc, "nat")
    return {"status": "staged", "changes": 1}

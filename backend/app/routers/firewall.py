import asyncio
import ipaddress
import re
from fastapi import APIRouter, HTTPException
from typing import List, Literal

from pydantic import BaseModel

from app.models import FirewallRuleset, FirewallRule, FirewallRuleCreate, AddressGroup
from app.services.vyos_client import vyos_client
from app.services.staging import staging_area

router = APIRouter(prefix="/api/firewall", tags=["firewall"])

CHAINS = ("input", "forward", "output")


def _chain_base(name: str) -> str:
    if name not in CHAINS:
        raise HTTPException(status_code=404, detail=f"Unknown chain {name!r} (use input/forward/output)")
    return f"firewall ipv4 {name} filter"


def _norm_opt(value, sentinel: str):
    """Normalize optional rule fields: 'any'/'all'/empty mean "not set" in VyOS 1.5."""
    if value is None:
        return None
    v = str(value).strip()
    if not v or v.lower() == sentinel:
        return None
    return v


def _validate_rule(rule: FirewallRuleCreate):
    protocol = _norm_opt(rule.protocol, "all")
    if (rule.source_port or rule.destination_port) and not protocol:
        raise HTTPException(
            status_code=400,
            detail="VyOS requires protocol (tcp/udp/tcp_udp) when a port is specified",
        )
    # VyOS: only one of address / group / geoip per side
    if _norm_opt(rule.source_address, "any") and rule.source_group:
        raise HTTPException(status_code=400, detail="Source: choose either an address or an address group, not both")
    if _norm_opt(rule.destination_address, "any") and rule.destination_group:
        raise HTTPException(status_code=400, detail="Destination: choose either an address or an address group, not both")
    for side, addr, grp, geoip in (
        ("Source", rule.source_address, rule.source_group, rule.source_geoip),
        ("Destination", rule.destination_address, rule.destination_group, rule.destination_geoip),
    ):
        if geoip and (_norm_opt(addr, "any") or grp):
            raise HTTPException(status_code=400, detail=f"{side}: GeoIP cannot be combined with an address or group")
        for cc in geoip or []:
            if not re.match(r"^[a-z]{2}$", cc):
                raise HTTPException(status_code=400, detail=f"{side}: '{cc}' is not a valid 2-letter country code (lowercase, e.g. 'by')")


@router.get("/chains", response_model=List[FirewallRuleset])
async def list_chains():
    return await asyncio.to_thread(vyos_client.get_firewall_chains)


class DefaultActionUpdate(BaseModel):
    action: Literal["accept", "drop", "reject"]


@router.put("/chains/{name}/default-action")
async def set_default_action(name: str, data: DefaultActionUpdate):
    base = _chain_base(name)
    staging_area.add(
        f"set {base} default-action '{data.action}'",
        f"Set {name} default-action to {data.action}",
        "firewall"
    )
    return {"status": "staged", "changes": 1}


@router.post("/chains/{name}/rules")
async def add_rule(name: str, rule: FirewallRuleCreate):
    _chain_base(name)
    _validate_rule(rule)
    _stage_rule_commands(name, rule)
    return {"status": "staged", "changes": 1}


@router.delete("/chains/{name}/rules/{number}")
async def delete_rule(name: str, number: int):
    base = _chain_base(name)
    staging_area.add(
        f"delete {base} rule {number}",
        f"Delete rule {number} from {name}",
        "firewall"
    )
    return {"status": "staged", "changes": 1}


@router.put("/chains/{name}/rules/{number}")
async def update_rule(name: str, number: int, rule: FirewallRuleCreate):
    """Replace rule `number` with new content (possibly a new number).

    Staged as delete + full re-set so that cleared fields are actually
    removed and renumbering works — all inside one commit transaction.
    """
    base = _chain_base(name)
    _validate_rule(rule)
    staging_area.add(
        f"delete {base} rule {number}",
        f"Update: remove old rule {number} from {name}",
        "firewall"
    )
    _stage_rule_commands(name, rule)
    return {"status": "staged", "changes": 1}


def _stage_rule_commands(chain: str, rule: FirewallRule):
    base = f"set firewall ipv4 {chain} filter rule {rule.number}"
    protocol = _norm_opt(rule.protocol, "all")
    src_addr = _norm_opt(rule.source_address, "any")
    dst_addr = _norm_opt(rule.destination_address, "any")
    staging_area.add(f"{base} action '{rule.action}'", f"Rule {rule.number} action", "firewall")
    if rule.description:
        staging_area.add(f"{base} description '{rule.description}'", f"Rule {rule.number} description", "firewall")
    if protocol:
        staging_area.add(f"{base} protocol '{protocol}'", f"Rule {rule.number} protocol", "firewall")
    if src_addr:
        staging_area.add(f"{base} source address '{src_addr}'", f"Rule {rule.number} source", "firewall")
    if rule.source_group:
        staging_area.add(f"{base} source group address-group '{rule.source_group}'", f"Rule {rule.number} source group", "firewall")
    if rule.source_geoip:
        for cc in rule.source_geoip:
            staging_area.add(f"{base} source geoip country-code '{cc}'", f"Rule {rule.number} source geoip", "firewall")
        if rule.source_geoip_inverse:
            staging_area.add(f"{base} source geoip inverse-match", f"Rule {rule.number} source geoip inverse", "firewall")
    if dst_addr:
        staging_area.add(f"{base} destination address '{dst_addr}'", f"Rule {rule.number} dest", "firewall")
    if rule.destination_group:
        staging_area.add(f"{base} destination group address-group '{rule.destination_group}'", f"Rule {rule.number} dest group", "firewall")
    if rule.destination_geoip:
        for cc in rule.destination_geoip:
            staging_area.add(f"{base} destination geoip country-code '{cc}'", f"Rule {rule.number} dest geoip", "firewall")
        if rule.destination_geoip_inverse:
            staging_area.add(f"{base} destination geoip inverse-match", f"Rule {rule.number} dest geoip inverse", "firewall")
    if rule.source_port:
        staging_area.add(f"{base} source port '{rule.source_port}'", f"Rule {rule.number} src port", "firewall")
    if rule.destination_port:
        staging_area.add(f"{base} destination port '{rule.destination_port}'", f"Rule {rule.number} dst port", "firewall")
    if rule.log:
        staging_area.add(f"{base} log", f"Rule {rule.number} logging", "firewall")
    if rule.state_established:
        staging_area.add(f"{base} state established", f"Rule {rule.number} state", "firewall")
    if rule.state_related:
        staging_area.add(f"{base} state related", f"Rule {rule.number} state", "firewall")
    if rule.state_new:
        staging_area.add(f"{base} state new", f"Rule {rule.number} state", "firewall")


@router.post("/chains/{name}/reorder")
async def reorder_chain(name: str, ordered_numbers: List[int]):
    _chain_base(name)
    chains = await asyncio.to_thread(vyos_client.get_firewall_chains)
    chain = next(c for c in chains if c.name == name)

    rules_by_num = {r.number: r for r in chain.rules}

    # Validate and build ordered rule list
    new_rules = []
    for num in ordered_numbers:
        rule = rules_by_num.get(num)
        if not rule:
            raise HTTPException(status_code=400, detail=f"Rule {num} not found")
        new_rules.append(rule)

    # Step 1: delete all existing rules first (avoids number collisions)
    for old_num in list(rules_by_num.keys()):
        staging_area.add(
            f"delete firewall ipv4 {name} filter rule {old_num}",
            f"Reorder: remove old rule {old_num}",
            "firewall"
        )

    # Step 2: recreate all rules with sequential numbers
    for i, rule in enumerate(new_rules, start=1):
        new_num = i * 10
        _stage_rule_commands(name, FirewallRule(**{**rule.model_dump(), "number": new_num}))

    return {"status": "staged", "changes": "reordered"}


# ─── Address groups ─────────────────────────────────────────────

_GROUP_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
_ADDR_RANGE_RE = re.compile(r"^(\d{1,3}(?:\.\d{1,3}){3})-(\d{1,3}(?:\.\d{1,3}){3})$")


def _validate_group(group: AddressGroup):
    if not _GROUP_NAME_RE.match(group.name):
        raise HTTPException(status_code=400, detail=f"Invalid group name {group.name!r} (letters, digits, - _ .)")
    if not group.addresses:
        raise HTTPException(status_code=400, detail="Add at least one address (IP, CIDR or range)")
    for addr in group.addresses:
        a = addr.strip()
        if not a:
            raise HTTPException(status_code=400, detail="Empty address entry")
        m = _ADDR_RANGE_RE.match(a)
        if m:
            try:
                ipaddress.ip_address(m.group(1))
                ipaddress.ip_address(m.group(2))
            except ValueError:
                raise HTTPException(status_code=400, detail=f"'{a}' is not a valid address range")
            continue
        try:
            ipaddress.ip_address(a)
        except ValueError:
            try:
                ipaddress.ip_network(a)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"'{a}' is not a valid IP, network (CIDR) or range (10.0.0.1-10.0.0.9)")


def _stage_group_commands(group: AddressGroup):
    base = f"set firewall group address-group {group.name}"
    if group.description:
        staging_area.add(f"{base} description '{group.description}'", f"Address group {group.name} description", "firewall")
    for addr in group.addresses:
        staging_area.add(f"{base} address '{addr.strip()}'", f"Address group {group.name} + {addr.strip()}", "firewall")


@router.get("/groups", response_model=List[AddressGroup])
async def list_address_groups():
    return await asyncio.to_thread(vyos_client.get_address_groups)


@router.post("/groups")
async def add_address_group(group: AddressGroup):
    _validate_group(group)
    _stage_group_commands(group)
    return {"status": "staged", "changes": 1}


@router.put("/groups/{name}")
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


@router.delete("/groups/{name}")
async def delete_address_group(name: str):
    chains = await asyncio.to_thread(vyos_client.get_firewall_chains)
    used_by = [
        f"{c.name} rule {r.number}"
        for c in chains for r in c.rules
        if r.source_group == name or r.destination_group == name
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

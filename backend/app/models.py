from pydantic import BaseModel
from typing import Optional, List, Literal, Dict, Any

class InterfaceBase(BaseModel):
    name: str
    description: Optional[str] = None
    address: Optional[str] = None
    mtu: Optional[int] = None
    enabled: bool = True

class Interface(InterfaceBase):
    mac: Optional[str] = None
    state: Optional[str] = None
    link: Optional[str] = None

class InterfacePatch(BaseModel):
    description: Optional[str] = None
    address: Optional[str] = None
    mtu: Optional[int] = None
    enabled: bool = True

class FirewallRuleBase(BaseModel):
    number: int
    action: Literal["accept", "drop", "reject"]
    protocol: Optional[str] = None
    source_address: Optional[str] = None
    destination_address: Optional[str] = None
    source_port: Optional[str] = None
    destination_port: Optional[str] = None
    description: Optional[str] = None
    log: Optional[bool] = None
    state_established: Optional[bool] = None
    state_related: Optional[bool] = None
    state_new: Optional[bool] = None

class FirewallRuleCreate(FirewallRuleBase):
    pass

class FirewallRule(FirewallRuleBase):
    pass

class FirewallRulesetBase(BaseModel):
    name: str
    default_action: Literal["accept", "drop", "reject"] = "drop"
    description: Optional[str] = None
    rules: List[FirewallRule] = []

class FirewallRuleset(FirewallRulesetBase):
    pass

# ─── NAT ─────────────────────────────────────────────────────────

class NatRuleBase(BaseModel):
    number: int
    description: Optional[str] = None
    protocol: Optional[str] = None
    source_address: Optional[str] = None
    destination_address: Optional[str] = None
    destination_port: Optional[str] = None
    inbound_interface: Optional[str] = None
    translation_address: Optional[str] = None
    translation_port: Optional[str] = None
    log: Optional[bool] = None

class NatRuleCreate(NatRuleBase):
    pass

class NatRule(NatRuleBase):
    pass

# ─── System ──────────────────────────────────────────────────────

class SystemConfig(BaseModel):
    host_name: Optional[str] = None
    domain_search: Optional[str] = None
    time_zone: Optional[str] = None
    name_servers: List[str] = []
    ntp_servers: List[str] = []

# ─── Logs ────────────────────────────────────────────────────────

class LogEntry(BaseModel):
    timestamp: str            # raw syslog timestamp, e.g. "Sep  7 16:32:01" (no year)
    host: Optional[str] = None
    process: Optional[str] = None  # tag, e.g. "named[1234]" / "kernel"
    message: str
    severity: str = "info"    # error | warning | info (inferred from keywords)
    raw: str

class FirewallLogEntry(BaseModel):
    timestamp: str
    chain: Optional[str] = None        # e.g. "INPUT-FILTER" or custom chain name
    rule_number: Optional[int] = None
    action: Optional[str] = None       # accept | drop | reject
    iface_in: Optional[str] = None
    iface_out: Optional[str] = None
    src: Optional[str] = None
    dst: Optional[str] = None
    proto: Optional[str] = None
    spt: Optional[str] = None
    dpt: Optional[str] = None
    raw: str

class ServiceInfo(BaseModel):
    name: str
    label: str
    enabled: bool = False
    configured: bool = False
    settings: Optional[Dict[str, Any]] = None

class SystemResources(BaseModel):
    cpu_model: Optional[str] = None
    cpu_cores: Optional[int] = None
    cpu_mhz: Optional[float] = None
    load1: Optional[float] = None      # percent
    load5: Optional[float] = None
    load15: Optional[float] = None
    mem_total_mb: Optional[float] = None
    mem_used_mb: Optional[float] = None
    mem_free_mb: Optional[float] = None
    disk_fs: Optional[str] = None
    disk_size: Optional[str] = None
    disk_used: Optional[str] = None
    disk_used_pct: Optional[int] = None
    disk_available: Optional[str] = None
    uptime: Optional[str] = None

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
    source_group: Optional[str] = None        # address-group name (mutually exclusive with source_address)
    destination_group: Optional[str] = None   # address-group name (mutually exclusive with destination_address)
    source_geoip: Optional[List[str]] = None        # country codes, e.g. ["by", "ru"]
    source_geoip_inverse: bool = False              # match all EXCEPT the listed countries
    destination_geoip: Optional[List[str]] = None
    destination_geoip_inverse: bool = False
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

class AddressGroup(BaseModel):
    name: str
    description: Optional[str] = None
    addresses: List[str] = []

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
    disabled: bool = False

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
    device_time: Optional[str] = None

# ─── HAProxy (load-balancing haproxy) ────────────────────────────

class HaproxyServer(BaseModel):
    name: str
    address: Optional[str] = None
    port: Optional[int] = None
    check: bool = False                # active health check
    check_port: Optional[int] = None
    backup: bool = False               # only used when others fail
    send_proxy: bool = False
    send_proxy_v2: bool = False

class HaproxyBackend(BaseModel):
    name: str
    description: Optional[str] = None
    mode: Optional[Literal["http", "tcp"]] = None
    balance: Optional[Literal["round-robin", "least-connection", "source-address"]] = None
    logging_facility: Optional[str] = None   # syslog facility: daemon, local0-7
    ssl_no_verify: bool = False              # re-encrypt to backend, don't verify its cert
    ssl_ca_certificate: Optional[str] = None # re-encrypt to backend, verify against this CA
    servers: List[HaproxyServer] = []

class HaproxyServiceRule(BaseModel):
    number: int
    domain_name: Optional[str] = None
    wildcard_domain: bool = False          # domain-name also matches subdomains
    url_path_match: Optional[Literal["begin", "end", "exact"]] = None
    url_path: Optional[str] = None
    backend: Optional[str] = None          # action: route to backend
    redirect_location: Optional[str] = None  # action: HTTP redirect
    geoip_mode: Optional[Literal["allow", "deny"]] = None  # None = inherit service
    geoip_countries: List[str] = []        # ISO 3166-1 alpha-2 codes

class HaproxyService(BaseModel):
    name: str
    description: Optional[str] = None
    mode: Optional[Literal["http", "tcp"]] = None
    port: Optional[int] = None
    listen_addresses: List[str] = []   # empty = all router addresses
    backends: List[str] = []           # backend members (multi-value node)
    redirect_http_to_https: bool = False
    ssl_certificate: Optional[str] = None
    ssl_certificates: List[str] = []      # additional certs, chosen by SNI
    logging_facility: Optional[str] = None
    rules: List[HaproxyServiceRule] = []
    geoip_mode: Optional[Literal["off", "allow", "deny"]] = "off"
    geoip_countries: List[str] = []        # ISO 3166-1 alpha-2 codes

class HaproxyGlobals(BaseModel):
    max_connections: Optional[int] = None
    timeout_client: Optional[int] = None
    timeout_connect: Optional[int] = None
    timeout_server: Optional[int] = None

class HaproxyConfig(HaproxyGlobals):
    services: List[HaproxyService] = []
    backends: List[HaproxyBackend] = []

class HaproxyAcmeStubCreate(BaseModel):
    listen_address: str           # public IPv4 the HTTP:80 stub binds to (never "*": certbot needs 127.0.0.1:80 free)

# ─── PKI (certificates) ──────────────────────────────────────────

class PkiCertificate(BaseModel):
    name: str
    description: Optional[str] = None
    has_private_key: bool = False
    revoked: bool = False
    acme: bool = False                      # Let's Encrypt managed
    acme_domains: List[str] = []
    acme_email: Optional[str] = None
    acme_rsa_key_size: Optional[int] = None
    acme_url: Optional[str] = None
    acme_listen_address: Optional[str] = None
    subject: Optional[str] = None
    issuer: Optional[str] = None
    not_before: Optional[str] = None
    not_after: Optional[str] = None
    expires_in_days: Optional[int] = None
    serial: Optional[str] = None
    sans: List[str] = []

class PkiCaCertificate(BaseModel):
    name: str
    description: Optional[str] = None
    has_private_key: bool = False
    revoked: bool = False
    subject: Optional[str] = None
    issuer: Optional[str] = None
    not_before: Optional[str] = None
    not_after: Optional[str] = None
    expires_in_days: Optional[int] = None

class PkiConfig(BaseModel):
    certificates: List[PkiCertificate] = []
    ca_certificates: List[PkiCaCertificate] = []

class PkiCertificateImport(BaseModel):
    name: str
    certificate: str                      # PEM text
    private_key: Optional[str] = None     # PEM text
    description: Optional[str] = None

class PkiCaImport(BaseModel):
    name: str
    certificate: str                      # PEM text
    description: Optional[str] = None

class PkiAcmeCreate(BaseModel):
    name: str
    domains: List[str]
    email: str
    listen_address: Optional[str] = None
    rsa_key_size: Literal[2048, 3072, 4096] = 2048
    url: Optional[str] = None             # default: Let's Encrypt v2
    description: Optional[str] = None

# ─── Routing ─────────────────────────────────────────────────────

class RouteNexthop(BaseModel):
    ip: Optional[str] = None
    interface: Optional[str] = None
    active: bool = True
    directly_connected: bool = False

class RouteEntry(BaseModel):
    prefix: str
    protocol: str
    distance: Optional[int] = None
    metric: Optional[int] = None
    selected: bool = False
    installed: bool = False
    uptime: Optional[str] = None
    nexthops: List[RouteNexthop] = []

class StaticNextHop(BaseModel):
    address: str
    distance: Optional[int] = None

class StaticRoute(BaseModel):
    prefix: str
    description: Optional[str] = None
    next_hops: List[StaticNextHop] = []
    blackhole: bool = False
    blackhole_distance: Optional[int] = None
    disabled: bool = False

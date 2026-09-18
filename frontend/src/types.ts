export interface Interface {
  name: string;
  description: string | null;
  address: string | null;
  mtu: number;
  enabled: boolean;
  mac: string | null;
  state: string | null;
  link: string | null;
}

export interface FirewallRule {
  number: number;
  action: 'accept' | 'drop' | 'reject';
  protocol: string | null;
  source_address: string | null;
  destination_address: string | null;
  source_group: string | null;
  destination_group: string | null;
  source_geoip: string[] | null;
  source_geoip_inverse: boolean;
  destination_geoip: string[] | null;
  destination_geoip_inverse: boolean;
  source_port: string | null;
  destination_port: string | null;
  description: string | null;
  log: boolean | null;
  state_established: boolean | null;
  state_related: boolean | null;
  state_new: boolean | null;
}

export interface AddressGroup {
  name: string;
  description: string | null;
  addresses: string[];
}

export interface FirewallRuleset {
  name: string;
  default_action: 'accept' | 'drop' | 'reject';
  description: string | null;
  rules: FirewallRule[];
}

export interface LogEntry {
  timestamp: string;
  host: string | null;
  process: string | null;
  message: string;
  severity: string;
  raw: string;
}

export interface SystemConfig {
  host_name: string | null;
  domain_search: string | null;
  time_zone: string | null;
  name_servers: string[];
  ntp_servers: string[];
}

export interface SystemResources {
  cpu_model: string | null;
  cpu_cores: number | null;
  cpu_mhz: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  mem_total_mb: number | null;
  mem_used_mb: number | null;
  mem_free_mb: number | null;
  disk_fs: string | null;
  disk_size: string | null;
  disk_used: string | null;
  disk_used_pct: number | null;
  disk_available: string | null;
  uptime: string | null;
  device_time: string | null;
}

export interface FirewallLogEntry {
  timestamp: string;
  chain: string | null;
  rule_number: number | null;
  action: string | null;
  iface_in: string | null;
  iface_out: string | null;
  src: string | null;
  dst: string | null;
  proto: string | null;
  spt: string | null;
  dpt: string | null;
  raw: string;
}

export interface ServiceInfo {
  name: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  settings: Record<string, unknown> | null;
}

export interface NatRule {
  number: number;
  description: string | null;
  protocol: string | null;
  source_address: string | null;
  destination_address: string | null;
  destination_port: string | null;
  inbound_interface: string | null;
  translation_address: string | null;
  translation_port: string | null;
  log: boolean | null;
  disabled: boolean;
}

// HAProxy (load-balancing haproxy)
export interface HaproxyServer {
  name: string;
  address: string | null;
  port: number | null;
  check: boolean;
  check_port: number | null;
  backup: boolean;
  send_proxy: boolean;
  send_proxy_v2: boolean;
}

export interface HaproxyBackend {
  name: string;
  description: string | null;
  mode: 'http' | 'tcp' | null;
  balance: 'round-robin' | 'least-connection' | 'source-address' | null;
  logging_facility: string | null;
  ssl_no_verify: boolean;
  ssl_ca_certificate: string | null;
  servers: HaproxyServer[];
}

export interface HaproxyServiceRule {
  number: number;
  domain_name: string | null;
  wildcard_domain: boolean;
  url_path_match: 'begin' | 'end' | 'exact' | null;
  url_path: string | null;
  backend: string | null;
  redirect_location: string | null;
  geoip_mode: 'allow' | 'deny' | null;   // null = inherit service
  geoip_countries: string[];
}

export interface HaproxyService {
  name: string;
  description: string | null;
  mode: 'http' | 'tcp' | null;
  port: number | null;
  listen_addresses: string[];
  backends: string[];
  redirect_http_to_https: boolean;
  ssl_certificate: string | null;
  logging_facility: string | null;
  rules: HaproxyServiceRule[];
  geoip_mode: 'off' | 'allow' | 'deny' | null;
  geoip_countries: string[];
}

export interface GeoipStatus {
  available: boolean;
  updated_at: string | null;
  entries: number;
  countries: number;
  source: string | null;
  staged?: boolean;
}

export interface HaproxyGlobals {
  max_connections: number | null;
  timeout_client: number | null;
  timeout_connect: number | null;
  timeout_server: number | null;
}

export interface HaproxyConfig extends HaproxyGlobals {
  services: HaproxyService[];
  backends: HaproxyBackend[];
}

// PKI (certificates)
export interface PkiCertificate {
  name: string;
  description: string | null;
  has_private_key: boolean;
  revoked: boolean;
  acme: boolean;
  acme_domains: string[];
  acme_email: string | null;
  acme_rsa_key_size: number | null;
  acme_url: string | null;
  acme_listen_address: string | null;
  subject: string | null;
  issuer: string | null;
  not_before: string | null;
  not_after: string | null;
  expires_in_days: number | null;
  serial: string | null;
  sans: string[];
}

export interface PkiCaCertificate {
  name: string;
  description: string | null;
  has_private_key: boolean;
  revoked: boolean;
  subject: string | null;
  issuer: string | null;
  not_before: string | null;
  not_after: string | null;
  expires_in_days: number | null;
}

export interface PkiConfig {
  certificates: PkiCertificate[];
  ca_certificates: PkiCaCertificate[];
}

export interface PkiAcmeCreate {
  name: string;
  domains: string[];
  email: string;
  listen_address: string | null;
  rsa_key_size: 2048 | 3072 | 4096;
  url: string | null;
  description: string | null;
}

export interface RouteNexthop {
  ip: string | null;
  interface: string | null;
  active: boolean;
  directly_connected: boolean;
}

export interface RouteEntry {
  prefix: string;
  protocol: string;
  distance: number | null;
  metric: number | null;
  selected: boolean;
  installed: boolean;
  uptime: string | null;
  nexthops: RouteNexthop[];
}

export interface StaticNextHop {
  address: string;
  distance: number | null;
}

export interface StaticRoute {
  prefix: string;
  description: string | null;
  next_hops: StaticNextHop[];
  blackhole: boolean;
  blackhole_distance: number | null;
  disabled: boolean;
}


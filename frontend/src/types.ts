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
  source_port: string | null;
  destination_port: string | null;
  description: string | null;
  log: boolean | null;
  state_established: boolean | null;
  state_related: boolean | null;
  state_new: boolean | null;
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
}

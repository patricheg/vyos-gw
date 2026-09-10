"""VyOS HTTP API client.

Replaces the legacy SSH/netmiko transport with the native VyOS REST API
(`service https api rest`). The public method signatures are unchanged,
so routers and the staging service work as before.
"""
import json
import re
import shlex
from typing import List, Optional, Dict, Any

import requests
import urllib3

from app.config import settings
from app.models import Interface, FirewallRule, FirewallRuleset

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class VyOSError(RuntimeError):
    """Raised when the VyOS API reports a failure."""


class VyOSClient:
    def __init__(self):
        self.base_url = settings.vyos_api_url.rstrip("/")
        self.key = settings.vyos_api_key
        self.verify = settings.vyos_api_verify_tls
        self.timeout = settings.vyos_api_timeout
        self._session = requests.Session()

    # ─── Transport ────────────────────────────────────────────────

    def _post(self, endpoint: str, payload: Any) -> Any:
        """POST to a VyOS API endpoint; return `data` or raise VyOSError."""
        try:
            resp = self._session.post(
                f"{self.base_url}{endpoint}",
                data={"data": json.dumps(payload), "key": self.key},
                verify=self.verify,
                timeout=self.timeout,
            )
        except requests.RequestException as e:
            raise VyOSError(f"API request to {endpoint} failed: {e}") from e

        try:
            body = resp.json()
        except ValueError:
            raise VyOSError(
                f"API {endpoint} returned HTTP {resp.status_code}: {resp.text[:300]}"
            )

        if not body.get("success"):
            raise VyOSError(f"API {endpoint} error: {body.get('error')}")
        return body.get("data")

    @staticmethod
    def _cli_to_op(command: str) -> Dict[str, Any]:
        """Convert a 'set/delete ...' CLI string into an API operation."""
        tokens = shlex.split(command)
        if not tokens or tokens[0] not in ("set", "delete"):
            raise VyOSError(f"Unsupported command for API conversion: {command!r}")
        return {"op": tokens[0], "path": tokens[1:]}

    def exec_config(self, commands: List[str]) -> str:
        """Apply a list of set/delete commands as a single commit transaction."""
        if not commands:
            return "No changes"
        ops = [self._cli_to_op(c) for c in commands]
        payload: Any = ops[0] if len(ops) == 1 else ops
        self._post("/configure", payload)
        return f"Committed {len(ops)} operation(s) via API"

    def save_config(self) -> str:
        """Persist the running configuration to /config/config.boot."""
        return self._post("/config-file", {"op": "save"}) or "saved"

    # ─── Interfaces ───────────────────────────────────────────────

    def get_interfaces(self) -> List[Interface]:
        output = self._post("/show", {"op": "show", "path": ["interfaces"]})
        return self._parse_interfaces(output or "")

    def _parse_interfaces(self, output: str) -> List[Interface]:
        interfaces = []
        lines = output.splitlines()
        header_found = False
        for line in lines:
            if not header_found:
                if "Interface" in line and "IP Address" in line:
                    header_found = True
                continue
            if not line.strip() or line.startswith("---"):
                continue
            parts = line.split()
            if len(parts) < 6:
                continue
            name = parts[0]
            ip = parts[1] if "/" in parts[1] else None
            mac = parts[2] if ":" in parts[2] else None
            mtu = int(parts[4]) if parts[4].isdigit() else 1500
            state_link = parts[5].split("/")
            state = state_link[0] if len(state_link) > 0 else None
            link = state_link[1] if len(state_link) > 1 else None
            desc = " ".join(parts[6:]) if len(parts) > 6 else None

            existing = next((i for i in interfaces if i.name == name), None)
            if existing:
                continue

            interfaces.append(Interface(
                name=name,
                description=desc,
                address=ip,
                mac=mac,
                mtu=mtu,
                state=state,
                link=link,
            ))
        return interfaces

    _IFACE_TYPES = {
        "eth": "ethernet", "dum": "dummy", "vxlan": "vxlan", "lo": "loopback",
        "wg": "wireguard", "tun": "openvpn", "bond": "bonding", "br": "bridge",
        "vti": "vti", "pppoe": "pppoe", "sstpc": "sstpc",
    }

    def get_interface_detail(self, name: str) -> Optional[Dict[str, Any]]:
        # Op-mode path needs the interface type: `show interfaces ethernet eth0`
        paths = [["interfaces", name]]
        for prefix, itype in self._IFACE_TYPES.items():
            if name.startswith(prefix):
                paths.insert(0, ["interfaces", itype, name])
                break
        output = None
        for path in paths:
            try:
                output = self._post("/show", {"op": "show", "path": path})
                break
            except VyOSError:
                continue
        if not output or "does not exist" in output.lower():
            return None
        return {"name": name, "raw": output}

    def update_interface(self, name: str, description: Optional[str] = None,
                         address: Optional[str] = None, mtu: Optional[int] = None,
                         enabled: bool = True) -> str:
        commands = []
        if not enabled:
            commands.append(f"set interfaces ethernet {name} disable")
        else:
            commands.append(f"delete interfaces ethernet {name} disable")
        if description:
            commands.append(f"set interfaces ethernet {name} description '{description}'")
        else:
            commands.append(f"delete interfaces ethernet {name} description")
        if address is not None:
            commands.append(f"set interfaces ethernet {name} address {address}")
        if mtu is not None:
            commands.append(f"set interfaces ethernet {name} mtu '{mtu}'")
        return self.exec_config(commands)

    def delete_interface_address(self, name: str, address: str) -> str:
        return self.exec_config([f"delete interfaces ethernet {name} address {address}"])

    # ─── Firewall (base chains, no zones) ─────────────────────────

    # Base chains work directly, without zones or custom-chain bindings:
    # input = traffic to the router, forward = transit, output = from router
    CHAINS = {
        "input": ["firewall", "ipv4", "input", "filter"],
        "forward": ["firewall", "ipv4", "forward", "filter"],
        "output": ["firewall", "ipv4", "output", "filter"],
    }

    def get_firewall_chains(self) -> List[FirewallRuleset]:
        chains = []
        for name, path in self.CHAINS.items():
            try:
                data = self._post("/retrieve", {"op": "showConfig", "path": path})
            except VyOSError as e:
                # showConfig errors when nothing is configured under the path
                if "empty" in str(e).lower():
                    data = None
                else:
                    raise
            cfg = data if isinstance(data, dict) else {}
            # showConfig may keep the queried node as a top-level wrapper
            if set(cfg.keys()) == {"filter"} and isinstance(cfg["filter"], dict):
                cfg = cfg["filter"]
            # Base chains default to accept when default-action is unset
            chains.append(self._parse_ruleset(name, cfg, default_action="accept"))
        return chains

    @staticmethod
    def _parse_ruleset(name: str, cfg: Dict[str, Any], default_action: str = "drop") -> FirewallRuleset:
        ruleset = FirewallRuleset(
            name=name,
            default_action=cfg.get("default-action", default_action),
            description=cfg.get("description"),
            rules=[],
        )
        for num_str, rcfg in (cfg.get("rule") or {}).items():
            if not isinstance(rcfg, dict):
                continue
            state = rcfg.get("state") or {}
            source = rcfg.get("source") or {}
            dest = rcfg.get("destination") or {}
            ruleset.rules.append(FirewallRule(
                number=int(num_str),
                action=rcfg.get("action", "drop"),
                description=rcfg.get("description"),
                protocol=rcfg.get("protocol"),
                source_address=source.get("address"),
                destination_address=dest.get("address"),
                source_port=source.get("port"),
                destination_port=dest.get("port"),
                log="log" in rcfg,
                # Newer rolling: `state established` is a valueless node
                state_established="established" in state,
                state_related="related" in state,
                state_new="new" in state,
            ))
        ruleset.rules.sort(key=lambda r: r.number)
        return ruleset

    @staticmethod
    def _norm_opt(value, sentinel: str):
        """'any'/'all'/empty mean "not set" in the VyOS 1.5 firewall syntax."""
        if value is None:
            return None
        v = str(value).strip()
        if not v or v.lower() == sentinel:
            return None
        return v

    # ─── NAT ──────────────────────────────────────────────────────

    def get_nat_rules(self) -> List["NatRule"]:
        """Read `nat destination` (port forwarding) as structured JSON."""
        from app.models import NatRule
        try:
            data = self._post("/retrieve", {"op": "showConfig", "path": ["nat", "destination"]})
        except VyOSError as e:
            if "empty" in str(e).lower():
                return []
            raise
        cfg = data if isinstance(data, dict) else {}
        if set(cfg.keys()) == {"destination"} and isinstance(cfg["destination"], dict):
            cfg = cfg["destination"]

        rules: List[NatRule] = []
        for num_str, rcfg in (cfg.get("rule") or {}).items():
            if not isinstance(rcfg, dict):
                continue
            source = rcfg.get("source") or {}
            dest = rcfg.get("destination") or {}
            translation = rcfg.get("translation") or {}
            iface = rcfg.get("inbound-interface")
            if isinstance(iface, dict):
                iface = iface.get("name")
            rules.append(NatRule(
                number=int(num_str),
                description=rcfg.get("description"),
                protocol=rcfg.get("protocol"),
                source_address=source.get("address"),
                destination_address=dest.get("address"),
                destination_port=dest.get("port"),
                inbound_interface=iface if isinstance(iface, str) else None,
                translation_address=translation.get("address"),
                translation_port=translation.get("port"),
                log="log" in rcfg,
            ))
        rules.sort(key=lambda r: r.number)
        return rules

    # ─── System ───────────────────────────────────────────────────

    def get_system_config(self) -> "SystemConfig":
        from app.models import SystemConfig
        try:
            data = self._post("/retrieve", {"op": "showConfig", "path": ["system"]})
        except VyOSError as e:
            if "empty" in str(e).lower():
                return SystemConfig()
            raise
        cfg = data if isinstance(data, dict) else {}
        if set(cfg.keys()) == {"system"} and isinstance(cfg["system"], dict):
            cfg = cfg["system"]

        name_servers = cfg.get("name-server") or []
        if isinstance(name_servers, str):
            name_servers = [name_servers]

        ntp = (cfg.get("ntp") or {}).get("server") or {}
        if isinstance(ntp, str):
            ntp_servers = [ntp]
        else:
            ntp_servers = list(ntp.keys())

        domain_search = cfg.get("domain-search")
        if isinstance(domain_search, list):
            domain_search = domain_search[0] if domain_search else None

        return SystemConfig(
            host_name=cfg.get("host-name"),
            domain_search=domain_search,
            time_zone=cfg.get("time-zone"),
            name_servers=sorted(name_servers),
            ntp_servers=sorted(ntp_servers),
        )

    # ─── System resources ─────────────────────────────────────────

    @staticmethod
    def _kv_lines(output: str) -> Dict[str, str]:
        """Parse 'Key: value' op-mode output into a dict."""
        result = {}
        for line in (output or "").splitlines():
            if ":" in line:
                k, _, v = line.partition(":")
                result[k.strip()] = v.strip()
        return result

    @staticmethod
    def _to_mb(value: str) -> Optional[float]:
        """'1.93 GB' / '644.02 MB' / '512 KB' -> MB."""
        m = re.match(r"([\d.]+)\s*(KB|MB|GB|TB)", value or "", re.I)
        if not m:
            return None
        n = float(m.group(1))
        unit = m.group(2).upper()
        return n * {"KB": 1 / 1024, "MB": 1, "GB": 1024, "TB": 1024 * 1024}[unit]

    def get_system_resources(self) -> "SystemResources":
        from app.models import SystemResources
        res = SystemResources()

        try:
            cpu = self._kv_lines(self._post("/show", {"op": "show", "path": ["system", "cpu"]}) or "")
            res.cpu_model = cpu.get("Model")
            res.cpu_cores = int(cpu["Cores"]) if cpu.get("Cores", "").isdigit() else None
            try:
                res.cpu_mhz = float(cpu.get("Current MHz", ""))
            except ValueError:
                pass
        except VyOSError:
            pass

        try:
            mem = self._kv_lines(self._post("/show", {"op": "show", "path": ["system", "memory"]}) or "")
            res.mem_total_mb = self._to_mb(mem.get("Total", ""))
            res.mem_used_mb = self._to_mb(mem.get("Used", ""))
            res.mem_free_mb = self._to_mb(mem.get("Free", ""))
        except VyOSError:
            pass

        try:
            storage = self._kv_lines(self._post("/show", {"op": "show", "path": ["system", "storage"]}) or "")
            res.disk_fs = storage.get("Filesystem")
            res.disk_size = storage.get("Size")
            used = storage.get("Used", "")
            m = re.match(r"(\S+)\s*\((\d+)%\)", used)
            res.disk_used = m.group(1) if m else used or None
            res.disk_used_pct = int(m.group(2)) if m else None
            avail = storage.get("Available", "")
            m = re.match(r"(\S+)", avail)
            res.disk_available = m.group(1) if m else avail or None
        except VyOSError:
            pass

        try:
            up = self._kv_lines(self._post("/show", {"op": "show", "path": ["system", "uptime"]}) or "")
            res.uptime = up.get("Uptime")
            for key, attr in (("1  minute", "load1"), ("5  minutes", "load5"), ("15 minutes", "load15")):
                v = up.get(key, "").rstrip("%")
                try:
                    setattr(res, attr, float(v))
                except ValueError:
                    pass
        except VyOSError:
            pass

        return res

    # ─── Services ─────────────────────────────────────────────────

    _SERVICES = {
        "ssh": "SSH",
        "https": "HTTPS / REST API",
        "dns": "DNS forwarding",
        "dhcp-server": "DHCP server",
        "dhcp-relay": "DHCP relay",
        "snmp": "SNMP",
        "lldp": "LLDP",
        "mdns": "mDNS",
        "conntrack-sync": "Conntrack sync",
        "webproxy": "Web proxy",
        "ipsec": "IPsec VPN",
        "openvpn": "OpenVPN",
        "sstp-server": "SSTP server",
        "pppoe-server": "PPPoE server",
        "broadcast-relay": "Broadcast relay",
    }
    _SENSITIVE_RE = re.compile(r"password|secret|key", re.I)

    @classmethod
    def _mask_secrets(cls, node):
        if isinstance(node, dict):
            return {k: (cls._mask_secrets(v) if isinstance(v, (dict, list)) else ("•••" if cls._SENSITIVE_RE.search(k) else v))
                    for k, v in node.items()}
        if isinstance(node, list):
            return [cls._mask_secrets(v) for v in node]
        return node

    def get_services(self) -> List["ServiceInfo"]:
        from app.models import ServiceInfo
        try:
            data = self._post("/retrieve", {"op": "showConfig", "path": ["service"]})
        except VyOSError as e:
            if "empty" in str(e).lower():
                data = None
            else:
                raise
        cfg = data if isinstance(data, dict) else {}
        if set(cfg.keys()) == {"service"} and isinstance(cfg["service"], dict):
            cfg = cfg["service"]

        services = []
        for name, label in self._SERVICES.items():
            node = cfg.get(name)
            configured = node is not None
            enabled = configured and isinstance(node, dict) and "disable" not in node
            services.append(ServiceInfo(
                name=name,
                label=label,
                configured=configured,
                enabled=enabled,
                settings=self._mask_secrets(node) if configured else None,
            ))
        return services

    # ─── Logs ─────────────────────────────────────────────────────

    # VyOS op-mode: `show log <category>`; "all" = last N lines of syslog
    LOG_CATEGORIES = (
        "kernel", "firewall", "nat", "authorization", "https", "openvpn",
        "vpn", "wireguard", "lldp", "snmp", "vrrp", "conntrack-sync",
        "zebra", "cluster",
    )

    _SYSLOG_RE = re.compile(
        r"^(?P<ts>[A-Z][a-z]{2}\s+\d{1,2}\s\d{2}:\d{2}:\d{2})\s+"
        r"(?:(?P<host>\S+)\s+)?(?P<proc>\S+):\s*(?P<msg>.*)$"
    )
    _SEVERITY_RULES = (
        ("error", re.compile(r"error|fail|crit|deny|denied|refused", re.I)),
        ("warning", re.compile(r"warn", re.I)),
    )

    # Firewall log line: "[CHAIN-10-A]IN=eth0 OUT= SRC=.. DST=.. PROTO=TCP SPT=.. DPT=.."
    _FW_PREFIX_RE = re.compile(r"\[(?P<prefix>[^\]]+)\]")
    _FW_KV_RE = re.compile(r"(\w+)=([^\s\]]+)")
    _FW_ACTION_MAP = {"A": "accept", "D": "drop", "R": "reject"}

    def get_firewall_logs(self) -> List["FirewallLogEntry"]:
        from app.models import FirewallLogEntry
        out: List[FirewallLogEntry] = []
        for e in self.get_logs("firewall"):
            entry = FirewallLogEntry(timestamp=e.timestamp, raw=e.raw)
            m = self._FW_PREFIX_RE.search(e.message)
            if m:
                parts = m.group("prefix").split("-")
                if parts and parts[-1] in self._FW_ACTION_MAP:
                    entry.action = self._FW_ACTION_MAP[parts.pop()]
                if parts and parts[-1].isdigit():
                    entry.rule_number = int(parts.pop())
                entry.chain = "-".join(parts) or None
                kv = dict(self._FW_KV_RE.findall(e.message[m.end():]))
                entry.iface_in = kv.get("IN") or None
                entry.iface_out = kv.get("OUT") or None
                entry.src = kv.get("SRC")
                entry.dst = kv.get("DST")
                entry.proto = kv.get("PROTO")
                entry.spt = kv.get("SPT")
                entry.dpt = kv.get("DPT")
            out.append(entry)
        return out

    def get_logs(self, source: str = "all", lines: int = 200) -> List["LogEntry"]:
        from app.models import LogEntry
        if source == "all":
            # `show log <N>` returns the last N syslog lines, sliced by VyOS itself
            path: List[Any] = ["log", str(lines)]
        elif source in self.LOG_CATEGORIES:
            path = ["log", source]
        else:
            raise VyOSError(f"Unknown log source: {source!r}")
        try:
            output = self._post("/show", {"op": "show", "path": path})
        except VyOSError as e:
            if "empty" in str(e).lower():
                return []
            raise
        entries: List[LogEntry] = []
        for line in (output or "").splitlines():
            if not line.strip() or "no entries" in line.lower():
                continue
            m = self._SYSLOG_RE.match(line)
            msg = m.group("msg") if m else line
            severity = "info"
            for name, rx in self._SEVERITY_RULES:
                if rx.search(msg):
                    severity = name
                    break
            host = m.group("host").rstrip(":") if m and m.group("host") else None
            entries.append(LogEntry(
                timestamp=m.group("ts") if m else "",
                host=host,
                process=m.group("proc") if m else None,
                message=msg,
                severity=severity,
                raw=line,
            ))
        return entries


vyos_client = VyOSClient()

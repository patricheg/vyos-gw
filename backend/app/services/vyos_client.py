"""VyOS HTTP API client.

Replaces the legacy SSH/netmiko transport with the native VyOS REST API
(`service https api rest`). The public method signatures are unchanged,
so routers and the staging service work as before.
"""
import json
import os
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
    def __init__(self, base_url: Optional[str] = None, key: Optional[str] = None,
                 verify: Optional[bool] = None, timeout: Optional[int] = None):
        self.base_url = (base_url or settings.vyos_api_url).rstrip("/")
        self.key = key if key is not None else settings.vyos_api_key
        self.verify = settings.vyos_api_verify_tls if verify is None else verify
        self.timeout = timeout if timeout is not None else settings.vyos_api_timeout
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

    def get_config_commands(self) -> str:
        """Return the running configuration as 'set ...' commands (for backup)."""
        return self._post("/show", {"op": "show", "path": ["configuration", "commands"]}) or ""

    def restore_config_commands(self, commands: List[str], chunk_size: int = 100) -> str:
        """Apply set/delete commands in chunks (config restore)."""
        applied = 0
        for i in range(0, len(commands), chunk_size):
            chunk = commands[i:i + chunk_size]
            try:
                self.exec_config(chunk)
            except VyOSError as e:
                raise VyOSError(
                    f"Restore failed at command #{i + 1} "
                    f"({chunk[0][:120]!r}...): {e}"
                ) from e
            applied += len(chunk)
        return f"Applied {applied} command(s)"

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
            src_group = source.get("group") or {}
            dst_group = dest.get("group") or {}
            src_geoip = source.get("geoip") or {}
            dst_geoip = dest.get("geoip") or {}
            ruleset.rules.append(FirewallRule(
                number=int(num_str),
                action=rcfg.get("action", "drop"),
                description=rcfg.get("description"),
                protocol=rcfg.get("protocol"),
                source_address=source.get("address"),
                destination_address=dest.get("address"),
                source_group=VyOSClient._scalar(src_group.get("address-group")),
                destination_group=VyOSClient._scalar(dst_group.get("address-group")),
                source_geoip=sorted(VyOSClient._as_list(src_geoip.get("country-code"))) or None,
                source_geoip_inverse="inverse-match" in src_geoip,
                destination_geoip=sorted(VyOSClient._as_list(dst_geoip.get("country-code"))) or None,
                destination_geoip_inverse="inverse-match" in dst_geoip,
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

    def get_address_groups(self) -> List["AddressGroup"]:
        """Read `firewall group address-group` as structured JSON."""
        from app.models import AddressGroup
        try:
            data = self._post("/retrieve", {"op": "showConfig", "path": ["firewall", "group"]})
        except VyOSError as e:
            if "empty" in str(e).lower():
                return []
            raise
        cfg = data if isinstance(data, dict) else {}
        if set(cfg.keys()) == {"group"} and isinstance(cfg["group"], dict):
            cfg = cfg["group"]

        groups: List[AddressGroup] = []
        for name, gcfg in (cfg.get("address-group") or {}).items():
            gcfg = gcfg if isinstance(gcfg, dict) else {}
            groups.append(AddressGroup(
                name=name,
                description=VyOSClient._scalar(gcfg.get("description")),
                addresses=sorted(self._as_list(gcfg.get("address"))),
            ))
        groups.sort(key=lambda g: g.name)
        return groups

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
                disabled="disable" in rcfg,
            ))
        rules.sort(key=lambda r: r.number)
        return rules

    # ─── Routing ──────────────────────────────────────────────────

    def get_routing_table(self) -> List["RouteEntry"]:
        """Live IPv4 routing table via `show ip route json` (FRR output)."""
        import ipaddress
        from app.models import RouteEntry, RouteNexthop
        raw = self._post("/show", {"op": "show", "path": ["ip", "route", "json"]})
        if not raw:
            return []
        try:
            table = json.loads(raw)
        except (TypeError, ValueError):
            raise VyOSError("Could not parse 'show ip route json' output")
        routes: List[RouteEntry] = []
        for prefix, entries in (table or {}).items():
            if not isinstance(entries, list):
                continue
            for e in entries:
                nexthops = [
                    RouteNexthop(
                        ip=nh.get("ip"),
                        interface=nh.get("interfaceName"),
                        active=bool(nh.get("active")),
                        directly_connected=bool(nh.get("directlyConnected")),
                    )
                    for nh in e.get("nexthops", [])
                ]
                routes.append(RouteEntry(
                    prefix=e.get("prefix", prefix),
                    protocol=e.get("protocol", "unknown"),
                    distance=self._to_int(e.get("distance")),
                    metric=self._to_int(e.get("metric")),
                    selected=bool(e.get("selected")),
                    installed=bool(e.get("installed")),
                    uptime=e.get("uptime"),
                    nexthops=nexthops,
                ))

        def _sort_key(r: "RouteEntry"):
            try:
                net = ipaddress.ip_network(r.prefix)
                return (0, int(net.network_address), net.prefixlen)
            except ValueError:
                return (1, 0, 0)
        routes.sort(key=_sort_key)
        return routes

    def get_static_routes(self) -> List["StaticRoute"]:
        """Configured `protocols static route` entries (main table, IPv4)."""
        import ipaddress
        from app.models import StaticRoute, StaticNextHop
        try:
            data = self._post("/retrieve", {"op": "showConfig", "path": ["protocols", "static"]})
        except VyOSError as e:
            if "empty" in str(e).lower():
                return []
            raise
        cfg = data if isinstance(data, dict) else {}
        if set(cfg.keys()) == {"static"} and isinstance(cfg["static"], dict):
            cfg = cfg["static"]

        routes: List[StaticRoute] = []
        for prefix, rcfg in (cfg.get("route") or {}).items():
            if not isinstance(rcfg, dict):
                continue
            next_hops = [
                StaticNextHop(
                    address=addr,
                    distance=self._to_int(nhcfg.get("distance")) if isinstance(nhcfg, dict) else None,
                )
                for addr, nhcfg in (rcfg.get("next-hop") or {}).items()
            ]
            blackhole = rcfg.get("blackhole")
            routes.append(StaticRoute(
                prefix=prefix,
                description=self._scalar(rcfg.get("description")),
                next_hops=sorted(next_hops, key=lambda n: n.address),
                blackhole=blackhole is not None,
                blackhole_distance=self._to_int(blackhole.get("distance")) if isinstance(blackhole, dict) else None,
                disabled="disable" in rcfg,
            ))

        def _sort_key(r: "StaticRoute"):
            try:
                net = ipaddress.ip_network(r.prefix)
                return (0, int(net.network_address), net.prefixlen)
            except ValueError:
                return (1, 0, 0)
        routes.sort(key=_sort_key)
        return routes

    # ─── HAProxy (load-balancing haproxy) ─────────────────────────

    @staticmethod
    def _as_list(value):
        if value is None:
            return []
        # multi-value leaf nodes come back as {value: {}, ...}
        if isinstance(value, dict):
            return list(value.keys())
        return value if isinstance(value, list) else [value]

    @staticmethod
    def _to_int(value) -> Optional[int]:
        try:
            return int(str(value))
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _scalar(value):
        """showConfig may wrap a leaf value as {value: {}} — unwrap it."""
        if isinstance(value, dict):
            return next(iter(value), None)
        return value

    @staticmethod
    def _logging_facility(node) -> Optional[str]:
        if not isinstance(node, dict):
            return None
        logging = node.get("logging")
        if not isinstance(logging, dict):
            return None
        fac = VyOSClient._scalar(logging.get("facility"))
        return str(fac) if fac else None

    def get_haproxy(self) -> "HaproxyConfig":
        """Read `load-balancing haproxy` as structured JSON."""
        from app.models import HaproxyConfig, HaproxyService, HaproxyBackend, HaproxyServer, HaproxyServiceRule
        try:
            data = self._post("/retrieve", {"op": "showConfig", "path": ["load-balancing", "haproxy"]})
        except VyOSError as e:
            if "empty" in str(e).lower():
                return HaproxyConfig()
            raise
        cfg = data if isinstance(data, dict) else {}
        if set(cfg.keys()) == {"haproxy"} and isinstance(cfg["haproxy"], dict):
            cfg = cfg["haproxy"]

        backends = []
        for name, bcfg in (cfg.get("backend") or {}).items():
            if not isinstance(bcfg, dict):
                continue
            servers = []
            for sname, scfg in (bcfg.get("server") or {}).items():
                if not isinstance(scfg, dict):
                    continue
                check = scfg.get("check")
                servers.append(HaproxyServer(
                    name=sname,
                    address=scfg.get("address"),
                    port=self._to_int(scfg.get("port")),
                    check=check is not None,
                    check_port=self._to_int(check.get("port")) if isinstance(check, dict) else None,
                    backup="backup" in scfg,
                    send_proxy="send-proxy" in scfg,
                    send_proxy_v2="send-proxy-v2" in scfg,
                ))
            ssl = bcfg.get("ssl") or {}
            backends.append(HaproxyBackend(
                name=name,
                description=self._scalar(bcfg.get("description")),
                mode=self._scalar(bcfg.get("mode")),
                balance=self._scalar(bcfg.get("balance")),
                logging_facility=self._logging_facility(bcfg),
                ssl_no_verify=isinstance(ssl, dict) and "no-verify" in ssl,
                ssl_ca_certificate=self._scalar(ssl.get("ca-certificate")) if isinstance(ssl, dict) else None,
                servers=servers,
            ))

        services = []
        for name, scfg in (cfg.get("service") or {}).items():
            if not isinstance(scfg, dict):
                continue
            ssl = scfg.get("ssl") or {}
            rules = []
            for rnum, rcfg in (scfg.get("rule") or {}).items():
                if not isinstance(rcfg, dict):
                    continue
                url_path_node = rcfg.get("url-path") or {}
                url_match, url_value = None, None
                if isinstance(url_path_node, dict):
                    for mtype in ("begin", "end", "exact"):
                        if mtype in url_path_node:
                            url_match = mtype
                            v = self._scalar(url_path_node[mtype])
                            url_value = str(v) if v else None
                            break
                set_node = rcfg.get("set") or {}
                backend = self._scalar(set_node.get("backend")) if isinstance(set_node, dict) else None
                redirect = self._scalar(set_node.get("redirect-location")) if isinstance(set_node, dict) else None
                rules.append(HaproxyServiceRule(
                    number=int(rnum),
                    domain_name=self._scalar(rcfg.get("domain-name")),
                    wildcard_domain="wildcard-domain" in rcfg,
                    url_path_match=url_match,
                    url_path=url_value,
                    backend=str(backend) if backend else None,
                    redirect_location=str(redirect) if redirect else None,
                ))
            rules.sort(key=lambda r: r.number)
            services.append(HaproxyService(
                name=name,
                description=self._scalar(scfg.get("description")),
                mode=self._scalar(scfg.get("mode")),
                port=self._to_int(scfg.get("port")),
                listen_addresses=sorted(str(a) for a in self._as_list(scfg.get("listen-address"))),
                backends=sorted(str(b) for b in self._as_list(scfg.get("backend"))),
                redirect_http_to_https="redirect-http-to-https" in scfg,
                ssl_certificate=self._scalar(ssl.get("certificate")) if isinstance(ssl, dict) else None,
                logging_facility=self._logging_facility(scfg),
                rules=rules,
            ))

        timeouts = cfg.get("timeout") or {}
        gp = cfg.get("global-parameters") or {}
        return HaproxyConfig(
            services=services,
            backends=backends,
            max_connections=self._to_int(gp.get("max-connections")) if isinstance(gp, dict) else None,
            timeout_client=self._to_int(timeouts.get("client")) if isinstance(timeouts, dict) else None,
            timeout_connect=self._to_int(timeouts.get("connect")) if isinstance(timeouts, dict) else None,
            timeout_server=self._to_int(timeouts.get("server")) if isinstance(timeouts, dict) else None,
        )

    # ─── PKI (certificates) ───────────────────────────────────────

    @staticmethod
    def pem_to_store_body(pem_text: str) -> str:
        """VyOS stores certs/keys as the bare PEM body (base64, no headers)."""
        lines = [
            l.strip() for l in pem_text.replace("\r\n", "\n").splitlines()
            if l.strip() and not l.startswith("-----")
        ]
        return "".join(lines)

    @staticmethod
    def _decode_cert_pem(pem: str) -> Dict[str, Any]:
        """Extract subject/issuer/validity from a PEM cert (stdlib ssl parser)."""
        import ssl
        import tempfile
        from datetime import datetime, timezone
        try:
            with tempfile.NamedTemporaryFile("w", suffix=".pem", delete=False, newline="\n") as f:
                f.write(pem)
                path = f.name
            info = ssl._ssl._test_decode_cert(path)  # type: ignore[attr-defined]
        except Exception:
            return {}
        finally:
            try:
                os.unlink(path)
            except Exception:
                pass

        def _name(rdn) -> Optional[str]:
            # prefer commonName, fall back to full string
            full = []
            cn = None
            for group in rdn or []:
                for key, value in group:
                    full.append(f"{key}={value}")
                    if key == "commonName":
                        cn = value
            return cn or (", ".join(full) if full else None)

        result: Dict[str, Any] = {
            "subject": _name(info.get("subject")),
            "issuer": _name(info.get("issuer")),
            "not_before": info.get("notBefore"),
            "not_after": info.get("notAfter"),
            "serial": info.get("serialNumber"),
            "sans": [v for t, v in info.get("subjectAltName", []) if t == "DNS"],
        }
        na = info.get("notAfter")
        if na:
            try:
                exp = datetime.strptime(na, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
                result["expires_in_days"] = (exp - datetime.now(timezone.utc)).days
            except ValueError:
                pass
        return result

    def _show_pem(self, path: List[str]) -> Optional[str]:
        try:
            out = self._post("/show", {"op": "show", "path": path})
        except VyOSError:
            return None
        out = (out or "").strip()
        return out if "BEGIN" in out else None

    def get_pki(self) -> "PkiConfig":
        """Read `pki` config; enrich certs with details decoded from their PEM."""
        from app.models import PkiConfig, PkiCertificate, PkiCaCertificate
        try:
            data = self._post("/retrieve", {"op": "showConfig", "path": ["pki"]})
        except VyOSError as e:
            if "empty" in str(e).lower():
                return PkiConfig()
            raise
        cfg = data if isinstance(data, dict) else {}
        if set(cfg.keys()) == {"pki"} and isinstance(cfg["pki"], dict):
            cfg = cfg["pki"]

        certificates = []
        for name, ccfg in (cfg.get("certificate") or {}).items():
            if not isinstance(ccfg, dict):
                continue
            acme = ccfg.get("acme") or {}
            private = ccfg.get("private") or {}
            entry = PkiCertificate(
                name=name,
                description=ccfg.get("description"),
                has_private_key=isinstance(private, dict) and "key" in private,
                revoked="revoke" in ccfg,
                acme=bool(acme),
                acme_domains=sorted(self._as_list(acme.get("domain-name"))) if isinstance(acme, dict) else [],
                acme_email=acme.get("email") if isinstance(acme, dict) else None,
                acme_rsa_key_size=self._to_int(acme.get("rsa-key-size")) if isinstance(acme, dict) else None,
                acme_url=acme.get("url") if isinstance(acme, dict) else None,
                acme_listen_address=acme.get("listen-address") if isinstance(acme, dict) else None,
            )
            if "certificate" in ccfg:
                pem = self._show_pem(["pki", "certificate", name, "pem"])
                if pem:
                    details = self._decode_cert_pem(pem)
                    for k, v in details.items():
                        setattr(entry, k, v)
            certificates.append(entry)

        ca_certificates = []
        for name, ccfg in (cfg.get("ca") or {}).items():
            if not isinstance(ccfg, dict) or name.startswith("AUTOCHAIN_"):
                continue
            private = ccfg.get("private") or {}
            entry = PkiCaCertificate(
                name=name,
                description=ccfg.get("description"),
                has_private_key=isinstance(private, dict) and "key" in private,
                revoked="revoke" in ccfg,
            )
            if "certificate" in ccfg:
                pem = self._show_pem(["pki", "ca", name, "pem"])
                if pem:
                    details = self._decode_cert_pem(pem)
                    for k in ("subject", "issuer", "not_before", "not_after", "expires_in_days"):
                        if k in details:
                            setattr(entry, k, details[k])
            ca_certificates.append(entry)

        return PkiConfig(certificates=certificates, ca_certificates=ca_certificates)

    def renew_certbot(self) -> str:
        """op-mode: renew certbot force (immediate, not staged)."""
        return self._post("/renew", {"op": "renew", "path": ["certbot", "force"]}) or "renewal done"

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

        try:
            res.device_time = (self._post("/show", {"op": "show", "path": ["date"]}) or "").strip() or None
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
        "zebra", "cluster", "haproxy", "certbot",
    )

    _SYSLOG_RE = re.compile(
        r"^(?P<ts>[A-Z][a-z]{2}\s+\d{1,2}\s\d{2}:\d{2}:\d{2})\s+"
        r"(?:(?P<host>\S+)\s+)?(?P<proc>\S+):\s*(?P<msg>.*)$"
    )
    # certbot debug log: "2026-09-11 14:14:55,996:DEBUG:certbot._internal.main:msg"
    _CERTBOT_RE = re.compile(
        r"^(?P<ts>\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}),\d+:(?P<lvl>[A-Z]+):(?P<proc>\S+?):(?P<msg>.*)$"
    )
    _CERTBOT_LEVELS = {"CRITICAL": "error", "ERROR": "error", "WARNING": "warning"}
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
            if not line.strip() or "no entries" in line.lower() or "does not exist" in line.lower():
                continue
            m = self._SYSLOG_RE.match(line)
            msg = m.group("msg") if m else line
            severity = "info"
            for name, rx in self._SEVERITY_RULES:
                if rx.search(msg):
                    severity = name
                    break
            host = m.group("host").rstrip(":") if m and m.group("host") else None
            ts = m.group("ts") if m else ""
            proc = m.group("proc") if m else None
            if not m:
                cb = self._CERTBOT_RE.match(line)
                if cb:
                    ts = cb.group("ts")
                    proc = cb.group("proc")
                    msg = cb.group("msg").strip() or msg
                    severity = self._CERTBOT_LEVELS.get(cb.group("lvl"), "info")
            entries.append(LogEntry(
                timestamp=ts,
                host=host,
                process=proc,
                message=msg,
                severity=severity,
                raw=line,
            ))
        return entries


class _ClientProxy:
    """Forwards attribute access to the currently connected device's client.

    Keeps the historical `vyos_client.get_...()` call sites working while the
    actual client is owned by the connection manager (multi-device support).
    """
    def __getattr__(self, item):
        from app.services.connections import connection_manager
        client = connection_manager.client
        if client is None:
            raise VyOSError("Not connected to any VyOS device — log in first")
        return getattr(client, item)


vyos_client = _ClientProxy()

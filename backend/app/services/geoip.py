"""GeoIP country database for HAProxy ACLs.

Source: DB-IP Lite (free, no account needed, monthly updates).
The CSV (start_ip, end_ip, country_code pairs) is decomposed into CIDR
blocks and stored as an HAProxy map file (`CIDR CC` per line), which
HAProxy loads as a Patricia tree and queries via `src,map_ip(...)`.

The map is stored locally in backend/data/geoip/ and pushed to the device
(/config/auth/haproxy/geoip.map) on apply — it is mounted into the
container through the read-only "files" volume.
"""
import csv
import gzip
import io
import ipaddress
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
_GEOIP_DIR = os.path.join(_DATA_DIR, "geoip")
MAP_PATH = os.path.join(_GEOIP_DIR, "geoip.map")
_META_PATH = os.path.join(_GEOIP_DIR, "geoip.json")

_DOWNLOAD_TPL = "https://download.db-ip.com/free/dbip-country-lite-{stamp}.csv.gz"


def _download_url_candidates() -> List[str]:
    now = datetime.now(timezone.utc)
    stamps = []
    year, month = now.year, now.month
    for _ in range(3):  # current month, then previous ones
        stamps.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    return [_DOWNLOAD_TPL.format(stamp=s) for s in stamps]


def status() -> Dict[str, Any]:
    """Local DB status; `entries` counts map lines, `countries` distinct CCs."""
    if not os.path.exists(_META_PATH) or not os.path.exists(MAP_PATH):
        return {"available": False, "updated_at": None, "entries": 0, "countries": 0, "source": None}
    try:
        with open(_META_PATH) as f:
            meta = json.load(f)
    except (OSError, ValueError):
        meta = {}
    meta["available"] = True
    return meta


def read_map() -> Optional[str]:
    try:
        with open(MAP_PATH) as f:
            return f.read()
    except OSError:
        return None


def update(timeout: int = 120) -> Dict[str, Any]:
    """Download the latest DB-IP Lite country DB and rebuild the local map."""
    last_err: Optional[Exception] = None
    text: Optional[str] = None
    used_url = ""
    for url in _download_url_candidates():
        try:
            resp = requests.get(url, timeout=timeout)
            if resp.status_code == 404:
                continue
            resp.raise_for_status()
            text = gzip.decompress(resp.content).decode("utf-8", errors="replace")
            used_url = url
            break
        except requests.RequestException as e:
            last_err = e
        except OSError as e:  # gzip
            last_err = e
    if text is None:
        raise RuntimeError(f"GeoIP DB download failed: {last_err or 'no file for the last 3 months'}")

    lines: List[str] = []
    countries = set()
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        if len(row) < 3:
            continue
        start_s, end_s, cc = row[0].strip(), row[1].strip(), row[2].strip().upper()
        if not cc or len(cc) != 2:
            continue
        try:
            start = ipaddress.ip_address(start_s)
            end = ipaddress.ip_address(end_s)
        except ValueError:
            continue
        countries.add(cc)
        for net in ipaddress.summarize_address_range(start, end):
            lines.append(f"{net} {cc}")

    os.makedirs(_GEOIP_DIR, exist_ok=True)
    tmp = MAP_PATH + ".tmp"
    with open(tmp, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, MAP_PATH)

    meta = {
        "available": True,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "entries": len(lines),
        "countries": len(countries),
        "source": used_url,
    }
    with open(_META_PATH, "w") as f:
        json.dump(meta, f)
    return meta

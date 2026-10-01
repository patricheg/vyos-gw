"""Host metrics collector: samples /proc once per second into SQLite.

On-device the container shares the host network namespace
(allow-host-networks), so /proc/net/dev and the other /proc files describe
the router itself. On non-Linux dev machines the collector stays idle and
the API returns empty series.

Rates (bytes/sec, cpu %) are computed from consecutive counter samples and
stored directly, so queries never need deltas. Raw 1s samples are kept for
RAW_KEEP seconds, per-minute averages for MINUTE_KEEP seconds.
"""
import os
import re
import sqlite3
import threading
import time
from typing import Dict, List, Optional, Tuple

from app.config import settings

_DATA_DIR = settings.data_dir or os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
_DB_PATH = os.path.join(_DATA_DIR, "metrics.db")

SAMPLE_INTERVAL = 1.0
RAW_KEEP = 6 * 3600        # raw 1s samples
MINUTE_KEEP = 7 * 86400    # per-minute aggregates

_DISK_RE = re.compile(r"^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$")

_lock = threading.Lock()
_thread: Optional[threading.Thread] = None
_latest_sys: dict = {}
_latest_ifaces: Dict[str, dict] = {}


def _db() -> sqlite3.Connection:
    os.makedirs(_DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS iface_samples(
            ts INTEGER, iface TEXT, rx_bps REAL, tx_bps REAL);
        CREATE INDEX IF NOT EXISTS idx_iface_ts ON iface_samples(ts);
        CREATE TABLE IF NOT EXISTS sys_samples(
            ts INTEGER PRIMARY KEY, cpu_pct REAL, mem_used_mb REAL,
            mem_total_mb REAL, load1 REAL, disk_r_bps REAL, disk_w_bps REAL,
            disk_used_pct REAL, disk_total_mb REAL);
        CREATE TABLE IF NOT EXISTS iface_min(
            ts INTEGER, iface TEXT, rx_bps REAL, tx_bps REAL);
        CREATE INDEX IF NOT EXISTS idx_iface_min_ts ON iface_min(ts);
        CREATE TABLE IF NOT EXISTS sys_min(
            ts INTEGER PRIMARY KEY, cpu_pct REAL, mem_used_mb REAL,
            mem_total_mb REAL, load1 REAL, disk_r_bps REAL, disk_w_bps REAL,
            disk_used_pct REAL, disk_total_mb REAL);
    """)
    return conn


def _read_netdev() -> Dict[str, Tuple[int, int]]:
    out: Dict[str, Tuple[int, int]] = {}
    try:
        with open("/proc/net/dev") as f:
            for line in f.readlines()[2:]:
                name, _, rest = line.partition(":")
                name = name.strip()
                if not name or name == "lo":
                    continue
                fields = rest.split()
                if len(fields) >= 9:
                    out[name] = (int(fields[0]), int(fields[8]))
    except OSError:
        pass
    return out


def _read_cpu() -> Optional[Tuple[int, int]]:
    try:
        with open("/proc/stat") as f:
            fields = f.readline().split()
        if not fields or fields[0] != "cpu":
            return None
        vals = [int(v) for v in fields[1:9]]
        idle = vals[3] + (vals[4] if len(vals) > 4 else 0)  # idle + iowait
        return sum(vals), idle
    except (OSError, ValueError):
        return None


def _read_mem() -> Tuple[Optional[float], Optional[float]]:
    total = avail = None
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    total = float(line.split()[1]) / 1024.0
                elif line.startswith("MemAvailable:"):
                    avail = float(line.split()[1]) / 1024.0
    except (OSError, ValueError):
        pass
    used = (total - avail) if (total is not None and avail is not None) else None
    return used, total


def _read_diskstats() -> Tuple[int, int]:
    """Aggregate 512-byte sectors read/written for whole-disk devices."""
    r = w = 0
    try:
        with open("/proc/diskstats") as f:
            for line in f:
                fields = line.split()
                if len(fields) >= 10 and _DISK_RE.match(fields[2]):
                    r += int(fields[5])
                    w += int(fields[9])
    except (OSError, ValueError):
        pass
    return r * 512, w * 512


def _read_load1() -> Optional[float]:
    try:
        with open("/proc/loadavg") as f:
            return float(f.read().split()[0])
    except (OSError, ValueError):
        return None


def _disk_usage() -> Tuple[Optional[float], Optional[float]]:
    path = "/config/auth" if os.path.isdir("/config/auth") else "/"
    try:
        st = os.statvfs(path)
        total = st.f_blocks * st.f_frsize / (1024 * 1024)
        used = (st.f_blocks - st.f_bfree) * st.f_frsize / (1024 * 1024)
        pct = (used / total * 100.0) if total else None
        return pct, total
    except OSError:
        return None, None


def _collector_loop() -> None:
    conn = _db()
    prev_net: Dict[str, Tuple[int, int]] = {}
    prev_cpu: Optional[Tuple[int, int]] = None
    prev_disk: Optional[Tuple[int, int]] = None
    prev_ts = 0.0
    tick = 0
    while True:
        now = time.time()
        ts = int(now)
        dt = now - prev_ts if prev_ts else 0.0

        net = _read_netdev()
        cpu = _read_cpu()
        mem_used, mem_total = _read_mem()
        disk = _read_diskstats()
        load1 = _read_load1()
        disk_pct, disk_total = _disk_usage()

        global _latest_sys, _latest_ifaces
        if dt > 0.2:  # skip the very first sample — no deltas yet
            cpu_pct = None
            if cpu and prev_cpu:
                d_total = cpu[0] - prev_cpu[0]
                d_idle = cpu[1] - prev_cpu[1]
                if d_total > 0:
                    cpu_pct = max(0.0, min(100.0, 100.0 * (1.0 - d_idle / d_total)))
            disk_r = disk_w = None
            if prev_disk:
                disk_r = max(0.0, (disk[0] - prev_disk[0]) / dt)
                disk_w = max(0.0, (disk[1] - prev_disk[1]) / dt)

            sys_row = (ts, cpu_pct, mem_used, mem_total, load1,
                       disk_r, disk_w, disk_pct, disk_total)
            iface_rows = []
            for name, counters in net.items():
                prev = prev_net.get(name)
                rx = tx = None
                if prev:
                    rx = max(0.0, (counters[0] - prev[0]) / dt)
                    tx = max(0.0, (counters[1] - prev[1]) / dt)
                iface_rows.append((ts, name, rx, tx))

            with _lock:
                conn.executemany(
                    "INSERT INTO iface_samples VALUES (?,?,?,?)", iface_rows)
                conn.execute(
                    "INSERT OR REPLACE INTO sys_samples VALUES (?,?,?,?,?,?,?,?,?)",
                    sys_row)
                conn.commit()
                _latest_sys = {
                    "ts": ts, "cpu_pct": cpu_pct, "mem_used_mb": mem_used,
                    "mem_total_mb": mem_total, "load1": load1,
                    "disk_read_bps": disk_r, "disk_write_bps": disk_w,
                    "disk_used_pct": disk_pct, "disk_total_mb": disk_total,
                }
                _latest_ifaces = {
                    name: {"rx_bps": rx, "tx_bps": tx}
                    for _, name, rx, tx in iface_rows
                }

            tick += 1
            if tick % 60 == 0:
                _maintain(conn)

        prev_net, prev_cpu, prev_disk, prev_ts = net, cpu, disk, now
        time.sleep(SAMPLE_INTERVAL)


def _maintain(conn: sqlite3.Connection) -> None:
    """Roll raw samples older than RAW_KEEP into per-minute rows, prune."""
    now = int(time.time())
    cutoff = now - RAW_KEEP
    with _lock:
        conn.execute("""
            INSERT OR IGNORE INTO iface_min
            SELECT (ts/60)*60 AS m, iface, AVG(rx_bps), AVG(tx_bps)
            FROM iface_samples
            WHERE ts < ? AND (ts/60)*60 > COALESCE((SELECT MAX(ts) FROM iface_min), 0)
            GROUP BY m, iface
        """, (cutoff,))
        conn.execute("""
            INSERT OR IGNORE INTO sys_min
            SELECT (ts/60)*60 AS m, AVG(cpu_pct), AVG(mem_used_mb),
                   MAX(mem_total_mb), AVG(load1), AVG(disk_r_bps),
                   AVG(disk_w_bps), AVG(disk_used_pct), MAX(disk_total_mb)
            FROM sys_samples
            WHERE ts < ? AND (ts/60)*60 > COALESCE((SELECT MAX(ts) FROM sys_min), 0)
            GROUP BY m
        """, (cutoff,))
        conn.execute("DELETE FROM iface_samples WHERE ts < ?", (cutoff,))
        conn.execute("DELETE FROM sys_samples WHERE ts < ?", (cutoff,))
        min_cutoff = now - MINUTE_KEEP
        conn.execute("DELETE FROM iface_min WHERE ts < ?", (min_cutoff,))
        conn.execute("DELETE FROM sys_min WHERE ts < ?", (min_cutoff,))
        conn.commit()


def start() -> None:
    """Launch the collector thread (no-op on systems without /proc)."""
    global _thread
    if _thread is not None or not os.path.exists("/proc/net/dev"):
        return
    _thread = threading.Thread(target=_collector_loop, name="metrics", daemon=True)
    _thread.start()


def get_current() -> dict:
    with _lock:
        return {
            "system": dict(_latest_sys),
            "interfaces": {k: dict(v) for k, v in _latest_ifaces.items()},
        }


def _fetch_series(conn: sqlite3.Connection, table: str, since: int,
                  ifaces: bool) -> List[tuple]:
    cols = "ts, iface, rx_bps, tx_bps" if ifaces else (
        "ts, cpu_pct, mem_used_mb, mem_total_mb, load1, disk_r_bps,"
        " disk_w_bps, disk_used_pct, disk_total_mb")
    cur = conn.execute(
        f"SELECT {cols} FROM {table} WHERE ts >= ? ORDER BY ts", (since,))
    return cur.fetchall()


def _downsample(points: List[tuple], max_points: int) -> List[tuple]:
    """Average-value bucketing to at most max_points entries."""
    if len(points) <= max_points:
        return points
    bucket = (points[-1][0] - points[0][0] + 1) / max_points
    out: List[tuple] = []
    acc: List[list] = []
    cur_bucket = -1
    for row in points:
        b = int((row[0] - points[0][0]) / bucket)
        if b != cur_bucket:
            if acc:
                out.append(_avg_rows(acc))
            acc = []
            cur_bucket = b
        acc.append(row)
    if acc:
        out.append(_avg_rows(acc))
    return out


def _avg_rows(rows: List[tuple]) -> tuple:
    n = len(rows)
    out = [rows[-1][0]]
    for i in range(1, len(rows[0])):
        vals = [r[i] for r in rows if r[i] is not None]
        out.append(sum(vals) / len(vals) if vals else None)
    # keep the iface column (string) from the first row
    if isinstance(rows[0][1], str):
        out[1] = rows[0][1]
    return tuple(out)


def get_history(minutes: int, max_points: int = 600) -> dict:
    minutes = max(5, min(minutes, 7 * 24 * 60))
    since = int(time.time()) - minutes * 60
    use_raw = minutes <= RAW_KEEP // 60
    conn = _db()
    try:
        with _lock:
            sys_rows = _fetch_series(
                conn, "sys_samples" if use_raw else "sys_min", since, False)
            iface_rows = _fetch_series(
                conn, "iface_samples" if use_raw else "iface_min", since, True)
    finally:
        conn.close()

    sys_rows = _downsample(sys_rows, max_points)
    ts = [r[0] for r in sys_rows]
    sys_series = {
        "cpu_pct": [r[1] for r in sys_rows],
        "mem_used_mb": [r[2] for r in sys_rows],
        "mem_total_mb": [r[3] for r in sys_rows],
        "load1": [r[4] for r in sys_rows],
        "disk_read_bps": [r[5] for r in sys_rows],
        "disk_write_bps": [r[6] for r in sys_rows],
        "disk_used_pct": [r[7] for r in sys_rows],
    }

    by_iface: Dict[str, List[tuple]] = {}
    for row in iface_rows:
        by_iface.setdefault(row[1], []).append((row[0], row[2], row[3]))
    ifaces = {}
    for name, rows in by_iface.items():
        rows = _downsample(rows, max_points)
        ifaces[name] = {
            "ts": [r[0] for r in rows],
            "rx_bps": [r[1] for r in rows],
            "tx_bps": [r[2] for r in rows],
        }

    return {"ts": ts, "system": sys_series, "interfaces": ifaces}

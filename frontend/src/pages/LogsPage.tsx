import { useEffect, useState, useCallback, useRef } from 'react';
import { getLogs } from '../api/client';
import type { LogEntry } from '../types';

const SEVERITY_STYLE: Record<string, string> = {
  error: 'bg-red-900 text-red-300',
  warning: 'bg-yellow-900 text-yellow-300',
  info: 'bg-gray-700 text-gray-300',
};

// Same categories as VyOS op-mode `show log <category>`
const LOG_SOURCES = [
  { value: 'all', label: 'All (syslog)' },
  { value: 'kernel', label: 'Kernel' },
  { value: 'firewall', label: 'Firewall' },
  { value: 'nat', label: 'NAT' },
  { value: 'authorization', label: 'Authorization' },
  { value: 'https', label: 'HTTPS (nginx)' },
  { value: 'openvpn', label: 'OpenVPN' },
  { value: 'vpn', label: 'VPN' },
  { value: 'wireguard', label: 'WireGuard' },
  { value: 'lldp', label: 'LLDP' },
  { value: 'snmp', label: 'SNMP' },
  { value: 'vrrp', label: 'VRRP' },
  { value: 'conntrack-sync', label: 'Conntrack-sync' },
  { value: 'zebra', label: 'Zebra (routing)' },
  { value: 'cluster', label: 'Cluster' },
];

export default function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [source, setSource] = useState('all');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [lines, setLines] = useState(200);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [interval, setIntervalSec] = useState(5);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadingRef = useRef(false);
  const load = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setErr('');
    getLogs({
      source,
      severity: (severity || undefined) as 'error' | 'warning' | 'info' | undefined,
      search: debouncedSearch || undefined,
      lines,
    })
      .then(setEntries)
      .catch(e => setErr('Load error: ' + (e.response?.data?.detail || e.message)))
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  }, [source, severity, debouncedSearch, lines]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = window.setInterval(load, interval * 1000);
    return () => window.clearInterval(t);
  }, [autoRefresh, interval, load]);

  const selectCls = 'px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Logs</h2>
        <button onClick={load} disabled={loading} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm disabled:opacity-50">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700">
        <label className="text-sm text-gray-400">Source</label>
        <select value={source} onChange={e => setSource(e.target.value)} className={selectCls}>
          {LOG_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <label className="text-sm text-gray-400">Severity</label>
        <select value={severity} onChange={e => setSeverity(e.target.value)} className={selectCls}>
          <option value="">All</option>
          <option value="error">Error</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>

        <label className="text-sm text-gray-400">Lines</label>
        <select value={lines} onChange={e => setLines(Number(e.target.value))} className={selectCls}>
          {[100, 200, 500, 1000].map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search…"
          className="flex-1 min-w-[180px] px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500"
        />

        <label className="flex items-center gap-2 text-sm text-gray-300 ml-auto">
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto-refresh
        </label>
        {autoRefresh && (
          <select value={interval} onChange={e => setIntervalSec(Number(e.target.value))} className={selectCls}>
            {[2, 5, 10].map(n => <option key={n} value={n}>{n}s</option>)}
          </select>
        )}
      </div>

      {err && <div className="mb-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}

      {loading && entries.length === 0 ? (
        <div className="flex items-center gap-2 text-gray-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading logs…
        </div>
      ) : entries.length === 0 ? (
        <div className="text-gray-400 text-sm">No log entries match the current filters.</div>
      ) : (
        <>
          <div className="text-sm text-gray-400 mb-2">{entries.length} entries (newest first)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border border-gray-700 rounded-lg overflow-hidden">
              <thead className="bg-gray-800">
                <tr>
                  <th className="px-4 py-2 whitespace-nowrap">Time</th>
                  <th className="px-4 py-2">Severity</th>
                  <th className="px-4 py-2">Process</th>
                  <th className="px-4 py-2">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {entries.map((e, i) => (
                  <tr key={i} className="hover:bg-gray-800/50 align-top">
                    <td className="px-4 py-1.5 font-mono text-xs text-gray-400 whitespace-nowrap">{e.timestamp || '-'}</td>
                    <td className="px-4 py-1.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_STYLE[e.severity] || SEVERITY_STYLE.info}`}>
                        {e.severity}
                      </span>
                    </td>
                    <td className="px-4 py-1.5 font-mono text-xs whitespace-nowrap">{e.process || '-'}</td>
                    <td className="px-4 py-1.5 font-mono text-xs break-all">{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

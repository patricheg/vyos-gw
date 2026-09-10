import { useEffect, useState, useCallback, useRef } from 'react';
import { getFirewallLogs } from '../api/client';
import type { FirewallLogEntry } from '../types';

const ACTION_STYLE: Record<string, string> = {
  accept: 'bg-green-900 text-green-300',
  drop: 'bg-red-900 text-red-300',
  reject: 'bg-yellow-900 text-yellow-300',
};

const ROW_TINT: Record<string, string> = {
  drop: 'bg-red-900/10',
  reject: 'bg-yellow-900/10',
  accept: 'bg-green-900/5',
};

const selectCls = 'px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500';
const inputCls = 'px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm focus:outline-none focus:border-blue-500';

export default function FirewallLogsPage() {
  const [entries, setEntries] = useState<FirewallLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [action, setAction] = useState('');
  const [chain, setChain] = useState('');
  const [src, setSrc] = useState('');
  const [dst, setDst] = useState('');
  const [proto, setProto] = useState('');
  const [port, setPort] = useState('');
  const [lines, setLines] = useState(500);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalSec, setIntervalSec] = useState(5);

  // Debounce text filters
  const [debounced, setDebounced] = useState({ chain: '', src: '', dst: '', port: '' });
  useEffect(() => {
    const t = setTimeout(() => setDebounced({
      chain: chain.trim(), src: src.trim(), dst: dst.trim(), port: port.trim(),
    }), 300);
    return () => clearTimeout(t);
  }, [chain, src, dst, port]);

  const loadingRef = useRef(false);
  const load = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setErr('');
    getFirewallLogs({
      action: (action || undefined) as 'accept' | 'drop' | 'reject' | undefined,
      chain: debounced.chain || undefined,
      src: debounced.src || undefined,
      dst: debounced.dst || undefined,
      proto: proto || undefined,
      port: debounced.port || undefined,
      lines,
    })
      .then(setEntries)
      .catch(e => setErr('Load error: ' + (e.response?.data?.detail || e.message)))
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  }, [action, debounced, proto, lines]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = window.setInterval(load, intervalSec * 1000);
    return () => window.clearInterval(t);
  }, [autoRefresh, intervalSec, load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Firewall Logs</h2>
        <button onClick={load} disabled={loading} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm disabled:opacity-50">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700">
        <label className="text-sm text-gray-400">Action</label>
        <select value={action} onChange={e => setAction(e.target.value)} className={selectCls}>
          <option value="">Any</option>
          <option value="accept">Accept</option>
          <option value="drop">Drop</option>
          <option value="reject">Reject</option>
        </select>

        <label className="text-sm text-gray-400">Proto</label>
        <select value={proto} onChange={e => setProto(e.target.value)} className={selectCls}>
          <option value="">Any</option>
          <option value="tcp">TCP</option>
          <option value="udp">UDP</option>
          <option value="icmp">ICMP</option>
        </select>

        <input value={chain} onChange={e => setChain(e.target.value)} placeholder="Chain / ruleset" className={`${inputCls} w-36`} />
        <input value={src} onChange={e => setSrc(e.target.value)} placeholder="Source IP" className={`${inputCls} w-32`} />
        <input value={dst} onChange={e => setDst(e.target.value)} placeholder="Dest IP" className={`${inputCls} w-32`} />
        <input value={port} onChange={e => setPort(e.target.value)} placeholder="Port" className={`${inputCls} w-20`} />

        <label className="text-sm text-gray-400">Lines</label>
        <select value={lines} onChange={e => setLines(Number(e.target.value))} className={selectCls}>
          {[100, 500, 1000, 2000].map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        <label className="flex items-center gap-2 text-sm text-gray-300 ml-auto">
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto-refresh
        </label>
        {autoRefresh && (
          <select value={intervalSec} onChange={e => setIntervalSec(Number(e.target.value))} className={selectCls}>
            {[2, 5, 10].map(n => <option key={n} value={n}>{n}s</option>)}
          </select>
        )}
      </div>

      {err && <div className="mb-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}

      {loading && entries.length === 0 ? (
        <div className="flex items-center gap-2 text-gray-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading firewall logs…
        </div>
      ) : entries.length === 0 ? (
        <div className="text-gray-400 text-sm">
          No firewall log entries. Enable «Log matching packets» on firewall rules to see traffic here.
        </div>
      ) : (
        <>
          <div className="text-sm text-gray-400 mb-2">{entries.length} entries (newest first)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border border-gray-700 rounded-lg overflow-hidden">
              <thead className="bg-gray-800">
                <tr>
                  <th className="px-3 py-2 whitespace-nowrap">Time</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Chain</th>
                  <th className="px-3 py-2">Rule</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Destination</th>
                  <th className="px-3 py-2">Proto</th>
                  <th className="px-3 py-2">Iface</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {entries.map((e, i) => (
                  <tr key={i} title={e.raw} className={`hover:bg-gray-800/50 ${ROW_TINT[e.action || ''] || ''}`}>
                    <td className="px-3 py-1.5 font-mono text-xs text-gray-400 whitespace-nowrap">{e.timestamp || '-'}</td>
                    <td className="px-3 py-1.5">
                      {e.action ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ACTION_STYLE[e.action]}`}>
                          {e.action}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">{e.chain || '-'}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{e.rule_number ?? '-'}</td>
                    <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{e.src || '-'}{e.spt ? `:${e.spt}` : ''}</td>
                    <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{e.dst || '-'}{e.dpt ? `:${e.dpt}` : ''}</td>
                    <td className="px-3 py-1.5 text-xs">{e.proto || '-'}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-gray-400">{e.iface_in || '-'}{e.iface_out ? ` → ${e.iface_out}` : ''}</td>
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

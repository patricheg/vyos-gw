import { Fragment, useEffect, useState } from 'react';
import { getServices } from '../api/client';
import type { ServiceInfo } from '../types';

function SettingsTree({ node, depth = 0 }: { node: unknown; depth?: number }) {
  if (node === null || node === undefined) return <span className="text-gray-500">-</span>;
  if (typeof node !== 'object') return <span className="font-mono text-gray-200">{String(node)}</span>;
  if (Array.isArray(node)) {
    return (
      <div className={depth > 0 ? 'ml-4' : ''}>
        {node.map((v, i) => <div key={i}><SettingsTree node={v} depth={depth + 1} /></div>)}
      </div>
    );
  }
  const entries = Object.entries(node as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-gray-500 text-xs">enabled (no options)</span>;
  return (
    <div className={depth > 0 ? 'ml-4 border-l border-gray-700 pl-3' : ''}>
      {entries.map(([k, v]) => {
        const isBranch = typeof v === 'object' && v !== null && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0);
        return (
          <div key={k} className="py-0.5">
            <span className="font-mono text-xs text-blue-300">{k}</span>
            {isBranch
              ? <SettingsTree node={v} depth={depth + 1} />
              : <span className="text-gray-400"> = <SettingsTree node={v} depth={depth + 1} /></span>}
          </div>
        );
      })}
    </div>
  );
}

export default function ServicesPage() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = () => {
    setLoading(true);
    setErr('');
    getServices()
      .then(setServices)
      .catch(e => setErr('Load error: ' + e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Reload after staged changes are committed or discarded
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('vyos:config-changed', handler);
    return () => window.removeEventListener('vyos:config-changed', handler);
  }, []);

  const visible = showAll ? services : services.filter(s => s.configured);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Services</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
            Show unconfigured
          </label>
          <button onClick={load} disabled={loading} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {err && <div className="mb-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}

      {loading && services.length === 0 ? (
        <div className="flex items-center gap-2 text-gray-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading services…
        </div>
      ) : (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {visible.map(s => (
                <Fragment key={s.name}>
                  <tr className="hover:bg-gray-800/50">
                    <td className="px-4 py-2.5 font-medium">{s.label}</td>
                    <td className="px-4 py-2.5 font-mono text-sm text-gray-400">{s.name}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        s.enabled ? 'bg-green-900 text-green-300'
                        : s.configured ? 'bg-yellow-900 text-yellow-300'
                        : 'bg-gray-700 text-gray-400'
                      }`}>
                        {s.enabled ? 'enabled' : s.configured ? 'disabled' : 'not configured'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {s.configured && (
                        <button
                          onClick={() => setExpanded(expanded === s.name ? null : s.name)}
                          className="text-blue-400 hover:text-blue-300 text-sm"
                        >
                          {expanded === s.name ? 'Hide settings' : 'Settings'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === s.name && s.settings && (
                    <tr className="bg-gray-900/50">
                      <td colSpan={4} className="px-4 py-3">
                        <SettingsTree node={s.settings} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-4 text-sm text-gray-400 text-center">No services configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-gray-500">Sensitive values (keys, passwords, secrets) are masked.</p>
    </div>
  );
}

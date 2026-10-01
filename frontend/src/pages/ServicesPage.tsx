import { Fragment, useEffect, useState } from 'react';
import { getServices } from '../api/client';
import type { ServiceInfo } from '../types';
import {
  pageTitle, btnSecondarySm, badgeGreen, badgeAmber, badgeSlate,
  tableWrap, tableCls, theadCls, thCls, tbodyCls, trHover,
  alertErr, linkEdit, loadingRow, spinner, checkboxCls,
} from '../ui';

function SettingsTree({ node, depth = 0 }: { node: unknown; depth?: number }) {
  if (node === null || node === undefined) return <span className="text-slate-500">-</span>;
  if (typeof node !== 'object') return <span className="font-mono text-slate-200">{String(node)}</span>;
  if (Array.isArray(node)) {
    return (
      <div className={depth > 0 ? 'ml-4' : ''}>
        {node.map((v, i) => <div key={i}><SettingsTree node={v} depth={depth + 1} /></div>)}
      </div>
    );
  }
  const entries = Object.entries(node as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-slate-500 text-xs">enabled (no options)</span>;
  return (
    <div className={depth > 0 ? 'ml-4 border-l border-slate-700 pl-3' : ''}>
      {entries.map(([k, v]) => {
        const isBranch = typeof v === 'object' && v !== null && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0);
        return (
          <div key={k} className="py-0.5">
            <span className="font-mono text-xs text-indigo-300">{k}</span>
            {isBranch
              ? <SettingsTree node={v} depth={depth + 1} />
              : <span className="text-slate-400"> = <SettingsTree node={v} depth={depth + 1} /></span>}
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
        <h2 className={pageTitle}>Services</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className={checkboxCls} />
            Show unconfigured
          </label>
          <button onClick={load} disabled={loading} className={btnSecondarySm}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {err && <div className={alertErr}>{err}</div>}

      {loading && services.length === 0 ? (
        <div className={loadingRow}>
          <svg className={spinner} viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading services…
        </div>
      ) : (
        <div className={tableWrap}>
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={thCls}>Service</th>
                <th className={thCls}>Name</th>
                <th className={thCls}>Status</th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody className={tbodyCls}>
              {visible.map(s => (
                <Fragment key={s.name}>
                  <tr className={trHover}>
                    <td className="px-4 py-2.5 font-medium text-slate-100">{s.label}</td>
                    <td className="px-4 py-2.5 font-mono text-sm text-slate-400">{s.name}</td>
                    <td className="px-4 py-2.5">
                      <span className={
                        s.enabled ? badgeGreen
                        : s.configured ? badgeAmber
                        : badgeSlate
                      }>
                        {s.enabled ? 'enabled' : s.configured ? 'disabled' : 'not configured'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {s.configured && (
                        <button
                          onClick={() => setExpanded(expanded === s.name ? null : s.name)}
                          className={linkEdit}
                        >
                          {expanded === s.name ? 'Hide settings' : 'Settings'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === s.name && s.settings && (
                    <tr className="bg-slate-900/50">
                      <td colSpan={4} className="px-4 py-3">
                        <SettingsTree node={s.settings} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {visible.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-4 text-sm text-slate-400 text-center">No services configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">Sensitive values (keys, passwords, secrets) are masked.</p>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { getInterfaces, updateInterface } from '../api/client';
import type { Interface } from '../types';
import {
  pageTitle, btnSecondarySm, btnPrimary, btnSecondary, inputCls, labelCls,
  tableWrap, tableCls, theadCls, thCls, tbodyCls, trHover,
  badgeGreen, badgeRed, alertErr, alertInfo, modalOverlay, modalCard, modalTitle,
  linkEdit, loadingRow, spinner, spinnerSm, checkboxCls,
} from '../ui';

export default function InterfacesPage() {
  const [ifaces, setIfaces] = useState<Interface[]>([]);
  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Interface>>({});
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setErr('');
    getInterfaces()
      .then(setIfaces)
      .catch(e => setErr('Load error: ' + e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Reload actual config after staged changes are committed or discarded
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('vyos:config-changed', handler);
    return () => window.removeEventListener('vyos:config-changed', handler);
  }, []);

  const startEdit = (iface: Interface) => {
    setEditName(iface.name);
    setMsg('');
    setErr('');
    setForm({
      description: iface.description || '',
      address: iface.address || '',
      mtu: iface.mtu,
      enabled: iface.enabled,
    });
  };

  const save = async () => {
    if (!editName) return;
    setSaving(true);
    setMsg('');
    setErr('');

    const desc = (form.description || '').trim();
    const addr = (form.address || '').trim();

    // Optimistic update
    setIfaces(prev => prev.map(i =>
      i.name === editName
        ? { ...i, description: desc || null, address: addr || null, mtu: form.mtu || i.mtu, enabled: form.enabled ?? i.enabled }
        : i
    ));
    setEditName(null);

    try {
      await updateInterface(editName, {
        description: desc || null,
        address: addr || null,
        mtu: form.mtu,
        enabled: form.enabled,
      });
      setMsg('Added to pending changes');
    } catch (e: any) {
      setErr('Stage error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className={pageTitle}>Interfaces</h2>
        <button onClick={load} disabled={loading} className={btnSecondarySm}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {err && <div className={alertErr}>{err}</div>}
      {msg && <div className={alertInfo}>{msg}</div>}

      {loading && ifaces.length === 0 ? (
        <div className={loadingRow}>
          <svg className={spinner} viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading interfaces…
        </div>
      ) : (
        <div className={tableWrap}>
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={thCls}>Name</th>
                <th className={thCls}>State</th>
                <th className={thCls}>Address</th>
                <th className={thCls}>MAC</th>
                <th className={thCls}>MTU</th>
                <th className={thCls}>Description</th>
                <th className={thCls}>Actions</th>
              </tr>
            </thead>
            <tbody className={tbodyCls}>
              {ifaces.map(iface => (
                <tr key={iface.name} className={trHover}>
                  <td className="px-4 py-3 font-mono font-medium text-slate-100">{iface.name}</td>
                  <td className="px-4 py-3">
                    <span className={iface.state === 'u' && iface.link === 'u' ? badgeGreen : badgeRed}>
                      {iface.state}/{iface.link}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-300">{iface.address || '-'}</td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-400">{iface.mac || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{iface.mtu}</td>
                  <td className="px-4 py-3 text-sm text-slate-400">{iface.description || '-'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => startEdit(iface)} className={linkEdit}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editName && (
        <div className={modalOverlay}>
          <div className={modalCard + ' max-w-md'}>
            <h3 className={modalTitle}>Edit {editName}</h3>
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Description (leave empty to remove)</label>
                <input value={form.description || ''} onChange={e => setForm({...form, description: e.target.value})} className={inputCls} placeholder="WAN uplink" />
              </div>
              <div>
                <label className={labelCls}>Address (CIDR)</label>
                <input value={form.address || ''} onChange={e => setForm({...form, address: e.target.value})} className={inputCls} placeholder="10.0.0.1/24" />
              </div>
              <div>
                <label className={labelCls}>MTU</label>
                <input type="number" value={form.mtu || ''} onChange={e => setForm({...form, mtu: Number(e.target.value)})} className={inputCls} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={form.enabled ?? true} onChange={e => setForm({...form, enabled: e.target.checked})} id="enabled" className={checkboxCls} />
                <label htmlFor="enabled" className="text-sm text-slate-300">Enabled</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setEditName(null)} disabled={saving} className={btnSecondary}>Cancel</button>
              <button onClick={save} disabled={saving} className={btnPrimary}>
                {saving && <svg className={spinnerSm} viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>}
                {saving ? 'Staging…' : 'Stage Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

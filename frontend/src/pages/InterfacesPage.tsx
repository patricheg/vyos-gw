import { useEffect, useState } from 'react';
import { getInterfaces, updateInterface } from '../api/client';
import type { Interface } from '../types';

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
        <h2 className="text-2xl font-bold">Interfaces</h2>
        <button onClick={load} disabled={loading} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm disabled:opacity-50">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {err && <div className="mb-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
      {msg && <div className="mb-4 p-3 bg-blue-900/50 rounded border border-blue-700 text-sm text-blue-200">{msg}</div>}

      {loading && ifaces.length === 0 ? (
        <div className="flex items-center gap-2 text-gray-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading interfaces…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border border-gray-700 rounded-lg overflow-hidden">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Address</th>
                <th className="px-4 py-3">MAC</th>
                <th className="px-4 py-3">MTU</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {ifaces.map(iface => (
                <tr key={iface.name} className="hover:bg-gray-800/50">
                  <td className="px-4 py-3 font-mono font-medium">{iface.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${iface.state === 'u' && iface.link === 'u' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                      {iface.state}/{iface.link}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm">{iface.address || '-'}</td>
                  <td className="px-4 py-3 font-mono text-sm">{iface.mac || '-'}</td>
                  <td className="px-4 py-3 text-sm">{iface.mtu}</td>
                  <td className="px-4 py-3 text-sm">{iface.description || '-'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => startEdit(iface)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editName && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700 shadow-xl">
            <h3 className="text-lg font-bold mb-4">Edit {editName}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description (leave empty to remove)</label>
                <input value={form.description || ''} onChange={e => setForm({...form, description: e.target.value})} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500" placeholder="WAN uplink" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Address (CIDR)</label>
                <input value={form.address || ''} onChange={e => setForm({...form, address: e.target.value})} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500" placeholder="10.0.0.1/24" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">MTU</label>
                <input type="number" value={form.mtu || ''} onChange={e => setForm({...form, mtu: Number(e.target.value)})} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500" />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={form.enabled ?? true} onChange={e => setForm({...form, enabled: e.target.checked})} id="enabled" />
                <label htmlFor="enabled" className="text-sm">Enabled</label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setEditName(null)} disabled={saving} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 flex items-center gap-2">
                {saving && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>}
                {saving ? 'Staging…' : 'Stage Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

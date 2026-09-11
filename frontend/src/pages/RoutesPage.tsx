import { useEffect, useState } from 'react';
import {
  getRoutingTable, getStaticRoutes,
  addStaticRoute, updateStaticRoute, deleteStaticRoute, toggleStaticRoute,
} from '../api/client';
import type { RouteEntry, StaticRoute, StaticNextHop } from '../types';

const inputCls = 'w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500';

const PROTOCOL_COLORS: Record<string, string> = {
  connected: 'bg-emerald-900 text-emerald-300',
  local: 'bg-gray-700 text-gray-300',
  static: 'bg-blue-900 text-blue-300',
  kernel: 'bg-purple-900 text-purple-300',
  dhcp: 'bg-cyan-900 text-cyan-300',
  ospf: 'bg-orange-900 text-orange-300',
  bgp: 'bg-red-900 text-red-300',
  rip: 'bg-yellow-900 text-yellow-300',
};

const EMPTY_ROUTE: StaticRoute = {
  prefix: '',
  description: null,
  next_hops: [{ address: '', distance: null }],
  blackhole: false,
  blackhole_distance: null,
  disabled: false,
};

function nexthopLabel(nh: RouteEntry['nexthops'][number]): string {
  if (nh.directly_connected || !nh.ip) return `dev ${nh.interface || '?'}`;
  return nh.interface ? `via ${nh.ip} dev ${nh.interface}` : `via ${nh.ip}`;
}

export default function RoutesPage() {
  const [table, setTable] = useState<RouteEntry[]>([]);
  const [staticRoutes, setStaticRoutes] = useState<StaticRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [working, setWorking] = useState<string | null>(null);

  const [filter, setFilter] = useState('');
  const [protoFilter, setProtoFilter] = useState('all');

  const [form, setForm] = useState<StaticRoute>(EMPTY_ROUTE);
  const [editPrefix, setEditPrefix] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    setLoading(true);
    setErr('');
    Promise.all([
      getRoutingTable().catch(e => { throw new Error('routing table: ' + (e.response?.data?.detail || e.message)); }),
      getStaticRoutes().catch(e => { throw new Error('static routes: ' + (e.response?.data?.detail || e.message)); }),
    ])
      .then(([t, s]) => { setTable(t); setStaticRoutes(s); })
      .catch(e => setErr('Load error: ' + e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const handler = () => load();
    window.addEventListener('vyos:config-changed', handler);
    return () => window.removeEventListener('vyos:config-changed', handler);
  }, []);

  const isWorking = (key: string) => working === key;

  // ─── Static route form ────────────────────────────────────────

  const openAdd = () => {
    setForm({ ...EMPTY_ROUTE, next_hops: [{ address: '', distance: null }] });
    setEditPrefix(null);
    setErr(''); setMsg('');
    setShowForm(true);
  };

  const openEdit = (r: StaticRoute) => {
    setForm({ ...r, next_hops: r.next_hops.map(n => ({ ...n })) });
    setEditPrefix(r.prefix);
    setErr(''); setMsg('');
    setShowForm(true);
  };

  const setNexthop = (idx: number, patch: Partial<StaticNextHop>) => {
    setForm(prev => ({ ...prev, next_hops: prev.next_hops.map((n, i) => i === idx ? { ...n, ...patch } : n) }));
  };

  const validate = (): string | null => {
    if (!form.prefix.trim()) return 'Prefix is required (e.g. 192.168.0.0/24)';
    if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(form.prefix.trim())) return 'Prefix must look like 192.168.0.0/24';
    if (form.blackhole) {
      if (form.blackhole_distance !== null && (form.blackhole_distance < 1 || form.blackhole_distance > 255))
        return 'Blackhole distance must be 1-255';
      return null;
    }
    if (form.next_hops.length === 0) return 'Add at least one next-hop, or enable blackhole';
    for (const nh of form.next_hops) {
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(nh.address.trim())) return `Next-hop "${nh.address}" is not a valid IPv4 address`;
      if (nh.distance !== null && (nh.distance < 1 || nh.distance > 255)) return `Next-hop ${nh.address}: distance must be 1-255`;
    }
    return null;
  };

  const handleSave = async () => {
    setErr(''); setMsg('');
    const problem = validate();
    if (problem) { setErr(problem); return; }
    const route: StaticRoute = {
      ...form,
      prefix: form.prefix.trim(),
      description: form.description?.trim() || null,
      next_hops: form.blackhole ? [] : form.next_hops.map(n => ({ address: n.address.trim(), distance: n.distance })),
      blackhole_distance: form.blackhole ? form.blackhole_distance : null,
    };
    setWorking('save');
    try {
      let result: { prefix?: string };
      if (editPrefix !== null) {
        result = await updateStaticRoute(editPrefix, route);
        setMsg('Static route update staged — review and commit');
      } else {
        result = await addStaticRoute(route);
        setMsg('Static route staged — review and commit');
      }
      const finalRoute = { ...route, prefix: result.prefix || route.prefix };
      setStaticRoutes(prev => {
        const rest = prev.filter(r => r.prefix !== editPrefix && r.prefix !== finalRoute.prefix);
        return [...rest, finalRoute].sort((a, b) => a.prefix.localeCompare(b.prefix, undefined, { numeric: true }));
      });
      setShowForm(false);
    } catch (e: any) {
      setErr('Save error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const handleDelete = async (prefix: string) => {
    if (!confirm(`Delete static route ${prefix}?`)) return;
    setWorking('del-' + prefix);
    setErr(''); setMsg('');
    setStaticRoutes(prev => prev.filter(r => r.prefix !== prefix));
    try {
      await deleteStaticRoute(prefix);
      setMsg('Static route deletion staged — review and commit');
    } catch (e: any) {
      setErr('Delete error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const handleToggle = async (r: StaticRoute) => {
    setWorking('toggle-' + r.prefix);
    setErr(''); setMsg('');
    const target = !r.disabled;
    setStaticRoutes(prev => prev.map(x => x.prefix === r.prefix ? { ...x, disabled: target } : x));
    try {
      await toggleStaticRoute(r.prefix, target);
      setMsg(`Static route ${r.prefix} ${target ? 'disable' : 'enable'} staged — review and commit`);
    } catch (e: any) {
      setErr('Toggle error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  // ─── Live table filtering ─────────────────────────────────────

  const protocols = [...new Set(table.map(r => r.protocol))].sort();
  const filteredTable = table.filter(r => {
    if (protoFilter !== 'all' && r.protocol !== protoFilter) return false;
    if (!filter.trim()) return true;
    const f = filter.trim().toLowerCase();
    return r.prefix.toLowerCase().includes(f)
      || r.protocol.toLowerCase().includes(f)
      || r.nexthops.some(n => (n.ip || '').includes(f) || (n.interface || '').toLowerCase().includes(f));
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Routing</h2>
        <button onClick={load} disabled={loading} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm disabled:opacity-50">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {err && <div className="mb-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
      {msg && <div className="mb-4 p-3 bg-green-900/50 rounded border border-green-700 text-sm text-green-200">{msg}</div>}

      {/* Static routes */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Static routes</h3>
        <button onClick={openAdd} className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-500 text-sm text-white font-medium">+ Add Static Route</button>
      </div>

      {staticRoutes.length === 0 ? (
        <div className="mb-6 p-6 border border-dashed border-gray-600 rounded-lg text-center text-gray-400">
          No static routes configured{loading ? ' (loading…)' : ''}.
        </div>
      ) : (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-left border border-gray-700 rounded-lg overflow-hidden">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-3">Prefix</th>
                <th className="px-4 py-3">Next-hops</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {staticRoutes.map(r => (
                <tr key={r.prefix} className={`hover:bg-gray-800/50 ${r.disabled ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2.5 font-mono text-blue-300">{r.prefix}</td>
                  <td className="px-4 py-2.5 font-mono text-sm">
                    {r.blackhole ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-900 text-red-300">
                        blackhole{r.blackhole_distance ? ` (dist ${r.blackhole_distance})` : ''}
                      </span>
                    ) : (
                      r.next_hops.map(n => (
                        <div key={n.address} className="text-green-300">
                          {n.address}{n.distance !== null && <span className="text-gray-400"> (dist {n.distance})</span>}
                        </div>
                      ))
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-400">{r.description || '-'}</td>
                  <td className="px-4 py-2.5 text-sm">{r.disabled ? <span className="text-gray-500">disabled</span> : <span className="text-green-400">active</span>}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(r)} className="text-blue-400 hover:text-blue-300 text-sm mr-3">Edit</button>
                    <button onClick={() => handleToggle(r)} disabled={isWorking('toggle-' + r.prefix)} className="text-yellow-400 hover:text-yellow-300 text-sm mr-3 disabled:opacity-50">
                      {r.disabled ? 'Enable' : 'Disable'}
                    </button>
                    <button onClick={() => handleDelete(r.prefix)} disabled={isWorking('del-' + r.prefix)} className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50">
                      {isWorking('del-' + r.prefix) ? '…' : 'Del'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Live routing table */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="text-lg font-semibold">Routing table (live)</h3>
        <div className="flex gap-2">
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter: prefix, next-hop, iface…" className={inputCls + ' !w-64'} />
          <select value={protoFilter} onChange={e => setProtoFilter(e.target.value)} className={inputCls + ' !w-36'}>
            <option value="all">all protocols</option>
            {protocols.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {filteredTable.length === 0 ? (
        <div className="p-6 border border-dashed border-gray-600 rounded-lg text-center text-gray-400">
          {loading ? 'Loading…' : 'No routes match the filter.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border border-gray-700 rounded-lg overflow-hidden">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-3">Prefix</th>
                <th className="px-4 py-3">Protocol</th>
                <th className="px-4 py-3">Next-hops</th>
                <th className="px-4 py-3">Dist/Metric</th>
                <th className="px-4 py-3">Uptime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filteredTable.map((r, i) => (
                <tr key={`${r.prefix}-${i}`} className={`hover:bg-gray-800/50 ${!r.installed ? 'opacity-50' : ''}`} title={r.installed ? 'Installed in FIB' : 'Not installed (shadowed by a better route)'}>
                  <td className="px-4 py-2.5 font-mono text-blue-300">{r.prefix}</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${PROTOCOL_COLORS[r.protocol] || 'bg-gray-700 text-gray-300'}`}>
                      {r.protocol}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-sm">
                    {r.nexthops.length === 0 ? <span className="text-gray-500">-</span> : r.nexthops.map((n, j) => (
                      <div key={j} className={n.active ? 'text-green-300' : 'text-gray-500 line-through'}>
                        {nexthopLabel(n)}
                      </div>
                    ))}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-400 font-mono">[{r.distance ?? '-'}/{r.metric ?? '-'}]</td>
                  <td className="px-4 py-2.5 text-sm text-gray-400">{r.uptime || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Static route modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg border border-gray-700 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">
              {editPrefix !== null ? <>Edit static route <span className="text-blue-400">{editPrefix}</span></> : 'New Static Route'}
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Prefix</label>
                  <input value={form.prefix} onChange={e => setForm({ ...form, prefix: e.target.value })} disabled={editPrefix !== null} className={inputCls + ' disabled:opacity-50'} placeholder="192.168.0.0/24" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Description</label>
                  <input value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value || null })} className={inputCls} placeholder="to branch office" />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.blackhole} onChange={e => setForm({ ...form, blackhole: e.target.checked })} />
                <span>Blackhole (silently drop traffic to this prefix)</span>
              </label>

              {form.blackhole ? (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Blackhole distance (optional, 1-255)</label>
                  <input type="number" value={form.blackhole_distance ?? ''} onChange={e => setForm({ ...form, blackhole_distance: e.target.value === '' ? null : Number(e.target.value) })} className={inputCls} placeholder="default" />
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm text-gray-400 font-medium">Next-hops</label>
                    <button
                      onClick={() => setForm(prev => ({ ...prev, next_hops: [...prev.next_hops, { address: '', distance: null }] }))}
                      className="px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 text-xs"
                    >
                      + Add Next-hop
                    </button>
                  </div>
                  <div className="space-y-2">
                    {form.next_hops.map((nh, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input value={nh.address} onChange={e => setNexthop(idx, { address: e.target.value })} className={inputCls} placeholder="10.0.0.1" />
                        <input type="number" value={nh.distance ?? ''} onChange={e => setNexthop(idx, { distance: e.target.value === '' ? null : Number(e.target.value) })} className={inputCls + ' !w-28'} placeholder="dist (opt)" title="Administrative distance 1-255 (optional)" />
                        <button
                          onClick={() => setForm(prev => ({ ...prev, next_hops: prev.next_hops.filter((_, i) => i !== idx) }))}
                          disabled={form.next_hops.length <= 1}
                          className="text-red-400 hover:text-red-300 text-sm px-1 disabled:opacity-30"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Several next-hops = ECMP (traffic is balanced between them).</p>
                </div>
              )}

              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.disabled} onChange={e => setForm({ ...form, disabled: e.target.checked })} />
                <span>Create disabled</span>
              </label>
            </div>
            {err && <div className="mt-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowForm(false)} disabled={isWorking('save')} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleSave} disabled={isWorking('save')} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
                {isWorking('save') ? 'Saving…' : editPrefix !== null ? 'Save Changes' : 'Add Route'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { getNatRules, addNatRule, updateNatRule, deleteNatRule, getInterfaces } from '../api/client';
import type { NatRule } from '../types';

const inputCls = 'w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500';

const EMPTY_RULE: NatRule = {
  number: 10,
  description: null,
  protocol: 'tcp',
  source_address: null,
  destination_address: null,
  destination_port: null,
  inbound_interface: null,
  translation_address: null,
  translation_port: null,
  log: null,
};

export default function NatPage() {
  const [rules, setRules] = useState<NatRule[]>([]);
  const [ifaceNames, setIfaceNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<NatRule>(EMPTY_RULE);
  const [editNumber, setEditNumber] = useState<number | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setErr('');
    Promise.all([getNatRules(), getInterfaces()])
      .then(([rs, ifs]) => {
        setRules(rs);
        setIfaceNames(ifs.map(i => i.name));
      })
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

  const isWorking = (key: string) => working === key;

  const openAdd = () => {
    const maxNum = rules.length > 0 ? Math.max(...rules.map(r => r.number)) : 0;
    setForm({ ...EMPTY_RULE, number: maxNum > 0 ? maxNum + 10 : 10 });
    setEditNumber(null);
    setErr('');
    setMsg('');
    setShowForm(true);
  };

  const openEdit = (rule: NatRule) => {
    setForm({ ...rule, protocol: rule.protocol || 'tcp' });
    setEditNumber(rule.number);
    setErr('');
    setMsg('');
    setShowForm(true);
  };

  const buildRule = (): NatRule => ({
    ...form,
    protocol: form.protocol === 'all' ? null : form.protocol,
    source_address: form.source_address || null,
    destination_address: form.destination_address || null,
    destination_port: form.destination_port || null,
    inbound_interface: form.inbound_interface || null,
    translation_address: form.translation_address || null,
    translation_port: form.translation_port || null,
    description: form.description || null,
  });

  const handleSave = async () => {
    setWorking('save');
    setErr('');
    setMsg('');
    const rule = buildRule();

    // Optimistic update
    setRules(prev => {
      const filtered = prev.filter(r => r.number !== (editNumber ?? rule.number) && r.number !== rule.number);
      return [...filtered, rule].sort((a, b) => a.number - b.number);
    });
    setShowForm(false);

    try {
      if (editNumber !== null) {
        await updateNatRule(editNumber, rule);
        setMsg('NAT rule update staged — review and commit');
      } else {
        await addNatRule(rule);
        setMsg('NAT rule staged — review and commit');
      }
    } catch (e: any) {
      setErr('Save error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const handleDelete = async (num: number) => {
    if (!confirm(`Delete NAT rule ${num}?`)) return;
    setWorking('del-' + num);
    setErr('');
    setMsg('');
    setRules(prev => prev.filter(r => r.number !== num));
    try {
      await deleteNatRule(num);
      setMsg('NAT rule deletion staged — review and commit');
    } catch (e: any) {
      setErr('Delete error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">NAT — Port Forwarding</h2>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={openAdd} className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-500 text-sm text-white font-medium">
            + Add Rule
          </button>
        </div>
      </div>

      <div className="mb-4 p-3 bg-gray-800/80 rounded border border-gray-700 text-sm text-gray-300">
        <strong className="text-white">Destination NAT (port forwarding):</strong> incoming traffic to
        <em> destination address:port</em> on the chosen inbound interface is redirected to the
        <em> translation address:port</em>. Don't forget a matching <strong>forward</strong>-chain firewall rule.
      </div>

      {err && <div className="mb-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
      {msg && <div className="mb-4 p-3 bg-green-900/50 rounded border border-green-700 text-sm text-green-200">{msg}</div>}

      {loading && rules.length === 0 ? (
        <div className="flex items-center gap-2 text-gray-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading NAT rules…
        </div>
      ) : rules.length === 0 ? (
        <div className="p-6 border border-dashed border-gray-600 rounded-lg text-center text-gray-400">
          <p className="mb-2">No port-forwarding rules yet.</p>
          <button onClick={openAdd} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-500 text-white text-sm">Create your first rule</button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border border-gray-700 rounded-lg overflow-hidden">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Inbound Iface</th>
                <th className="px-4 py-3">Proto</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3">→ Translation</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {rules.map(r => (
                <tr key={r.number} className="hover:bg-gray-800/50">
                  <td className="px-4 py-2.5 font-mono text-gray-300">{r.number}</td>
                  <td className="px-4 py-2.5 font-mono text-sm">{r.inbound_interface || 'any'}</td>
                  <td className="px-4 py-2.5 text-sm">{r.protocol || 'all'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {r.destination_address || 'any'}{r.destination_port ? `:${r.destination_port}` : ''}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-green-300">
                    {r.translation_address || '-'}{r.translation_port ? `:${r.translation_port}` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-gray-400">
                    {r.description || '-'}
                    {r.log && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-900 text-blue-300 align-middle">LOG</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => openEdit(r)} className="text-blue-400 hover:text-blue-300 text-sm mr-3">Edit</button>
                    <button onClick={() => handleDelete(r.number)} disabled={isWorking('del-' + r.number)} className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50">
                      {isWorking('del-' + r.number) ? '…' : 'Del'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg border border-gray-700 shadow-xl">
            <h3 className="text-lg font-bold mb-4">
              {editNumber !== null ? <>Edit NAT rule <span className="text-blue-400">#{editNumber}</span></> : 'New Port Forward'}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Rule Number</label>
                <input type="number" value={form.number} onChange={e => setForm({ ...form, number: Number(e.target.value) })} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Protocol</label>
                <select value={form.protocol || 'tcp'} onChange={e => setForm({ ...form, protocol: e.target.value })} className={inputCls}>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="tcp_udp">TCP+UDP</option>
                  <option value="all">all</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Inbound Interface</label>
                <select value={form.inbound_interface || ''} onChange={e => setForm({ ...form, inbound_interface: e.target.value || null })} className={inputCls}>
                  <option value="">any</option>
                  {ifaceNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Source Address</label>
                <input value={form.source_address || ''} onChange={e => setForm({ ...form, source_address: e.target.value || null })} className={inputCls} placeholder="any" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Destination Address</label>
                <input value={form.destination_address || ''} onChange={e => setForm({ ...form, destination_address: e.target.value || null })} className={inputCls} placeholder="any (router's WAN IP)" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Destination Port</label>
                <input value={form.destination_port || ''} onChange={e => setForm({ ...form, destination_port: e.target.value || null })} className={inputCls} placeholder="80" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Translation Address</label>
                <input value={form.translation_address || ''} onChange={e => setForm({ ...form, translation_address: e.target.value || null })} className={inputCls} placeholder="192.168.1.10" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Translation Port</label>
                <input value={form.translation_port || ''} onChange={e => setForm({ ...form, translation_port: e.target.value || null })} className={inputCls} placeholder="8080" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <input value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value || null })} className={inputCls} placeholder="Web server" />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.log ?? false} onChange={e => setForm({ ...form, log: e.target.checked })} />
                <span>Log matching packets</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowForm(false)} disabled={isWorking('save')} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleSave} disabled={isWorking('save')} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
                {isWorking('save') ? 'Saving…' : editNumber !== null ? 'Save Changes' : 'Add Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

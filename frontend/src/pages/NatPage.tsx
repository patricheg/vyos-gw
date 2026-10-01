import { useEffect, useState } from 'react';
import { getNatRules, addNatRule, updateNatRule, deleteNatRule, toggleNatRule, getInterfaces, getSourceNatRules, addSourceNatRule, updateSourceNatRule, deleteSourceNatRule, toggleSourceNatRule, getNatCounters, getAddressGroups } from '../api/client';
import type { NatRule, SourceNatRule, NatCounters, AddressGroup, RuleCounterMap } from '../types';
import { humanCount, humanBytes } from '../format';
import {
  pageTitle, btnSecondarySm, btnPrimary, btnPrimarySm, btnSecondary, inputCls, labelCls,
  TAG, tableWrap, tableCls, theadCls, thCls, tbodyCls, trHover,
  alertErr, alertOk, modalOverlay, modalCard, modalTitle,
  linkEdit, linkDelete, linkEnable, linkDisable, loadingRow, spinner, hintBox, emptyBox, checkboxCls,
} from '../ui';

const EMPTY_RULE: NatRule = {
  number: 10,
  description: null,
  protocol: 'tcp',
  source_address: null,
  destination_address: null,
  source_address_group: null,
  destination_address_group: null,
  destination_port: null,
  inbound_interface: null,
  translation_address: null,
  translation_port: null,
  log: null,
  disabled: false,
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
  const [counters, setCounters] = useState<NatCounters>({ destination: {}, source: {} });
  const [groups, setGroups] = useState<AddressGroup[]>([]);
  const [srcKind, setSrcKind] = useState<'address' | 'group'>('address');
  const [dstKind, setDstKind] = useState<'address' | 'group'>('address');

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
    // counter errors are ignored — the column just stays empty
    getNatCounters()
      .then(setCounters)
      .catch(() => {});
    getAddressGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
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
    setSrcKind('address');
    setDstKind('address');
    setErr('');
    setMsg('');
    setShowForm(true);
  };

  const openEdit = (rule: NatRule) => {
    setForm({ ...rule, protocol: rule.protocol || 'tcp' });
    setEditNumber(rule.number);
    setSrcKind(rule.source_address_group ? 'group' : 'address');
    setDstKind(rule.destination_address_group ? 'group' : 'address');
    setErr('');
    setMsg('');
    setShowForm(true);
  };

  const buildRule = (): NatRule => ({
    ...form,
    protocol: form.protocol === 'all' ? null : form.protocol,
    source_address: srcKind === 'address' ? (form.source_address || null) : null,
    source_address_group: srcKind === 'group' ? (form.source_address_group || null) : null,
    destination_address: dstKind === 'address' ? (form.destination_address || null) : null,
    destination_address_group: dstKind === 'group' ? (form.destination_address_group || null) : null,
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

  const handleToggle = async (rule: NatRule) => {
    const disabled = !rule.disabled;
    setWorking('toggle-' + rule.number);
    setErr('');
    setMsg('');
    setRules(prev => prev.map(r => r.number === rule.number ? { ...r, disabled } : r));
    try {
      await toggleNatRule(rule.number, disabled);
      setMsg(`NAT rule ${rule.number} ${disabled ? 'disable' : 'enable'} staged — review and commit`);
    } catch (e: any) {
      setErr('Toggle error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className={pageTitle}>NAT — Port Forwarding</h2>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className={btnSecondarySm}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={openAdd} className={btnPrimarySm}>
            + Add Rule
          </button>
        </div>
      </div>

      {err && <div className={alertErr}>{err}</div>}
      {msg && <div className={alertOk}>{msg}</div>}

      {loading && rules.length === 0 ? (
        <div className={loadingRow}>
          <svg className={spinner} viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading NAT rules…
        </div>
      ) : rules.length === 0 ? (
        <div className={emptyBox}>
          <p className="mb-2">No port-forwarding rules yet.</p>
          <button onClick={openAdd} className={btnPrimarySm}>Create your first rule</button>
        </div>
      ) : (
        <div className={tableWrap}>
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={thCls}>#</th>
                <th className={thCls}>Inbound Iface</th>
                <th className={thCls}>Proto</th>
                <th className={thCls}>Destination</th>
                <th className={thCls}>→ Translation</th>
                <th className={thCls}>Description</th>
                <th className={thCls}>Packets</th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody className={tbodyCls}>
              {rules.map(r => {
                const counter = counters.destination[String(r.number)];
                return (
                <tr key={r.number} className={`${trHover} ${r.disabled ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2.5 font-mono text-slate-300">{r.number}</td>
                  <td className="px-4 py-2.5 font-mono text-sm text-slate-300">{r.inbound_interface || 'any'}</td>
                  <td className="px-4 py-2.5 text-sm text-slate-300">{r.protocol || 'all'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">
                    {r.destination_address_group
                      ? <span className="text-violet-300">@{r.destination_address_group}</span>
                      : r.destination_address || 'any'}{r.destination_port ? `:${r.destination_port}` : ''}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-emerald-300">
                    {r.translation_address || '-'}{r.translation_port ? `:${r.translation_port}` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-400">
                    {r.description || '-'}
                    {r.log && <span className={`ml-2 align-middle ${TAG.indigo}`}>LOG</span>}
                    {r.disabled && <span className={`ml-2 align-middle ${TAG.slate}`}>OFF</span>}
                  </td>
                  <td
                    className="px-4 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap"
                    title={counter ? `${counter.packets.toLocaleString()} packets / ${counter.bytes.toLocaleString()} bytes` : undefined}
                  >
                    {counter ? `${humanCount(counter.packets)} / ${humanBytes(counter.bytes)}` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => handleToggle(r)}
                      disabled={isWorking('toggle-' + r.number)}
                      title={r.disabled ? 'Enable rule' : 'Disable rule'}
                      className={(r.disabled ? linkEnable : linkDisable) + ' mr-3'}
                    >
                      {isWorking('toggle-' + r.number) ? '…' : r.disabled ? 'Enable' : 'Disable'}
                    </button>
                    <button onClick={() => openEdit(r)} className={linkEdit + ' mr-3'}>Edit</button>
                    <button onClick={() => handleDelete(r.number)} disabled={isWorking('del-' + r.number)} className={linkDelete}>
                      {isWorking('del-' + r.number) ? '…' : 'Del'}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className={modalOverlay}>
          <div className={modalCard}>
            <h3 className={modalTitle}>
              {editNumber !== null ? <>Edit NAT rule <span className="text-indigo-400">#{editNumber}</span></> : 'New Port Forward'}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Rule Number</label>
                <input type="number" value={form.number} onChange={e => setForm({ ...form, number: Number(e.target.value) })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Protocol</label>
                <select value={form.protocol || 'tcp'} onChange={e => setForm({ ...form, protocol: e.target.value })} className={inputCls}>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="tcp_udp">TCP+UDP</option>
                  <option value="all">all</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Inbound Interface</label>
                <select value={form.inbound_interface || ''} onChange={e => setForm({ ...form, inbound_interface: e.target.value || null })} className={inputCls}>
                  <option value="">any</option>
                  {ifaceNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Source Address</label>
                <select value={srcKind} onChange={e => {
                  const k = e.target.value as 'address' | 'group';
                  setSrcKind(k);
                  setForm({ ...form, source_address: k === 'address' ? form.source_address : null, source_address_group: k === 'group' ? form.source_address_group : null });
                }} className={inputCls}>
                  <option value="address">Address</option>
                  <option value="group">Group</option>
                </select>
                {srcKind === 'address' ? (
                  <input value={form.source_address || ''} onChange={e => setForm({ ...form, source_address: e.target.value || null })} className={inputCls + ' mt-2'} placeholder="any" />
                ) : (
                  <select value={form.source_address_group || ''} onChange={e => setForm({ ...form, source_address_group: e.target.value || null })} className={inputCls + ' mt-2'}>
                    <option value="">— select group —</option>
                    {groups.map(g => <option key={g.name} value={g.name}>@{g.name} ({g.addresses.length})</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className={labelCls}>Destination Address</label>
                <select value={dstKind} onChange={e => {
                  const k = e.target.value as 'address' | 'group';
                  setDstKind(k);
                  setForm({ ...form, destination_address: k === 'address' ? form.destination_address : null, destination_address_group: k === 'group' ? form.destination_address_group : null });
                }} className={inputCls}>
                  <option value="address">Address</option>
                  <option value="group">Group</option>
                </select>
                {dstKind === 'address' ? (
                  <input value={form.destination_address || ''} onChange={e => setForm({ ...form, destination_address: e.target.value || null })} className={inputCls + ' mt-2'} placeholder="any (router's WAN IP)" />
                ) : (
                  <select value={form.destination_address_group || ''} onChange={e => setForm({ ...form, destination_address_group: e.target.value || null })} className={inputCls + ' mt-2'}>
                    <option value="">— select group —</option>
                    {groups.map(g => <option key={g.name} value={g.name}>@{g.name} ({g.addresses.length})</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className={labelCls}>Destination Port</label>
                <input value={form.destination_port || ''} onChange={e => setForm({ ...form, destination_port: e.target.value || null })} className={inputCls} placeholder="80" />
              </div>
              <div>
                <label className={labelCls}>Translation Address</label>
                <input value={form.translation_address || ''} onChange={e => setForm({ ...form, translation_address: e.target.value || null })} className={inputCls} placeholder="192.168.1.10" />
              </div>
              <div>
                <label className={labelCls}>Translation Port</label>
                <input value={form.translation_port || ''} onChange={e => setForm({ ...form, translation_port: e.target.value || null })} className={inputCls} placeholder="8080" />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Description</label>
                <input value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value || null })} className={inputCls} placeholder="Web server" />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={form.log ?? false} onChange={e => setForm({ ...form, log: e.target.checked })} className={checkboxCls} />
                <span>Log matching packets</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowForm(false)} disabled={isWorking('save')} className={btnSecondary}>Cancel</button>
              <button onClick={handleSave} disabled={isWorking('save')} className={btnPrimary}>
                {isWorking('save') ? 'Saving…' : editNumber !== null ? 'Save Changes' : 'Add Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      <SourceNatSection ifaceNames={ifaceNames} counters={counters.source} groups={groups} />

      <div className={hintBox}>
        <strong className="text-slate-100">Destination NAT (port forwarding):</strong> incoming traffic to
        <em> destination address:port</em> on the chosen inbound interface is redirected to the
        <em> translation address:port</em>. Don't forget a matching <strong>forward</strong>-chain firewall rule.
      </div>
    </div>
  );
}

const EMPTY_SNAT_RULE: SourceNatRule = {
  number: 100,
  description: null,
  protocol: 'all',
  source_address: null,
  destination_address: null,
  source_address_group: null,
  destination_address_group: null,
  destination_port: null,
  outbound_interface: null,
  translation_address: 'masquerade',
  translation_port: null,
  log: null,
  disabled: false,
};

function SourceNatSection({ ifaceNames, counters, groups }: { ifaceNames: string[]; counters: RuleCounterMap; groups: AddressGroup[] }) {
  const [rules, setRules] = useState<SourceNatRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SourceNatRule>(EMPTY_SNAT_RULE);
  const [editNumber, setEditNumber] = useState<number | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [srcKind, setSrcKind] = useState<'address' | 'group'>('address');
  const [dstKind, setDstKind] = useState<'address' | 'group'>('address');

  const load = () => {
    setLoading(true);
    setErr('');
    getSourceNatRules()
      .then(rs => setRules(rs))
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
    setForm({ ...EMPTY_SNAT_RULE, number: maxNum > 0 ? maxNum + 10 : 100 });
    setEditNumber(null);
    setSrcKind('address');
    setDstKind('address');
    setErr('');
    setMsg('');
    setShowForm(true);
  };

  const openEdit = (rule: SourceNatRule) => {
    setForm({ ...rule, protocol: rule.protocol || 'all' });
    setEditNumber(rule.number);
    setSrcKind(rule.source_address_group ? 'group' : 'address');
    setDstKind(rule.destination_address_group ? 'group' : 'address');
    setErr('');
    setMsg('');
    setShowForm(true);
  };

  const buildRule = (): SourceNatRule => ({
    ...form,
    protocol: form.protocol === 'all' ? null : form.protocol,
    source_address: srcKind === 'address' ? (form.source_address || null) : null,
    source_address_group: srcKind === 'group' ? (form.source_address_group || null) : null,
    destination_address: dstKind === 'address' ? (form.destination_address || null) : null,
    destination_address_group: dstKind === 'group' ? (form.destination_address_group || null) : null,
    destination_port: form.destination_port || null,
    outbound_interface: form.outbound_interface || null,
    translation_address: form.translation_address || null,
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
        await updateSourceNatRule(editNumber, rule);
        setMsg('SNAT rule update staged — review and commit');
      } else {
        await addSourceNatRule(rule);
        setMsg('SNAT rule staged — review and commit');
      }
    } catch (e: any) {
      setErr('Save error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const handleDelete = async (num: number) => {
    if (!confirm(`Delete SNAT rule ${num}?`)) return;
    setWorking('del-' + num);
    setErr('');
    setMsg('');
    setRules(prev => prev.filter(r => r.number !== num));
    try {
      await deleteSourceNatRule(num);
      setMsg('SNAT rule deletion staged — review and commit');
    } catch (e: any) {
      setErr('Delete error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const handleToggle = async (rule: SourceNatRule) => {
    const disabled = !rule.disabled;
    setWorking('toggle-' + rule.number);
    setErr('');
    setMsg('');
    setRules(prev => prev.map(r => r.number === rule.number ? { ...r, disabled } : r));
    try {
      await toggleSourceNatRule(rule.number, disabled);
      setMsg(`SNAT rule ${rule.number} ${disabled ? 'disable' : 'enable'} staged — review and commit`);
    } catch (e: any) {
      setErr('Toggle error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const translationMode = form.translation_address === 'masquerade' ? 'masquerade' : 'address';

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className={pageTitle}>NAT — Source NAT (Masquerade)</h2>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className={btnSecondarySm}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={openAdd} className={btnPrimarySm}>
            + Add Rule
          </button>
        </div>
      </div>

      {err && <div className={alertErr}>{err}</div>}
      {msg && <div className={alertOk}>{msg}</div>}

      {loading && rules.length === 0 ? (
        <div className={loadingRow}>
          <svg className={spinner} viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading SNAT rules…
        </div>
      ) : rules.length === 0 ? (
        <div className={emptyBox}>
          <p className="mb-2">No source NAT rules yet.</p>
          <button onClick={openAdd} className={btnPrimarySm}>Create your first rule</button>
        </div>
      ) : (
        <div className={tableWrap}>
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <th className={thCls}>#</th>
                <th className={thCls}>Outbound Iface</th>
                <th className={thCls}>Proto</th>
                <th className={thCls}>Source</th>
                <th className={thCls}>Destination</th>
                <th className={thCls}>→ Translation</th>
                <th className={thCls}>Description</th>
                <th className={thCls}>Packets</th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody className={tbodyCls}>
              {rules.map(r => {
                const counter = counters[String(r.number)];
                return (
                <tr key={r.number} className={`${trHover} ${r.disabled ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2.5 font-mono text-slate-300">{r.number}</td>
                  <td className="px-4 py-2.5 font-mono text-sm text-slate-300">{r.outbound_interface || 'any'}</td>
                  <td className="px-4 py-2.5 text-sm text-slate-300">{r.protocol || 'all'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">
                    {r.source_address_group
                      ? <span className="text-violet-300">@{r.source_address_group}</span>
                      : r.source_address || 'any'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">
                    {r.destination_address_group
                      ? <span className="text-violet-300">@{r.destination_address_group}</span>
                      : r.destination_address || 'any'}{r.destination_port ? `:${r.destination_port}` : ''}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-emerald-300">
                    {r.translation_address === 'masquerade'
                      ? <span className={`align-middle ${TAG.purple}`}>MASQUERADE</span>
                      : r.translation_address || '-'}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-400">
                    {r.description || '-'}
                    {r.log && <span className={`ml-2 align-middle ${TAG.indigo}`}>LOG</span>}
                    {r.disabled && <span className={`ml-2 align-middle ${TAG.slate}`}>OFF</span>}
                  </td>
                  <td
                    className="px-4 py-2.5 font-mono text-xs text-slate-500 whitespace-nowrap"
                    title={counter ? `${counter.packets.toLocaleString()} packets / ${counter.bytes.toLocaleString()} bytes` : undefined}
                  >
                    {counter ? `${humanCount(counter.packets)} / ${humanBytes(counter.bytes)}` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => handleToggle(r)}
                      disabled={isWorking('toggle-' + r.number)}
                      title={r.disabled ? 'Enable rule' : 'Disable rule'}
                      className={(r.disabled ? linkEnable : linkDisable) + ' mr-3'}
                    >
                      {isWorking('toggle-' + r.number) ? '…' : r.disabled ? 'Enable' : 'Disable'}
                    </button>
                    <button onClick={() => openEdit(r)} className={linkEdit + ' mr-3'}>Edit</button>
                    <button onClick={() => handleDelete(r.number)} disabled={isWorking('del-' + r.number)} className={linkDelete}>
                      {isWorking('del-' + r.number) ? '…' : 'Del'}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className={modalOverlay}>
          <div className={modalCard}>
            <h3 className={modalTitle}>
              {editNumber !== null ? <>Edit SNAT rule <span className="text-indigo-400">#{editNumber}</span></> : 'New Source NAT Rule'}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Rule Number</label>
                <input type="number" value={form.number} onChange={e => setForm({ ...form, number: Number(e.target.value) })} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Protocol</label>
                <select value={form.protocol || 'all'} onChange={e => setForm({ ...form, protocol: e.target.value })} className={inputCls}>
                  <option value="all">all</option>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="tcp_udp">TCP+UDP</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Outbound Interface</label>
                <select value={form.outbound_interface || ''} onChange={e => setForm({ ...form, outbound_interface: e.target.value || null })} className={inputCls}>
                  <option value="">any</option>
                  {ifaceNames.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Source Address</label>
                <select value={srcKind} onChange={e => {
                  const k = e.target.value as 'address' | 'group';
                  setSrcKind(k);
                  setForm({ ...form, source_address: k === 'address' ? form.source_address : null, source_address_group: k === 'group' ? form.source_address_group : null });
                }} className={inputCls}>
                  <option value="address">Address</option>
                  <option value="group">Group</option>
                </select>
                {srcKind === 'address' ? (
                  <input value={form.source_address || ''} onChange={e => setForm({ ...form, source_address: e.target.value || null })} className={inputCls + ' mt-2'} placeholder="192.168.1.0/24" />
                ) : (
                  <select value={form.source_address_group || ''} onChange={e => setForm({ ...form, source_address_group: e.target.value || null })} className={inputCls + ' mt-2'}>
                    <option value="">— select group —</option>
                    {groups.map(g => <option key={g.name} value={g.name}>@{g.name} ({g.addresses.length})</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className={labelCls}>Destination Address</label>
                <select value={dstKind} onChange={e => {
                  const k = e.target.value as 'address' | 'group';
                  setDstKind(k);
                  setForm({ ...form, destination_address: k === 'address' ? form.destination_address : null, destination_address_group: k === 'group' ? form.destination_address_group : null });
                }} className={inputCls}>
                  <option value="address">Address</option>
                  <option value="group">Group</option>
                </select>
                {dstKind === 'address' ? (
                  <input value={form.destination_address || ''} onChange={e => setForm({ ...form, destination_address: e.target.value || null })} className={inputCls + ' mt-2'} placeholder="any" />
                ) : (
                  <select value={form.destination_address_group || ''} onChange={e => setForm({ ...form, destination_address_group: e.target.value || null })} className={inputCls + ' mt-2'}>
                    <option value="">— select group —</option>
                    {groups.map(g => <option key={g.name} value={g.name}>@{g.name} ({g.addresses.length})</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className={labelCls}>Destination Port</label>
                <input value={form.destination_port || ''} onChange={e => setForm({ ...form, destination_port: e.target.value || null })} className={inputCls} placeholder="any" />
              </div>
              <div>
                <label className={labelCls}>Translation</label>
                <select
                  value={translationMode}
                  onChange={e => setForm({ ...form, translation_address: e.target.value === 'masquerade' ? 'masquerade' : '' })}
                  className={inputCls}
                >
                  <option value="masquerade">Masquerade</option>
                  <option value="address">Address</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Translation Address</label>
                <input
                  value={translationMode === 'masquerade' ? '' : form.translation_address || ''}
                  onChange={e => setForm({ ...form, translation_address: e.target.value || null })}
                  disabled={translationMode === 'masquerade'}
                  className={inputCls}
                  placeholder="203.0.113.5"
                />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Description</label>
                <input value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value || null })} className={inputCls} placeholder="LAN to WAN masquerade" />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={form.log ?? false} onChange={e => setForm({ ...form, log: e.target.checked })} className={checkboxCls} />
                <span>Log matching packets</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowForm(false)} disabled={isWorking('save')} className={btnSecondary}>Cancel</button>
              <button onClick={handleSave} disabled={isWorking('save')} className={btnPrimary}>
                {isWorking('save') ? 'Saving…' : editNumber !== null ? 'Save Changes' : 'Add Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={hintBox}>
        <strong className="text-slate-100">Source NAT (masquerade / SNAT):</strong> outgoing traffic from
        <em> source address</em> leaving via the chosen outbound interface gets its source rewritten to
        <em> translation address</em>. Use <strong>masquerade</strong> to let LAN hosts reach the internet.
      </div>
    </div>
  );
}

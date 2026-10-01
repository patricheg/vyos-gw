import { useEffect, useState } from 'react';
import { getAddressGroups, addAddressGroup, updateAddressGroup, deleteAddressGroup } from '../api/client';
import type { AddressGroup } from '../types';
import {
  pageTitle, btnSecondarySm, btnPrimary, btnPrimarySm, btnSecondary, inputCls, labelCls, hintText,
  TAG, alertErr, alertOk, modalOverlay, modalCard, modalTitle,
  linkEdit, linkDelete, loadingRow, spinner, hintBox, emptyBox, cardPad,
} from '../ui';

export default function AddressGroupsPage() {
  const [groups, setGroups] = useState<AddressGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editGroup, setEditGroup] = useState<string | null>(null);
  const [groupForm, setGroupForm] = useState({ name: '', description: '', addresses: '' });

  const load = () => {
    setLoading(true);
    setErr('');
    getAddressGroups()
      .then(setGroups)
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

  const openAddGroup = () => {
    setGroupForm({ name: '', description: '', addresses: '' });
    setEditGroup(null);
    setErr(''); setMsg('');
    setShowGroupForm(true);
  };

  const openEditGroup = (g: AddressGroup) => {
    setGroupForm({ name: g.name, description: g.description || '', addresses: g.addresses.join('\n') });
    setEditGroup(g.name);
    setErr(''); setMsg('');
    setShowGroupForm(true);
  };

  const handleSaveGroup = async () => {
    setErr(''); setMsg('');
    const group: AddressGroup = {
      name: groupForm.name.trim(),
      description: groupForm.description.trim() || null,
      addresses: groupForm.addresses.split('\n').map(a => a.trim()).filter(Boolean),
    };
    if (!group.name) { setErr('Group name is required'); return; }
    if (group.addresses.length === 0) { setErr('Add at least one address (IP, CIDR or range)'); return; }
    setWorking('save-group');
    try {
      if (editGroup !== null) {
        await updateAddressGroup(editGroup, group);
        setMsg('Address group update staged — review and commit');
      } else {
        await addAddressGroup(group);
        setMsg('Address group staged — review and commit');
      }
      setGroups(prev => [...prev.filter(g => g.name !== editGroup && g.name !== group.name), group]
        .sort((a, b) => a.name.localeCompare(b.name)));
      setShowGroupForm(false);
    } catch (e: any) {
      setErr('Save error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const handleDeleteGroup = async (name: string) => {
    if (!confirm(`Delete address group ${name}?`)) return;
    setWorking('del-group-' + name);
    setErr(''); setMsg('');
    try {
      await deleteAddressGroup(name);
      setGroups(prev => prev.filter(g => g.name !== name));
      setMsg('Address group deletion staged — review and commit');
    } catch (e: any) {
      setErr('Delete error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className={pageTitle}>Address Groups</h2>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className={btnSecondarySm}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={openAddGroup} className={btnPrimarySm}>+ Add Group</button>
        </div>
      </div>

      {err && <div className={alertErr}>{err}</div>}
      {msg && <div className={alertOk}>{msg}</div>}

      {loading && groups.length === 0 ? (
        <div className={loadingRow}>
          <svg className={spinner} viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading address groups…
        </div>
      ) : groups.length === 0 ? (
        <div className={emptyBox}>
          No address groups yet — groups let you reuse the same address list in many rules.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {groups.map(g => (
            <div key={g.name} className={cardPad}>
              <div className="flex items-center justify-between mb-1.5">
                <div>
                  <span className="font-mono text-violet-300 font-semibold">@{g.name}</span>
                  <span className={`ml-2 align-middle ${TAG.slate}`}>
                    {g.addresses.length} addr
                  </span>
                </div>
                <div className="whitespace-nowrap">
                  <button onClick={() => openEditGroup(g)} className={linkEdit + ' mr-3'}>Edit</button>
                  <button onClick={() => handleDeleteGroup(g.name)} disabled={isWorking('del-group-' + g.name)} className={linkDelete}>
                    {isWorking('del-group-' + g.name) ? '…' : 'Del'}
                  </button>
                </div>
              </div>
              {g.description && <div className="text-xs text-slate-400 mb-1.5">{g.description}</div>}
              <div className="flex flex-wrap gap-1">
                {g.addresses.slice(0, 8).map(a => (
                  <span key={a} className="px-1.5 py-0.5 bg-slate-900 rounded-md text-[11px] font-mono text-slate-300 border border-slate-700/60">{a}</span>
                ))}
                {g.addresses.length > 8 && <span className="px-1.5 py-0.5 text-[11px] text-slate-500">+{g.addresses.length - 8} more</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Help box */}
      <div className={hintBox}>
        <strong className="text-slate-100">How it works:</strong>
        <ol className="list-decimal list-inside mt-1 space-y-0.5">
          <li>A group is a named list of IPs, networks (CIDR) or ranges.</li>
          <li>Groups are reused in firewall rules — pick <strong>address group</strong> in the Source/Destination selector; the rule shows them as <span className="font-mono text-violet-300">@group</span>.</li>
          <li>The same groups can be used in NAT rules (source/destination address group).</li>
          <li>Changes are applied via the <strong>pending changes</strong> panel on top — review and commit there.</li>
        </ol>
      </div>

      {/* Address group modal */}
      {showGroupForm && (
        <div className={modalOverlay}>
          <div className={modalCard}>
            <h3 className={modalTitle}>
              {editGroup !== null ? <>Edit group <span className="text-violet-400">@{editGroup}</span></> : 'New Address Group'}
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Name</label>
                  <input value={groupForm.name} onChange={e => setGroupForm({ ...groupForm, name: e.target.value })} disabled={editGroup !== null} className={inputCls} placeholder="office-nets" />
                </div>
                <div>
                  <label className={labelCls}>Description</label>
                  <input value={groupForm.description} onChange={e => setGroupForm({ ...groupForm, description: e.target.value })} className={inputCls} placeholder="Trusted networks" />
                </div>
              </div>
              <div>
                <label className={labelCls}>Addresses (one per line)</label>
                <textarea
                  value={groupForm.addresses}
                  onChange={e => setGroupForm({ ...groupForm, addresses: e.target.value })}
                  rows={6}
                  className={inputCls + ' font-mono text-sm'}
                  placeholder={'10.0.0.0/24\n192.168.1.10\n172.16.0.10-172.16.0.20'}
                />
                <p className={hintText}>IP, network (CIDR) or range (10.0.0.1-10.0.0.9) — one per line</p>
              </div>
            </div>
            {err && <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">{err}</div>}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowGroupForm(false)} disabled={isWorking('save-group')} className={btnSecondary}>Cancel</button>
              <button onClick={handleSaveGroup} disabled={isWorking('save-group')} className={btnPrimary}>
                {isWorking('save-group') ? 'Saving…' : editGroup !== null ? 'Save Changes' : 'Add Group'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

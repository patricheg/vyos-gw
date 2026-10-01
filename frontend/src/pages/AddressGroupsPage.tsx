import { useEffect, useState } from 'react';
import { getAddressGroups, addAddressGroup, updateAddressGroup, deleteAddressGroup } from '../api/client';
import type { AddressGroup } from '../types';

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
        <h2 className="text-2xl font-bold">Address Groups</h2>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={openAddGroup} className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-500 text-sm text-white font-medium">+ Add Group</button>
        </div>
      </div>

      {err && <div className="mb-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
      {msg && <div className="mb-4 p-3 bg-green-900/50 rounded border border-green-700 text-sm text-green-200">{msg}</div>}

      {loading && groups.length === 0 ? (
        <div className="flex items-center gap-2 text-gray-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading address groups…
        </div>
      ) : groups.length === 0 ? (
        <div className="p-4 border border-dashed border-gray-600 rounded-lg text-center text-gray-400 text-sm">
          No address groups yet — groups let you reuse the same address list in many rules.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {groups.map(g => (
            <div key={g.name} className="p-3 bg-gray-800 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between mb-1.5">
                <div>
                  <span className="font-mono text-violet-300 font-semibold">@{g.name}</span>
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-700 text-gray-300 align-middle">
                    {g.addresses.length} addr
                  </span>
                </div>
                <div className="whitespace-nowrap">
                  <button onClick={() => openEditGroup(g)} className="text-blue-400 hover:text-blue-300 text-sm mr-3">Edit</button>
                  <button onClick={() => handleDeleteGroup(g.name)} disabled={isWorking('del-group-' + g.name)} className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50">
                    {isWorking('del-group-' + g.name) ? '…' : 'Del'}
                  </button>
                </div>
              </div>
              {g.description && <div className="text-xs text-gray-400 mb-1.5">{g.description}</div>}
              <div className="flex flex-wrap gap-1">
                {g.addresses.slice(0, 8).map(a => (
                  <span key={a} className="px-1.5 py-0.5 bg-gray-900 rounded text-[11px] font-mono text-gray-300 border border-gray-700">{a}</span>
                ))}
                {g.addresses.length > 8 && <span className="px-1.5 py-0.5 text-[11px] text-gray-500">+{g.addresses.length - 8} more</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Help box */}
      <div className="mt-6 p-3 bg-gray-800/80 rounded border border-gray-700 text-sm text-gray-300">
        <strong className="text-white">How it works:</strong>
        <ol className="list-decimal list-inside mt-1 space-y-0.5">
          <li>A group is a named list of IPs, networks (CIDR) or ranges.</li>
          <li>Groups are reused in firewall rules — pick <strong>address group</strong> in the Source/Destination selector; the rule shows them as <span className="font-mono text-violet-300">@group</span>.</li>
          <li>The same groups can be used in NAT rules (source/destination address group).</li>
          <li>Changes are applied via the yellow <strong>pending changes</strong> panel on top — review and commit there.</li>
        </ol>
      </div>

      {/* Address group modal */}
      {showGroupForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg border border-gray-700 shadow-xl">
            <h3 className="text-lg font-bold mb-4">
              {editGroup !== null ? <>Edit group <span className="text-violet-400">@{editGroup}</span></> : 'New Address Group'}
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Name</label>
                  <input value={groupForm.name} onChange={e => setGroupForm({ ...groupForm, name: e.target.value })} disabled={editGroup !== null} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500 disabled:opacity-50" placeholder="office-nets" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Description</label>
                  <input value={groupForm.description} onChange={e => setGroupForm({ ...groupForm, description: e.target.value })} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500" placeholder="Trusted networks" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Addresses (one per line)</label>
                <textarea
                  value={groupForm.addresses}
                  onChange={e => setGroupForm({ ...groupForm, addresses: e.target.value })}
                  rows={6}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500 font-mono text-sm"
                  placeholder={'10.0.0.0/24\n192.168.1.10\n172.16.0.10-172.16.0.20'}
                />
                <p className="text-xs text-gray-500 mt-1">IP, network (CIDR) or range (10.0.0.1-10.0.0.9) — one per line</p>
              </div>
            </div>
            {err && <div className="mt-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowGroupForm(false)} disabled={isWorking('save-group')} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleSaveGroup} disabled={isWorking('save-group')} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
                {isWorking('save-group') ? 'Saving…' : editGroup !== null ? 'Save Changes' : 'Add Group'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

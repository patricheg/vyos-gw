import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getChains, setDefaultAction, addRule, updateRule, deleteRule, reorderChain, getAddressGroups, addAddressGroup, updateAddressGroup, deleteAddressGroup } from '../api/client';
import type { FirewallRuleset, FirewallRule, AddressGroup } from '../types';

const POPULAR_PORTS = [
  { label: 'Custom', value: 'custom' },
  { label: 'HTTP (80)', value: '80' },
  { label: 'HTTPS (443)', value: '443' },
  { label: 'SSH (22)', value: '22' },
  { label: 'DNS (53)', value: '53' },
  { label: 'SMTP (25)', value: '25' },
  { label: 'RDP (3389)', value: '3389' },
  { label: 'Telnet (23)', value: '23' },
  { label: 'FTP (21)', value: '21' },
  { label: 'PostgreSQL (5432)', value: '5432' },
  { label: 'MySQL (3306)', value: '3306' },
  { label: 'Redis (6379)', value: '6379' },
  { label: 'Elasticsearch (9200)', value: '9200' },
];

const CHAIN_INFO: Record<string, string> = {
  input: 'Traffic to the router itself (SSH, API, ping)',
  forward: 'Transit traffic passing through the router',
  output: 'Traffic the router generates',
};

interface SortableRuleProps {
  rule: FirewallRule;
  chainName: string;
  onDelete: (chain: string, num: number) => void;
  onEdit: (chain: string, rule: FirewallRule) => void;
  isWorking: (key: string) => boolean;
}

function SortableRuleItem({ rule, chainName, onDelete, onEdit, isWorking }: SortableRuleProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rule.number });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.9 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-800/30 ${isDragging ? 'bg-gray-800/60 shadow-lg ring-1 ring-blue-500/30' : ''}`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-300"
        title="Drag to reorder"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" /></svg>
      </div>
      <div className="font-mono w-8 text-gray-300">{rule.number}</div>
      <div className="w-20">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${rule.action === 'accept' ? 'bg-green-900 text-green-300' : rule.action === 'drop' ? 'bg-red-900 text-red-300' : 'bg-yellow-900 text-yellow-300'}`}>
          {rule.action}
        </span>
      </div>
      <div className="w-16 text-gray-300">{rule.protocol || 'all'}</div>
      <div className="w-32 font-mono text-xs text-gray-400 truncate" title={rule.source_group ? `group: ${rule.source_group}` : rule.source_geoip ? `geoip: ${rule.source_geoip_inverse ? 'all except ' : ''}${rule.source_geoip.join(', ')}` : undefined}>
        {rule.source_group
          ? <span className="text-violet-300">@{rule.source_group}</span>
          : rule.source_geoip?.length
            ? <span className="text-amber-300">geo:{rule.source_geoip_inverse ? '!' : ''}{rule.source_geoip.join(',')}</span>
            : rule.source_address || 'any'}{rule.source_port ? `:${rule.source_port}` : ''}
      </div>
      <div className="w-32 font-mono text-xs text-gray-400 truncate" title={rule.destination_group ? `group: ${rule.destination_group}` : rule.destination_geoip ? `geoip: ${rule.destination_geoip_inverse ? 'all except ' : ''}${rule.destination_geoip.join(', ')}` : undefined}>
        {rule.destination_group
          ? <span className="text-violet-300">@{rule.destination_group}</span>
          : rule.destination_geoip?.length
            ? <span className="text-amber-300">geo:{rule.destination_geoip_inverse ? '!' : ''}{rule.destination_geoip.join(',')}</span>
            : rule.destination_address || 'any'}{rule.destination_port ? `:${rule.destination_port}` : ''}
      </div>
      <div className="flex-1 text-gray-400 truncate">
        {rule.description || '-'}
        {rule.log && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-900 text-blue-300 align-middle">LOG</span>}
      </div>
      <button
        onClick={() => onEdit(chainName, rule)}
        disabled={isWorking('edit-rule-' + rule.number)}
        className="text-blue-400 hover:text-blue-300 text-xs disabled:opacity-50"
      >
        Edit
      </button>
      <button
        onClick={() => onDelete(chainName, rule.number)}
        disabled={isWorking('delete-rule-' + rule.number)}
        className="text-red-400 hover:text-red-300 text-xs disabled:opacity-50"
      >
        {isWorking('delete-rule-' + rule.number) ? '…' : 'Del'}
      </button>
    </div>
  );
}

export default function FirewallPage() {
  const [chains, setChains] = useState<FirewallRuleset[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [activeChain, setActiveChain] = useState<string | null>(null);
  const [newRule, setNewRule] = useState<Partial<FirewallRule>>({
    number: 10, action: 'accept', protocol: 'tcp',
  });
  const [destPortOption, setDestPortOption] = useState<string>('custom');
  const [showAddRule, setShowAddRule] = useState(false);
  const [editContext, setEditContext] = useState<{ chain: string; oldNumber: number } | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const [groups, setGroups] = useState<AddressGroup[]>([]);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editGroup, setEditGroup] = useState<string | null>(null);
  const [groupForm, setGroupForm] = useState({ name: '', description: '', addresses: '' });
  const [srcKind, setSrcKind] = useState<'any' | 'address' | 'group' | 'geoip'>('any');
  const [dstKind, setDstKind] = useState<'any' | 'address' | 'group' | 'geoip'>('any');
  const [srcGeoip, setSrcGeoip] = useState('');
  const [srcGeoipInv, setSrcGeoipInv] = useState(false);
  const [dstGeoip, setDstGeoip] = useState('');
  const [dstGeoipInv, setDstGeoipInv] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = () => {
    setLoading(true);
    setErr('');
    getChains()
      .then(setChains)
      .catch(e => setErr('Load error: ' + e.message))
      .finally(() => setLoading(false));
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

  const handleDefaultAction = async (chain: FirewallRuleset) => {
    const next = chain.default_action === 'drop' ? 'accept' : 'drop';
    setWorking('defact-' + chain.name);
    setErr('');
    setMsg('');
    setChains(prev => prev.map(c => c.name === chain.name ? { ...c, default_action: next } : c));
    try {
      await setDefaultAction(chain.name, next);
      setMsg(`Default action for ${chain.name} staged — review and commit`);
    } catch (e: any) {
      setErr('Default action error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const parseGeoip = (text: string): string[] | null => {
    const codes = text.split(/[\s,]+/).map(c => c.trim().toLowerCase()).filter(Boolean);
    return codes.length > 0 ? [...new Set(codes)].sort() : null;
  };

  const buildRule = (fallbackNumber: number): FirewallRule => ({
    number: newRule.number ?? fallbackNumber,
    action: (newRule.action as 'accept' | 'drop' | 'reject') ?? 'accept',
    protocol: newRule.protocol === 'all' ? null : (newRule.protocol || null),
    source_address: srcKind === 'address' ? (newRule.source_address || null) : null,
    destination_address: dstKind === 'address' ? (newRule.destination_address || null) : null,
    source_group: srcKind === 'group' ? (newRule.source_group || null) : null,
    destination_group: dstKind === 'group' ? (newRule.destination_group || null) : null,
    source_geoip: srcKind === 'geoip' ? parseGeoip(srcGeoip) : null,
    source_geoip_inverse: srcKind === 'geoip' ? srcGeoipInv : false,
    destination_geoip: dstKind === 'geoip' ? parseGeoip(dstGeoip) : null,
    destination_geoip_inverse: dstKind === 'geoip' ? dstGeoipInv : false,
    source_port: newRule.source_port || null,
    destination_port: newRule.destination_port || null,
    description: newRule.description || null,
    log: newRule.log ?? null,
    state_established: newRule.state_established ?? null,
    state_related: newRule.state_related ?? null,
    state_new: newRule.state_new ?? null,
  });

  const handleAddRule = async () => {
    if (!activeChain) return;
    const problem = ruleProblem();
    if (problem) { setErr(problem); return; }
    setWorking('add-rule');
    setErr('');
    setMsg('');

    const rule = buildRule(newRule.number ?? 10);

    setChains(prev => prev.map(c => {
      if (c.name !== activeChain) return c;
      const exists = c.rules.find(r => r.number === rule.number);
      if (exists) {
        return { ...c, rules: c.rules.map(r => r.number === rule.number ? rule : r) };
      }
      return { ...c, rules: [...c.rules, rule] };
    }));
    setShowAddRule(false);
    setNewRule({ number: 10, action: 'accept', protocol: 'tcp' });
    setDestPortOption('custom');

    try {
      await addRule(activeChain, rule);
      setMsg('Rule staged — review and commit');
    } catch (e: any) {
      setErr('Add rule error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const handleUpdateRule = async () => {
    if (!editContext) return;
    const { chain, oldNumber } = editContext;
    const problem = ruleProblem();
    if (problem) { setErr(problem); return; }
    setWorking('edit-rule-' + oldNumber);
    setErr('');
    setMsg('');

    const rule = buildRule(oldNumber);

    // Optimistic update: drop old number, insert edited rule, keep numeric order
    setChains(prev => prev.map(c => {
      if (c.name !== chain) return c;
      const rules = c.rules
        .filter(r => r.number !== oldNumber && r.number !== rule.number)
        .concat(rule)
        .sort((a, b) => a.number - b.number);
      return { ...c, rules };
    }));
    setShowAddRule(false);
    setEditContext(null);

    try {
      await updateRule(chain, oldNumber, rule);
      setMsg('Rule update staged — review and commit');
    } catch (e: any) {
      setErr('Update rule error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const handleDeleteRule = async (chain: string, num: number) => {
    if (!confirm(`Delete rule ${num} from "${chain}"?`)) return;
    setWorking('delete-rule-' + num);
    setErr('');
    setMsg('');

    setChains(prev => prev.map(c =>
      c.name === chain
        ? { ...c, rules: c.rules.filter(r => r.number !== num) }
        : c
    ));

    try {
      await deleteRule(chain, num);
      setMsg('Rule deletion staged — review and commit');
    } catch (e: any) {
      setErr('Delete rule error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const handleDragEnd = async (chainName: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const chain = chains.find(c => c.name === chainName);
    if (!chain) return;

    const oldIndex = chain.rules.findIndex(r => r.number === active.id);
    const newIndex = chain.rules.findIndex(r => r.number === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const newRules = arrayMove(chain.rules, oldIndex, newIndex);
    setChains(prev => prev.map(c => c.name === chainName ? { ...c, rules: newRules } : c));

    const orderedNumbers = newRules.map(r => r.number);
    setWorking('reorder-' + chainName);
    try {
      await reorderChain(chainName, orderedNumbers);
      setMsg('New order staged — review and commit');
      // Do NOT reload here: the new order lives in staging, not in the
      // router config yet — reloading would revert the list visually.
    } catch (e: any) {
      setErr('Reorder error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const isWorking = (key: string) => working === key;

  const openAddRule = (chainName: string) => {
    const chain = chains.find(c => c.name === chainName);
    const maxNum = chain && chain.rules.length > 0 ? Math.max(...chain.rules.map(r => r.number)) : 0;
    const nextNum = maxNum > 0 ? maxNum + 10 : 10;
    setActiveChain(chainName);
    setNewRule({ number: nextNum, action: 'accept', protocol: 'tcp' });
    setDestPortOption('custom');
    setSrcKind('any');
    setDstKind('any');
    setSrcGeoip(''); setSrcGeoipInv(false);
    setDstGeoip(''); setDstGeoipInv(false);
    setEditContext(null);
    setErr('');
    setMsg('');
    setShowAddRule(true);
  };

  const openEditRule = (chainName: string, rule: FirewallRule) => {
    setActiveChain(chainName);
    setNewRule({ ...rule, protocol: rule.protocol || 'all' });
    setDestPortOption(
      rule.destination_port && POPULAR_PORTS.some(p => p.value === rule.destination_port)
        ? rule.destination_port
        : 'custom'
    );
    setSrcKind(rule.source_geoip?.length ? 'geoip' : rule.source_group ? 'group' : rule.source_address ? 'address' : 'any');
    setDstKind(rule.destination_geoip?.length ? 'geoip' : rule.destination_group ? 'group' : rule.destination_address ? 'address' : 'any');
    setSrcGeoip((rule.source_geoip || []).join(', '));
    setSrcGeoipInv(rule.source_geoip_inverse);
    setDstGeoip((rule.destination_geoip || []).join(', '));
    setDstGeoipInv(rule.destination_geoip_inverse);
    setEditContext({ chain: chainName, oldNumber: rule.number });
    setErr('');
    setMsg('');
    setShowAddRule(true);
  };

  const ruleProblem = (): string | null => {
    if (srcKind === 'group' && !newRule.source_group) return 'Select a source address group';
    if (dstKind === 'group' && !newRule.destination_group) return 'Select a destination address group';
    const geoipProblem = (text: string, side: string): string | null => {
      const codes = parseGeoip(text);
      if (!codes) return `${side}: enter at least one country code (e.g. by, ru, de)`;
      const bad = codes.find(c => !/^[a-z]{2}$/.test(c));
      if (bad) return `${side}: '${bad}' is not a 2-letter country code`;
      return null;
    };
    if (srcKind === 'geoip') { const p = geoipProblem(srcGeoip, 'Source'); if (p) return p; }
    if (dstKind === 'geoip') { const p = geoipProblem(dstGeoip, 'Destination'); if (p) return p; }
    return null;
  };

  // ─── Address groups ───────────────────────────────────────────

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
        <h2 className="text-2xl font-bold">Firewall</h2>
        <button onClick={load} disabled={loading} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm disabled:opacity-50">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Help box */}
      <div className="mb-4 p-3 bg-gray-800/80 rounded border border-gray-700 text-sm text-gray-300">
        <strong className="text-white">How it works (VyOS 1.5, no zones):</strong>
        <ol className="list-decimal list-inside mt-1 space-y-0.5">
          <li><strong>Input</strong> filters traffic to the router itself — protect SSH/API here.</li>
          <li><strong>Forward</strong> filters transit traffic passing through the router.</li>
          <li><strong>Output</strong> filters traffic the router generates.</li>
          <li>Rules are checked in number order, first match wins. Unmatched traffic hits the chain's <strong>default action</strong>.</li>
          <li>Everything is applied via the yellow <strong>pending changes</strong> panel on top — review and commit there.</li>
        </ol>
      </div>

      {err && <div className="mb-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
      {msg && <div className="mb-4 p-3 bg-green-900/50 rounded border border-green-700 text-sm text-green-200">{msg}</div>}

      {/* Address groups */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold">Address groups</h3>
          <button onClick={openAddGroup} className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-500 text-sm text-white font-medium">+ Add Group</button>
        </div>
        {groups.length === 0 ? (
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
      </div>

      {loading && chains.length === 0 ? (
        <div className="flex items-center gap-2 text-gray-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading firewall…
        </div>
      ) : (
        <div className="space-y-6">
          {chains.map(chain => (
            <div key={chain.name} className="border border-gray-700 rounded-lg overflow-hidden">
              <div className="bg-gray-800 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-white uppercase">{chain.name}</span>
                  <span className="text-sm text-gray-400">{CHAIN_INFO[chain.name]}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleDefaultAction(chain)}
                    disabled={isWorking('defact-' + chain.name)}
                    title="Click to toggle (staged)"
                    className={`text-xs px-2 py-0.5 rounded font-medium disabled:opacity-50 ${chain.default_action === 'accept' ? 'bg-green-900 text-green-300' : chain.default_action === 'drop' ? 'bg-red-900 text-red-300' : 'bg-yellow-900 text-yellow-300'}`}
                  >
                    default: {chain.default_action} ⇄
                  </button>
                  <button
                    onClick={() => openAddRule(chain.name)}
                    disabled={isWorking('add-rule')}
                    className="text-xs px-3 py-1.5 bg-green-600 rounded hover:bg-green-500 text-white font-medium disabled:opacity-50"
                  >
                    {isWorking('add-rule') ? 'Adding…' : '+ Add Rule'}
                  </button>
                </div>
              </div>
              {chain.rules.length > 0 ? (
                <div className="divide-y divide-gray-700/50">
                  {/* Header */}
                  <div className="flex items-center gap-3 px-4 py-2 bg-gray-800/50 text-xs uppercase text-gray-400 font-medium">
                    <div className="w-6"></div>
                    <div className="w-8">#</div>
                    <div className="w-20">Action</div>
                    <div className="w-16">Proto</div>
                    <div className="w-32">Source</div>
                    <div className="w-32">Destination</div>
                    <div className="flex-1">Description</div>
                    <div></div>
                  </div>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(chain.name, e)}>
                    <SortableContext items={chain.rules.map(r => r.number)} strategy={verticalListSortingStrategy}>
                      {chain.rules.map(rule => (
                        <SortableRuleItem
                          key={rule.number}
                          rule={rule}
                          chainName={chain.name}
                          onDelete={handleDeleteRule}
                          onEdit={openEditRule}
                          isWorking={isWorking}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              ) : (
                <div className="px-4 py-4 text-sm text-gray-400 flex items-center justify-between">
                  <span>No rules — everything hits the default action ({chain.default_action}).</span>
                  <button
                    onClick={() => openAddRule(chain.name)}
                    disabled={isWorking('add-rule')}
                    className="text-xs px-2 py-1 bg-green-700 rounded hover:bg-green-600 text-white disabled:opacity-50"
                  >
                    + Add Rule
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddRule && activeChain && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg border border-gray-700 shadow-xl">
            <h3 className="text-lg font-bold mb-4">
              {editContext
                ? <>Edit rule <span className="text-blue-400">#{editContext.oldNumber}</span> in <span className="text-blue-400 uppercase">{editContext.chain}</span></>
                : <>Add Rule to <span className="text-blue-400 uppercase">{activeChain}</span></>}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Rule Number</label>
                <input type="number" value={newRule.number} onChange={e => setNewRule({...newRule, number: Number(e.target.value)})} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500" />
                <p className="text-xs text-gray-500 mt-1">Auto-suggested next available</p>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Action</label>
                <select value={newRule.action} onChange={e => setNewRule({...newRule, action: e.target.value as any})} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500">
                  <option value="accept">accept (allow)</option>
                  <option value="drop">drop (silent deny)</option>
                  <option value="reject">reject (deny + reply)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Protocol</label>
                <select value={newRule.protocol || 'tcp'} onChange={e => setNewRule({...newRule, protocol: e.target.value})} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500">
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="icmp">ICMP</option>
                  <option value="all">all</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Source</label>
                <select value={srcKind} onChange={e => setSrcKind(e.target.value as 'any' | 'address' | 'group' | 'geoip')} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500">
                  <option value="any">any</option>
                  <option value="address">address / network</option>
                  <option value="group">address group</option>
                  <option value="geoip">geoip (countries)</option>
                </select>
                {srcKind === 'address' && (
                  <input value={newRule.source_address || ''} onChange={e => setNewRule({...newRule, source_address: e.target.value || null})} className="w-full mt-2 px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500" placeholder="10.0.0.0/24" />
                )}
                {srcKind === 'group' && (
                  <select value={newRule.source_group || ''} onChange={e => setNewRule({...newRule, source_group: e.target.value || null})} className="w-full mt-2 px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500">
                    <option value="">— select group —</option>
                    {groups.map(g => <option key={g.name} value={g.name}>@{g.name} ({g.addresses.length})</option>)}
                  </select>
                )}
                {srcKind === 'geoip' && (
                  <div className="mt-2 space-y-1.5">
                    <input value={srcGeoip} onChange={e => setSrcGeoip(e.target.value)} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500 font-mono" placeholder="by, ru, de" />
                    <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={srcGeoipInv} onChange={e => setSrcGeoipInv(e.target.checked)} />
                      <span>inverse — all countries EXCEPT these</span>
                    </label>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Destination</label>
                <select value={dstKind} onChange={e => setDstKind(e.target.value as 'any' | 'address' | 'group' | 'geoip')} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500">
                  <option value="any">any</option>
                  <option value="address">address / network</option>
                  <option value="group">address group</option>
                  <option value="geoip">geoip (countries)</option>
                </select>
                {dstKind === 'address' && (
                  <input value={newRule.destination_address || ''} onChange={e => setNewRule({...newRule, destination_address: e.target.value || null})} className="w-full mt-2 px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500" placeholder="10.0.0.5" />
                )}
                {dstKind === 'group' && (
                  <select value={newRule.destination_group || ''} onChange={e => setNewRule({...newRule, destination_group: e.target.value || null})} className="w-full mt-2 px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500">
                    <option value="">— select group —</option>
                    {groups.map(g => <option key={g.name} value={g.name}>@{g.name} ({g.addresses.length})</option>)}
                  </select>
                )}
                {dstKind === 'geoip' && (
                  <div className="mt-2 space-y-1.5">
                    <input value={dstGeoip} onChange={e => setDstGeoip(e.target.value)} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500 font-mono" placeholder="by, ru, de" />
                    <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer">
                      <input type="checkbox" checked={dstGeoipInv} onChange={e => setDstGeoipInv(e.target.checked)} />
                      <span>inverse — all countries EXCEPT these</span>
                    </label>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Dest Port</label>
                <select
                  value={destPortOption}
                  onChange={e => {
                    const val = e.target.value;
                    setDestPortOption(val);
                    if (val !== 'custom') {
                      setNewRule({...newRule, destination_port: val});
                    } else {
                      setNewRule({...newRule, destination_port: null});
                    }
                  }}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500"
                >
                  {POPULAR_PORTS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                {destPortOption === 'custom' && (
                  <input
                    value={newRule.destination_port || ''}
                    onChange={e => setNewRule({...newRule, destination_port: e.target.value || null})}
                    className="w-full mt-2 px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500"
                    placeholder="22 / 80,443 / 1-65535"
                  />
                )}
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <input value={newRule.description || ''} onChange={e => setNewRule({...newRule, description: e.target.value || null})} className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500" placeholder="Allow SSH from office" />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={newRule.log ?? false} onChange={e => setNewRule({...newRule, log: e.target.checked})} />
                <span>Log matching packets <span className="text-gray-500">(visible on the Logs page, source «firewall»)</span></span>
              </label>
            </div>
            {err && <div className="mt-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => { setShowAddRule(false); setEditContext(null); }} disabled={isWorking('add-rule')} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={editContext ? handleUpdateRule : handleAddRule} disabled={isWorking('add-rule')} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
                {isWorking('add-rule') ? 'Saving…' : editContext ? 'Save Changes' : 'Add Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

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

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
import { getChains, setDefaultAction, addRule, updateRule, deleteRule, reorderChain, getAddressGroups, getFirewallCounters } from '../api/client';
import type { FirewallRuleset, FirewallRule, AddressGroup, FirewallCounters, RuleCounter } from '../types';
import { humanCount, humanBytes } from '../format';
import {
  pageTitle, btnSecondarySm, btnPrimary, btnSecondary, btnSuccessSm, inputCls, labelCls, hintText,
  badgeGreen, badgeRed, badgeAmber, TAG, alertErr, alertOk, modalOverlay, modalCard, modalTitle,
  linkEdit, linkDelete, loadingRow, spinner, hintBox, checkboxCls, card,
} from '../ui';

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
  counter?: RuleCounter;
  onDelete: (chain: string, num: number) => void;
  onEdit: (chain: string, rule: FirewallRule) => void;
  isWorking: (key: string) => boolean;
}

function SortableRuleItem({ rule, chainName, counter, onDelete, onEdit, isWorking }: SortableRuleProps) {
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
      className={`flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-800/40 transition-colors ${isDragging ? 'bg-slate-800/80 shadow-lg ring-1 ring-indigo-500/40 rounded-lg' : ''}`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300"
        title="Drag to reorder"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" /></svg>
      </div>
      <div className="font-mono w-8 text-slate-300">{rule.number}</div>
      <div className="w-20">
        <span className={rule.action === 'accept' ? badgeGreen : rule.action === 'drop' ? badgeRed : badgeAmber}>
          {rule.action}
        </span>
      </div>
      <div className="w-16 text-slate-300">{rule.protocol || 'all'}</div>
      <div className="w-32 font-mono text-xs text-slate-400 truncate" title={rule.source_group ? `group: ${rule.source_group}` : rule.source_geoip ? `geoip: ${rule.source_geoip_inverse ? 'all except ' : ''}${rule.source_geoip.join(', ')}` : undefined}>
        {rule.source_group
          ? <span className="text-violet-300">@{rule.source_group}</span>
          : rule.source_geoip?.length
            ? <span className="text-amber-300">geo:{rule.source_geoip_inverse ? '!' : ''}{rule.source_geoip.join(',')}</span>
            : rule.source_address || 'any'}{rule.source_port ? `:${rule.source_port}` : ''}
      </div>
      <div className="w-32 font-mono text-xs text-slate-400 truncate" title={rule.destination_group ? `group: ${rule.destination_group}` : rule.destination_geoip ? `geoip: ${rule.destination_geoip_inverse ? 'all except ' : ''}${rule.destination_geoip.join(', ')}` : undefined}>
        {rule.destination_group
          ? <span className="text-violet-300">@{rule.destination_group}</span>
          : rule.destination_geoip?.length
            ? <span className="text-amber-300">geo:{rule.destination_geoip_inverse ? '!' : ''}{rule.destination_geoip.join(',')}</span>
            : rule.destination_address || 'any'}{rule.destination_port ? `:${rule.destination_port}` : ''}
      </div>
      <div className="flex-1 text-slate-400 truncate">
        {rule.description || '-'}
        {rule.log && <span className={`ml-2 align-middle ${TAG.indigo}`}>LOG</span>}
      </div>
      <div
        className="w-24 text-right font-mono text-xs text-slate-500 whitespace-nowrap"
        title={counter ? `${counter.packets.toLocaleString()} packets / ${counter.bytes.toLocaleString()} bytes` : undefined}
      >
        {counter ? `${humanCount(counter.packets)} / ${humanBytes(counter.bytes)}` : ''}
      </div>
      <button
        onClick={() => onEdit(chainName, rule)}
        disabled={isWorking('edit-rule-' + rule.number)}
        className={linkEdit + ' text-xs'}
      >
        Edit
      </button>
      <button
        onClick={() => onDelete(chainName, rule.number)}
        disabled={isWorking('delete-rule-' + rule.number)}
        className={linkDelete + ' text-xs'}
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
  const [counters, setCounters] = useState<FirewallCounters>({});

  const [groups, setGroups] = useState<AddressGroup[]>([]);
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
    // counter errors are ignored — the column just stays empty
    getFirewallCounters()
      .then(setCounters)
      .catch(() => {});
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

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className={pageTitle}>Firewall</h2>
        <button onClick={load} disabled={loading} className={btnSecondarySm}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {err && <div className={alertErr}>{err}</div>}
      {msg && <div className={alertOk}>{msg}</div>}

      {loading && chains.length === 0 ? (
        <div className={loadingRow}>
          <svg className={spinner} viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
          Loading firewall…
        </div>
      ) : (
        <div className="space-y-6">
          {chains.map(chain => (
            <div key={chain.name} className={`${card} overflow-hidden`}>
              <div className="px-4 py-3 flex items-center justify-between border-b border-slate-700/60">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-100 uppercase">{chain.name}</span>
                  <span className="text-sm text-slate-400">{CHAIN_INFO[chain.name]}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleDefaultAction(chain)}
                    disabled={isWorking('defact-' + chain.name)}
                    title="Click to toggle (staged)"
                    className={`disabled:opacity-50 cursor-pointer ${chain.default_action === 'accept' ? badgeGreen : chain.default_action === 'drop' ? badgeRed : badgeAmber}`}
                  >
                    default: {chain.default_action} ⇄
                  </button>
                  <button
                    onClick={() => openAddRule(chain.name)}
                    disabled={isWorking('add-rule')}
                    className={btnSuccessSm}
                  >
                    {isWorking('add-rule') ? 'Adding…' : '+ Add Rule'}
                  </button>
                </div>
              </div>
              {chain.rules.length > 0 ? (
                <div className="divide-y divide-slate-700/50">
                  {/* Header */}
                  <div className="flex items-center gap-3 px-4 py-2 bg-slate-800/40 text-xs uppercase tracking-wide text-slate-400 font-medium">
                    <div className="w-6"></div>
                    <div className="w-8">#</div>
                    <div className="w-20">Action</div>
                    <div className="w-16">Proto</div>
                    <div className="w-32">Source</div>
                    <div className="w-32">Destination</div>
                    <div className="flex-1">Description</div>
                    <div className="w-24 text-right">Packets</div>
                    <div></div>
                  </div>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleDragEnd(chain.name, e)}>
                    <SortableContext items={chain.rules.map(r => r.number)} strategy={verticalListSortingStrategy}>
                      {chain.rules.map(rule => (
                        <SortableRuleItem
                          key={rule.number}
                          rule={rule}
                          chainName={chain.name}
                          counter={counters[chain.name]?.[String(rule.number)]}
                          onDelete={handleDeleteRule}
                          onEdit={openEditRule}
                          isWorking={isWorking}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              ) : (
                <div className="px-4 py-4 text-sm text-slate-400 flex items-center justify-between">
                  <span>No rules — everything hits the default action ({chain.default_action}).</span>
                  <button
                    onClick={() => openAddRule(chain.name)}
                    disabled={isWorking('add-rule')}
                    className={btnSuccessSm}
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
        <div className={modalOverlay}>
          <div className={modalCard}>
            <h3 className={modalTitle}>
              {editContext
                ? <>Edit rule <span className="text-indigo-400">#{editContext.oldNumber}</span> in <span className="text-indigo-400 uppercase">{editContext.chain}</span></>
                : <>Add Rule to <span className="text-indigo-400 uppercase">{activeChain}</span></>}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Rule Number</label>
                <input type="number" value={newRule.number} onChange={e => setNewRule({...newRule, number: Number(e.target.value)})} className={inputCls} />
                <p className={hintText}>Auto-suggested next available</p>
              </div>
              <div>
                <label className={labelCls}>Action</label>
                <select value={newRule.action} onChange={e => setNewRule({...newRule, action: e.target.value as any})} className={inputCls}>
                  <option value="accept">accept (allow)</option>
                  <option value="drop">drop (silent deny)</option>
                  <option value="reject">reject (deny + reply)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Protocol</label>
                <select value={newRule.protocol || 'tcp'} onChange={e => setNewRule({...newRule, protocol: e.target.value})} className={inputCls}>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="icmp">ICMP</option>
                  <option value="all">all</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Source</label>
                <select value={srcKind} onChange={e => setSrcKind(e.target.value as 'any' | 'address' | 'group' | 'geoip')} className={inputCls}>
                  <option value="any">any</option>
                  <option value="address">address / network</option>
                  <option value="group">address group</option>
                  <option value="geoip">geoip (countries)</option>
                </select>
                {srcKind === 'address' && (
                  <input value={newRule.source_address || ''} onChange={e => setNewRule({...newRule, source_address: e.target.value || null})} className={inputCls + ' mt-2'} placeholder="10.0.0.0/24" />
                )}
                {srcKind === 'group' && (
                  <select value={newRule.source_group || ''} onChange={e => setNewRule({...newRule, source_group: e.target.value || null})} className={inputCls + ' mt-2'}>
                    <option value="">— select group —</option>
                    {groups.map(g => <option key={g.name} value={g.name}>@{g.name} ({g.addresses.length})</option>)}
                  </select>
                )}
                {srcKind === 'geoip' && (
                  <div className="mt-2 space-y-1.5">
                    <input value={srcGeoip} onChange={e => setSrcGeoip(e.target.value)} className={inputCls + ' font-mono'} placeholder="by, ru, de" />
                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={srcGeoipInv} onChange={e => setSrcGeoipInv(e.target.checked)} className={checkboxCls} />
                      <span>inverse — all countries EXCEPT these</span>
                    </label>
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Destination</label>
                <select value={dstKind} onChange={e => setDstKind(e.target.value as 'any' | 'address' | 'group' | 'geoip')} className={inputCls}>
                  <option value="any">any</option>
                  <option value="address">address / network</option>
                  <option value="group">address group</option>
                  <option value="geoip">geoip (countries)</option>
                </select>
                {dstKind === 'address' && (
                  <input value={newRule.destination_address || ''} onChange={e => setNewRule({...newRule, destination_address: e.target.value || null})} className={inputCls + ' mt-2'} placeholder="10.0.0.5" />
                )}
                {dstKind === 'group' && (
                  <select value={newRule.destination_group || ''} onChange={e => setNewRule({...newRule, destination_group: e.target.value || null})} className={inputCls + ' mt-2'}>
                    <option value="">— select group —</option>
                    {groups.map(g => <option key={g.name} value={g.name}>@{g.name} ({g.addresses.length})</option>)}
                  </select>
                )}
                {dstKind === 'geoip' && (
                  <div className="mt-2 space-y-1.5">
                    <input value={dstGeoip} onChange={e => setDstGeoip(e.target.value)} className={inputCls + ' font-mono'} placeholder="by, ru, de" />
                    <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={dstGeoipInv} onChange={e => setDstGeoipInv(e.target.checked)} className={checkboxCls} />
                      <span>inverse — all countries EXCEPT these</span>
                    </label>
                  </div>
                )}
              </div>
              <div>
                <label className={labelCls}>Dest Port</label>
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
                  className={inputCls}
                >
                  {POPULAR_PORTS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                {destPortOption === 'custom' && (
                  <input
                    value={newRule.destination_port || ''}
                    onChange={e => setNewRule({...newRule, destination_port: e.target.value || null})}
                    className={inputCls + ' mt-2'}
                    placeholder="22 / 80,443 / 1-65535"
                  />
                )}
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Description</label>
                <input value={newRule.description || ''} onChange={e => setNewRule({...newRule, description: e.target.value || null})} className={inputCls} placeholder="Allow SSH from office" />
              </div>
              <label className="col-span-2 flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={newRule.log ?? false} onChange={e => setNewRule({...newRule, log: e.target.checked})} className={checkboxCls} />
                <span>Log matching packets <span className="text-slate-500">(visible on the Logs page, source «firewall»)</span></span>
              </label>
            </div>
            {err && <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">{err}</div>}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => { setShowAddRule(false); setEditContext(null); }} disabled={isWorking('add-rule')} className={btnSecondary}>Cancel</button>
              <button onClick={editContext ? handleUpdateRule : handleAddRule} disabled={isWorking('add-rule')} className={btnPrimary}>
                {isWorking('add-rule') ? 'Saving…' : editContext ? 'Save Changes' : 'Add Rule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help box */}
      <div className={hintBox}>
        <strong className="text-slate-100">How it works (VyOS 1.5, no zones):</strong>
        <ol className="list-decimal list-inside mt-1 space-y-0.5">
          <li><strong>Input</strong> filters traffic to the router itself — protect SSH/API here.</li>
          <li><strong>Forward</strong> filters transit traffic passing through the router.</li>
          <li><strong>Output</strong> filters traffic the router generates.</li>
          <li>Rules are checked in number order, first match wins. Unmatched traffic hits the chain's <strong>default action</strong>.</li>
          <li>Reusable <strong>address groups</strong> are managed on the <strong>Address Groups</strong> page and selected here as <span className="font-mono text-violet-300">@group</span>.</li>
          <li>Everything is applied via the <strong>pending changes</strong> panel on top — review and commit there.</li>
        </ol>
      </div>
    </div>
  );
}

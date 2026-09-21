import { useEffect, useState } from 'react';
import {
  getHaproxy, getHaproxyStatus, provisionHaproxy, migrateHaproxy,
  addHaproxyService, updateHaproxyService, deleteHaproxyService,
  addHaproxyBackend, updateHaproxyBackend, deleteHaproxyBackend,
  updateHaproxyGlobals, createHaproxyAcmeStub,
  getGeoipStatus, updateGeoipDb,
  getPki, getInterfaces,
} from '../api/client';
import type { HaproxyStatus } from '../api/client';
import type { HaproxyConfig, HaproxyService, HaproxyBackend, HaproxyServer, HaproxyServiceRule, GeoipStatus } from '../types';
import CountrySelect from '../components/CountrySelect';

const inputCls = 'w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500';

const LOG_FACILITIES = ['daemon', 'local0', 'local1', 'local2', 'local3', 'local4', 'local5', 'local6', 'local7'];

const EMPTY_SERVICE: HaproxyService = {
  name: '',
  description: null,
  mode: 'http',
  port: null,
  listen_addresses: [],
  backends: [],
  redirect_http_to_https: false,
  ssl_certificate: null,
  ssl_certificates: [],
  logging_facility: null,
  rules: [],
  geoip_mode: 'off',
  geoip_countries: [],
};

const newRule = (n: number): HaproxyServiceRule => ({
  number: n,
  domain_name: '',
  wildcard_domain: false,
  url_path_match: null,
  url_path: null,
  backend: null,
  redirect_location: null,
  geoip_mode: null,
  geoip_countries: [],
});

const EMPTY_SERVER: HaproxyServer = {
  name: '',
  address: null,
  port: null,
  check: true,
  check_port: null,
  backup: false,
  send_proxy: false,
  send_proxy_v2: false,
};

const EMPTY_BACKEND: HaproxyBackend = {
  name: '',
  description: null,
  mode: 'http',
  balance: 'round-robin',
  logging_facility: null,
  ssl_no_verify: false,
  ssl_ca_certificate: null,
  servers: [{ ...EMPTY_SERVER }],
};

export default function HaproxyPage() {
  const [cfg, setCfg] = useState<HaproxyConfig>({ services: [], backends: [], max_connections: null, timeout_client: null, timeout_connect: null, timeout_server: null });
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [working, setWorking] = useState<string | null>(null);

  const [svcForm, setSvcForm] = useState<HaproxyService>(EMPTY_SERVICE);
  const [svcListen, setSvcListen] = useState('');
  const [editSvc, setEditSvc] = useState<string | null>(null);
  const [showSvcForm, setShowSvcForm] = useState(false);

  const [beForm, setBeForm] = useState<HaproxyBackend>(EMPTY_BACKEND);
  const [editBe, setEditBe] = useState<string | null>(null);
  const [showBeForm, setShowBeForm] = useState(false);

  const [globals, setGlobals] = useState({ max_connections: '', timeout_client: '', timeout_connect: '', timeout_server: '' });
  const [showGlobals, setShowGlobals] = useState(false);
  const [certNames, setCertNames] = useState<string[]>([]);
  const [caNames, setCaNames] = useState<string[]>([]);
  const [stagedBackends, setStagedBackends] = useState<string[]>([]);
  const [expandedSvcs, setExpandedSvcs] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<HaproxyStatus | null>(null);
  const [geoip, setGeoip] = useState<GeoipStatus | null>(null);
  const [geoipMsg, setGeoipMsg] = useState('');
  const [geoipErr, setGeoipErr] = useState('');

  const [showAcme, setShowAcme] = useState(false);
  const [acmeAddrs, setAcmeAddrs] = useState<{ iface: string; ip: string }[]>([]);
  const [acmeAddr, setAcmeAddr] = useState('');
  const [acmeErr, setAcmeErr] = useState('');

  const toggleSvc = (name: string) => {
    setExpandedSvcs(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const load = () => {
    setLoading(true);
    setErr('');
    getHaproxyStatus().then(setStatus).catch(() => setStatus(null));
    getHaproxy()
      .then(c => {
        setCfg(c);
        setGlobals({
          max_connections: c.max_connections?.toString() ?? '',
          timeout_client: c.timeout_client?.toString() ?? '',
          timeout_connect: c.timeout_connect?.toString() ?? '',
          timeout_server: c.timeout_server?.toString() ?? '',
        });
        // the model already includes staged (uncommitted) changes
        setStagedBackends(c.backends.map(b => b.name));
      })
      .catch(e => setErr('Load error: ' + e.message))
      .finally(() => setLoading(false));
    // certificate names for the TLS dropdown (fail silently — the field degrades to a hint)
    getPki()
      .then(pki => {
        setCertNames(pki.certificates.map(c => c.name));
        setCaNames(pki.ca_certificates.map(c => c.name));
      })
      .catch(() => {});
  };

  const handleProvision = async () => {
    if (!confirm('Pull the haproxy container image and stage the container config? (may take a few minutes)')) return;
    setWorking('provision');
    setErr(''); setMsg('');
    try {
      await provisionHaproxy();
      setMsg('Container staged — review and commit the pending changes');
      load();
    } catch (e: any) {
      setErr('Provision failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const handleMigrate = async () => {
    if (!confirm('Convert the built-in HAProxy config into the container model and stage removal of the built-in config? Commit afterwards to apply.')) return;
    setWorking('migrate');
    setErr(''); setMsg('');
    try {
      await migrateHaproxy();
      setMsg('Migration staged — review and commit the pending changes');
      load();
    } catch (e: any) {
      setErr('Migration failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  useEffect(() => { load(); }, []);

  // Reload actual config after staged changes are committed or discarded
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('vyos:config-changed', handler);
    return () => window.removeEventListener('vyos:config-changed', handler);
  }, []);

  const isWorking = (key: string) => working === key;
  const numOrNull = (v: string) => v.trim() === '' ? null : Number(v);

  // ─── Services ─────────────────────────────────────────────────

  const openAddSvc = () => {
    setSvcForm(EMPTY_SERVICE);
    setSvcListen('');
    setEditSvc(null);
    setErr(''); setMsg('');
    setShowSvcForm(true);
  };

  const openEditSvc = (s: HaproxyService) => {
    setSvcForm({
      ...s,
      ssl_certificates: s.ssl_certificates || [],
      geoip_mode: s.geoip_mode ?? 'off',
      geoip_countries: s.geoip_countries ?? [],
      rules: s.rules.map(r => ({ ...r, geoip_mode: r.geoip_mode ?? null, geoip_countries: r.geoip_countries ?? [] })),
    });
    setSvcListen(s.listen_addresses.join(', '));
    setEditSvc(s.name);
    setErr(''); setMsg('');
    setShowSvcForm(true);
  };

  const buildService = (): HaproxyService => ({
    ...svcForm,
    description: svcForm.description || null,
    ssl_certificate: svcForm.ssl_certificate || null,
    ssl_certificates: svcForm.ssl_certificate ? svcForm.ssl_certificates : [],
    geoip_mode: svcForm.geoip_mode ?? 'off',
    listen_addresses: svcListen.split(',').map(a => a.trim()).filter(Boolean),
    rules: svcForm.rules.map(r => ({
      ...r,
      domain_name: r.domain_name !== null ? r.domain_name.trim() : null,
      url_path: r.url_path !== null ? r.url_path.trim() : null,
      backend: r.backend?.trim() || null,
      redirect_location: r.redirect_location?.trim() || null,
    })),
  });

  const validateService = (svc: HaproxyService): string | null => {
    if (!svc.name.trim()) return 'Service name is required';
    if (svc.port === null || svc.port < 1 || svc.port > 65535) return 'Port (1-65535) is required';
    if (svc.backends.length === 0 && !svc.rules.some(r => r.backend))
      return 'Select at least one backend (default or via a routing rule)';
    for (const r of svc.rules) {
      const matchValue = r.domain_name !== null ? r.domain_name : r.url_path;
      if (!matchValue || !matchValue.trim()) return `Rule ${r.number}: enter a domain name or URL path to match`;
      if (r.domain_name === null && !r.url_path_match) return `Rule ${r.number}: URL path needs a match type (begin/end/exact)`;
      if (!!r.backend === !!r.redirect_location) return `Rule ${r.number}: choose exactly one action — backend or redirect`;
    }
    if (svc.rules.length > 0 && svc.mode === 'tcp') return 'Routing rules require HTTP mode (TCP cannot inspect URLs)';
    return null;
  };

  const setRule = (idx: number, patch: Partial<HaproxyServiceRule>) => {
    setSvcForm(prev => ({
      ...prev,
      rules: prev.rules.map((r, i) => i === idx ? { ...r, ...patch } : r),
    }));
  };

  const setRuleMatchKind = (idx: number, kind: 'domain' | 'url') => {
    if (kind === 'domain') {
      setRule(idx, { domain_name: '', url_path: null, url_path_match: null });
    } else {
      setRule(idx, { domain_name: null, wildcard_domain: false, url_path: '', url_path_match: 'begin' });
    }
  };

  const setRuleActionKind = (idx: number, kind: 'backend' | 'redirect') => {
    if (kind === 'backend') {
      setRule(idx, { backend: stagedBackends[0] ?? '', redirect_location: null });
    } else {
      setRule(idx, { backend: null, redirect_location: '' });
    }
  };

  const handleSaveSvc = async () => {
    setErr(''); setMsg('');
    const svc = buildService();
    const problem = validateService(svc);
    if (problem) {
      setErr(problem);
      return;
    }
    setWorking('save-svc');
    try {
      if (editSvc !== null) {
        await updateHaproxyService(editSvc, svc);
        setMsg('HAProxy service update staged — review and commit');
      } else {
        await addHaproxyService(svc);
        setMsg('HAProxy service staged — review and commit');
      }
      setCfg(prev => ({
        ...prev,
        services: [...prev.services.filter(s => s.name !== (editSvc ?? svc.name) && s.name !== svc.name), svc]
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
      setShowSvcForm(false);
    } catch (e: any) {
      setErr('Save error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const handleDeleteSvc = async (name: string) => {
    const isLast = cfg.services.length <= 1;
    const warn = isLast
      ? `Delete HAProxy service ${name}?\n\nThis is the last service — VyOS requires a service+backend pair or nothing, so the ENTIRE haproxy config (including backends and global settings) will be removed.`
      : `Delete HAProxy service ${name}?`;
    if (!confirm(warn)) return;
    setWorking('del-svc-' + name);
    setErr(''); setMsg('');
    setCfg(prev => ({ ...prev, services: prev.services.filter(s => s.name !== name) }));
    try {
      await deleteHaproxyService(name);
      setMsg('HAProxy service deletion staged — review and commit');
    } catch (e: any) {
      setErr('Delete error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  // ─── Backends ─────────────────────────────────────────────────

  const openAddBe = () => {
    setBeForm({ ...EMPTY_BACKEND, servers: [{ ...EMPTY_SERVER }] });
    setEditBe(null);
    setErr(''); setMsg('');
    setShowBeForm(true);
  };

  const openEditBe = (b: HaproxyBackend) => {
    setBeForm({ ...b, servers: b.servers.map(s => ({ ...s })) });
    setEditBe(b.name);
    setErr(''); setMsg('');
    setShowBeForm(true);
  };

  const buildBackend = (): HaproxyBackend => ({
    ...beForm,
    description: beForm.description || null,
    ssl_ca_certificate: beForm.ssl_ca_certificate?.trim() || null,
    servers: beForm.servers.map(s => {
      let address = (s.address || '').trim() || null;
      let port = s.port ?? null;
      // Forgiving input: "10.0.0.1:8080" in the address field is split into address + port
      const m = address && address.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
      if (m) {
        address = m[1];
        if (port === null) port = Number(m[2]);
      }
      return { ...s, address, port, check_port: s.check_port ?? null };
    }),
  });

  const validateBackend = (be: HaproxyBackend): string | null => {
    if (!be.name.trim()) return 'Backend name is required';
    for (const s of be.servers) {
      if (!s.name.trim()) return 'Every server needs a name';
      if (!s.address) return `Server "${s.name}": address is required (IP only, without port)`;
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s.address) && !/^[0-9a-fA-F:]+$/.test(s.address))
        return `Server "${s.name}": "${s.address}" is not a valid IP address — enter IP only, port goes in the Port field`;
      if (s.port === null || s.port < 1 || s.port > 65535)
        return `Server "${s.name}": port (1-65535) is required`;
    }
    return null;
  };

  const handleSaveBe = async () => {
    setErr(''); setMsg('');
    if (!beForm.ssl_no_verify && beForm.ssl_ca_certificate !== null && !beForm.ssl_ca_certificate.trim()) {
      setErr('TLS verification needs a CA certificate — import one on the Certificates page, or choose "don\'t verify"');
      return;
    }
    const be = buildBackend();
    const problem = validateBackend(be);
    if (problem) {
      setErr(problem);
      return;
    }
    setWorking('save-be');
    try {
      if (editBe !== null) {
        await updateHaproxyBackend(editBe, be);
        setMsg('HAProxy backend update staged — review and commit');
      } else {
        await addHaproxyBackend(be);
        setMsg('HAProxy backend staged — review and commit');
      }
      setCfg(prev => ({
        ...prev,
        backends: [...prev.backends.filter(b => b.name !== (editBe ?? be.name) && b.name !== be.name), be]
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
      if (editBe === null) setStagedBackends(prev => [...new Set([...prev, be.name])].sort());
      setShowBeForm(false);
    } catch (e: any) {
      setErr('Save error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const handleDeleteBe = async (name: string) => {
    const usedBy = cfg.services.filter(s => s.backends.includes(name)).map(s => s.name);
    const isLast = cfg.backends.length <= 1;
    if (isLast) {
      if (!confirm(`Delete HAProxy backend ${name}?\n\nThis is the last backend — VyOS requires a service+backend pair or nothing, so the ENTIRE haproxy config (including services and global settings) will be removed.`)) return;
    } else if (usedBy.length > 0) {
      if (!confirm(`Backend ${name} is used by service(s): ${usedBy.join(', ')}. Delete anyway?`)) return;
    } else if (!confirm(`Delete HAProxy backend ${name}?`)) return;
    setWorking('del-be-' + name);
    setErr(''); setMsg('');
    setCfg(prev => ({ ...prev, backends: prev.backends.filter(b => b.name !== name) }));
    try {
      await deleteHaproxyBackend(name);
      setMsg('HAProxy backend deletion staged — review and commit');
    } catch (e: any) {
      setErr('Delete error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const setServer = (idx: number, patch: Partial<HaproxyServer>) => {
    setBeForm(prev => ({
      ...prev,
      servers: prev.servers.map((s, i) => i === idx ? { ...s, ...patch } : s),
    }));
  };

  // ─── Globals ──────────────────────────────────────────────────

  const handleSaveGlobals = async () => {
    setWorking('globals');
    setErr(''); setMsg('');
    const data = {
      max_connections: numOrNull(globals.max_connections),
      timeout_client: numOrNull(globals.timeout_client),
      timeout_connect: numOrNull(globals.timeout_connect),
      timeout_server: numOrNull(globals.timeout_server),
    };
    try {
      await updateHaproxyGlobals(data);
      setCfg(prev => ({ ...prev, ...data }));
      setMsg('HAProxy global settings staged — review and commit');
      setShowGlobals(false);
    } catch (e: any) {
      setErr('Save error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  // ─── GeoIP DB ─────────────────────────────────────────────────

  const openGlobals = () => {
    setErr('');
    setGeoipMsg(''); setGeoipErr('');
    setShowGlobals(true);
    getGeoipStatus().then(setGeoip).catch(() => setGeoip(null));
  };

  const handleUpdateGeoip = async () => {
    setWorking('geoip');
    setGeoipMsg(''); setGeoipErr('');
    try {
      const st = await updateGeoipDb();
      setGeoip(st);
      setGeoipMsg(st.staged ? 'Staged — commit pending changes to apply' : 'GeoIP DB updated');
    } catch (e: any) {
      setGeoipErr('Update failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  // ─── ACME stub (HTTP:80 for Let's Encrypt) ────────────────────

  const openAcmeStub = () => {
    setErr(''); setMsg('');
    setAcmeErr('');
    setAcmeAddr('');
    setAcmeAddrs([]);
    setShowAcme(true);
    getInterfaces()
      .then(list => {
        const opts = list
          .map(i => ({ iface: i.name, ip: (i.address || '').split('/')[0] }))
          .filter(o => /^\d{1,3}(\.\d{1,3}){3}$/.test(o.ip) && o.ip !== '127.0.0.1');
        setAcmeAddrs(opts);
        if (opts.length > 0) setAcmeAddr(opts[0].ip);
      })
      .catch(e => setAcmeErr('Could not load interface addresses: ' + (e.response?.data?.detail || e.message)));
  };

  const handleAcmeStub = async () => {
    if (!acmeAddr) {
      setAcmeErr('Select a listen address');
      return;
    }
    setWorking('acme-stub');
    setAcmeErr('');
    try {
      await createHaproxyAcmeStub(acmeAddr);
      setMsg(`ACME stub staged: service "http" will listen on ${acmeAddr}:80 — review and commit`);
      setShowAcme(false);
      load();
    } catch (e: any) {
      setAcmeErr(e.response?.data?.detail || e.message);
    } finally {
      setWorking(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">HAProxy — Load Balancing</h2>
        <div className="flex gap-2">
          <button onClick={openGlobals} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm">
            ⚙ Global Settings
          </button>
          <button onClick={load} disabled={loading} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="mb-4 p-3 bg-gray-800/80 rounded border border-gray-700 text-sm text-gray-300">
        <strong className="text-white">How it works:</strong> a <strong>service</strong> listens on a port and forwards
        traffic to a <strong>backend</strong> — a pool of servers with a balancing algorithm. Create a backend first,
        then attach it to a service. Don't forget a matching <strong>input</strong>-chain firewall rule.
      </div>

      {err && <div className="mb-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
      {msg && <div className="mb-4 p-3 bg-green-900/50 rounded border border-green-700 text-sm text-green-200">{msg}</div>}

      {/* Container status / provisioning banner */}
      {status && (
        <div className={`mb-4 p-3 rounded border text-sm flex flex-wrap items-center gap-x-4 gap-y-2 ${
          status.provisioned
            ? 'bg-gray-800/80 border-gray-700 text-gray-300'
            : 'bg-blue-900/30 border-blue-700 text-blue-200'
        }`}>
          <span>
            Container engine:{' '}
            <strong className="text-white">
              {status.provisioned
                ? status.running === true ? 'running' : status.running === false ? 'stopped' : 'provisioned'
                : 'not provisioned'}
            </strong>
          </span>
          {status.builtin_active && (
            <span className="text-yellow-300">built-in HAProxy config still present</span>
          )}
          {!status.provisioned && (
            <button onClick={handleProvision} disabled={working !== null} className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50">
              {isWorking('provision') ? 'Pulling image…' : 'Provision container'}
            </button>
          )}
          {status.builtin_active && (
            <button onClick={handleMigrate} disabled={working !== null} className="px-3 py-1 bg-yellow-700 rounded hover:bg-yellow-600 text-white text-xs font-medium disabled:opacity-50">
              {isWorking('migrate') ? 'Migrating…' : 'Migrate built-in config → container'}
            </button>
          )}
          {!status.provisioned && !status.builtin_active && (
            <span className="text-xs text-gray-400">Provision the container to enable HAProxy management.</span>
          )}
        </div>
      )}

      {/* Global settings modal */}
      {showGlobals && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg border border-gray-700 shadow-xl">
            <h3 className="text-lg font-bold mb-4">HAProxy Global Settings</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Max connections</label>
                <input type="number" value={globals.max_connections} onChange={e => setGlobals({ ...globals, max_connections: e.target.value })} className={inputCls} placeholder="default" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Client timeout, s</label>
                <input type="number" value={globals.timeout_client} onChange={e => setGlobals({ ...globals, timeout_client: e.target.value })} className={inputCls} placeholder="50" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Connect timeout, s</label>
                <input type="number" value={globals.timeout_connect} onChange={e => setGlobals({ ...globals, timeout_connect: e.target.value })} className={inputCls} placeholder="5" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Server timeout, s</label>
                <input type="number" value={globals.timeout_server} onChange={e => setGlobals({ ...globals, timeout_server: e.target.value })} className={inputCls} placeholder="50" />
              </div>
            </div>
            <div className="mt-5 pt-4 border-t border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-300">GeoIP DB</h4>
                <button onClick={handleUpdateGeoip} disabled={isWorking('geoip')} className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-500 text-white text-xs font-medium disabled:opacity-50">
                  {isWorking('geoip') ? 'Updating…' : 'Update DB'}
                </button>
              </div>
              {geoip === null ? (
                <p className="text-xs text-gray-500">Status unavailable.</p>
              ) : (
                <div className="text-xs text-gray-400 space-y-1">
                  <div>
                    Status: {geoip.available
                      ? <span className="text-green-400">available</span>
                      : <span className="text-yellow-400">not available</span>}
                  </div>
                  {geoip.updated_at && <div>Updated: <span className="text-gray-300">{geoip.updated_at}</span></div>}
                  <div>Entries: <span className="text-gray-300">{geoip.entries}</span> · Countries: <span className="text-gray-300">{geoip.countries}</span></div>
                  {geoip.source && <div>Source: <span className="text-gray-300">{geoip.source}</span></div>}
                </div>
              )}
              {geoipMsg && <div className="mt-2 text-xs text-green-300">{geoipMsg}</div>}
              {geoipErr && <div className="mt-2 text-xs text-red-300">{geoipErr}</div>}
            </div>
            {err && <div className="mt-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowGlobals(false)} disabled={isWorking('globals')} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleSaveGlobals} disabled={isWorking('globals')} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50">
                {isWorking('globals') ? 'Saving…' : 'Save Globals'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Services */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Services (frontends)</h3>
        <div className="flex gap-2">
          <button onClick={openAcmeStub} disabled={working !== null} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm disabled:opacity-50" title="Create an HTTP:80 stub for Let's Encrypt (certbot) challenges">
            ACME Stub
          </button>
          <button onClick={openAddSvc} className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-500 text-sm text-white font-medium">+ Add Service</button>
        </div>
      </div>

      {loading && cfg.services.length === 0 ? (
        <div className="text-gray-400 mb-6">Loading…</div>
      ) : cfg.services.length === 0 ? (
        <div className="mb-6 p-6 border border-dashed border-gray-600 rounded-lg text-center text-gray-400">
          No HAProxy services yet.
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          {cfg.services.map(s => {
            const expanded = expandedSvcs.has(s.name);
            return (
              <div key={s.name} className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <div
                  className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-gray-700/40 select-none"
                  onClick={() => toggleSvc(s.name)}
                  title={expanded ? 'Click to collapse' : 'Click to see routing rules'}
                >
                  <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                    <span className={`text-gray-500 text-[10px] transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
                    <span className="font-mono text-blue-300 font-semibold">{s.name}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-700 text-gray-300 uppercase">{s.mode || 'http'}</span>
                    <span className="font-mono text-xs text-gray-300">
                      {(s.listen_addresses.length > 0 ? s.listen_addresses.join(', ') : '*')}:{s.port ?? '?'}
                    </span>
                    {s.ssl_certificate && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900 text-green-300" title={`TLS certificate: ${s.ssl_certificate}`}>TLS:{s.ssl_certificate}</span>}
                    {s.ssl_certificates && s.ssl_certificates.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900/60 text-green-300" title={`Additional SNI certificates: ${s.ssl_certificates.join(', ')}`}>
                        +{s.ssl_certificates.length} certs
                      </span>
                    )}
                    {s.redirect_http_to_https && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-900 text-purple-300">→HTTPS</span>}
                    {s.logging_facility && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-900 text-sky-300">log:{s.logging_facility}</span>}
                    {s.geoip_mode && s.geoip_mode !== 'off' && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.geoip_mode === 'allow' ? 'bg-amber-900 text-amber-300' : 'bg-orange-900 text-orange-300'}`}
                        title={`GeoIP ${s.geoip_mode}: ${s.geoip_countries.join(', ') || 'no countries selected'}`}
                      >
                        GeoIP: {s.geoip_mode}{s.geoip_countries.length > 0 && ' ' + s.geoip_countries.slice(0, 4).join(',') + (s.geoip_countries.length > 4 ? ',…' : '')}
                      </span>
                    )}
                    {s.rules.length > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-900 text-violet-300">{s.rules.length} rule{s.rules.length > 1 ? 's' : ''}</span>}
                  </div>
                  <div className="flex items-center gap-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    {s.backends.length > 0 && (
                      <span className="text-xs text-gray-400" title="Default backend(s)">→ <span className="font-mono">{s.backends.join(', ')}</span></span>
                    )}
                    <button onClick={() => openEditSvc(s)} className="text-blue-400 hover:text-blue-300 text-sm">Edit</button>
                    <button onClick={() => handleDeleteSvc(s.name)} disabled={isWorking('del-svc-' + s.name)} className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50">
                      {isWorking('del-svc-' + s.name) ? '…' : 'Del'}
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className="border-t border-gray-700 px-4 py-3 bg-gray-900/40 text-sm">
                    {s.description && <div className="text-gray-400 mb-3">{s.description}</div>}
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Routing rules (in order)</h4>
                    {s.rules.length === 0 ? (
                      <p className="text-xs text-gray-500">
                        No match rules — all traffic goes to the default backend{s.backends.length > 0 && <> (<span className="font-mono text-blue-300">{s.backends.join(', ')}</span>)</>}.
                      </p>
                    ) : (
                      <div className="rounded border border-gray-700/70 divide-y divide-gray-700/50 overflow-hidden">
                        {[...s.rules].sort((a, b) => a.number - b.number).map(r => (
                          <div key={r.number} className="flex items-center gap-2.5 px-3 py-2 bg-gray-900/60 flex-wrap">
                            <span className="font-mono text-gray-500 text-xs w-8">#{r.number}</span>
                            {r.domain_name !== null ? (
                              <span className="px-1.5 py-0.5 rounded bg-violet-900/60 text-violet-200 text-xs font-mono" title={r.wildcard_domain ? 'Domain and all its subdomains' : 'Exact domain'}>
                                {r.wildcard_domain ? '*.' : ''}{r.domain_name}
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-teal-900/60 text-teal-200 text-xs font-mono" title="URL path match">
                                path {{ begin: 'begins', end: 'ends', exact: 'equals' }[r.url_path_match || 'begin']} {r.url_path}
                              </span>
                            )}
                            <span className="text-gray-500">→</span>
                            {r.backend !== null ? (
                              <span className="font-mono text-blue-300 text-xs" title="Forward to backend">{r.backend}</span>
                            ) : (
                              <span className="font-mono text-purple-300 text-xs" title="Redirect client">↷ {r.redirect_location}</span>
                            )}
                          </div>
                        ))}
                        <div className="flex items-center gap-2.5 px-3 py-2 bg-gray-900/30 text-xs text-gray-500">
                          <span className="w-8" />
                          <span>everything else</span>
                          <span>→</span>
                          {s.backends.length > 0
                            ? <span className="font-mono text-blue-300">{s.backends.join(', ')}</span>
                            : <span className="text-red-400">no default backend!</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Backends */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold">Backends (server pools)</h3>
        <button onClick={openAddBe} className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-500 text-sm text-white font-medium">+ Add Backend</button>
      </div>

      {cfg.backends.length === 0 ? (
        <div className="p-6 border border-dashed border-gray-600 rounded-lg text-center text-gray-400">
          No HAProxy backends yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cfg.backends.map(b => (
            <div key={b.name} className="p-4 bg-gray-800 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-mono text-blue-300 font-semibold">{b.name}</span>
                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-700 text-gray-300 uppercase align-middle">{b.mode || 'http'}</span>
                  {b.balance && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-900 text-indigo-300 align-middle">{b.balance}</span>}
                  {b.logging_facility && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-900 text-sky-300 align-middle">log:{b.logging_facility}</span>}
                  {b.ssl_no_verify && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-900 text-orange-300 align-middle" title="TLS to servers, certificate not verified">TLS!</span>}
                  {b.ssl_ca_certificate && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900 text-green-300 align-middle" title={`TLS to servers, verified by CA ${b.ssl_ca_certificate}`}>TLS</span>}
                </div>
                <div className="whitespace-nowrap">
                  <button onClick={() => openEditBe(b)} className="text-blue-400 hover:text-blue-300 text-sm mr-3">Edit</button>
                  <button onClick={() => handleDeleteBe(b.name)} disabled={isWorking('del-be-' + b.name)} className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50">
                    {isWorking('del-be-' + b.name) ? '…' : 'Del'}
                  </button>
                </div>
              </div>
              {b.description && <div className="text-sm text-gray-400 mb-2">{b.description}</div>}
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-700/50">
                  {b.servers.map(srv => (
                    <tr key={srv.name}>
                      <td className="py-1.5 font-mono text-gray-300">{srv.name}</td>
                      <td className="py-1.5 font-mono text-green-300">{srv.address || '?'}:{srv.port ?? '?'}</td>
                      <td className="py-1.5 text-right">
                        {srv.check && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-900 text-emerald-300">check{srv.check_port ? `:${srv.check_port}` : ''}</span>}
                        {srv.backup && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-900 text-yellow-300">backup</span>}
                        {srv.send_proxy && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-900 text-cyan-300">proxy-v1</span>}
                        {srv.send_proxy_v2 && <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-900 text-cyan-300">proxy-v2</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* Service modal */}
      {showSvcForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-2xl border border-gray-700 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">
              {editSvc !== null ? <>Edit service <span className="text-blue-400">{editSvc}</span></> : 'New HAProxy Service'}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input value={svcForm.name} onChange={e => setSvcForm({ ...svcForm, name: e.target.value })} disabled={editSvc !== null} className={inputCls + ' disabled:opacity-50'} placeholder="web-front" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Mode</label>
                <select value={svcForm.mode || 'http'} onChange={e => setSvcForm({ ...svcForm, mode: e.target.value as 'http' | 'tcp' })} className={inputCls}>
                  <option value="http">HTTP</option>
                  <option value="tcp">TCP</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Port</label>
                <input type="number" value={svcForm.port ?? ''} onChange={e => setSvcForm({ ...svcForm, port: e.target.value === '' ? null : Number(e.target.value) })} className={inputCls} placeholder="80" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Listen addresses</label>
                <input value={svcListen} onChange={e => setSvcListen(e.target.value)} className={inputCls} placeholder="empty = all, or 1.2.3.4, 5.6.7.8" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-400 mb-1">Backends</label>
                <div className="flex flex-wrap gap-3 p-2 bg-gray-900 border border-gray-700 rounded">
                  {stagedBackends.length === 0 && <span className="text-sm text-gray-500">No backends yet — create one first</span>}
                  {stagedBackends.map(name => (
                    <label key={name} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={svcForm.backends.includes(name)}
                        onChange={e => setSvcForm({
                          ...svcForm,
                          backends: e.target.checked
                            ? [...svcForm.backends, name]
                            : svcForm.backends.filter(x => x !== name),
                        })}
                      />
                      <span className="font-mono">{name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm text-gray-400">Routing rules</label>
                  <button
                    onClick={() => setSvcForm({
                      ...svcForm,
                      rules: [...svcForm.rules, { ...newRule((svcForm.rules.length + 1) * 10), backend: stagedBackends[0] ?? '' }],
                    })}
                    className="px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 text-xs"
                  >
                    + Add Rule
                  </button>
                </div>
                {svcForm.rules.length === 0 ? (
                  <p className="text-xs text-gray-500">No rules — all traffic goes to the default backend(s).</p>
                ) : (
                  <div className="space-y-2">
                    {svcForm.rules.map((r, idx) => (
                      <div key={idx} className="p-2 bg-gray-900 rounded border border-gray-700 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 font-mono text-xs w-8">#{r.number}</span>
                          <select value={r.domain_name !== null ? 'domain' : 'url'} onChange={e => setRuleMatchKind(idx, e.target.value as 'domain' | 'url')} className={inputCls + ' !w-28'}>
                            <option value="domain">Domain</option>
                            <option value="url">URL path</option>
                          </select>
                          {r.domain_name !== null ? (
                            <>
                              <input value={r.domain_name} onChange={e => setRule(idx, { domain_name: e.target.value })} className={inputCls} placeholder="api.example.com" />
                              <label className="flex items-center gap-1 text-xs text-gray-300 whitespace-nowrap cursor-pointer" title="Also match all subdomains">
                                <input type="checkbox" checked={r.wildcard_domain} onChange={e => setRule(idx, { wildcard_domain: e.target.checked })} />
                                wild
                              </label>
                            </>
                          ) : (
                            <>
                              <select value={r.url_path_match || 'begin'} onChange={e => setRule(idx, { url_path_match: e.target.value as 'begin' | 'end' | 'exact' })} className={inputCls + ' !w-24'}>
                                <option value="begin">begins</option>
                                <option value="end">ends</option>
                                <option value="exact">exact</option>
                              </select>
                              <input value={r.url_path || ''} onChange={e => setRule(idx, { url_path: e.target.value })} className={inputCls} placeholder="/api" />
                            </>
                          )}
                          <button onClick={() => setSvcForm(prev => ({ ...prev, rules: prev.rules.filter((_, i) => i !== idx) }))} className="text-red-400 hover:text-red-300 text-sm px-1" title="Remove rule">✕</button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 text-xs w-8 text-right">→</span>
                          <select value={r.backend !== null ? 'backend' : 'redirect'} onChange={e => setRuleActionKind(idx, e.target.value as 'backend' | 'redirect')} className={inputCls + ' !w-28'}>
                            <option value="backend">Backend</option>
                            <option value="redirect">Redirect</option>
                          </select>
                          {r.backend !== null ? (
                            <select value={r.backend} onChange={e => setRule(idx, { backend: e.target.value })} className={inputCls}>
                              {stagedBackends.length === 0 && <option value="">— create a backend first —</option>}
                              {stagedBackends.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                          ) : (
                            <input value={r.redirect_location || ''} onChange={e => setRule(idx, { redirect_location: e.target.value })} className={inputCls} placeholder="/new-path or https://example.com/page" />
                          )}
                        </div>
                        {(svcForm.mode || 'http') === 'http' && (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500 text-xs w-8 text-right">geo</span>
                            <select
                              value={r.geoip_mode ?? ''}
                              onChange={e => setRule(idx, { geoip_mode: (e.target.value || null) as 'allow' | 'deny' | null })}
                              className={inputCls + ' !w-28'}
                            >
                              <option value="">Inherit</option>
                              <option value="allow">Allow</option>
                              <option value="deny">Deny</option>
                            </select>
                            {r.geoip_mode !== null && (
                              <div className="flex-1">
                                <CountrySelect
                                  value={r.geoip_countries}
                                  onChange={codes => setRule(idx, { geoip_countries: codes })}
                                  placeholder="Countries…"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-400 mb-1">GeoIP restriction</label>
                <div className="flex items-start gap-2">
                  <select
                    value={svcForm.geoip_mode || 'off'}
                    onChange={e => setSvcForm({ ...svcForm, geoip_mode: e.target.value as 'off' | 'allow' | 'deny' })}
                    className={inputCls + ' !w-52'}
                  >
                    <option value="off">Off</option>
                    <option value="allow">Allow only selected</option>
                    <option value="deny">Deny selected</option>
                  </select>
                  {svcForm.geoip_mode && svcForm.geoip_mode !== 'off' && (
                    <div className="flex-1">
                      <CountrySelect
                        value={svcForm.geoip_countries}
                        onChange={codes => setSvcForm({ ...svcForm, geoip_countries: codes })}
                      />
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">TLS certificate</label>
                <select
                  value={svcForm.ssl_certificate || ''}
                  onChange={e => {
                    const cert = e.target.value || null;
                    setSvcForm({
                      ...svcForm,
                      ssl_certificate: cert,
                      ssl_certificates: cert ? svcForm.ssl_certificates.filter(c => c !== cert) : [],
                    });
                  }}
                  className={inputCls}
                >
                  <option value="">none (plain HTTP)</option>
                  {certNames.map(n => <option key={n} value={n}>{n}</option>)}
                  {svcForm.ssl_certificate && !certNames.includes(svcForm.ssl_certificate) && (
                    <option value={svcForm.ssl_certificate}>{svcForm.ssl_certificate} (not in PKI)</option>
                  )}
                </select>
                {certNames.length === 0 && <p className="text-xs text-gray-500 mt-1">No certificates in PKI — add one on the Certificates page</p>}
                {svcForm.ssl_certificate && (
                  <div className="mt-3">
                    <label className="block text-sm text-gray-400 mb-1">Additional certificates (SNI)</label>
                    <div className="max-h-32 overflow-y-auto p-2 bg-gray-900 border border-gray-700 rounded space-y-1">
                      {certNames.filter(n => n !== svcForm.ssl_certificate).length === 0 && (
                        <span className="text-xs text-gray-500">No other certificates in PKI</span>
                      )}
                      {certNames.filter(n => n !== svcForm.ssl_certificate).map(n => (
                        <label key={n} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={svcForm.ssl_certificates.includes(n)}
                            onChange={e => setSvcForm({
                              ...svcForm,
                              ssl_certificates: e.target.checked
                                ? [...svcForm.ssl_certificates, n]
                                : svcForm.ssl_certificates.filter(c => c !== n),
                            })}
                          />
                          <span className="font-mono">{n}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">picked automatically by requested domain name (SNI); the primary certificate is the default</p>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Logging facility</label>
                <select value={svcForm.logging_facility || ''} onChange={e => setSvcForm({ ...svcForm, logging_facility: e.target.value || null })} className={inputCls}>
                  <option value="">off</option>
                  {LOG_FACILITIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <input value={svcForm.description || ''} onChange={e => setSvcForm({ ...svcForm, description: e.target.value || null })} className={inputCls} placeholder="Public web frontend" />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer self-end pb-2">
                <input type="checkbox" checked={svcForm.redirect_http_to_https} onChange={e => setSvcForm({ ...svcForm, redirect_http_to_https: e.target.checked })} />
                <span>Redirect HTTP → HTTPS</span>
              </label>
            </div>
            {err && <div className="mt-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowSvcForm(false)} disabled={isWorking('save-svc')} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleSaveSvc} disabled={isWorking('save-svc')} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
                {isWorking('save-svc') ? 'Saving…' : editSvc !== null ? 'Save Changes' : 'Add Service'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backend modal */}
      {showBeForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-2xl border border-gray-700 shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">
              {editBe !== null ? <>Edit backend <span className="text-blue-400">{editBe}</span></> : 'New HAProxy Backend'}
            </h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input value={beForm.name} onChange={e => setBeForm({ ...beForm, name: e.target.value })} disabled={editBe !== null} className={inputCls + ' disabled:opacity-50'} placeholder="web-servers" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Mode</label>
                <select value={beForm.mode || 'http'} onChange={e => setBeForm({ ...beForm, mode: e.target.value as 'http' | 'tcp' })} className={inputCls}>
                  <option value="http">HTTP</option>
                  <option value="tcp">TCP</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Balance</label>
                <select value={beForm.balance || 'round-robin'} onChange={e => setBeForm({ ...beForm, balance: e.target.value as HaproxyBackend['balance'] })} className={inputCls}>
                  <option value="round-robin">round-robin</option>
                  <option value="least-connection">least-connection</option>
                  <option value="source-address">source-address</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <input value={beForm.description || ''} onChange={e => setBeForm({ ...beForm, description: e.target.value || null })} className={inputCls} placeholder="Web server pool" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Logging facility</label>
                <select value={beForm.logging_facility || ''} onChange={e => setBeForm({ ...beForm, logging_facility: e.target.value || null })} className={inputCls}>
                  <option value="">off</option>
                  {LOG_FACILITIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Backend TLS (SSL bridging)</label>
                <select
                  value={beForm.ssl_no_verify ? 'noverify' : beForm.ssl_ca_certificate !== null ? 'ca' : 'plain'}
                  onChange={e => {
                    const v = e.target.value;
                    setBeForm({
                      ...beForm,
                      ssl_no_verify: v === 'noverify',
                      ssl_ca_certificate: v === 'ca' ? (caNames[0] ?? '') : null,
                    });
                  }}
                  className={inputCls}
                >
                  <option value="plain">plain HTTP to servers</option>
                  <option value="noverify">HTTPS, don't verify cert</option>
                  <option value="ca">HTTPS, verify via CA</option>
                </select>
              </div>
              {beForm.ssl_ca_certificate !== null && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">CA certificate</label>
                  <select value={beForm.ssl_ca_certificate} onChange={e => setBeForm({ ...beForm, ssl_ca_certificate: e.target.value })} className={inputCls}>
                    {caNames.length === 0 && <option value="">— import a CA on the Certificates page —</option>}
                    {caNames.map(n => <option key={n} value={n}>{n}</option>)}
                    {beForm.ssl_ca_certificate && !caNames.includes(beForm.ssl_ca_certificate) && (
                      <option value={beForm.ssl_ca_certificate}>{beForm.ssl_ca_certificate} (not in PKI)</option>
                    )}
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-gray-400 font-medium">Servers</label>
              <button
                onClick={() => setBeForm(prev => ({ ...prev, servers: [...prev.servers, { ...EMPTY_SERVER, name: `srv${prev.servers.length + 1}` }] }))}
                className="px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 text-xs"
              >
                + Add Server
              </button>
            </div>
            <div className="space-y-2">
              {beForm.servers.map((srv, idx) => (
                <div key={idx} className="p-3 bg-gray-900 rounded border border-gray-700">
                  <div className="grid grid-cols-12 gap-2 items-center">
                    <input value={srv.name} onChange={e => setServer(idx, { name: e.target.value })} className={inputCls + ' col-span-2'} placeholder="name" />
                    <input value={srv.address || ''} onChange={e => setServer(idx, { address: e.target.value || null })} className={inputCls + ' col-span-4'} placeholder="192.168.1.10 or 192.168.1.10:8080" title="IP address. You may enter IP:port — it will be split automatically" />
                    <input type="number" value={srv.port ?? ''} onChange={e => setServer(idx, { port: e.target.value === '' ? null : Number(e.target.value) })} className={inputCls + ' col-span-2'} placeholder="port" />
                    <input type="number" value={srv.check_port ?? ''} onChange={e => setServer(idx, { check_port: e.target.value === '' ? null : Number(e.target.value) })} className={inputCls + ' col-span-2'} placeholder="check port" title="Health-check port (optional)" />
                    <div className="col-span-2 text-right">
                      <button
                        onClick={() => setBeForm(prev => ({ ...prev, servers: prev.servers.filter((_, i) => i !== idx) }))}
                        disabled={beForm.servers.length <= 1}
                        className="text-red-400 hover:text-red-300 text-sm disabled:opacity-30"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-300">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={srv.check} onChange={e => setServer(idx, { check: e.target.checked })} />
                      <span>Health check</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={srv.backup} onChange={e => setServer(idx, { backup: e.target.checked })} />
                      <span>Backup</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={srv.send_proxy} onChange={e => setServer(idx, { send_proxy: e.target.checked, send_proxy_v2: false })} />
                      <span>PROXY v1</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={srv.send_proxy_v2} onChange={e => setServer(idx, { send_proxy_v2: e.target.checked, send_proxy: false })} />
                      <span>PROXY v2</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>

            {err && <div className="mt-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowBeForm(false)} disabled={isWorking('save-be')} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleSaveBe} disabled={isWorking('save-be')} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
                {isWorking('save-be') ? 'Saving…' : editBe !== null ? 'Save Changes' : 'Add Backend'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ACME stub modal */}
      {showAcme && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-gray-700 shadow-xl">
            <h3 className="text-lg font-bold mb-2">ACME stub (Let's Encrypt)</h3>
            <p className="text-sm text-gray-400 mb-4">
              Creates an HTTP service on port 80 that passes ACME challenges to certbot
              and redirects everything else to HTTPS. Pick the public address that
              receives port-80 traffic. Never binds <code>*:80</code> — certbot needs 127.0.0.1:80.
            </p>
            <label className="block text-sm text-gray-400 mb-1">Listen address</label>
            {acmeAddrs.length > 0 ? (
              <select value={acmeAddr} onChange={e => setAcmeAddr(e.target.value)} className={inputCls}>
                {acmeAddrs.map(o => (
                  <option key={o.ip} value={o.ip}>{o.ip} ({o.iface})</option>
                ))}
              </select>
            ) : (
              <input value={acmeAddr} onChange={e => setAcmeAddr(e.target.value)} className={inputCls} placeholder="e.g. 203.0.113.10" />
            )}
            {acmeErr && <div className="mt-3 p-2 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{acmeErr}</div>}
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowAcme(false)} disabled={isWorking('acme-stub')} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleAcmeStub} disabled={isWorking('acme-stub')} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
                {isWorking('acme-stub') ? 'Creating…' : 'Create stub'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

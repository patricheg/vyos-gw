import { NavLink } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { getStaged, commitStaged, discardStaged, removeStaged, saveSystemConfig } from '../api/client';
import type { StagedChange } from '../api/client';
import { btnSuccessSm, btnDangerSm } from '../ui';

const ICONS: Record<string, string> = {
  dashboard:
    'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
  interfaces:
    'M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z',
  firewall:
    'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  groups:
    'M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3zM6 6h.008v.008H6V6z',
  nat: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  routes:
    'M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z',
  haproxy:
    'M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z',
  certificates:
    'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
  fire:
    'M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48zM12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z',
  logs:
    'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  services:
    'M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z',
  system:
    'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281zM15 12a3 3 0 11-6 0 3 3 0 016 0z',
};

const NAV_ITEMS: { path: string; label: string; icon: keyof typeof ICONS }[] = [
  { path: '/', label: 'Dashboard', icon: 'dashboard' },
  { path: '/interfaces', label: 'Interfaces', icon: 'interfaces' },
  { path: '/firewall', label: 'Firewall', icon: 'firewall' },
  { path: '/address-groups', label: 'Address Groups', icon: 'groups' },
  { path: '/nat', label: 'NAT', icon: 'nat' },
  { path: '/routes', label: 'Routes', icon: 'routes' },
  { path: '/haproxy', label: 'HAProxy', icon: 'haproxy' },
  { path: '/certificates', label: 'Certificates', icon: 'certificates' },
  { path: '/firewall-logs', label: 'Firewall Logs', icon: 'fire' },
  { path: '/logs', label: 'Logs', icon: 'logs' },
  { path: '/services', label: 'Services', icon: 'services' },
  { path: '/system', label: 'System', icon: 'system' },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg className="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

export default function Layout({ children, onLogout }: { children: React.ReactNode; onLogout?: () => void }) {
  const [staged, setStaged] = useState<StagedChange[]>([]);
  const [stagedLoading, setStagedLoading] = useState(false);
  const [stagedMsg, setStagedMsg] = useState('');

  const loadStaged = useCallback(async () => {
    try {
      const data = await getStaged();
      setStaged(data);
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadStaged();
    const interval = setInterval(loadStaged, 2000);
    return () => clearInterval(interval);
  }, [loadStaged]);

  const [saveMsg, setSaveMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      await saveSystemConfig();
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(''), 3000);
    } catch (e: any) {
      setSaveMsg('Save failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleCommit = async () => {
    setStagedLoading(true);
    setStagedMsg('');
    try {
      const result = await commitStaged();
      if (result.status === 'success') {
        setStagedMsg('Changes committed to VyOS');
        window.dispatchEvent(new CustomEvent('vyos:config-changed'));
      } else {
        setStagedMsg('Commit error: ' + (result.detail || 'unknown'));
      }
      loadStaged();
    } catch (e: any) {
      setStagedMsg('Commit failed: ' + e.message);
    } finally {
      setStagedLoading(false);
    }
  };

  const handleDiscard = async () => {
    if (!confirm('Discard all pending changes?')) return;
    setStagedLoading(true);
    try {
      await discardStaged();
      setStagedMsg('All changes discarded');
      window.dispatchEvent(new CustomEvent('vyos:config-changed'));
      loadStaged();
    } catch (e: any) {
      setStagedMsg('Discard failed: ' + e.message);
    } finally {
      setStagedLoading(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeStaged(id);
      loadStaged();
    } catch (e) {
      // ignore
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col min-h-screen sticky top-0 h-screen">
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-slate-800">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={ICONS.firewall} />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100 leading-tight">VyOS GW</div>
            <div className="text-[11px] text-slate-500 leading-tight">Management console</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`
              }
            >
              <NavIcon d={ICONS[item.icon]} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-slate-800 space-y-2">
          <button
            onClick={handleSave}
            disabled={saving}
            title="Save running configuration to device flash (write memory)"
            className="w-full px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2.5"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
            {saving ? 'Saving…' : 'Save config'}
            {saveMsg && (
              <span className={`ml-auto text-xs ${saveMsg === 'Saved' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {saveMsg === 'Saved' ? '✓' : '!'}
              </span>
            )}
          </button>
          {saveMsg && saveMsg !== 'Saved' && <div className="text-xs text-rose-400 px-1">{saveMsg}</div>}
          {onLogout && (
            <button
              onClick={onLogout}
              title="Sign out of the management console"
              className="w-full px-3 py-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100 text-sm font-medium transition-colors flex items-center gap-2.5"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
              Logout
            </button>
          )}
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Pending Changes Panel */}
        {staged.length > 0 && (
          <div className="bg-amber-500/10 border-b border-amber-500/30">
            <div className="max-w-7xl mx-auto px-6 py-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="font-semibold text-amber-200">{staged.length} pending change{staged.length > 1 ? 's' : ''}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleDiscard} disabled={stagedLoading} className={btnDangerSm}>
                    Discard
                  </button>
                  <button onClick={handleCommit} disabled={stagedLoading} className={btnSuccessSm}>
                    {stagedLoading && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>}
                    {stagedLoading ? 'Committing…' : 'Commit to VyOS'}
                  </button>
                </div>
              </div>
              {stagedMsg && <div className="text-sm text-amber-200 mb-2">{stagedMsg}</div>}
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {staged.map(c => (
                  <div key={c.id} className="flex items-center justify-between text-xs bg-amber-500/10 rounded-lg px-2 py-1">
                    <span className="text-amber-100">{c.description}</span>
                    <button onClick={() => handleRemove(c.id)} className="text-amber-400 hover:text-amber-200 ml-2">×</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

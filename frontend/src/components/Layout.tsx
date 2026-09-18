import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { getStaged, commitStaged, discardStaged, removeStaged, saveSystemConfig } from '../api/client';
import type { StagedChange } from '../api/client';

export default function Layout({ children, onLogout }: { children: React.ReactNode; onLogout?: () => void }) {
  const loc = useLocation();
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

  const nav = (path: string, label: string) => (
    <Link
      to={path}
      className={`px-4 py-2 rounded-lg font-medium transition ${
        loc.pathname === path
          ? 'bg-blue-600 text-white'
          : 'text-gray-300 hover:bg-gray-800 hover:text-white'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen">
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-white whitespace-nowrap">VyOS Web Gateway</h1>
            {onLogout && (
              <button
                onClick={onLogout}
                title="Sign out of the management console"
                className="text-xs text-gray-400 hover:text-white underline"
              >
                logout
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              title="Save running configuration to device flash (write memory)"
              className="px-3 py-1.5 bg-indigo-600 rounded hover:bg-indigo-500 text-xs text-white font-medium disabled:opacity-50 flex items-center gap-1"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saveMsg && <span className={`text-xs ${saveMsg === 'Saved' ? 'text-green-400' : 'text-red-400'}`}>{saveMsg}</span>}
          </div>
          <nav className="flex flex-wrap gap-1.5">
            {nav('/', 'Interfaces')}
            {nav('/firewall', 'Firewall')}
            {nav('/nat', 'NAT')}
            {nav('/routes', 'Routes')}
            {nav('/haproxy', 'HAProxy')}
            {nav('/certificates', 'Certificates')}
            {nav('/firewall-logs', 'FW Logs')}
            {nav('/logs', 'Logs')}
            {nav('/services', 'Services')}
            {nav('/system', 'System')}
          </nav>
        </div>
      </header>

      {/* Pending Changes Panel */}
      {staged.length > 0 && (
        <div className="bg-yellow-900/30 border-b border-yellow-700/50">
          <div className="max-w-7xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <svg className="h-5 w-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <span className="font-bold text-yellow-200">{staged.length} pending change{staged.length > 1 ? 's' : ''}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={handleDiscard} disabled={stagedLoading} className="px-3 py-1.5 bg-red-700 rounded hover:bg-red-600 text-sm text-white disabled:opacity-50">
                  Discard
                </button>
                <button onClick={handleCommit} disabled={stagedLoading} className="px-3 py-1.5 bg-green-600 rounded hover:bg-green-500 text-sm text-white font-medium disabled:opacity-50 flex items-center gap-2">
                  {stagedLoading && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>}
                  {stagedLoading ? 'Committing…' : 'Commit to VyOS'}
                </button>
              </div>
            </div>
            {stagedMsg && <div className="text-sm text-yellow-200 mb-2">{stagedMsg}</div>}
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {staged.map(c => (
                <div key={c.id} className="flex items-center justify-between text-xs bg-yellow-900/40 rounded px-2 py-1">
                  <span className="text-yellow-100">{c.description}</span>
                  <button onClick={() => handleRemove(c.id)} className="text-yellow-400 hover:text-yellow-200 ml-2">×</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}

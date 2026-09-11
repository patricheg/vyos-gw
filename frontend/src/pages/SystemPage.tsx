import { useEffect, useRef, useState } from 'react';
import { getSystem, updateSystem, getSystemResources, downloadBackup, restoreBackup } from '../api/client';
import type { SystemConfig, SystemResources } from '../types';
import { TIMEZONES } from '../timezones';

const inputCls = 'w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500';

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-2 bg-gray-700 rounded overflow-hidden">
      <div className={`h-full rounded ${color}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  );
}

function ListEditor({ label, values, placeholder, onChange }: {
  label: string;
  values: string[];
  placeholder: string;
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v].sort());
    setDraft('');
  };

  return (
    <div>
      <label className="block text-sm text-gray-400 mb-1">{label}</label>
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {values.map(v => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-700 rounded text-xs font-mono text-gray-200">
            {v}
            <button type="button" onClick={() => onChange(values.filter(x => x !== v))} className="text-red-400 hover:text-red-300">×</button>
          </span>
        ))}
        {values.length === 0 && <span className="text-xs text-gray-500">none</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className={inputCls}
          placeholder={placeholder}
        />
        <button type="button" onClick={add} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm whitespace-nowrap">Add</button>
      </div>
    </div>
  );
}

export default function SystemPage() {
  const [form, setForm] = useState<SystemConfig>({
    host_name: null, domain_search: null, time_zone: null, name_servers: [], ntp_servers: [],
  });
  const [resources, setResources] = useState<SystemResources | null>(null);
  const [resErr, setResErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [tzCustom, setTzCustom] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const [backupErr, setBackupErr] = useState('');
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    setErr('');
    getSystem()
      .then(setForm)
      .catch(e => setErr('Load error: ' + e.message))
      .finally(() => setLoading(false));
  };

  const loadResources = () => {
    getSystemResources()
      .then(r => { setResources(r); setResErr(''); })
      .catch(e => setResErr('Resources: ' + (e.response?.data?.detail || e.message)));
  };

  useEffect(() => { load(); loadResources(); }, []);

  // Poll resource usage while the page is open
  useEffect(() => {
    const t = window.setInterval(loadResources, 10000);
    return () => window.clearInterval(t);
  }, []);

  // Reload actual config after staged changes are committed or discarded
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('vyos:config-changed', handler);
    return () => window.removeEventListener('vyos:config-changed', handler);
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg('');
    setErr('');
    try {
      const result = await updateSystem(form);
      setMsg(result.changes > 0 ? `Staged ${result.changes} change(s) — review and commit` : 'No changes');
    } catch (e: any) {
      setErr('Stage error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setSaving(false);
    }
  };

  const memPct = resources?.mem_total_mb && resources?.mem_used_mb
    ? (resources.mem_used_mb / resources.mem_total_mb) * 100 : 0;

  const handleBackup = async () => {
    setBackupMsg('');
    setBackupErr('');
    try {
      await downloadBackup();
      setBackupMsg('Backup downloaded');
    } catch (e: any) {
      setBackupErr('Backup failed: ' + (e.response?.data?.detail || e.message));
    }
  };

  const handleRestoreFile = async (file: File) => {
    if (!confirm(
      `Restore configuration from "${file.name}"?\n\n` +
      'All set/delete commands from the file will be applied on top of the CURRENT configuration (merge, not wipe). ' +
      'This can disrupt connectivity. Continue?'
    )) return;
    setRestoring(true);
    setBackupMsg('');
    setBackupErr('');
    try {
      const r = await restoreBackup(file);
      setBackupMsg(`Restored: ${r.commands} command(s) applied and committed`);
      window.dispatchEvent(new CustomEvent('vyos:config-changed'));
      load();
    } catch (e: any) {
      setBackupErr('Restore failed: ' + (e.response?.data?.detail || e.message));
    } finally {
      setRestoring(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const tzKnown = form.time_zone != null && TIMEZONES.includes(form.time_zone);
  const tzSelectValue = tzCustom || (form.time_zone != null && form.time_zone !== '' && !tzKnown)
    ? 'custom'
    : (tzKnown ? form.time_zone! : '');

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">System</h2>
        <button onClick={() => { load(); loadResources(); }} disabled={loading} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm disabled:opacity-50">
          Refresh
        </button>
      </div>

      {err && <div className="mb-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
      {msg && <div className="mb-4 p-3 bg-green-900/50 rounded border border-green-700 text-sm text-green-200">{msg}</div>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] items-start">
        {/* Settings */}
        <div>
          {loading ? (
            <div className="text-sm text-gray-400">Loading system config…</div>
          ) : (
            <>
              <div className="space-y-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Hostname</label>
                  <input value={form.host_name || ''} onChange={e => setForm({ ...form, host_name: e.target.value || null })} className={inputCls} placeholder="router" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Domain search</label>
                  <input value={form.domain_search || ''} onChange={e => setForm({ ...form, domain_search: e.target.value || null })} className={inputCls} placeholder="example.local" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Timezone</label>
                  <select
                    value={tzSelectValue}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === 'custom') {
                        setTzCustom(true);
                      } else {
                        setTzCustom(false);
                        setForm({ ...form, time_zone: v || null });
                      }
                    }}
                    className={inputCls}
                  >
                    <option value="">Not set</option>
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                    <option value="custom">Custom…</option>
                  </select>
                  {tzSelectValue === 'custom' && (
                    <input
                      value={form.time_zone || ''}
                      onChange={e => setForm({ ...form, time_zone: e.target.value })}
                      className={`${inputCls} mt-2`}
                      placeholder="Europe/Moscow"
                      autoFocus
                    />
                  )}
                  <p className="text-xs text-gray-500 mt-1">IANA name, e.g. UTC or Europe/Moscow</p>
                </div>
                <ListEditor
                  label="DNS servers"
                  values={form.name_servers}
                  placeholder="8.8.8.8"
                  onChange={v => setForm({ ...form, name_servers: v })}
                />
                <ListEditor
                  label="NTP servers"
                  values={form.ntp_servers}
                  placeholder="pool.ntp.org"
                  onChange={v => setForm({ ...form, ntp_servers: v })}
                />
              </div>

              <div className="flex justify-end mt-4">
                <button onClick={save} disabled={saving} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 flex items-center gap-2">
                  {saving && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>}
                  {saving ? 'Staging…' : 'Stage Changes'}
                </button>
              </div>

              {/* Backup / Restore */}
              <div className="mt-6 p-4 bg-gray-800 rounded-lg border border-gray-700">
                <h3 className="font-bold mb-1">Configuration backup</h3>
                <p className="text-xs text-gray-500 mb-3">
                  Backup downloads the running config as a text file of set-commands.
                  Restore applies such a file on top of the current config (merge).
                </p>
                {backupMsg && <div className="mb-2 p-2 bg-green-900/50 rounded border border-green-700 text-sm text-green-200">{backupMsg}</div>}
                {backupErr && <div className="mb-2 p-2 bg-red-900/50 rounded border border-red-700 text-sm text-red-200 whitespace-pre-wrap">{backupErr}</div>}
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={handleBackup} className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600 text-sm flex items-center gap-2">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Download backup
                  </button>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={restoring}
                    className="px-3 py-2 bg-yellow-700 rounded hover:bg-yellow-600 text-sm flex items-center gap-2 disabled:opacity-50"
                  >
                    {restoring && <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>}
                    {restoring ? 'Restoring…' : 'Restore from file…'}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".txt,.conf,.cfg,text/plain"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleRestoreFile(f); }}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Resources */}
        <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
          <div className="flex items-start justify-between mb-3">
            <h3 className="font-bold">Resources</h3>
            <div className="text-right text-xs text-gray-400 space-y-0.5">
              {resources?.device_time && <div>Time: <span className="font-mono text-gray-200">{resources.device_time}</span></div>}
              {resources?.uptime && <div>Uptime: {resources.uptime}</div>}
            </div>
          </div>
          {resErr && <div className="mb-2 text-sm text-red-300">{resErr}</div>}
          {!resources && !resErr ? (
            <div className="text-sm text-gray-400">Loading…</div>
          ) : resources && (
            <div className="space-y-5">
              <div>
                <div className="text-xs uppercase text-gray-400 mb-1">CPU load</div>
                <div className="space-y-1.5">
                  {([['1 min', resources.load1], ['5 min', resources.load5], ['15 min', resources.load15]] as const).map(([label, v]) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 w-10">{label}</span>
                      <Bar pct={v ?? 0} color={(v ?? 0) > 80 ? 'bg-red-500' : (v ?? 0) > 50 ? 'bg-yellow-500' : 'bg-green-500'} />
                      <span className="text-xs font-mono w-12 text-right">{v != null ? `${v.toFixed(0)}%` : '-'}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  {resources.cpu_model}{resources.cpu_cores ? `, ${resources.cpu_cores} core(s)` : ''}{resources.cpu_mhz ? ` @ ${resources.cpu_mhz.toFixed(0)} MHz` : ''}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400 mb-1">Memory</div>
                <Bar pct={memPct} color={memPct > 85 ? 'bg-red-500' : memPct > 65 ? 'bg-yellow-500' : 'bg-green-500'} />
                <div className="text-xs font-mono text-gray-300 mt-1.5">
                  {resources.mem_used_mb?.toFixed(0) ?? '-'} / {resources.mem_total_mb?.toFixed(0) ?? '-'} MB used
                </div>
                <div className="text-xs text-gray-500">free: {resources.mem_free_mb?.toFixed(0) ?? '-'} MB</div>
              </div>
              <div>
                <div className="text-xs uppercase text-gray-400 mb-1">Disk {resources.disk_fs && <span className="font-mono normal-case">({resources.disk_fs})</span>}</div>
                <Bar pct={resources.disk_used_pct ?? 0} color={(resources.disk_used_pct ?? 0) > 85 ? 'bg-red-500' : (resources.disk_used_pct ?? 0) > 65 ? 'bg-yellow-500' : 'bg-green-500'} />
                <div className="text-xs font-mono text-gray-300 mt-1.5">
                  {resources.disk_used ?? '-'} / {resources.disk_size ?? '-'} ({resources.disk_used_pct ?? '-'}%)
                </div>
                <div className="text-xs text-gray-500">available: {resources.disk_available ?? '-'}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

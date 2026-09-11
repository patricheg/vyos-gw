import { useEffect, useState } from 'react';
import { connectDevice, setupDeviceViaSsh, getSavedDevices, deleteSavedDevice } from '../api/client';
import type { SavedDevice } from '../types';

const inputCls = 'w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500';

export default function ConnectionPage({ onConnected }: { onConnected: () => void }) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8443');
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');
  const [devices, setDevices] = useState<SavedDevice[]>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [err, setErr] = useState('');

  // SSH bootstrap mode (API not configured on the device)
  const [sshMode, setSshMode] = useState(false);
  const [sshUser, setSshUser] = useState('vyos');
  const [sshPass, setSshPass] = useState('');
  const [apiFailDetail, setApiFailDetail] = useState('');

  // generated key, shown exactly once until the user confirms
  const [newKey, setNewKey] = useState<string | null>(null);

  const loadDevices = () => getSavedDevices().then(setDevices).catch(() => {});
  useEffect(() => { loadDevices(); }, []);

  const handleConnect = async () => {
    if (!host.trim() || !apiKey.trim()) { setErr('Enter the device address and API key'); return; }
    setErr('');
    setWorking('connect');
    try {
      const res = await connectDevice({
        host: host.trim(),
        port: Number(port) || 8443,
        api_key: apiKey.trim(),
        label: label.trim() || undefined,
      });
      if (res.status === 'ok') { onConnected(); return; }
      setApiFailDetail(res.detail || '');
      if (res.ssh_available) {
        setSshMode(true);
      } else {
        setErr(`API is unreachable: ${res.detail}. SSH (port 22) is not answering either — check the address and connectivity.`);
      }
    } catch (e: any) {
      setErr('Connect error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const handleSshSetup = async () => {
    if (!sshUser.trim() || !sshPass) { setErr('Enter SSH credentials'); return; }
    setErr('');
    setWorking('ssh');
    try {
      const res = await setupDeviceViaSsh({
        host: host.trim(),
        ssh_user: sshUser.trim(),
        ssh_password: sshPass,
        api_port: Number(port) || 8443,
        label: label.trim() || undefined,
      });
      setNewKey(res.api_key);
    } catch (e: any) {
      setErr('Setup error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const handleSaved = async (id: string) => {
    setErr('');
    setWorking('saved-' + id);
    try {
      const res = await connectDevice({ device_id: id });
      if (res.status === 'ok') { onConnected(); return; }
      setErr('Connect failed: ' + (res.detail || 'device unreachable'));
    } catch (e: any) {
      setErr('Connect error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const handleDeleteSaved = async (id: string) => {
    await deleteSavedDevice(id).catch(() => {});
    loadDevices();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-white">VyOS Web Gateway</h1>
          <p className="text-sm text-gray-400 mt-1">Connect to a device to manage it</p>
        </div>

        {devices.length > 0 && (
          <div className="mb-4 p-4 bg-gray-800 rounded-xl border border-gray-700">
            <div className="text-xs uppercase text-gray-400 font-semibold mb-2">Saved devices</div>
            <div className="space-y-1.5">
              {devices.map(d => (
                <div key={d.id} className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleSaved(d.id)}
                    disabled={working !== null}
                    className="flex-1 text-left px-3 py-2 bg-gray-900 rounded border border-gray-700 hover:border-blue-500 text-sm disabled:opacity-50"
                  >
                    <span className="font-medium text-white">{d.label || d.host}</span>
                    <span className="text-gray-400 font-mono text-xs ml-2">{d.host}:{d.port}</span>
                  </button>
                  <button onClick={() => handleDeleteSaved(d.id)} className="text-red-400 hover:text-red-300 text-sm px-1" title="Forget this device">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="p-5 bg-gray-800 rounded-xl border border-gray-700">
          {!sshMode ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm text-gray-400 mb-1">Device address</label>
                  <input value={host} onChange={e => setHost(e.target.value)} className={inputCls} placeholder="192.168.1.1 or gw.example.com" autoFocus />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">API port</label>
                  <input type="number" value={port} onChange={e => setPort(e.target.value)} className={inputCls} placeholder="8443" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">API key</label>
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleConnect(); }} className={inputCls} placeholder="REST API key" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Label (optional)</label>
                <input value={label} onChange={e => setLabel(e.target.value)} className={inputCls} placeholder="main-gw" />
              </div>
              <button onClick={handleConnect} disabled={working !== null} className="w-full px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
                {working === 'connect' ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-yellow-900/40 rounded border border-yellow-700/60 text-sm text-yellow-200">
                The REST API is not answering on <span className="font-mono">{host}:{port}</span>, but the device
                is reachable via SSH. Enter SSH credentials — the API will be configured automatically
                on port <strong>{port}</strong> and an API key will be generated.
              </div>
              {apiFailDetail && <div className="text-xs text-gray-500 font-mono break-all">{apiFailDetail}</div>}
              <div>
                <label className="block text-sm text-gray-400 mb-1">SSH user</label>
                <input value={sshUser} onChange={e => setSshUser(e.target.value)} className={inputCls} placeholder="vyos" />
                <p className="text-xs text-gray-500 mt-1">The default VyOS account is <span className="font-mono">vyos</span></p>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">SSH password</label>
                <input type="password" value={sshPass} onChange={e => setSshPass(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSshSetup(); }} className={inputCls} placeholder="••••••••" />
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setSshMode(false); setErr(''); }} disabled={working !== null} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">
                  Back
                </button>
                <button onClick={handleSshSetup} disabled={working !== null} className="flex-1 px-4 py-2 rounded bg-green-700 hover:bg-green-600 text-white font-medium disabled:opacity-50">
                  {working === 'ssh' ? 'Configuring…' : 'Configure API & Connect'}
                </button>
              </div>
            </div>
          )}
          {err && <div className="mt-3 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200">{err}</div>}
        </div>
      </div>

      {/* Generated API key — must be acknowledged, no other way out */}
      {newKey && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 px-4">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md border border-yellow-600/60 shadow-xl">
            <h3 className="text-lg font-bold mb-2 text-yellow-300">Save this API key</h3>
            <p className="text-sm text-gray-300 mb-3">
              The REST API on <span className="font-mono">{host}</span> is configured and the console is connected.
              This key was generated for it:
            </p>
            <div className="p-3 bg-gray-900 rounded border border-gray-600 font-mono text-sm text-green-300 break-all select-all">
              {newKey}
            </div>
            <p className="text-sm text-yellow-200 mt-3">
              ⚠ The key is shown only once. Save it — you will need it to connect to this device from other browsers
              or after clearing saved devices. (It is also stored in this console's device list.)
            </p>
            <button onClick={() => { setNewKey(null); onConnected(); }} className="mt-4 w-full px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium">
              OK, I saved the key
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

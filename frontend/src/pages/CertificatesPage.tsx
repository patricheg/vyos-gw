import { useEffect, useState } from 'react';
import {
  getPki,
  importPkiCertificate, deletePkiCertificate, exportPkiCertificate, getPkiCertificateText,
  importPkiCa, deletePkiCa, exportPkiCa,
  createAcmeCertificate, renewAcmeCertificates,
} from '../api/client';
import type { PkiConfig } from '../types';

const inputCls = 'w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded focus:outline-none focus:border-blue-500';
const textareaCls = inputCls + ' font-mono text-xs h-32 resize-y';

function expiryBadge(days: number | null, notAfter: string | null) {
  if (days === null) return <span className="text-gray-500">-</span>;
  const cls = days < 0
    ? 'bg-red-900 text-red-300'
    : days < 14
      ? 'bg-red-900/70 text-red-300'
      : days < 30
        ? 'bg-yellow-900 text-yellow-300'
        : 'bg-emerald-900 text-emerald-300';
  const label = days < 0 ? `expired ${-days}d ago` : `${days}d left`;
  return (
    <span title={notAfter || ''} className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${cls}`}>{label}</span>
  );
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/x-pem-file' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CertificatesPage() {
  const [cfg, setCfg] = useState<PkiConfig>({ certificates: [], ca_certificates: [] });
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [working, setWorking] = useState<string | null>(null);

  const [showImport, setShowImport] = useState(false);
  const [importForm, setImportForm] = useState({ name: '', certificate: '', private_key: '', description: '' });

  const [showCaImport, setShowCaImport] = useState(false);
  const [caForm, setCaForm] = useState({ name: '', certificate: '', description: '' });

  const [showAcme, setShowAcme] = useState(false);
  const [acmeForm, setAcmeForm] = useState({ name: '', domains: '', email: '', listen_address: '', rsa_key_size: 2048, url: '', description: '' });

  const [viewName, setViewName] = useState<string | null>(null);
  const [viewText, setViewText] = useState('');

  const load = () => {
    setLoading(true);
    setErr('');
    getPki()
      .then(setCfg)
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

  const handleImport = async () => {
    setErr(''); setMsg('');
    if (!importForm.name.trim() || !importForm.certificate.trim()) {
      setErr('Name and certificate PEM are required');
      return;
    }
    setWorking('import');
    try {
      await importPkiCertificate({
        name: importForm.name.trim(),
        certificate: importForm.certificate,
        private_key: importForm.private_key.trim() || null,
        description: importForm.description.trim() || null,
      });
      setMsg(`Certificate ${importForm.name} import staged — review and commit`);
      setShowImport(false);
      setImportForm({ name: '', certificate: '', private_key: '', description: '' });
    } catch (e: any) {
      setErr('Import error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const handleImportCa = async () => {
    setErr(''); setMsg('');
    if (!caForm.name.trim() || !caForm.certificate.trim()) {
      setErr('Name and CA certificate PEM are required');
      return;
    }
    setWorking('import-ca');
    try {
      await importPkiCa({
        name: caForm.name.trim(),
        certificate: caForm.certificate,
        description: caForm.description.trim() || null,
      });
      setMsg(`CA ${caForm.name} import staged — review and commit`);
      setShowCaImport(false);
      setCaForm({ name: '', certificate: '', description: '' });
    } catch (e: any) {
      setErr('Import error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const handleAcme = async () => {
    setErr(''); setMsg('');
    const domains = acmeForm.domains.split(',').map(d => d.trim()).filter(Boolean);
    if (!acmeForm.name.trim() || domains.length === 0 || !acmeForm.email.trim()) {
      setErr('Name, at least one domain and email are required');
      return;
    }
    setWorking('acme');
    try {
      await createAcmeCertificate({
        name: acmeForm.name.trim(),
        domains,
        email: acmeForm.email.trim(),
        listen_address: acmeForm.listen_address.trim() || null,
        rsa_key_size: acmeForm.rsa_key_size as 2048 | 3072 | 4096,
        url: acmeForm.url.trim() || null,
        description: acmeForm.description.trim() || null,
      });
      setMsg(`Let's Encrypt certificate ${acmeForm.name} staged. Committing will run certbot — the router must be reachable from the Internet on port 80 (HTTP-01 challenge).`);
      setShowAcme(false);
      setAcmeForm({ name: '', domains: '', email: '', listen_address: '', rsa_key_size: 2048, url: '', description: '' });
    } catch (e: any) {
      setErr('ACME error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete certificate ${name}?`)) return;
    setWorking('del-' + name);
    setErr(''); setMsg('');
    setCfg(prev => ({ ...prev, certificates: prev.certificates.filter(c => c.name !== name) }));
    try {
      await deletePkiCertificate(name);
      setMsg(`Certificate ${name} deletion staged — review and commit`);
    } catch (e: any) {
      setErr('Delete error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const handleDeleteCa = async (name: string) => {
    if (!confirm(`Delete CA ${name}?`)) return;
    setWorking('del-ca-' + name);
    setErr(''); setMsg('');
    setCfg(prev => ({ ...prev, ca_certificates: prev.ca_certificates.filter(c => c.name !== name) }));
    try {
      await deletePkiCa(name);
      setMsg(`CA ${name} deletion staged — review and commit`);
    } catch (e: any) {
      setErr('Delete error: ' + (e.response?.data?.detail || e.message));
      load();
    } finally {
      setWorking(null);
    }
  };

  const handleExport = async (name: string) => {
    setErr('');
    const includeKey = confirm('Include the private key in the export?\n\nOK = certificate + private key\nCancel = certificate only');
    try {
      const pem = await exportPkiCertificate(name, includeKey);
      download(`${name}${includeKey ? '-bundle' : ''}.pem`, pem);
    } catch (e: any) {
      setErr('Export error: ' + (e.response?.data?.detail || e.message));
    }
  };

  const handleExportCa = async (name: string) => {
    setErr('');
    try {
      const pem = await exportPkiCa(name);
      download(`ca-${name}.pem`, pem);
    } catch (e: any) {
      setErr('Export error: ' + (e.response?.data?.detail || e.message));
    }
  };

  const handleView = async (name: string) => {
    setWorking('view-' + name);
    setErr('');
    try {
      const text = await getPkiCertificateText(name);
      setViewText(text);
      setViewName(name);
    } catch (e: any) {
      setErr('View error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const handleRenew = async () => {
    if (!confirm('Run certbot renewal now (renew certbot force)? This talks to the ACME server immediately.')) return;
    setWorking('renew');
    setErr(''); setMsg('');
    try {
      const r = await renewAcmeCertificates();
      setMsg('Renewal finished. ' + (r.output || '').trim());
      load();
    } catch (e: any) {
      setErr('Renew error: ' + (e.response?.data?.detail || e.message));
    } finally {
      setWorking(null);
    }
  };

  const hasAcme = cfg.certificates.some(c => c.acme);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Certificates (PKI)</h2>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-sm disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button onClick={() => { setShowAcme(true); setErr(''); setMsg(''); }} className="px-3 py-1 bg-green-700 rounded hover:bg-green-600 text-sm text-white font-medium">
            + Let's Encrypt
          </button>
          <button onClick={() => { setShowImport(true); setErr(''); setMsg(''); }} className="px-3 py-1 bg-blue-600 rounded hover:bg-blue-500 text-sm text-white font-medium">
            + Import Certificate
          </button>
          <button onClick={() => { setShowCaImport(true); setErr(''); setMsg(''); }} className="px-3 py-1 bg-indigo-600 rounded hover:bg-indigo-500 text-sm text-white font-medium">
            + Import CA
          </button>
          {hasAcme && (
            <button onClick={handleRenew} disabled={isWorking('renew')} className="px-3 py-1 bg-yellow-700 rounded hover:bg-yellow-600 text-sm text-white disabled:opacity-50">
              {isWorking('renew') ? 'Renewing…' : 'Renew LE now'}
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 p-3 bg-gray-800/80 rounded border border-gray-700 text-sm text-gray-300">
        <strong className="text-white">Let's Encrypt note:</strong> committing an ACME certificate makes the router run
        certbot immediately — the domain must point to the router and port <strong>80 must be reachable from the Internet</strong>
        (HTTP-01 challenge; don't forget an input-chain firewall rule). VyOS renews ACME certificates automatically.
      </div>

      {err && <div className="mb-4 p-3 bg-red-900/50 rounded border border-red-700 text-sm text-red-200 whitespace-pre-wrap">{err}</div>}
      {msg && <div className="mb-4 p-3 bg-green-900/50 rounded border border-green-700 text-sm text-green-200">{msg}</div>}

      {/* Certificates */}
      <h3 className="text-lg font-semibold mb-3">Certificates</h3>
      {loading && cfg.certificates.length === 0 ? (
        <div className="text-gray-400 mb-6">Loading…</div>
      ) : cfg.certificates.length === 0 ? (
        <div className="mb-6 p-6 border border-dashed border-gray-600 rounded-lg text-center text-gray-400">
          No certificates yet. Import one or request a Let's Encrypt certificate.
        </div>
      ) : (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-left border border-gray-700 rounded-lg overflow-hidden">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Subject CN</th>
                <th className="px-4 py-3">Issuer</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3">Info</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {cfg.certificates.map(c => (
                <tr key={c.name} className="hover:bg-gray-800/50">
                  <td className="px-4 py-2.5 font-mono text-blue-300">{c.name}</td>
                  <td className="px-4 py-2.5 text-sm">{c.subject || <span className="text-gray-500">not issued yet</span>}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-400">{c.issuer || '-'}</td>
                  <td className="px-4 py-2.5">{expiryBadge(c.expires_in_days, c.not_after)}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {c.acme && <span className="mr-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900 text-green-300" title={`ACME: ${c.acme_domains.join(', ')}`}>ACME</span>}
                    {c.has_private_key && <span className="mr-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-900 text-amber-300">KEY</span>}
                    {c.revoked && <span className="mr-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-900 text-red-300">REVOKED</span>}
                    {c.sans.length > 0 && <span className="text-gray-500" title={c.sans.join(', ')}>+{c.sans.length} SAN</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => handleView(c.name)} disabled={isWorking('view-' + c.name)} className="text-gray-300 hover:text-white text-sm mr-3 disabled:opacity-50">
                      {isWorking('view-' + c.name) ? '…' : 'View'}
                    </button>
                    <button onClick={() => handleExport(c.name)} className="text-blue-400 hover:text-blue-300 text-sm mr-3">Export</button>
                    <button onClick={() => handleDelete(c.name)} disabled={isWorking('del-' + c.name)} className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50">
                      {isWorking('del-' + c.name) ? '…' : 'Del'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CA certificates */}
      <h3 className="text-lg font-semibold mb-3">Certificate Authorities</h3>
      {cfg.ca_certificates.length === 0 ? (
        <div className="p-6 border border-dashed border-gray-600 rounded-lg text-center text-gray-400">
          No CA certificates.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border border-gray-700 rounded-lg overflow-hidden">
            <thead className="bg-gray-800">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Issuer</th>
                <th className="px-4 py-3">Expiry</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {cfg.ca_certificates.map(c => (
                <tr key={c.name} className="hover:bg-gray-800/50">
                  <td className="px-4 py-2.5 font-mono text-indigo-300">{c.name}</td>
                  <td className="px-4 py-2.5 text-sm">{c.subject || '-'}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-400">{c.issuer || '-'}</td>
                  <td className="px-4 py-2.5">{expiryBadge(c.expires_in_days, c.not_after)}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-400">{c.description || '-'}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => handleExportCa(c.name)} className="text-blue-400 hover:text-blue-300 text-sm mr-3">Export</button>
                    <button onClick={() => handleDeleteCa(c.name)} disabled={isWorking('del-ca-' + c.name)} className="text-red-400 hover:text-red-300 text-sm disabled:opacity-50">
                      {isWorking('del-ca-' + c.name) ? '…' : 'Del'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Import certificate modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-xl border border-gray-700 shadow-xl">
            <h3 className="text-lg font-bold mb-4">Import Certificate</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Name</label>
                  <input value={importForm.name} onChange={e => setImportForm({ ...importForm, name: e.target.value })} className={inputCls} placeholder="my-cert" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Description</label>
                  <input value={importForm.description} onChange={e => setImportForm({ ...importForm, description: e.target.value })} className={inputCls} placeholder="optional" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Certificate (PEM)</label>
                <textarea value={importForm.certificate} onChange={e => setImportForm({ ...importForm, certificate: e.target.value })} className={textareaCls} placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Private key (PEM, optional)</label>
                <textarea value={importForm.private_key} onChange={e => setImportForm({ ...importForm, private_key: e.target.value })} className={textareaCls} placeholder="-----BEGIN PRIVATE KEY-----&#10;…&#10;-----END PRIVATE KEY-----" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowImport(false)} disabled={isWorking('import')} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleImport} disabled={isWorking('import')} className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
                {isWorking('import') ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import CA modal */}
      {showCaImport && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-xl border border-gray-700 shadow-xl">
            <h3 className="text-lg font-bold mb-4">Import CA Certificate</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Name</label>
                  <input value={caForm.name} onChange={e => setCaForm({ ...caForm, name: e.target.value })} className={inputCls} placeholder="my-ca" />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Description</label>
                  <input value={caForm.description} onChange={e => setCaForm({ ...caForm, description: e.target.value })} className={inputCls} placeholder="optional" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">CA Certificate (PEM)</label>
                <textarea value={caForm.certificate} onChange={e => setCaForm({ ...caForm, certificate: e.target.value })} className={textareaCls} placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCaImport(false)} disabled={isWorking('import-ca')} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleImportCa} disabled={isWorking('import-ca')} className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50">
                {isWorking('import-ca') ? 'Importing…' : 'Import CA'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ACME / Let's Encrypt modal */}
      {showAcme && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-lg border border-gray-700 shadow-xl">
            <h3 className="text-lg font-bold mb-4">New Let's Encrypt Certificate</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <input value={acmeForm.name} onChange={e => setAcmeForm({ ...acmeForm, name: e.target.value })} className={inputCls} placeholder="le-web" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Email</label>
                <input value={acmeForm.email} onChange={e => setAcmeForm({ ...acmeForm, email: e.target.value })} className={inputCls} placeholder="admin@example.com" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-400 mb-1">Domains (comma-separated)</label>
                <input value={acmeForm.domains} onChange={e => setAcmeForm({ ...acmeForm, domains: e.target.value })} className={inputCls} placeholder="gw.example.com, www.example.com" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Listen address (optional)</label>
                <input value={acmeForm.listen_address} onChange={e => setAcmeForm({ ...acmeForm, listen_address: e.target.value })} className={inputCls} placeholder="router IP for HTTP-01" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">RSA key size</label>
                <select value={acmeForm.rsa_key_size} onChange={e => setAcmeForm({ ...acmeForm, rsa_key_size: Number(e.target.value) })} className={inputCls}>
                  <option value={2048}>2048</option>
                  <option value={3072}>3072</option>
                  <option value={4096}>4096</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-400 mb-1">ACME directory URL (optional)</label>
                <input value={acmeForm.url} onChange={e => setAcmeForm({ ...acmeForm, url: e.target.value })} className={inputCls} placeholder="default: https://acme-v02.api.letsencrypt.org/directory" />
              </div>
              <div className="col-span-2">
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <input value={acmeForm.description} onChange={e => setAcmeForm({ ...acmeForm, description: e.target.value })} className={inputCls} placeholder="optional" />
              </div>
            </div>
            <p className="mt-3 text-xs text-yellow-300/80">
              Commit runs certbot on the router: the domain must resolve to the router and port 80 must accept
              connections from the Internet. If the challenge fails, the commit fails.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAcme(false)} disabled={isWorking('acme')} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-50">Cancel</button>
              <button onClick={handleAcme} disabled={isWorking('acme')} className="px-4 py-2 rounded bg-green-700 hover:bg-green-600 text-white font-medium disabled:opacity-50">
                {isWorking('acme') ? 'Staging…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View certificate text modal */}
      {viewName && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-3xl border border-gray-700 shadow-xl max-h-[85vh] flex flex-col">
            <h3 className="text-lg font-bold mb-4">Certificate <span className="text-blue-400">{viewName}</span></h3>
            <pre className="flex-1 overflow-auto p-3 bg-gray-900 rounded border border-gray-700 text-xs text-gray-300 whitespace-pre-wrap">{viewText}</pre>
            <div className="flex justify-end mt-4">
              <button onClick={() => setViewName(null)} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

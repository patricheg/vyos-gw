import axios from 'axios';
import type { Interface, FirewallRuleset, FirewallRule, LogEntry, SystemConfig, SystemResources, FirewallLogEntry, ServiceInfo, NatRule, HaproxyConfig, HaproxyService, HaproxyBackend, HaproxyGlobals, GeoipStatus, PkiConfig, PkiAcmeCreate, RouteEntry, StaticRoute, AddressGroup } from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// On 401 the session expired or was never established — tell the App gate
// to show the login screen again.
api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401 && !String(err.config?.url || '').startsWith('/auth/')) {
      window.dispatchEvent(new Event('vgw:unauthorized'));
    }
    return Promise.reject(err);
  },
);

// Auth (local web-UI password)
export interface AuthStatus { configured: boolean; authenticated: boolean }
export const getAuthStatus = () => api.get<AuthStatus>('/auth/status').then(r => r.data);
export const setupPassword = (username: string, password: string) =>
  api.post('/auth/setup', { username, password }).then(r => r.data);
export const login = (username: string, password: string) =>
  api.post('/auth/login', { username, password }).then(r => r.data);
export const logout = () => api.post('/auth/logout').then(r => r.data);
export const changePassword = (old_password: string, new_password: string) =>
  api.post('/auth/password', { old_password, new_password }).then(r => r.data);

export const getInterfaces = () => api.get<Interface[]>('/interfaces/').then(r => r.data);
export const updateInterface = (name: string, data: Partial<Interface>) =>
  api.put(`/interfaces/${name}`, data).then(r => r.data);

// Firewall base chains (input / forward / output)
export const getChains = () => api.get<FirewallRuleset[]>('/firewall/chains').then(r => r.data);
export const setDefaultAction = (chain: string, action: string) =>
  api.put(`/firewall/chains/${chain}/default-action`, { action }).then(r => r.data);
export const addRule = (chain: string, rule: FirewallRule) =>
  api.post(`/firewall/chains/${chain}/rules`, rule).then(r => r.data);
export const deleteRule = (chain: string, number: number) =>
  api.delete(`/firewall/chains/${chain}/rules/${number}`).then(r => r.data);
export const updateRule = (chain: string, number: number, rule: FirewallRule) =>
  api.put(`/firewall/chains/${chain}/rules/${number}`, rule).then(r => r.data);
export const reorderChain = (chain: string, orderedNumbers: number[]) =>
  api.post(`/firewall/chains/${chain}/reorder`, orderedNumbers).then(r => r.data);

export const getAddressGroups = () => api.get<AddressGroup[]>('/firewall/groups').then(r => r.data);
export const addAddressGroup = (group: AddressGroup) =>
  api.post('/firewall/groups', group).then(r => r.data);
export const updateAddressGroup = (name: string, group: AddressGroup) =>
  api.put(`/firewall/groups/${name}`, group).then(r => r.data);
export const deleteAddressGroup = (name: string) =>
  api.delete(`/firewall/groups/${name}`).then(r => r.data);

// Logs
export interface LogQuery {
  source?: string;
  severity?: 'error' | 'warning' | 'info';
  search?: string;
  lines?: number;
}
export const getLogs = (params: LogQuery) =>
  api.get<LogEntry[]>('/logs/', { params }).then(r => r.data);

// System
export const getSystem = () => api.get<SystemConfig>('/system/').then(r => r.data);
export const updateSystem = (data: SystemConfig) => api.put('/system/', data).then(r => r.data);
export const getSystemResources = () => api.get<SystemResources>('/system/resources').then(r => r.data);
export const saveSystemConfig = () => api.post<{ status: string; detail: string }>('/system/save').then(r => r.data);
export const downloadBackup = async () => {
  const r = await api.get('/system/backup', { responseType: 'blob' });
  const dispo = String(r.headers['content-disposition'] || '');
  const m = dispo.match(/filename="?([^";]+)"?/);
  const url = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = m ? m[1] : 'vyos-backup.txt';
  a.click();
  URL.revokeObjectURL(url);
};
export const restoreBackup = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.post<{ status: string; commands: number; detail: string }>('/system/restore', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300000,
  }).then(r => r.data);
};

// Firewall logs (parsed netfilter entries)
export interface FirewallLogQuery {
  action?: 'accept' | 'drop' | 'reject';
  chain?: string;
  src?: string;
  dst?: string;
  proto?: string;
  port?: string;
  lines?: number;
}
export const getFirewallLogs = (params: FirewallLogQuery) =>
  api.get<FirewallLogEntry[]>('/logs/firewall', { params }).then(r => r.data);

// Services
export const getServices = () => api.get<ServiceInfo[]>('/services/').then(r => r.data);

// NAT (destination / port forwarding)
export const getNatRules = () => api.get<NatRule[]>('/nat/destination').then(r => r.data);
export const addNatRule = (rule: NatRule) =>
  api.post('/nat/destination/rules', rule).then(r => r.data);
export const updateNatRule = (number: number, rule: NatRule) =>
  api.put(`/nat/destination/rules/${number}`, rule).then(r => r.data);
export const deleteNatRule = (number: number) =>
  api.delete(`/nat/destination/rules/${number}`).then(r => r.data);
export const toggleNatRule = (number: number, disabled: boolean) =>
  api.put(`/nat/destination/rules/${number}/disabled`, { disabled }).then(r => r.data);

export const getRoutingTable = () => api.get<RouteEntry[]>('/routes/table').then(r => r.data);
export const getStaticRoutes = () => api.get<StaticRoute[]>('/routes/static').then(r => r.data);
export const addStaticRoute = (route: StaticRoute) =>
  api.post('/routes/static', route).then(r => r.data);
export const updateStaticRoute = (prefix: string, route: StaticRoute) =>
  api.put(`/routes/static/${prefix}`, route).then(r => r.data);
export const deleteStaticRoute = (prefix: string) =>
  api.delete(`/routes/static/${prefix}`).then(r => r.data);
export const toggleStaticRoute = (prefix: string, disabled: boolean) =>
  api.put(`/routes/static/${prefix}/disabled`, { disabled }).then(r => r.data);

// HAProxy (container-based)
export const getHaproxy = () => api.get<HaproxyConfig>('/haproxy').then(r => r.data);
export interface HaproxyStatus {
  provisioned: boolean;
  builtin_active: boolean;
  image: string;
  image_present: boolean | null;
  running: boolean | null;
}
export const getHaproxyStatus = () => api.get<HaproxyStatus>('/haproxy/status').then(r => r.data);
export const provisionHaproxy = () =>
  api.post('/haproxy/provision', null, { timeout: 900000 }).then(r => r.data);
export const migrateHaproxy = () => api.post('/haproxy/migrate').then(r => r.data);
export const addHaproxyService = (svc: HaproxyService) =>
  api.post('/haproxy/services', svc).then(r => r.data);
export const createHaproxyAcmeStub = (listen_address: string) =>
  api.post('/haproxy/acme-stub', { listen_address }).then(r => r.data);
export const updateHaproxyService = (name: string, svc: HaproxyService) =>
  api.put(`/haproxy/services/${name}`, svc).then(r => r.data);
export const deleteHaproxyService = (name: string) =>
  api.delete(`/haproxy/services/${name}`).then(r => r.data);
export const addHaproxyBackend = (be: HaproxyBackend) =>
  api.post('/haproxy/backends', be).then(r => r.data);
export const updateHaproxyBackend = (name: string, be: HaproxyBackend) =>
  api.put(`/haproxy/backends/${name}`, be).then(r => r.data);
export const deleteHaproxyBackend = (name: string) =>
  api.delete(`/haproxy/backends/${name}`).then(r => r.data);
export const updateHaproxyGlobals = (data: HaproxyGlobals) =>
  api.put('/haproxy/globals', data).then(r => r.data);

// GeoIP DB (DB-IP Lite → HAProxy map)
export const getGeoipStatus = () => api.get<GeoipStatus>('/haproxy/geoip/status').then(r => r.data);
export const updateGeoipDb = () =>
  api.post<GeoipStatus>('/haproxy/geoip/update', null, { timeout: 300000 }).then(r => r.data);

// Deploy (on-device console container)
export interface DeployStatus {
  on_device: boolean;
  container_configured: boolean;
  image_present: boolean | null;
  data_seeded: boolean | null;
}
export interface DeployProvisionResult {
  build: string;
  image: string;
  data_seeded: boolean;
  staged: boolean;
}
export const getDeployStatus = () => api.get<DeployStatus>('/deploy/status').then(r => r.data);
export const provisionDeploy = () =>
  api.post<DeployProvisionResult>('/deploy/provision', null, { timeout: 900000 }).then(r => r.data);

// PKI (certificates)
export const getPki = () => api.get<PkiConfig>('/pki').then(r => r.data);
export const importPkiCertificate = (data: { name: string; certificate: string; private_key?: string | null; description?: string | null }) =>
  api.post('/pki/certificates', data).then(r => r.data);
export const deletePkiCertificate = (name: string) =>
  api.delete(`/pki/certificates/${name}`).then(r => r.data);
export const exportPkiCertificate = (name: string, includeKey: boolean) =>
  api.get<string>(`/pki/certificates/${name}/export`, { params: { include_key: includeKey }, responseType: 'text' }).then(r => r.data);
export const getPkiCertificateText = (name: string) =>
  api.get<string>(`/pki/certificates/${name}/text`, { responseType: 'text' }).then(r => r.data);
export const importPkiCa = (data: { name: string; certificate: string; description?: string | null }) =>
  api.post('/pki/ca', data).then(r => r.data);
export const deletePkiCa = (name: string) =>
  api.delete(`/pki/ca/${name}`).then(r => r.data);
export const exportPkiCa = (name: string) =>
  api.get<string>(`/pki/ca/${name}/export`, { responseType: 'text' }).then(r => r.data);
export const createAcmeCertificate = (data: PkiAcmeCreate) =>
  api.post('/pki/acme', data).then(r => r.data);
export const renewAcmeCertificates = () =>
  api.post<{ status: string; output: string }>('/pki/renew').then(r => r.data);

// Staging API
export interface StagedChange {
  id: string;
  command: string;
  description: string;
  category: string;
}

export const getStaged = () => api.get<StagedChange[]>('/staged/').then(r => r.data);
export const commitStaged = () => api.post('/staged/commit').then(r => r.data);
export const discardStaged = () => api.delete('/staged/').then(r => r.data);
export const removeStaged = (id: string) => api.delete(`/staged/${id}`).then(r => r.data);

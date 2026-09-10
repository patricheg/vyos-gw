import axios from 'axios';
import type { Interface, FirewallRuleset, FirewallRule, LogEntry, SystemConfig, SystemResources, FirewallLogEntry, ServiceInfo, NatRule } from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

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

import { useCallback, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ConnectionPage from './pages/ConnectionPage';
import InterfacesPage from './pages/InterfacesPage';
import FirewallPage from './pages/FirewallPage';
import NatPage from './pages/NatPage';
import RoutesPage from './pages/RoutesPage';
import HaproxyPage from './pages/HaproxyPage';
import CertificatesPage from './pages/CertificatesPage';
import LogsPage from './pages/LogsPage';
import FirewallLogsPage from './pages/FirewallLogsPage';
import ServicesPage from './pages/ServicesPage';
import SystemPage from './pages/SystemPage';
import { getConnectionStatus, disconnectDevice } from './api/client';

export default function App() {
  const [connected, setConnected] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    getConnectionStatus()
      .then(s => setConnected(s.connected))
      .catch(() => setConnected(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSwitch = useCallback(async () => {
    await disconnectDevice().catch(() => {});
    refresh();
  }, [refresh]);

  if (connected === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Connecting…
      </div>
    );
  }

  if (!connected) {
    return <ConnectionPage onConnected={refresh} />;
  }

  return (
    <Layout onSwitchDevice={handleSwitch}>
      <Routes>
        <Route path="/" element={<InterfacesPage />} />
        <Route path="/firewall" element={<FirewallPage />} />
        <Route path="/nat" element={<NatPage />} />
        <Route path="/routes" element={<RoutesPage />} />
        <Route path="/haproxy" element={<HaproxyPage />} />
        <Route path="/certificates" element={<CertificatesPage />} />
        <Route path="/firewall-logs" element={<FirewallLogsPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/system" element={<SystemPage />} />
      </Routes>
    </Layout>
  );
}

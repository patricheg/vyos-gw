import { useCallback, useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
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
import { getAuthStatus, logout, AuthStatus } from './api/client';

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  const refresh = useCallback(() => {
    getAuthStatus()
      .then(setAuth)
      .catch(() => setAuth({ configured: true, authenticated: false }));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Any 401 from the API drops us back to the login screen.
  useEffect(() => {
    const onUnauthorized = () => setAuth(a => (a ? { ...a, authenticated: false } : a));
    window.addEventListener('vgw:unauthorized', onUnauthorized);
    return () => window.removeEventListener('vgw:unauthorized', onUnauthorized);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout().catch(() => {});
    refresh();
  }, [refresh]);

  if (auth === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Loading…
      </div>
    );
  }

  if (!auth.configured) {
    return <LoginPage mode="setup" onDone={refresh} />;
  }
  if (!auth.authenticated) {
    return <LoginPage mode="login" onDone={refresh} />;
  }

  return (
    <Layout onLogout={handleLogout}>
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

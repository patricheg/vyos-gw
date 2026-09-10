import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import InterfacesPage from './pages/InterfacesPage';
import FirewallPage from './pages/FirewallPage';
import NatPage from './pages/NatPage';
import LogsPage from './pages/LogsPage';
import FirewallLogsPage from './pages/FirewallLogsPage';
import ServicesPage from './pages/ServicesPage';
import SystemPage from './pages/SystemPage';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<InterfacesPage />} />
        <Route path="/firewall" element={<FirewallPage />} />
        <Route path="/nat" element={<NatPage />} />
        <Route path="/firewall-logs" element={<FirewallLogsPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/system" element={<SystemPage />} />
      </Routes>
    </Layout>
  );
}

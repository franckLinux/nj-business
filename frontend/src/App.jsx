import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import Layout from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import JournalPage from '@/pages/JournalPage';
import AttentePage from '@/pages/AttentePage';
import JournauxRecapPage from '@/pages/JournauxRecapPage';
import BudgetPage from '@/pages/BudgetPage';
import PrevisionsPage from '@/pages/PrevisionsPage';
import AppelFondsPage from '@/pages/AppelFondsPage';
import CompteEmploiPage from '@/pages/CompteEmploiPage';
import ConfigPage from '@/pages/ConfigPage';
import TenantsPage from '@/pages/TenantsPage';
import PermissionsPage from '@/pages/PermissionsPage';
import PwaBootstrap from '@/components/PwaBootstrap';
import OfflineIndicator from '@/components/OfflineIndicator';

// Toutes les pages listées dans MIGRATION.md sont désormais portées.
export default function App() {
  const { isAuthenticated } = useApp();

  return (
    <>
      <PwaBootstrap />
      <OfflineIndicator />
      {isAuthenticated ? <AuthenticatedApp /> : <LoginPage />}
    </>
  );
}

function AuthenticatedApp() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="journal/:id"    element={<JournalPage />} />
        <Route path="journaux-recap" element={<JournauxRecapPage />} />
        <Route path="budget"         element={<BudgetPage />} />
        <Route path="previsions"     element={<PrevisionsPage />} />
        <Route path="appel-fonds"    element={<AppelFondsPage />} />
        <Route path="compte-emploi"  element={<CompteEmploiPage />} />
        <Route path="config"         element={<ConfigPage />} />
        <Route path="attente"        element={<AttentePage />} />
        <Route path="tenants"        element={<TenantsPage />} />
        <Route path="permissions"    element={<PermissionsPage />} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

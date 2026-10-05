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
import PlanModelePage from '@/pages/PlanModelePage';
import PlateformePage from '@/pages/PlateformePage';
import PwaBootstrap from '@/components/PwaBootstrap';
import OfflineIndicator from '@/components/OfflineIndicator';
import { PAGE_PERMS, peut, voitConfiguration } from '@/lib/acces';

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

// Garde de route : une URL tapée ou un ancien favori vers un écran non
// autorisé ramène au tableau de bord au lieu d'afficher une erreur 403.
// Tant que la liste des permissions n'est pas chargée, on n'affiche rien.
function Autorise({ code, ok, children }) {
  const { user, can } = useApp();
  if (user && user.role !== 'super_admin' && user.permissions === undefined) return null;
  const permis = ok !== undefined ? ok : peut(can, code);
  return permis ? children : <Navigate to="/" replace />;
}

function AuthenticatedApp() {
  const { user, can } = useApp();
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="journal/:id"    element={<Autorise code="journal.view"><JournalPage /></Autorise>} />
        <Route path="journaux-recap" element={<Autorise code={PAGE_PERMS['/journaux-recap']}><JournauxRecapPage /></Autorise>} />
        <Route path="budget"         element={<Autorise code={PAGE_PERMS['/budget']}><BudgetPage /></Autorise>} />
        <Route path="previsions"     element={<Autorise code={PAGE_PERMS['/previsions']}><PrevisionsPage /></Autorise>} />
        <Route path="appel-fonds"    element={<Autorise code={PAGE_PERMS['/appel-fonds']}><AppelFondsPage /></Autorise>} />
        <Route path="compte-emploi"  element={<Autorise code={PAGE_PERMS['/compte-emploi']}><CompteEmploiPage /></Autorise>} />
        <Route path="config"         element={<Autorise ok={voitConfiguration(user, can)}><ConfigPage /></Autorise>} />
        <Route path="attente"        element={<Autorise code={PAGE_PERMS['/attente']}><AttentePage /></Autorise>} />
        <Route path="tenants"        element={<TenantsPage />} />
        <Route path="permissions"    element={<PermissionsPage />} />
        <Route path="plan-modele"    element={<Autorise ok={user?.role === 'super_admin'}><PlanModelePage /></Autorise>} />
        <Route path="plateforme"     element={<Autorise ok={user?.role === 'super_admin'}><PlateformePage /></Autorise>} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

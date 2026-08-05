import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import Layout from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import PlaceholderPage from '@/pages/PlaceholderPage';

// Routes migrées : tableau de bord.
// Les autres pointent vers PlaceholderPage en attendant leur portage ;
// la nav reste complète pour que l'ergonomie soit déjà celle de la cible.
export default function App() {
  const { isAuthenticated } = useApp();

  if (!isAuthenticated) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="journal/:id"    element={<PlaceholderPage titre="Journal de caisse" />} />
        <Route path="journaux-recap" element={<PlaceholderPage titre="Journaux de caisse" />} />
        <Route path="budget"         element={<PlaceholderPage titre="Suivi budgétaire" />} />
        <Route path="previsions"     element={<PlaceholderPage titre="Prévisions de dépenses" />} />
        <Route path="appel-fonds"    element={<PlaceholderPage titre="Demande de fonds" />} />
        <Route path="compte-emploi"  element={<PlaceholderPage titre="Compte d'emploi" />} />
        <Route path="config"         element={<PlaceholderPage titre="Configuration" />} />
        <Route path="attente"        element={<PlaceholderPage titre="Dépenses en attente" />} />
        <Route path="tenants"        element={<PlaceholderPage titre="Clients (Tenants)" />} />
        <Route path="permissions"    element={<PlaceholderPage titre="Gestion des permissions" />} />
        <Route path="*"              element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

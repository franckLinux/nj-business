import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import TenantSelectorModal from './TenantSelectorModal';
import SupportAcces from './SupportAcces';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';

// Titres de page — repris tels quels de la table `titles` de showPage().
const TITLES = {
  '/': 'Tableau de bord',
  '/journaux-recap': 'Journaux de caisse',
  '/budget': 'Suivi Budgétaire',
  '/previsions': 'Prévisions de dépenses',
  '/appel-fonds': 'Demande de fonds',
  '/compte-emploi': "Compte d'emploi",
  '/config': 'Configuration',
  '/tenants': 'Clients (Tenants)',
  '/permissions': 'Gestion des permissions',
  '/plan-modele': 'Modèle comptable',
  '/plateforme': 'Administration plateforme',
  '/attente': 'Dépenses en attente',
};

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const {
    journaux, peutVoirAttente, isAdmin, user, activeTenantId,
    tenantSelectorOpen, openTenantSelector, closeTenantSelector, selectTenant,
  } = useApp();
  const [badgeAttente, setBadgeAttente] = useState(0);
  const [badgeDepassements, setBadgeDepassements] = useState(0);

  // Un super_admin/comptable_cabinet qui se connecte sans tenant actif doit
  // choisir un client avant de continuer — reprend le bloc de launchApp()
  // (legacy/js/app.js l. 6278-6280) qui ouvre showTenantSelector() au boot.
  // Les écrans d'administration plateforme ne dépendent d'aucun client : on
  // n'y impose pas le choix d'un client.
  const pageSansClient = ['/plan-modele', '/tenants', '/permissions', '/plateforme'].includes(location.pathname);
  useEffect(() => {
    if (isAdmin && !user?.tenantId && !activeTenantId && !pageSansClient) openTenantSelector();
  }, [isAdmin, user, activeTenantId, openTenantSelector, pageSansClient]);

  // Le titre d'une page journal reprend le format « Nom (CODE) ».
  let title = TITLES[location.pathname] || 'Tableau de bord';
  if (location.pathname.startsWith('/journal/')) {
    const j = journaux.find((x) => String(x.id) === String(params.id));
    title = j ? `${j.nom} (${j.code})` : 'Journal de caisse';
  }

  // Badges : rechargés au plus une fois par minute, et non plus à CHAQUE
  // changement de page (2 requêtes par clic dans le menu auparavant).
  const dernierBadges = useRef(0);
  useEffect(() => {
    if (!peutVoirAttente) return;
    if (Date.now() - dernierBadges.current < 60000) return;
    dernierBadges.current = Date.now();
    api.get('/mouvements-attente/count').then((r) => {
      if (!r.error && typeof r.count === 'number') setBadgeAttente(r.count);
    });
    api.get('/budget-caisse/depassements/count').then((r) => {
      if (!r.error && typeof r.count === 'number') setBadgeDepassements(r.count);
    });
  }, [peutVoirAttente, location.pathname]);

  return (
    <div id="screen-app" className="screen" style={{ display: 'flex' }}>
      <Sidebar badgeAttente={badgeAttente} badgeDepassements={badgeDepassements} />
      <main className="main-content">
        <SupportAcces />
        <Topbar title={title} />
        <section className="page active">
          <Outlet />
        </section>
      </main>
      {tenantSelectorOpen && (
        <TenantSelectorModal
          onSelect={(id, nom, dev) => {
            selectTenant(id, nom, dev);
            closeTenantSelector();
            navigate('/');
          }}
        />
      )}
    </div>
  );
}

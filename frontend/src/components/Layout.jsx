import { useEffect, useState } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
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
  '/attente': 'Dépenses en attente',
};

export default function Layout() {
  const location = useLocation();
  const params = useParams();
  const { journaux, peutVoirAttente } = useApp();
  const [badgeAttente, setBadgeAttente] = useState(0);
  const [badgeDepassements, setBadgeDepassements] = useState(0);

  // Le titre d'une page journal reprend le format « Nom (CODE) ».
  let title = TITLES[location.pathname] || 'Tableau de bord';
  if (location.pathname.startsWith('/journal/')) {
    const j = journaux.find((x) => String(x.id) === String(params.id));
    title = j ? `${j.nom} (${j.code})` : 'Journal de caisse';
  }

  useEffect(() => {
    if (!peutVoirAttente) return;
    let annule = false;
    api.get('/mouvements-attente/count').then((r) => {
      if (!annule && !r.error && typeof r.count === 'number') setBadgeAttente(r.count);
    });
    api.get('/budget-caisse/depassements/count').then((r) => {
      if (!annule && !r.error && typeof r.count === 'number') setBadgeDepassements(r.count);
    });
    return () => { annule = true; };
  }, [peutVoirAttente, location.pathname]);

  return (
    <div id="screen-app" className="screen" style={{ display: 'flex' }}>
      <Sidebar badgeAttente={badgeAttente} badgeDepassements={badgeDepassements} />
      <main className="main-content">
        <Topbar title={title} />
        <section className="page active">
          <Outlet />
        </section>
      </main>
    </div>
  );
}

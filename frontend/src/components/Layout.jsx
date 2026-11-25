import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import TenantSelectorModal from './TenantSelectorModal';
import SupportAcces from './SupportAcces';
import InitialisationCompte from './InitialisationCompte';
import BottomNav from './BottomNav';
import { useApp } from '@/context/AppContext';
import { api } from '@/lib/api';
import { utiliseAccueil } from '@/lib/modules';

// Titres de page — repris tels quels de la table `titles` de showPage().
const TITLES = {
  '/': 'Tableau de bord',
  '/prospects': 'Prospects & démonstrations',
  '/mynjbusiness': 'MyNjBusiness',
  '/journaux-recap': 'Journaux de caisse',
  '/budget': 'Suivi Budgétaire',
  '/previsions': 'Prévisions de dépenses',
  '/appel-fonds': 'Demande de fonds',
  '/compte-emploi': "Compte d'emploi",
  '/activites': "Gestion d'activité — Suivi par activité",
  '/projets': "Gestion d'activité — Projets",
  '/projets/a-controler': "Gestion d'activité — Justificatifs à contrôler",
  '/projets/bilan': "Gestion d'activité — Bilan des activités",
  '/config': 'Configuration',
  '/tenants': 'Clients (Tenants)',
  '/permissions': 'Gestion des permissions',
  '/plan-modele': 'Modèle comptable',
  '/plateforme': 'Administration plateforme',
  '/validation-directe': 'Validation directe des prospects',
  '/attente': 'Dépenses en attente',
  '/controle/pieces': 'Contrôles comptables — Rapport',
  '/controle/regularite': 'Contrôles comptables — Contrôle de substance',
  '/controle/arretes': 'Caisse — Arrêtés de caisse & inventaires',
  '/controle/ecarts': 'Inventaire — Écarts de caisse',
  '/controle/registre': 'Clients et fournisseurs — Registre bénéficiaires Payés/Encaissés',
  '/controle/passerelle': 'Contrôles comptables — Contrôle de régularité formelle',
  '/finance/ecritures': 'Comptabilité — Écritures',
  '/finance/grand-livre': 'Comptabilité — Grand livre',
  '/finance/balance': 'Comptabilité — Balance générale',
};

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const {
    journaux, peutVoirAttente, isAdmin, user, activeTenantId,
    tenantSelectorOpen, openTenantSelector, closeTenantSelector, selectTenant,
    logout, loadJournaux, devise, setMois, setAnnee,
  } = useApp();

  // Initialisation guidée (espace de démonstration tout juste activé) : tant
  // que les caisses et leurs soldes d'ouverture ne sont pas définis, l'assistant
  // occupe tout l'écran. Uniquement pour les utilisateurs DU client (pas le cabinet).
  const [init, setInit] = useState(null);
  useEffect(() => {
    if (!user?.tenantId || isAdmin) { setInit(null); return; }
    let annule = false;
    api.get('/initialisation').then((r) => { if (!annule && r && !r.error) setInit(r); });
    return () => { annule = true; };
  }, [user?.tenantId, isAdmin]);
  // Tiroir de navigation (tablette et téléphone) : fermé à chaque changement d'écran.
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => { setNavOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.classList.toggle('nav-locked', navOpen);
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);
  const [badgeAttente, setBadgeAttente] = useState(0);
  const [badgeDepassements, setBadgeDepassements] = useState(0);

  // Un super_admin/comptable_cabinet qui se connecte sans tenant actif doit
  // choisir un client avant de continuer — reprend le bloc de launchApp()
  // (legacy/js/app.js l. 6278-6280) qui ouvre showTenantSelector() au boot.
  // Les écrans d'administration plateforme ne dépendent d'aucun client : on
  // n'y impose pas le choix d'un client.
  const pageSansClient = ['/plan-modele', '/tenants', '/permissions', '/plateforme', '/prospects', '/mynjbusiness', '/validation-directe'].includes(location.pathname);
  // Le super_admin administre la plateforme : il n'est plus forcé à choisir
  // un client (il en choisit un via le badge du haut ou la fiche client).
  // Le comptable cabinet, lui, travaille toujours DANS un client.
  useEffect(() => {
    if (user?.role === 'comptable_cabinet' && !user?.tenantId && !activeTenantId && !pageSansClient) openTenantSelector();
  }, [user, activeTenantId, openTenantSelector, pageSansClient]);

  // Le titre d'une page journal reprend le format « Nom (CODE) ».
  let title = TITLES[location.pathname] || (location.pathname.startsWith('/projets/') ? "Gestion d'activité — Projets" : 'Tableau de bord');
  if (location.pathname.startsWith('/journal/')) {
    const j = journaux.find((x) => String(x.id) === String(params.id));
    title = j ? `${j.nom} (${j.code})` : 'Journal de caisse';
  }

  // Badges : rechargés au plus une fois par minute, et non plus à CHAQUE
  // changement de page (2 requêtes par clic dans le menu auparavant).
  const dernierBadges = useRef(0);
  // Bouton « Rafraîchir » (27/10/2026) : la page affichée est remontée (elle
  // relit ses données), les journaux et les badges sont rechargés.
  const [cleRafraichir, setCleRafraichir] = useState(0);
  useEffect(() => {
    const surRafraichir = () => {
      setCleRafraichir((k) => k + 1);
      loadJournaux();
      dernierBadges.current = 0;
    };
    window.addEventListener('njb-rafraichir', surRafraichir);
    return () => window.removeEventListener('njb-rafraichir', surRafraichir);
  }, [loadJournaux]);
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
  }, [peutVoirAttente, location.pathname, cleRafraichir]);

  if (init?.requise) {
    return (
      <InitialisationCompte
        etat={init}
        devise={devise}
        onLogout={logout}
        onAccueil={utiliseAccueil(user) ? () => navigate('/accueil') : null}
        onTermine={(r) => { if (r?.mois) { setMois(r.mois); setAnnee(r.annee); } setInit(null); loadJournaux(); navigate('/config', { state: { bienvenue: true } }); }}
      />
    );
  }

  return (
    <div id="screen-app" className="screen" style={{ display: 'flex' }}>
      <Sidebar badgeAttente={badgeAttente} badgeDepassements={badgeDepassements} open={navOpen} onClose={() => setNavOpen(false)} />
      <div className={'nav-backdrop' + (navOpen ? ' show' : '')} onClick={() => setNavOpen(false)} aria-hidden="true" />
      <main className="main-content">
        <SupportAcces />
        {user?.type_compte === 'demo' && user?.demo_expire_le && (
          <div style={{ background: '#fefce8', color: '#854d0e', borderBottom: '1px solid #fde68a', padding: '8px 16px', fontSize: 13 }}>
            🧪 Compte de <strong>démonstration</strong> — données fictives uniquement. Accès ouvert jusqu'au{' '}
            <strong>{new Date(user.demo_expire_le).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>.
          </div>
        )}
        <Topbar title={title} onMenu={() => setNavOpen(true)} />
        <section className="page active">
          <Outlet key={cleRafraichir} />
        </section>
        <BottomNav badgeAttente={badgeAttente} onMenu={() => setNavOpen(true)} />
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

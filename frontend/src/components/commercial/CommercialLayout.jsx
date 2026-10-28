// NJ COMMERCIAL — cadre du module : menu latéral propre, barre du haut commune
// (client, rafraîchir, notifications), sans le sélecteur de période de la caisse.
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Topbar from '../Topbar';
import TenantSelectorModal from '../TenantSelectorModal';
import NjMarque from '../NjMarque';
import MonCompteModal from '../MonCompteModal';
import { useApp } from '@/context/AppContext';
import { utiliseAccueil } from '@/lib/modules';
import { api } from '@/lib/api';
import '@/styles/commercial.css';

const TITRES = {
  '/commercial': 'NJ COMMERCIAL — Démarrage',
  '/commercial/societe': 'Paramétrage — Société',
  '/commercial/magasins': 'Paramétrage — Magasins',
  '/commercial/familles': 'Paramétrage — Familles d\'articles',
  '/commercial/articles': 'Paramétrage — Articles',
  '/commercial/fournisseurs': 'Paramétrage — Fournisseurs',
  '/commercial/clients': 'Paramétrage — Clients',
  '/commercial/taxes': 'Paramétrage — Taxes',
  '/commercial/utilisateurs': 'Paramétrage — Utilisateurs et rôles',
  '/commercial/demandes': 'Achats — Demandes d\'achat',
  '/commercial/demandes/nouvelle': 'Achats — Nouvelle demande',
  '/commercial/autorisations': 'Achats — Autorisations',
};
const titre = (chemin) => TITRES[chemin]
  || (/^\/commercial\/demandes\/\d+\/modifier$/.test(chemin) ? 'Achats — Modifier la demande'
    : /^\/commercial\/demandes\/\d+$/.test(chemin) ? 'Achats — Demande d\'achat' : 'NJ COMMERCIAL');

// Entrées du menu : [chemin, libellé, permission(s) — une suffit, icône]
const PARAMETRAGE = [
  ['/commercial/societe', 'Société', ['com.parametrage.voir'], 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1'],
  ['/commercial/magasins', 'Magasins', ['com.parametrage.voir', 'com.articles.voir'], 'M3 9l1-5h16l1 5M3 9h18v11H3zM9 20v-6h6v6'],
  ['/commercial/familles', 'Familles d\'articles', ['com.parametrage.voir', 'com.articles.voir'], 'M3 7h7l2 2h9v10H3z'],
  ['/commercial/articles', 'Articles', ['com.articles.voir', 'com.da.creer'], 'M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12'],
  ['/commercial/fournisseurs', 'Fournisseurs', ['com.tiers.voir'], 'M1 3h15v13H1zM16 8h4l3 3v5h-7M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  ['/commercial/clients', 'Clients', ['com.tiers.voir'], 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'],
  ['/commercial/taxes', 'Taxes', ['com.parametrage.voir'], 'M19 5L5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  ['/commercial/utilisateurs', 'Utilisateurs et rôles', ['com.parametrage.modifier'], 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'],
];

export const peutUn = (can, codes) => codes.some((c) => can(c));

// Achats (livraison B). Les bons de commande et documents arrivent avec la livraison C.
export const DROITS_DEMANDES = ['com.da.creer', 'com.da.voir_tout', 'com.da.approuver', 'com.da.approuver_direction'];
export const DROITS_AUTORISATIONS = ['com.da.approuver', 'com.da.approuver_direction'];

const navClass = ({ isActive }) => 'nav-item' + (isActive ? ' active' : '');

function CommercialSidebar({ open, onClose }) {
  const { user, can, logout } = useApp();
  const location = useLocation();
  const [badge, setBadge] = useState({ a_examiner: 0, a_corriger: 0 });
  useEffect(() => {
    if (!peutUn(can, DROITS_DEMANDES)) return;
    api.get('/commercial/demandes/compteurs').then((r) => { if (r && !r.error) setBadge(r); });
  }, [can, location.pathname]);
  const navigate = useNavigate();
  const [monCompte, setMonCompte] = useState(false);
  const onLogout = () => { if (window.confirm('Se déconnecter ?')) { logout(); navigate('/', { replace: true }); } };
  return (
    <aside className={'sidebar' + (open ? ' open' : '')} aria-label="Menu NJ COMMERCIAL">
      <div className="sidebar-brand">
        <Link to={utiliseAccueil(user) ? '/accueil' : '/'} className="njb-sidebar-marque" title="Revenir à l'accueil NJ BUSINESS">
          <NjMarque taille={34} fond="#243655" module titre="NJ BUSINESS" />
          <span className="njb-sidebar-textes">
            <span className="njb-sidebar-nom">NJ COMMERCIAL</span>
            <span className="njb-sidebar-retour">‹ {utiliseAccueil(user) ? 'Accueil NJ BUSINESS' : 'Retour'}</span>
          </span>
        </Link>
        <button type="button" className="sidebar-close" onClick={onClose} aria-label="Fermer le menu">✕</button>
      </div>
      <nav className="sidebar-nav">
        <NavLink to="/commercial" end className={navClass}>
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
          Démarrage
        </NavLink>
        {peutUn(can, DROITS_DEMANDES) && (<>
          <div className="cm-sidebar-label">Achats</div>
          <NavLink to="/commercial/demandes" className={navClass}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>
            <span style={{ flex: 1 }}>Demandes d'achat</span>
            {badge.a_corriger > 0 && <span className="cm-badge-menu" title="Vos demandes à corriger">{badge.a_corriger}</span>}
          </NavLink>
          {peutUn(can, DROITS_AUTORISATIONS) && (
            <NavLink to="/commercial/autorisations" className={navClass}>
              <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
              <span style={{ flex: 1 }}>Autorisations</span>
              {badge.a_examiner > 0 && <span className="cm-badge-menu" title="Demandes qui attendent votre décision">{badge.a_examiner}</span>}
            </NavLink>
          )}
        </>)}
        <div className="cm-sidebar-label">Paramétrage</div>
        {PARAMETRAGE.filter(([, , codes]) => peutUn(can, codes)).map(([to, libelle, , d]) => (
          <NavLink key={to} to={to} className={navClass}>
            <svg viewBox="0 0 24 24"><path d={d} /></svg>
            {libelle}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="user-pill" role="button" tabIndex={0} title="Mon compte" style={{ cursor: 'pointer' }}
          onClick={() => setMonCompte(true)} onKeyDown={(e) => { if (e.key === 'Enter') setMonCompte(true); }}>
          <div className="user-avatar-sm">{(user?.username || '').substring(0, 2).toUpperCase()}</div>
          <div>
            <div className="user-name">{user?.username || '—'}</div>
            <div className="user-role">NJ COMMERCIAL</div>
          </div>
        </div>
        <button className="btn-logout" onClick={onLogout} title="Déconnexion">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
        </button>
      </div>
      {monCompte && <MonCompteModal onClose={() => setMonCompte(false)} />}
    </aside>
  );
}

export default function CommercialLayout() {
  const location = useLocation();
  const { user, activeTenantId, isAdmin, tenantSelectorOpen, openTenantSelector, closeTenantSelector, selectTenant } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [cle, setCle] = useState(0);
  useEffect(() => { setNavOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.body.classList.toggle('nav-locked', navOpen);
    return () => document.body.classList.remove('nav-locked');
  }, [navOpen]);
  useEffect(() => {
    const r = () => setCle((k) => k + 1);
    window.addEventListener('njb-rafraichir', r);
    return () => window.removeEventListener('njb-rafraichir', r);
  }, []);
  // Le cabinet travaille toujours dans un client choisi.
  useEffect(() => {
    if (isAdmin && !user?.tenantId && !activeTenantId) openTenantSelector();
  }, [isAdmin, user, activeTenantId, openTenantSelector]);
  useEffect(() => { document.title = 'NJ COMMERCIAL — NJ BUSINESS'; return () => { document.title = 'NJ BUSINESS — Plateforme de gestion'; }; }, []);

  const sansClient = isAdmin && !user?.tenantId && !activeTenantId;
  return (
    <div id="screen-app" className="screen" style={{ display: 'flex' }}>
      <CommercialSidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className={'nav-backdrop' + (navOpen ? ' show' : '')} onClick={() => setNavOpen(false)} aria-hidden="true" />
      <main className="main-content">
        <Topbar title={titre(location.pathname)} onMenu={() => setNavOpen(true)} sansPeriode />
        <section className="page active">
          {sansClient
            ? <div className="cm-note">Choisissez d'abord un client (badge en haut à droite).</div>
            : <Outlet key={`${activeTenantId || ''}-${cle}`} />}
        </section>
      </main>
      {tenantSelectorOpen && <TenantSelectorModal onSelect={(id, nom, dev) => { selectTenant(id, nom, dev); closeTenantSelector(); }} />}
    </div>
  );
}

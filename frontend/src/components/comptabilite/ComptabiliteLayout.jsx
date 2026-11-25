// NJ COMPTABILITÉ — cadre du module (076) : menu latéral propre, barre du haut
// commune (client, rafraîchir, notifications), sans le sélecteur de période de
// la caisse. Le module est relié à NJ FINANCE : les écritures sont partagées.
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Topbar from '../Topbar';
import TenantSelectorModal from '../TenantSelectorModal';
import NjMarque from '../NjMarque';
import MonCompteModal from '../MonCompteModal';
import { useApp } from '@/context/AppContext';
import { moduleActif, systemeInstalle, utiliseAccueil } from '@/lib/modules';
import '@/styles/commercial.css';
import '@/styles/comptabilite.css';

export const DROITS_COMPTA = ['compta.ecritures.voir', 'compta.ecritures.saisir', 'compta.ecritures.valider', 'compta.parametrage', 'compta.periodes.verrouiller'];

const ICONE = {
  ecritures: 'M4 4h16v16H4z M4 10h16 M12 10v10',
  grandLivre: 'M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z',
  balance: 'M12 3v18 M5 7h14 M5 7l-3 7a3 3 0 0 0 6 0z M19 7l-3 7a3 3 0 0 0 6 0z',
  parametrage: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  finance: 'M2 6h20v12H2z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
};
const RUBRIQUES = [
  { titre: 'Saisie et validation', entrees: [
    { to: '/comptabilite/ecritures', libelle: 'Écritures', codes: ['compta.ecritures.voir'], icone: ICONE.ecritures },
    { to: '/comptabilite/caisse', libelle: 'Écritures de caisse', codes: ['compta.ecritures.voir'], icone: ICONE.finance },
  ] },
  { titre: 'États comptables', entrees: [
    { to: '/comptabilite/grand-livre', libelle: 'Grand livre', codes: ['compta.ecritures.voir'], icone: ICONE.grandLivre },
    { to: '/comptabilite/balance', libelle: 'Balance générale', codes: ['compta.ecritures.voir'], icone: ICONE.balance },
  ] },
  { titre: 'Paramétrage', entrees: [
    { to: '/comptabilite/parametrage', libelle: 'Exercices et journaux', codes: ['compta.ecritures.voir', 'compta.parametrage', 'compta.periodes.verrouiller'], icone: ICONE.parametrage },
  ] },
];
const TITRES = {
  '/comptabilite/ecritures': 'Comptabilité — Écritures',
  '/comptabilite/caisse': 'Comptabilité — Écritures de caisse',
  '/comptabilite/grand-livre': 'Comptabilité — Grand livre',
  '/comptabilite/balance': 'Comptabilité — Balance générale',
  '/comptabilite/parametrage': 'Comptabilité — Exercices et journaux',
};
const navClass = ({ isActive }) => 'nav-item' + (isActive ? ' active' : '');
const peutUn = (can, codes) => codes.some((c) => can(c));

function ComptabiliteSidebar({ open, onClose }) {
  const { user, can, logout } = useApp();
  const navigate = useNavigate();
  const [monCompte, setMonCompte] = useState(false);
  const versFinance = !systemeInstalle(user) || moduleActif(user, 'caisse') || user?.role === 'super_admin' || user?.role === 'comptable_cabinet';
  const onLogout = () => { if (window.confirm('Se déconnecter ?')) { logout(); navigate('/', { replace: true }); } };
  return (
    <aside className={'sidebar' + (open ? ' open' : '')} aria-label="Menu NJ COMPTABILITÉ">
      <div className="sidebar-brand">
        <Link to={utiliseAccueil(user) ? '/accueil' : '/'} className="njb-sidebar-marque" title="Revenir à l'accueil NJ BUSINESS">
          <NjMarque taille={34} fond="#243655" module titre="NJ BUSINESS" />
          <span className="njb-sidebar-textes">
            <span className="njb-sidebar-nom">NJ COMPTABILITÉ</span>
            <span className="njb-sidebar-retour">‹ {utiliseAccueil(user) ? 'Accueil NJ BUSINESS' : 'Retour'}</span>
          </span>
        </Link>
        <button type="button" className="sidebar-close" onClick={onClose} aria-label="Fermer le menu">✕</button>
      </div>
      <nav className="sidebar-nav">
        {RUBRIQUES.map((r) => {
          const visibles = r.entrees.filter((e) => peutUn(can, e.codes));
          if (!visibles.length) return null;
          return (
            <div key={r.titre} className="cm-rubrique">
              <div className="cm-sidebar-label">{r.titre}</div>
              {visibles.map((e) => (
                <NavLink key={e.to} to={e.to} className={navClass}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={e.icone} /></svg>
                  <span style={{ flex: 1 }}>{e.libelle}</span>
                </NavLink>
              ))}
            </div>
          );
        })}
        {versFinance && (
          <div className="cm-rubrique">
            <div className="cm-sidebar-label">Module relié</div>
            <NavLink to="/" end className={navClass} title="Caisse, gestion d'activité, achats et ventes : les opérations dont NJ FINANCE produit les écritures">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONE.finance} /></svg>
              <span style={{ flex: 1 }}>NJ FINANCE ›</span>
            </NavLink>
          </div>
        )}
      </nav>
      <div className="sidebar-footer">
        <div className="user-pill" role="button" tabIndex={0} title="Mon compte" style={{ cursor: 'pointer' }}
          onClick={() => setMonCompte(true)} onKeyDown={(e) => { if (e.key === 'Enter') setMonCompte(true); }}>
          <div className="user-avatar-sm">{(user?.username || '').substring(0, 2).toUpperCase()}</div>
          <div>
            <div className="user-name">{user?.username || '—'}</div>
            <div className="user-role">NJ COMPTABILITÉ</div>
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

export default function ComptabiliteLayout() {
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
  useEffect(() => {
    if (isAdmin && !user?.tenantId && !activeTenantId) openTenantSelector();
  }, [isAdmin, user, activeTenantId, openTenantSelector]);
  useEffect(() => { document.title = 'NJ COMPTABILITÉ — NJ BUSINESS'; return () => { document.title = 'NJ BUSINESS — Plateforme de gestion'; }; }, []);

  const sansClient = isAdmin && !user?.tenantId && !activeTenantId;
  return (
    <div id="screen-app" className="screen" style={{ display: 'flex' }}>
      <ComptabiliteSidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className={'nav-backdrop' + (navOpen ? ' show' : '')} onClick={() => setNavOpen(false)} aria-hidden="true" />
      <main className="main-content">
        <Topbar title={TITRES[location.pathname] || 'NJ COMPTABILITÉ'} onMenu={() => setNavOpen(true)} sansPeriode />
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

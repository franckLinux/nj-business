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
  '/commercial/mise-en-route': 'Configuration — Mise en route',
  '/commercial/agences': 'Configuration — Agences',
  '/commercial/unites': 'Configuration — Unités de mesure',
  '/commercial/societe': 'Configuration — Société',
  '/commercial/magasins': 'Configuration — Magasins',
  '/commercial/familles': 'Configuration — Familles d\'articles',
  '/commercial/articles': 'Configuration — Articles',
  '/commercial/fournisseurs': 'Configuration — Fournisseurs',
  '/commercial/clients': 'Configuration — Clients',
  '/commercial/taxes': 'Configuration — Taxes',
  '/commercial/utilisateurs': 'Configuration — Utilisateurs et rôles',
  '/commercial/demandes': 'Achats — Expressions de besoin',
  '/commercial/demandes/nouvelle': 'Achats — Nouvelle expression de besoin',
  '/commercial/autorisations': 'Contrôles — Autorisations d\'achat',
  '/commercial/bons': 'Achats — Bons de commande',
  '/commercial/bons/nouveau': 'Achats — Préparer un bon de commande',
  '/commercial/tableau-bord': 'NJ COMMERCIAL — Tableau de bord',
  '/commercial/documents': 'Contrôles — Documents justificatifs',
  '/commercial/historique': 'Contrôles — Historique',
  '/commercial/stock': 'Stock — État du stock',
  '/commercial/receptions': 'Achats — Réceptions',
  '/commercial/receptions/nouvelle': 'Achats — Nouvelle réception',
  '/commercial/retours-fournisseurs': 'Achats — Retours fournisseurs',
  '/commercial/retours-fournisseurs/nouveau': 'Achats — Retour au fournisseur',
  '/commercial/factures-fournisseurs': 'Achats — Factures fournisseurs',
  '/commercial/factures-fournisseurs/nouvelle': 'Achats — Saisie d\'une facture fournisseur',
  '/commercial/validation-achats': 'Contrôles — Validation des achats',
  '/commercial/stock/nouveau': 'Stock — Nouveau document',
  '/commercial/stock/entrees': 'Stock — Entrées en stock',
  '/commercial/stock/sorties': 'Stock — Sorties diverses',
  '/commercial/stock/transferts': 'Stock — Transferts',
  '/commercial/stock/inventaires': 'Stock — Inventaires',
  '/commercial/stock/validation': 'Contrôles — Validation des stocks',
  '/commercial/stock/mouvements': 'Contrôles — Mouvements de stock',
  '/commercial/stock/valorisation': 'Contrôles — Valorisation du stock',
};
const titre = (chemin) => TITRES[chemin]
  || (/^\/commercial\/demandes\/\d+\/modifier$/.test(chemin) ? 'Achats — Modifier la demande'
    : /^\/commercial\/demandes\/\d+$/.test(chemin) ? 'Achats — Demande d\'achat'
      : /^\/commercial\/bons\/\d+\/modifier$/.test(chemin) ? 'Achats — Modifier le bon de commande'
        : /^\/commercial\/bons\/\d+$/.test(chemin) ? 'Achats — Bon de commande'
        : /^\/commercial\/stock\/documents\//.test(chemin) ? 'Stock — Document de stock'
        : /^\/commercial\/receptions\/\d+/.test(chemin) ? 'Achats — Réception'
          : /^\/commercial\/retours-fournisseurs\/\d+/.test(chemin) ? 'Achats — Retour fournisseur'
            : /^\/commercial\/factures-fournisseurs\/\d+/.test(chemin) ? 'Achats — Facture fournisseur' : 'NJ COMMERCIAL');

// Menu en quatre rubriques (lot 1) : la saisie dans « Traitements », la décision
// et le suivi dans « Contrôles et reporting ». Une entrée n'apparaît qu'avec une
// de ses permissions, et seulement quand son lot est livré (aucune entrée vide).
const I = {
  tableau: 'M6 20v-7M12 20V6M18 20v-10M3 20h18',
  depart: 'M4 4h16v16H4zM4 10h16M10 4v16',
  societe: 'M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1M9 13h1m4 0h1M9 17h1m4 0h1',
  agence: 'M3 21h18M4 21V10l8-6 8 6v11M9 21v-6h6v6',
  magasin: 'M3 9l1-5h16l1 5M3 9h18v11H3zM9 20v-6h6v6',
  famille: 'M3 7h7l2 2h9v10H3z',
  article: 'M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7L12 12l8.7-5M12 22V12',
  unite: 'M3 17l6-12 6 12M5 13h8M17 7v10M15 9l2-2 2 2M15 15l2 2 2-2',
  fournisseur: 'M1 3h15v13H1zM16 8h4l3 3v5h-7M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  client: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  taxe: 'M19 5L5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  utilisateur: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  besoin: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4',
  bon: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6M9 9h2',
  autorisation: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  piece: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  historique: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  stock: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  entree: 'M12 3v12M7 10l5 5 5-5M4 19h16',
  sortie: 'M12 15V3M7 8l5-5 5 5M4 19h16',
  transfert: 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4',
  inventaire: 'M9 4h6v3H9zM6 5H4v16h16V5h-2M8 12l2 2 4-4M8 17h8',
  valider: 'M20 6L9 17l-5-5',
  mouvements: 'M4 6h16M4 12h16M4 18h10',
  valeur: 'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  reception: 'M3 7l9-4 9 4v10l-9 4-9-4zM12 11v6M9 14l3 3 3-3',
  retour: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  facture: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  valideAchat: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
};
const STOCK = ['com.stock.voir', 'com.stock.entree', 'com.stock.sortie', 'com.stock.transfert', 'com.stock.inventaire', 'com.stock.valider', 'com.stock.annuler', 'com.stock.journal', 'com.stock.valorisation'];
const RECEPTIONS = ['com.receptions.saisir', 'com.receptions.valider', 'com.receptions.annuler', 'com.retours_fourn.saisir', 'com.retours_fourn.valider',
  'com.bc.preparer', 'com.bc.emettre', 'com.da.voir_tout', 'com.factures_fourn.voir', 'com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.stock.journal'];
const FACTURES = ['com.factures_fourn.voir', 'com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.factures_fourn.annuler'];
const LISTE = (code) => [code, 'com.stock.valider', 'com.stock.annuler', 'com.stock.journal'];
const RUBRIQUES = [
  { titre: 'Tableau de bord', groupes: [{ entrees: [
    { to: '/commercial/tableau-bord', libelle: 'Tableau de bord', codes: ['com.tableau_bord.voir'], icone: I.tableau },
  ] }] },
  { titre: 'Configuration', groupes: [{ entrees: [
    { to: '/commercial/mise-en-route', libelle: 'Mise en route', codes: ['com.parametrage.voir', 'com.articles.voir', 'com.da.creer', 'com.tiers.voir'], icone: I.depart },
    { to: '/commercial/societe', libelle: 'Société', codes: ['com.parametrage.voir'], icone: I.societe },
    { to: '/commercial/agences', libelle: 'Agences', codes: ['com.parametrage.voir'], icone: I.agence },
    { to: '/commercial/magasins', libelle: 'Magasins', codes: ['com.parametrage.voir', 'com.articles.voir'], icone: I.magasin },
    { to: '/commercial/familles', libelle: 'Familles d\'articles', codes: ['com.parametrage.voir', 'com.articles.voir'], icone: I.famille },
    { to: '/commercial/unites', libelle: 'Unités de mesure', codes: ['com.parametrage.voir', 'com.articles.voir'], icone: I.unite },
    { to: '/commercial/articles', libelle: 'Articles', codes: ['com.articles.voir', 'com.da.creer'], icone: I.article },
    { to: '/commercial/fournisseurs', libelle: 'Fournisseurs', codes: ['com.tiers.voir'], icone: I.fournisseur },
    { to: '/commercial/clients', libelle: 'Clients', codes: ['com.tiers.voir'], icone: I.client },
    { to: '/commercial/taxes', libelle: 'Taxes', codes: ['com.parametrage.voir'], icone: I.taxe },
    { to: '/commercial/utilisateurs', libelle: 'Utilisateurs et rôles', codes: ['com.parametrage.modifier'], icone: I.utilisateur },
  ] }] },
  { titre: 'Traitements', groupes: [{ titre: 'Achats', entrees: [
    { to: '/commercial/demandes', libelle: 'Expressions de besoin', codes: ['com.da.creer', 'com.da.voir_tout', 'com.da.approuver', 'com.da.approuver_direction'], icone: I.besoin, badge: 'a_corriger', badgeTitre: 'Vos demandes à corriger' },
    { to: '/commercial/bons', libelle: 'Bons de commande', codes: ['com.bc.preparer', 'com.bc.emettre', 'com.bc.annuler', 'com.da.voir_tout', 'com.tableau_bord.voir'], icone: I.bon, badge: 'a_commander', badgeTitre: 'Demandes approuvées à commander' },
    { to: '/commercial/receptions', libelle: 'Réceptions', codes: RECEPTIONS, icone: I.reception, badge: 'bons_a_recevoir', badgeTitre: 'Bons de commande à recevoir' },
    { to: '/commercial/retours-fournisseurs', libelle: 'Retours fournisseurs', codes: RECEPTIONS, icone: I.retour },
    { to: '/commercial/factures-fournisseurs', libelle: 'Factures fournisseurs', codes: FACTURES, icone: I.facture },
  ] }, { titre: 'Stock', entrees: [
    { to: '/commercial/stock', end: true, libelle: 'État du stock', codes: ['com.stock.voir'], icone: I.stock, badge: 'sous_seuil', badgeTitre: 'Articles sous le seuil d\'alerte' },
    { to: '/commercial/stock/entrees', libelle: 'Entrées en stock', codes: LISTE('com.stock.entree'), icone: I.entree },
    { to: '/commercial/stock/sorties', libelle: 'Sorties diverses', codes: LISTE('com.stock.sortie'), icone: I.sortie },
    { to: '/commercial/stock/transferts', libelle: 'Transferts', codes: LISTE('com.stock.transfert'), icone: I.transfert },
    { to: '/commercial/stock/inventaires', libelle: 'Inventaires', codes: LISTE('com.stock.inventaire'), icone: I.inventaire },
  ] }] },
  { titre: 'Contrôles et reporting', groupes: [{ entrees: [
    { to: '/commercial/autorisations', libelle: 'Autorisations d\'achat', codes: ['com.da.approuver', 'com.da.approuver_direction'], icone: I.autorisation, badge: 'a_examiner', badgeTitre: 'Demandes qui attendent votre décision' },
    { to: '/commercial/validation-achats', libelle: 'Validation des achats', codes: ['com.receptions.valider', 'com.retours_fourn.valider', 'com.factures_fourn.valider'], icone: I.valideAchat, badge: 'achats_a_valider', badgeTitre: 'Réceptions, retours et factures à valider' },
    { to: '/commercial/stock/validation', libelle: 'Validation des stocks', codes: ['com.stock.valider'], icone: I.valider, badge: 'a_valider', badgeTitre: 'Documents de stock à valider' },
    { to: '/commercial/stock/mouvements', libelle: 'Mouvements de stock', codes: ['com.stock.journal'], icone: I.mouvements },
    { to: '/commercial/stock/valorisation', libelle: 'Valorisation du stock', codes: ['com.stock.valorisation'], icone: I.valeur },
    { to: '/commercial/documents', libelle: 'Documents justificatifs', codes: ['com.bc.preparer', 'com.bc.emettre', 'com.bc.annuler', 'com.da.voir_tout', 'com.tableau_bord.voir'], icone: I.piece },
    { to: '/commercial/historique', libelle: 'Historique', codes: ['com.da.voir_tout', 'com.tableau_bord.voir'], icone: I.historique },
  ] }] },
];

export const peutUn = (can, codes) => codes.some((c) => can(c));

// Achats : demandes et autorisations (livraison B) ; bons, tableau de bord, documents, historique (C).
export const DROITS_DEMANDES = ['com.da.creer', 'com.da.voir_tout', 'com.da.approuver', 'com.da.approuver_direction'];
export const DROITS_AUTORISATIONS = ['com.da.approuver', 'com.da.approuver_direction'];
export const DROITS_BONS = ['com.bc.preparer', 'com.bc.emettre', 'com.bc.annuler', 'com.da.voir_tout', 'com.tableau_bord.voir'];
export const DROITS_HISTORIQUE = ['com.da.voir_tout', 'com.tableau_bord.voir'];

const navClass = ({ isActive }) => 'nav-item' + (isActive ? ' active' : '');

function CommercialSidebar({ open, onClose }) {
  const { user, can, logout } = useApp();
  const location = useLocation();
  const [badge, setBadge] = useState({ a_examiner: 0, a_corriger: 0, a_commander: 0, a_valider: 0, sous_seuil: 0 });
  useEffect(() => {
    if (peutUn(can, DROITS_DEMANDES)) api.get('/commercial/demandes/compteurs').then((r) => { if (r && !r.error) setBadge((b) => ({ ...b, ...r })); });
    if (peutUn(can, STOCK)) api.get('/commercial/stock/compteurs').then((r) => { if (r && !r.error) setBadge((b) => ({ ...b, ...r })); });
    if (peutUn(can, RECEPTIONS)) {
      api.get('/commercial/achats/compteurs').then((r) => {
        if (r && !r.error) setBadge((b) => ({ ...b, bons_a_recevoir: r.bons_a_recevoir, achats_a_valider: r.receptions_a_valider + r.retours_a_valider + r.factures_a_valider }));
      });
    }
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
        {RUBRIQUES.map((r) => {
          const groupes = r.groupes.map((g) => ({ ...g, entrees: g.entrees.filter((e) => peutUn(can, e.codes)) })).filter((g) => g.entrees.length);
          if (!groupes.length) return null;
          return (
            <div key={r.titre} className="cm-rubrique">
              <div className="cm-sidebar-label">{r.titre}</div>
              {groupes.map((g) => (
                <div key={g.titre || r.titre}>
                  {g.titre && <div className="cm-sidebar-sous">{g.titre}</div>}
                  {g.entrees.map((e) => (
                    <NavLink key={e.to} to={e.to} end={e.end} className={navClass}>
                      <svg viewBox="0 0 24 24"><path d={e.icone} /></svg>
                      <span style={{ flex: 1 }}>{e.libelle}</span>
                      {e.badge && badge[e.badge] > 0 && <span className="cm-badge-menu" title={e.badgeTitre}>{badge[e.badge]}</span>}
                    </NavLink>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
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

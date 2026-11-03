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
import { ICONES } from './icones';
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
const ONGLETS_TITRES = { 'mise-en-route': 'Mise en route', societe: 'Société', agences: 'Agences', magasins: 'Magasins', utilisateurs: 'Utilisateurs et rôles',
  familles: 'Familles d\'articles', unites: 'Unités de mesure', articles: 'Articles', taxes: 'Taxes', fournisseurs: 'Fournisseurs', clients: 'Clients' };
const titre = (chemin) => TITRES[chemin]
  || (chemin.startsWith('/commercial/configuration') ? `Configuration${ONGLETS_TITRES[chemin.split('/')[3]] ? ` — ${ONGLETS_TITRES[chemin.split('/')[3]]}` : ''}`
    : null)
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
const I = ICONES;
const STOCK = ['com.stock.voir', 'com.stock.entree', 'com.stock.sortie', 'com.stock.transfert', 'com.stock.inventaire', 'com.stock.valider', 'com.stock.annuler', 'com.stock.journal', 'com.stock.valorisation'];
const RECEPTIONS = ['com.receptions.saisir', 'com.receptions.valider', 'com.receptions.annuler', 'com.retours_fourn.saisir', 'com.retours_fourn.valider',
  'com.bc.preparer', 'com.bc.emettre', 'com.da.voir_tout', 'com.factures_fourn.voir', 'com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.stock.journal'];
const FACTURES = ['com.factures_fourn.voir', 'com.factures_fourn.saisir', 'com.factures_fourn.valider', 'com.factures_fourn.annuler'];
const LISTE = (code) => [code, 'com.stock.valider', 'com.stock.annuler', 'com.stock.journal'];
// Menu : deux accès directs (Tableau de bord, Configuration à onglets) puis des
// tiroirs repliables par domaine. Le tiroir de la page ouverte s'ouvre seul ; les
// autres gardent l'état choisi par la personne (mémorisé dans ce navigateur).
const CONFIG = ['com.parametrage.voir', 'com.parametrage.modifier', 'com.articles.voir', 'com.da.creer', 'com.tiers.voir'];
const RUBRIQUES = [
  { entrees: [
    { to: '/commercial/tableau-bord', libelle: 'Tableau de bord', codes: ['com.tableau_bord.voir'], icone: I.tableau },
    { to: '/commercial/configuration', libelle: 'Configuration', codes: CONFIG, icone: I.reglages },
  ] },
  { titre: 'Traitements', groupes: [
    { id: 'achats', titre: 'Achats', icone: I.bon, entrees: [
      { to: '/commercial/demandes', libelle: 'Expressions de besoin', codes: ['com.da.creer', 'com.da.voir_tout', 'com.da.approuver', 'com.da.approuver_direction'], icone: I.besoin, badge: 'a_corriger', badgeTitre: 'Vos demandes à corriger' },
      { to: '/commercial/bons', libelle: 'Bons de commande', codes: ['com.bc.preparer', 'com.bc.emettre', 'com.bc.annuler', 'com.da.voir_tout', 'com.tableau_bord.voir'], icone: I.bon, badge: 'a_commander', badgeTitre: 'Demandes approuvées à commander' },
      { to: '/commercial/receptions', libelle: 'Réceptions', codes: RECEPTIONS, icone: I.reception, badge: 'bons_a_recevoir', badgeTitre: 'Bons de commande à recevoir' },
      { to: '/commercial/retours-fournisseurs', libelle: 'Retours fournisseurs', codes: RECEPTIONS, icone: I.retour },
      { to: '/commercial/factures-fournisseurs', libelle: 'Factures fournisseurs', codes: FACTURES, icone: I.facture },
    ] },
    { id: 'stock', titre: 'Stock', icone: I.stock, entrees: [
      { to: '/commercial/stock', end: true, libelle: 'État du stock', codes: ['com.stock.voir'], icone: I.stock, badge: 'sous_seuil', badgeTitre: 'Articles sous le seuil d\'alerte' },
      { to: '/commercial/stock/entrees', libelle: 'Entrées en stock', codes: LISTE('com.stock.entree'), icone: I.entree },
      { to: '/commercial/stock/sorties', libelle: 'Sorties diverses', codes: LISTE('com.stock.sortie'), icone: I.sortie },
      { to: '/commercial/stock/transferts', libelle: 'Transferts', codes: LISTE('com.stock.transfert'), icone: I.transfert },
      { to: '/commercial/stock/inventaires', libelle: 'Inventaires', codes: LISTE('com.stock.inventaire'), icone: I.inventaire },
    ] },
  ] },
  { titre: 'Contrôles et reporting', groupes: [
    { id: 'validations', titre: 'Validations', icone: I.autorisation, entrees: [
      { to: '/commercial/autorisations', libelle: 'Autorisations d\'achat', codes: ['com.da.approuver', 'com.da.approuver_direction'], icone: I.autorisation, badge: 'a_examiner', badgeTitre: 'Demandes qui attendent votre décision' },
      { to: '/commercial/validation-achats', libelle: 'Validation des achats', codes: ['com.receptions.valider', 'com.retours_fourn.valider', 'com.factures_fourn.valider'], icone: I.valideAchat, badge: 'achats_a_valider', badgeTitre: 'Réceptions, retours et factures à valider' },
      { to: '/commercial/stock/validation', libelle: 'Validation des stocks', codes: ['com.stock.valider'], icone: I.valider, badge: 'a_valider', badgeTitre: 'Documents de stock à valider' },
    ] },
    { id: 'suivi', titre: 'Suivi et états', icone: I.historique, entrees: [
      { to: '/commercial/stock/mouvements', libelle: 'Mouvements de stock', codes: ['com.stock.journal'], icone: I.mouvements },
      { to: '/commercial/stock/valorisation', libelle: 'Valorisation du stock', codes: ['com.stock.valorisation'], icone: I.valeur },
      { to: '/commercial/documents', libelle: 'Documents justificatifs', codes: ['com.bc.preparer', 'com.bc.emettre', 'com.bc.annuler', 'com.da.voir_tout', 'com.tableau_bord.voir'], icone: I.piece },
      { to: '/commercial/historique', libelle: 'Historique', codes: ['com.da.voir_tout', 'com.tableau_bord.voir'], icone: I.historique },
    ] },
  ] },
];
// Entrée correspondant à la page ouverte : le préfixe le plus long l'emporte
// (une fiche /commercial/stock/documents/12 relève de « État du stock »).
const TOUTES = RUBRIQUES.flatMap((r) => [...(r.entrees || []), ...(r.groupes || []).flatMap((g) => g.entrees)]);
const entreeActive = (chemin) => TOUTES.filter((e) => chemin === e.to || chemin.startsWith(`${e.to}/`))
  .sort((x, y) => y.to.length - x.to.length)[0]?.to;
const CLE_TIROIRS = 'njc.menu.tiroirs';
const lireTiroirs = () => { try { return JSON.parse(localStorage.getItem(CLE_TIROIRS)) || {}; } catch { return {}; } };

function Entree({ e, badge, actif }) {
  return (
    <NavLink to={e.to} className={() => navClass({ isActive: actif })} aria-current={actif ? 'page' : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={e.icone} /></svg>
      <span style={{ flex: 1 }}>{e.libelle}</span>
      {e.badge && badge[e.badge] > 0 && <span className="cm-badge-menu" title={e.badgeTitre}>{badge[e.badge]}</span>}
    </NavLink>
  );
}

function Tiroir({ g, ouvert, onBasculer, badge, actif }) {
  const total = g.entrees.reduce((t, e) => t + (e.badge ? badge[e.badge] || 0 : 0), 0);
  const contientActif = g.entrees.some((e) => e.to === actif);
  return (
    <div className={'cm-tiroir-menu' + (ouvert ? ' ouvert' : '') + (contientActif ? ' contient-actif' : '')}>
      <button type="button" className="cm-tiroir-tete-menu" aria-expanded={ouvert} aria-controls={`menu-${g.id}`} onClick={onBasculer}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={g.icone} /></svg>
        <span className="cm-tiroir-titre-menu">{g.titre}</span>
        {!ouvert && total > 0 && <span className="cm-badge-menu" title="Éléments en attente dans ce tiroir">{total}</span>}
        <svg className="cm-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
      <div className="cm-tiroir-corps-menu" id={`menu-${g.id}`}>
        <div>{g.entrees.map((e) => <Entree key={e.to} e={e} badge={badge} actif={e.to === actif} />)}</div>
      </div>
    </div>
  );
}

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
  const actif = entreeActive(location.pathname);
  const [tiroirs, setTiroirs] = useState(lireTiroirs);
  const basculer = (id, valeur) => setTiroirs((t) => {
    const n = { ...t, [id]: valeur };
    try { localStorage.setItem(CLE_TIROIRS, JSON.stringify(n)); } catch { /* navigation privée */ }
    return n;
  });
  // La page ouverte rend toujours son tiroir visible (même s'il avait été replié).
  useEffect(() => {
    const g = RUBRIQUES.flatMap((r) => r.groupes || []).find((x) => x.entrees.some((e) => e.to === actif));
    if (g && tiroirs[g.id] === false) basculer(g.id, true);
  }, [actif]); // eslint-disable-line react-hooks/exhaustive-deps
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
        {RUBRIQUES.map((r, i) => {
          if (r.entrees) {
            const visibles = r.entrees.filter((e) => peutUn(can, e.codes));
            return visibles.length ? <div key={i} className="cm-rubrique cm-acces-directs">{visibles.map((e) => <Entree key={e.to} e={e} badge={badge} actif={e.to === actif} />)}</div> : null;
          }
          const groupes = r.groupes.map((g) => ({ ...g, entrees: g.entrees.filter((e) => peutUn(can, e.codes)) })).filter((g) => g.entrees.length);
          if (!groupes.length) return null;
          return (
            <div key={r.titre} className="cm-rubrique">
              <div className="cm-sidebar-label">{r.titre}</div>
              {groupes.map((g) => (
                <Tiroir key={g.id} g={g} badge={badge} actif={actif}
                  ouvert={tiroirs[g.id] ?? g.entrees.some((e) => e.to === actif)}
                  onBasculer={() => basculer(g.id, !(tiroirs[g.id] ?? g.entrees.some((e) => e.to === actif)))} />
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

import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import NjMarque from './NjMarque';
import { moduleActif, utiliseAccueil } from '@/lib/modules';
import { peutGererProspects } from '@/lib/acces';
import { useApp } from '@/context/AppContext';
import NavGroup from './NavGroup';
import { useState } from 'react';
import MonCompteModal from './MonCompteModal';
import { PAGE_PERMS, peut, voitConfiguration, voitOngletConfig } from '@/lib/acces';
import { useAccesProjets } from '@/lib/projets';

// Ordre d'affichage des journaux dans la sidebar — identique à app.js
const TYPE_ORDER = ['caisse', 'banque', 'om', 'momo', 'carte_prepayee', 'autre'];

const navClass = ({ isActive }) => 'nav-item' + (isActive ? ' active' : '');
const subClass = ({ isActive }) => 'nav-item nav-sub' + (isActive ? ' active' : '');

// Libellé affiché du rôle (044 : le code technique « auditeur » = profil « Comptable »).
const LIBELLE_ROLE = {
  super_admin: 'Super admin', comptable_cabinet: 'Comptable cabinet', commercial: 'Commercial',
  directeur: 'Directeur', caissier: 'Caissier(ère)', auditeur: 'Comptable', collaborateur: 'Collaborateur',
};

export default function Sidebar({ badgeAttente = 0, badgeDepassements = 0, open = false, onClose }) {
  const { user, isAdmin, peutVoirAttente, journauxGrouped, logout, can, activeTenantId } = useApp();
  // super_admin sans client choisi : uniquement l'administration plateforme.
  // Commercial : aucune donnée de caisse, uniquement MyNjBusiness.
  const sansClient = (user?.role === 'super_admin' && !activeTenantId) || user?.role === 'commercial';
  const voit = (path) => peut(can, PAGE_PERMS[path]);
  const navigate = useNavigate();
  const location = useLocation();

  const journaux = TYPE_ORDER.flatMap((t) => (journauxGrouped[t] || []).filter((j) => j.actif));

  const onLogout = () => {
    if (window.confirm('Se déconnecter ?')) {
      logout();
      navigate('/', { replace: true });
    }
  };

  // Gestion d'activité (ex-Projets, 069) : ONG / associations, pour la direction, le comptable et les
  // personnes désignées (chef de projet, responsable d'activité).
  const accesProjets = useAccesProjets(`${activeTenantId || ''}:${location.pathname}:${location.search}`);
  const badgeProjets = (accesProjets?.a_valider || 0) + (accesProjets?.justificatifs_a_controler || 0);
  // Entrées du menu qui ouvrent une même page filtrée (?filtre=…, ?type=…) : une seule active.
  const surPage = (path, q) => location.pathname === path && (q ? location.search.includes(q) : location.search === '');
  const comptaActive = utiliseAccueil(user) ? moduleActif(user, 'comptabilite') : Boolean(isAdmin && activeTenantId);
  const initiales = (user?.username || '').substring(0, 2).toUpperCase();
  const [monCompte, setMonCompte] = useState(false);

  return (
    <aside className={'sidebar' + (open ? ' open' : '')} aria-label="Menu principal">
      <div className="sidebar-brand">
        {/* NJ BUSINESS (048) : l'en-tête ramène à l'accueil des modules pour
            les utilisateurs d'un client ; pour le cabinet, simple marque. */}
        {utiliseAccueil(user) ? (
          <Link to="/accueil" className="njb-sidebar-marque" title="Revenir à l'accueil NJ BUSINESS">
            <NjMarque taille={34} fond="#243655" module titre="NJ BUSINESS" />
            <span className="njb-sidebar-textes">
              <span className="njb-sidebar-nom">NJ FINANCE</span>
              <span className="njb-sidebar-retour">‹ Accueil NJ BUSINESS</span>
            </span>
          </Link>
        ) : (
          <span className="njb-sidebar-marque">
            <NjMarque taille={34} fond="#243655" titre="NJ BUSINESS" />
            <span className="njb-sidebar-textes">
              <span className="njb-sidebar-nom">NJ BUSINESS</span>
              <span className="njb-sidebar-retour">NJ FINANCE</span>
            </span>
          </span>
        )}
        <button type="button" className="sidebar-close" onClick={onClose} aria-label="Fermer le menu">✕</button>
      </div>

      <nav className="sidebar-nav" id="sidebar-nav">
{peutGererProspects(user, can) && (
        <NavLink to="/mynjbusiness" className={navClass}>
          <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
          MyNjBusiness
        </NavLink>
        )}
{!['super_admin', 'commercial'].includes(user?.role) && (
        <NavLink to="/" end className={navClass}>
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
          Tableau de bord
        </NavLink>
        )}

        {/* NJ FINANCE — menu réorganisé le 25/11/2026 (cahier de Franck) : Tableau de bord,
            Configuration (entité, clients, fournisseurs, paramètres), 1 Achats, 2 Gestion des
            activités (ONG / associations), 4 Facturation, 5 Caisse Pro, 7 Contrôle, 8 Reporting.
            Missions (3) et Inventaire (6) viendront avec leurs lots. Les adresses et les droits des
            pages ne changent pas. */}
        {voitConfiguration(user, can) && (
        <NavLink to="/config" className={navClass}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          Configuration
        </NavLink>
        )}

        {!sansClient && (<>
        <div className="nav-sep" />

        {/* 1. ACHATS (F6, 080 ; menu réorganisé le 25/11/2026) : tableau des factures fournisseurs de
            toutes origines, par type d'achat ; échéancier et dettes. */}
        {voit('/finance/achats') && (
        <NavGroup
          name="achats"
          label="Achats"
          icon={<svg viewBox="0 0 24 24"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>}
        >
          <NavLink to="/finance/achats" className={() => subClass({ isActive: surPage('/finance/achats', '') || /^\/finance\/achats\/(fin|com_ff)\//.test(location.pathname) })}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
            Tableau des achats
          </NavLink>
          <NavLink to="/finance/achats?type=marchandises" className={() => subClass({ isActive: surPage('/finance/achats', 'type=marchandises') })}>
            <svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
            Achats de marchandises
          </NavLink>
          <NavLink to="/finance/achats?type=autres" className={() => subClass({ isActive: surPage('/finance/achats', 'type=autres') })}>
            <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
            Autres achats et charges
          </NavLink>
          {can('finance.achats.saisir') && (
          <NavLink to="/finance/achats/nouvelle" className={subClass}>
            <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Nouvelle facture
          </NavLink>
          )}
          {voit('/finance/achats/lecture') && (
          <NavLink to="/finance/achats/lecture" className={subClass}>
            <svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><line x1="7" y1="12" x2="17" y2="12" /></svg>
            Import et lecture automatique
          </NavLink>
          )}
          <NavLink to="/finance/achats/echeancier" className={subClass}>
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
            Échéancier fournisseurs
          </NavLink>
          {voit('/finance/dettes') && (
          <NavLink to="/finance/dettes" className={subClass}>
            <svg viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg>
            Dettes fournisseurs
          </NavLink>
          )}
        </NavGroup>
        )}

        {/* Activités et projets réservés aux ONG / associations (décision du 25/11/2026) :
            une PME n'a pas la rubrique. */}
        {accesProjets?.ong && (accesProjets?.visible || voit('/activites') || voitOngletConfig(user, can, 'activites')) && (
        <NavGroup
          name="gestion-activite"
          label="Gestion des activités"
          badge={badgeProjets}
          badgeTitre="Budgets à valider et justificatifs à contrôler"
          icon={<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><line x1="8" y1="13" x2="16" y2="13" /></svg>}
        >
          {accesProjets?.visible && (
          <NavLink to="/projets" className={subClass}>
            <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><line x1="8" y1="13" x2="16" y2="13" /></svg>
            <span style={{ flex: 1 }}>Activités et projets</span>
            {(accesProjets.a_valider || 0) + (accesProjets.justificatifs_a_controler || 0) > 0 && (
              <span className="j-badge" style={{ background: '#d97706', color: '#fff' }} title="Budgets à valider et justificatifs à contrôler">
                {(accesProjets.a_valider || 0) + (accesProjets.justificatifs_a_controler || 0)}
              </span>
            )}
          </NavLink>
          )}
          {accesProjets?.visible && (
          <NavLink to="/projets/bilan" className={subClass}>
            <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
            Budgets et suivi budgétaire
          </NavLink>
          )}
          {accesProjets?.visible && (
          <NavLink to="/projets/a-controler" className={subClass}>
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
            Justificatifs à contrôler
          </NavLink>
          )}
          {voit('/activites') && (
          <NavLink to="/activites" className={subClass}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>
            Rapports par activité
          </NavLink>
          )}
          {voitOngletConfig(user, can, 'activites') && (
            <Link to="/config" state={{ onglet: 'activites' }} className="nav-item nav-sub" title="Configuration → Activités / projets">
              <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
              Fiches des activités
            </Link>
          )}
        </NavGroup>
        )}

        {/* 4. FACTURATION (F8, 081) : proformas, factures définitives, avoirs, créances. Le paiement
            par caisse se fait depuis la facture (mouvement créé et relié, sans deuxième saisie). */}
        {voit('/finance/ventes') && (
        <NavGroup
          name="ventes"
          label="Facturation"
          icon={<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
        >
          <NavLink to="/finance/ventes" className={() => subClass({ isActive: surPage('/finance/ventes', '') || /^\/finance\/ventes\/\d+/.test(location.pathname) })}>
            <svg viewBox="0 0 24 24"><polyline points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
            Tous les documents
          </NavLink>
          <NavLink to="/finance/ventes?filtre=proformas" className={() => subClass({ isActive: surPage('/finance/ventes', 'filtre=proformas') })}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
            Factures proforma
          </NavLink>
          <NavLink to="/finance/ventes?filtre=factures" className={() => subClass({ isActive: surPage('/finance/ventes', 'filtre=factures') })}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
            Factures définitives
          </NavLink>
          <NavLink to="/finance/ventes?filtre=avoirs" className={() => subClass({ isActive: surPage('/finance/ventes', 'filtre=avoirs') })}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
            Factures d'avoir
          </NavLink>
          {can('finance.ventes.facturer') && (<>
          <NavLink to="/finance/ventes/nouvelle" className={() => subClass({ isActive: surPage('/finance/ventes/nouvelle', '') })}>
            <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Nouvelle facture
          </NavLink>
          <NavLink to="/finance/ventes/nouvelle?type=proforma" className={() => subClass({ isActive: surPage('/finance/ventes/nouvelle', 'type=proforma') })}>
            <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Nouvelle proforma
          </NavLink>
          </>)}
          <NavLink to="/finance/ventes/echeancier" className={subClass}>
            <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
            Échéancier clients
          </NavLink>
          {voit('/finance/creances') && (
          <NavLink to="/finance/creances" className={subClass}>
            <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
            Suivi des créances clients
          </NavLink>
          )}
        </NavGroup>
        )}

        <NavGroup
          name="caisse"
          label="Caisse Pro"
          badge={(peutVoirAttente ? badgeAttente : 0) + (voit('/budget') ? badgeDepassements : 0)}
          badgeTitre="Dépenses en attente et dépassements de budget"
          icon={<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><line x1="6" y1="12" x2="6.01" y2="12" /><line x1="18" y1="12" x2="18.01" y2="12" /></svg>}
        >
          {/* Caisse Pro (organisation de Franck, 25/11/2026) : Prévision, Saisies, Reporting. */}
          {(voit('/previsions') || voit('/appel-fonds')) && <div className="nav-deep-label">Prévision</div>}
          {voit('/previsions') && (
          <NavLink to="/previsions" className={subClass}>
            <svg viewBox="0 0 24 24"><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg>
            Prévisions de dépenses
          </NavLink>
          )}
          {voit('/appel-fonds') && (
          <NavLink to="/appel-fonds" className={subClass}>
            <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /></svg>
            Demande de fonds
          </NavLink>
          )}
          <div className="nav-deep-label">Saisies</div>
          <div id="nav-journaux-section">
            {journaux.length === 0 ? (
              <div className="sidebar-empty-journaux">Aucun journal — voir Configuration</div>
            ) : journaux.map((j) => (
              <NavLink key={j.id} to={`/journal/${j.id}`} className={subClass} title={j.nom}>
                <span className="j-badge">{j.code}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.nom}</span>
              </NavLink>
            ))}
          </div>
          {peutVoirAttente && (
          <NavLink to="/attente" className={subClass}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
            <span style={{ flex: 1 }}>Dépenses en attente</span>
            {badgeAttente > 0 && (
              <span className="j-badge" style={{ background: '#dc2626', color: '#fff' }}>{badgeAttente}</span>
            )}
          </NavLink>
          )}
          {(voit('/budget') || voit('/compte-emploi') || voit('/journaux-recap')) && <div className="nav-deep-label">Reporting</div>}
          {voit('/budget') && (
          <NavLink
            to="/budget"
            className={subClass}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg viewBox="0 0 24 24" style={{ width: 14, height: 14, flexShrink: 0, stroke: 'currentColor', strokeWidth: 2, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
              Suivi budgétaire
            </span>
            {badgeDepassements > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', background: '#dc2626', color: 'white', fontSize: 10, fontWeight: 800, borderRadius: 100, flexShrink: 0 }}>
                {badgeDepassements}
              </span>
            )}
          </NavLink>
          )}
          {voit('/compte-emploi') && (
          <NavLink to="/compte-emploi" className={subClass}>
            <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
            Compte d'emploi
          </NavLink>
          )}
          {voit('/journaux-recap') && (
          <NavLink to="/journaux-recap" className={subClass}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            Historique des mouvements
          </NavLink>
          )}
        </NavGroup>

        {/* 7. CONTRÔLE : contrôles financiers et comptables existants, regroupés. */}
        {(voit('/controle/passerelle') || voit('/controle/regularite') || voit('/controle/registre') || voit('/controle/arretes') || voit('/controle/ecarts')
          || can('finance.achats.valider') || can('finance.ventes.valider') || accesProjets?.visible) && (
        <NavGroup
          name="controle"
          label="Contrôle"
          icon={<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>}
        >
          {voit('/controle/passerelle') && (
          <NavLink to="/controle/passerelle" className={subClass}>
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
            Régularité formelle
          </NavLink>
          )}
          {voit('/controle/regularite') && (
          <NavLink to="/controle/regularite"
            className={({ isActive }) => subClass({ isActive: isActive || location.pathname.startsWith('/controle/pieces') })}>
            <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            Pièces justificatives (substance)
          </NavLink>
          )}
          {can('finance.achats.valider') && (
          <NavLink to="/finance/achats?filtre=a_valider" className={() => subClass({ isActive: surPage('/finance/achats', 'filtre=a_valider') })}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
            Factures fournisseurs à valider
          </NavLink>
          )}
          {can('finance.achats.valider') && (
          <NavLink to="/finance/achats?filtre=a_imputer" className={() => subClass({ isActive: surPage('/finance/achats', 'filtre=a_imputer') })}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
            Factures NJ COMMERCIAL à imputer
          </NavLink>
          )}
          {can('finance.ventes.valider') && (
          <NavLink to="/finance/ventes?filtre=a_valider" className={() => subClass({ isActive: surPage('/finance/ventes', 'filtre=a_valider') })}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
            Factures clients à valider
          </NavLink>
          )}
          {voit('/controle/arretes') && (
          <NavLink to="/controle/arretes" className={subClass}>
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
            Arrêts de caisse et contrôles physiques
          </NavLink>
          )}
          {voit('/controle/ecarts') && (
          <NavLink to="/controle/ecarts" className={subClass}>
            <svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            Écarts de caisse
          </NavLink>
          )}
          {voit('/budget') && (
          <NavLink to="/budget" className={subClass}>
            <svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            Budgets et dépassements
          </NavLink>
          )}
          {accesProjets?.visible && (
          <NavLink to="/projets/a-controler" className={subClass}>
            <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" /></svg>
            Dépenses des projets
          </NavLink>
          )}
          {voit('/controle/registre') && (
          <NavLink to="/controle/registre" className={subClass}>
            <svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
            Registre bénéficiaires Payés/Encaissés
          </NavLink>
          )}
        </NavGroup>
        )}

        {/* 8. REPORTING : états et rapports existants. Balance et grand livre : module NJ COMPTABILITÉ. */}
        {(voit('/journaux-recap') || voit('/budget') || voit('/finance/creances') || voit('/finance/dettes')) && (
        <NavGroup
          name="reporting-etats"
          label="Reporting"
          icon={<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>}
        >
          {voit('/journaux-recap') && (
          <NavLink to="/journaux-recap" className={subClass}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            Situation de caisse
          </NavLink>
          )}
          {voit('/budget') && (
          <NavLink to="/budget" className={subClass}>
            <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
            Suivi budgétaire
          </NavLink>
          )}
          {accesProjets?.ong && voit('/activites') && (
          <NavLink to="/activites" className={subClass}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>
            Rapport des activités
          </NavLink>
          )}
          {accesProjets?.visible && (
          <NavLink to="/projets/bilan" className={subClass}>
            <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>
            Bilan des projets
          </NavLink>
          )}
          {voit('/finance/creances') && (
          <NavLink to="/finance/creances" className={subClass}>
            <svg viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
            État des créances clients
          </NavLink>
          )}
          {voit('/finance/dettes') && (
          <NavLink to="/finance/dettes" className={subClass}>
            <svg viewBox="0 0 24 24"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></svg>
            État des dettes fournisseurs
          </NavLink>
          )}
          {comptaActive && <>
          <div className="nav-deep-label">NJ COMPTABILITÉ</div>
          <NavLink to="/comptabilite/balance" className={subClass}><svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>Balance générale</NavLink>
          <NavLink to="/comptabilite/grand-livre" className={subClass}><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>Grand livre</NavLink>
          </>}
        </NavGroup>
        )}

        {/* 076 : NJ COMPTABILITÉ, module relié — les écritures des opérations de
            NJ FINANCE s'y consultent, s'y valident et s'y arrêtent. */}
        {(utiliseAccueil(user) ? moduleActif(user, 'comptabilite') : isAdmin && activeTenantId) && (
          <>
            <div className="nav-sep" />
            <NavLink to="/comptabilite" className={navClass} title="Écritures, grand livre, balance : module NJ COMPTABILITÉ">
              <svg viewBox="0 0 24 24"><path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z" /><path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" /></svg>
              <span style={{ flex: 1 }}>NJ COMPTABILITÉ</span>
              <span aria-hidden="true">›</span>
            </NavLink>
          </>
        )}

        </>)}

        {isAdmin && (
          <>
            <div className="nav-sep" />
            {activeTenantId && (
              <NavLink to="/commercial" className={navClass} title="Module NJ COMMERCIAL du client choisi (s'il est activé)">
                <svg viewBox="0 0 24 24"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
                NJ COMMERCIAL
              </NavLink>
            )}
            <NavLink to="/tenants" className={navClass}>
              <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
              Clients (Tenants)
            </NavLink>
            <NavLink to="/permissions" className={navClass}>
              <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              Permissions
            </NavLink>
            {user?.role === 'super_admin' && (
              <NavLink to="/plateforme" className={navClass}>
                <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
                Administration plateforme
              </NavLink>
            )}
            {peutGererProspects(user, can) && (
              <NavLink to="/prospects" className={navClass}>
                <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
                Prospects &amp; démos
              </NavLink>
            )}
            {user?.role === 'super_admin' && (
              <NavLink to="/validation-directe" className={navClass}>
                <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
                Validation directe
              </NavLink>
            )}
            {user?.role === 'super_admin' && (
              <NavLink to="/plan-modele" className={navClass}>
                <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                Modèle comptable
              </NavLink>
            )}
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="user-pill" role="button" tabIndex={0} title="Mon compte (mot de passe)" style={{ cursor: 'pointer' }}
          onClick={() => setMonCompte(true)} onKeyDown={(e) => { if (e.key === 'Enter') setMonCompte(true); }}>
          <div className="user-avatar-sm" id="user-avatar">{initiales}</div>
          <div>
            <div className="user-name" id="user-name">{user?.username || '—'}</div>
            <div className="user-role" id="user-role">{LIBELLE_ROLE[user?.role] || user?.role || '—'}</div>
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

import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import NjMarque from './NjMarque';
import { utiliseAccueil } from '@/lib/modules';
import { peutGererProspects } from '@/lib/acces';
import { useApp } from '@/context/AppContext';
import NavGroup from './NavGroup';
import { useState } from 'react';
import MonCompteModal from './MonCompteModal';
import { PAGE_PERMS, peut, voitConfiguration } from '@/lib/acces';
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

  // Projets (069) : ONG / associations, pour la direction, le comptable et les
  // personnes désignées (chef de projet, responsable d'activité).
  const accesProjets = useAccesProjets(`${activeTenantId || ''}:${location.pathname}:${location.search}`);
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
              <span className="njb-sidebar-nom">NJ CAISSE PRO</span>
              <span className="njb-sidebar-retour">‹ Accueil NJ BUSINESS</span>
            </span>
          </Link>
        ) : (
          <span className="njb-sidebar-marque">
            <NjMarque taille={34} fond="#243655" titre="NJ BUSINESS" />
            <span className="njb-sidebar-textes">
              <span className="njb-sidebar-nom">NJ BUSINESS</span>
              <span className="njb-sidebar-retour">NJ CAISSE PRO</span>
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

        {voitConfiguration(user, can) && (
        <NavLink to="/config" className={navClass}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          Configuration
        </NavLink>
        )}

        {peutVoirAttente && !sansClient && (
          <NavLink to="/attente" className={navClass}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
            <span style={{ flex: 1 }}>Dépenses en attente</span>
            {badgeAttente > 0 && (
              <span className="j-badge" style={{ background: '#dc2626', color: '#fff' }}>{badgeAttente}</span>
            )}
          </NavLink>
        )}

        {!sansClient && (<>
        <div className="nav-sep" />
        <div className="nav-label">Activités</div>

        <NavGroup
          name="saisies"
          label="Saisies"
          icon={<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>}
        >
          <div className="nav-deep-label">Journaux</div>
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
        </NavGroup>

        {accesProjets?.visible && (
          <NavLink to="/projets" className={navClass}>
            <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><line x1="8" y1="13" x2="16" y2="13" /></svg>
            <span style={{ flex: 1 }}>Projets</span>
            {accesProjets.a_valider > 0 && (
              <span className="j-badge" style={{ background: '#d97706', color: '#fff' }} title="Budgets à valider">{accesProjets.a_valider}</span>
            )}
          </NavLink>
        )}

        {(voit('/journaux-recap') || voit('/budget') || voit('/compte-emploi')) && (
        <NavGroup
          name="reporting"
          label="Reporting"
          icon={<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>}
        >
          {voit('/journaux-recap') && (
          <NavLink to="/journaux-recap" className={subClass}>
            <svg viewBox="0 0 24 24"><rect x="2" y="3" width="6" height="18" rx="1" /><rect x="9" y="3" width="6" height="18" rx="1" /><rect x="16" y="3" width="6" height="18" rx="1" /></svg>
            Journaux de caisse
          </NavLink>
          )}

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
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
            Compte d'emploi
          </NavLink>
          )}

          {voit('/activites') && (
          <NavLink to="/activites" className={subClass}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>
            Suivi par activité
          </NavLink>
          )}
        </NavGroup>
        )}

        {(voit('/previsions') || voit('/appel-fonds')) && (
        <NavGroup
          name="prevision"
          label="Prévision de dépenses"
          icon={<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>}
        >
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
        </NavGroup>
        )}

        {(voit('/controle/regularite') || voit('/controle/passerelle')) && (
        <NavGroup
          name="controle"
          label="Contrôle comptable"
          icon={<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>}
        >
          {/* 25/10/2026 : Passerelle en tête ; l'ancienne entrée « Rapport » devient
              « Contrôle de régularité formelle » (le rapport s'ouvre par le bouton
              « Rapport » de la page) ; nouvelle entrée « Arrêtés & inventaires ». */}
          {voit('/controle/passerelle') && (
          <NavLink to="/controle/passerelle" className={subClass}>
            <svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            {/* 26/10/2026 : la passerelle comptable s'affiche « Contrôle de régularité formelle ». */}
            Contrôle de régularité formelle
          </NavLink>
          )}
          {voit('/controle/regularite') && (
          <NavLink to="/controle/regularite"
            className={({ isActive }) => subClass({ isActive: isActive || location.pathname.startsWith('/controle/pieces') })}>
            <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
            {/* 26/10/2026 : ex-« Contrôle de régularité formelle », renommé « Contrôle de substance ». */}
            Contrôle de substance
          </NavLink>
          )}
          {voit('/controle/arretes') && (
          <NavLink to="/controle/arretes" className={subClass}>
            {/* 046 : validation des arrêtés de caisse et des inventaires (PV scanné). */}
            <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /><polyline points="9 16 11 18 15 14" /></svg>
            Arrêtés &amp; inventaires
          </NavLink>
          )}
          {voit('/controle/ecarts') && (
          <NavLink to="/controle/ecarts" className={subClass}>
            {/* 061 : registre des écarts de caisse (constat, destination, régularisation). */}
            <svg viewBox="0 0 24 24"><path d="M12 3v18" /><path d="M5 7h14" /><path d="M5 7l-3 7a3 3 0 0 0 6 0z" /><path d="M19 7l-3 7a3 3 0 0 0 6 0z" /><path d="M8 21h8" /></svg>
            Écarts de caisse
          </NavLink>
          )}
          {voit('/controle/registre') && (
          <NavLink to="/controle/registre" className={subClass}>
            <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><line x1="9" y1="7" x2="16" y2="7" /><line x1="9" y1="11" x2="14" y2="11" /></svg>
            {/* 26/10/2026 : ex-« Clients / fournisseurs ». */}
            Registre bénéficiaires Payés/Encaissés
          </NavLink>
          )}
        </NavGroup>
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

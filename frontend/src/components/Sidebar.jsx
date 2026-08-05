import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import NavGroup from './NavGroup';

// Ordre d'affichage des journaux dans la sidebar — identique à app.js
const TYPE_ORDER = ['caisse', 'banque', 'om', 'momo', 'carte_prepayee', 'autre'];

const navClass = ({ isActive }) => 'nav-item' + (isActive ? ' active' : '');
const subClass = ({ isActive }) => 'nav-item nav-sub' + (isActive ? ' active' : '');

export default function Sidebar({ badgeAttente = 0, badgeDepassements = 0 }) {
  const { user, isAdmin, peutVoirAttente, journauxGrouped, logout } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  const journaux = TYPE_ORDER.flatMap((t) => (journauxGrouped[t] || []).filter((j) => j.actif));

  const onLogout = () => {
    if (window.confirm('Se déconnecter ?')) {
      logout();
      navigate('/', { replace: true });
    }
  };

  const initiales = (user?.username || '').substring(0, 2).toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-icon-sm">₣</span>
        <span>NJ Caisse Pro</span>
      </div>

      <nav className="sidebar-nav" id="sidebar-nav">
        <NavLink to="/" end className={navClass}>
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
          Tableau de bord
        </NavLink>

        <NavLink to="/config" className={navClass}>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          Configuration
        </NavLink>

        {peutVoirAttente && (
          <NavLink to="/attente" className={navClass}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
            <span style={{ flex: 1 }}>Dépenses en attente</span>
            {badgeAttente > 0 && (
              <span className="j-badge" style={{ background: '#dc2626', color: '#fff' }}>{badgeAttente}</span>
            )}
          </NavLink>
        )}

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

        <NavGroup
          name="reporting"
          label="Reporting"
          icon={<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>}
        >
          <NavLink to="/journaux-recap" className={subClass}>
            <svg viewBox="0 0 24 24"><rect x="2" y="3" width="6" height="18" rx="1" /><rect x="9" y="3" width="6" height="18" rx="1" /><rect x="16" y="3" width="6" height="18" rx="1" /></svg>
            Journaux de caisse
          </NavLink>

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

          <NavLink to="/compte-emploi" className={subClass}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
            Compte d'emploi
          </NavLink>
        </NavGroup>

        <NavGroup
          name="prevision"
          label="Prévision de dépenses"
          icon={<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></svg>}
        >
          <NavLink to="/previsions" className={subClass}>
            <svg viewBox="0 0 24 24"><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg>
            Prévisions de dépenses
          </NavLink>
          <NavLink to="/appel-fonds" className={subClass}>
            <svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /></svg>
            Demande de fonds
          </NavLink>
        </NavGroup>

        {isAdmin && (
          <>
            <div className="nav-sep" />
            <NavLink to="/tenants" className={navClass}>
              <svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
              Clients (Tenants)
            </NavLink>
            <NavLink to="/permissions" className={navClass}>
              <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              Permissions
            </NavLink>
          </>
        )}
      </nav>

      <div className="sidebar-footer">
        <div className="user-pill">
          <div className="user-avatar-sm" id="user-avatar">{initiales}</div>
          <div>
            <div className="user-name" id="user-name">{user?.username || '—'}</div>
            <div className="user-role" id="user-role">{user?.role || '—'}</div>
          </div>
        </div>
        <button className="btn-logout" onClick={onLogout} title="Déconnexion">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
        </button>
      </div>
    </aside>
  );
}

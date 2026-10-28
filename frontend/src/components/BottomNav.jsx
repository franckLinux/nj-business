import { NavLink } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { PAGE_PERMS, peut } from '@/lib/acces';

// Barre de navigation basse — affichée uniquement sur téléphone (≤ 640 px,
// voir styles/responsive.css). Donne un accès au pouce aux écrans les plus
// utilisés ; le bouton « Menu » ouvre le tiroir complet (Sidebar).
const TYPE_ORDER = ['caisse', 'banque', 'om', 'momo', 'carte_prepayee', 'autre'];

const cls = ({ isActive }) => 'bn-item' + (isActive ? ' active' : '');

const Ico = ({ children }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
);

export default function BottomNav({ badgeAttente = 0, onMenu }) {
  const { user, can, journaux, activeTenantId, peutVoirAttente } = useApp();
  const sansClient = (user?.role === 'super_admin' && !activeTenantId) || user?.role === 'commercial';
  const voit = (path) => peut(can, PAGE_PERMS[path]);

  const premierJournal = [...(journaux || [])]
    .filter((j) => j.actif)
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type))[0];

  const items = [];
  if (!['super_admin', 'commercial'].includes(user?.role)) {
    items.push(
      <NavLink key="home" to="/" end className={cls}>
        <Ico><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Ico>
        <span>Accueil</span>
      </NavLink>,
    );
  }
  if (!sansClient && premierJournal && can('journal.view')) {
    items.push(
      <NavLink key="saisie" to={`/journal/${premierJournal.id}`} className={({ isActive }) => cls({ isActive: isActive || window.location.pathname.startsWith('/journal/') })}>
        <Ico><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></Ico>
        <span>Saisie</span>
      </NavLink>,
    );
  }
  if (!sansClient && peutVoirAttente) {
    items.push(
      <NavLink key="attente" to="/attente" className={cls}>
        <Ico><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></Ico>
        <span>Attente</span>
        {badgeAttente > 0 && <b className="bn-badge">{badgeAttente > 99 ? '99+' : badgeAttente}</b>}
      </NavLink>,
    );
  } else if (!sansClient && voit('/budget')) {
    items.push(
      <NavLink key="budget" to="/budget" className={cls}>
        <Ico><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></Ico>
        <span>Budget</span>
      </NavLink>,
    );
  }
  if (!sansClient && voit('/journaux-recap')) {
    items.push(
      <NavLink key="etats" to="/journaux-recap" className={cls}>
        <Ico><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></Ico>
        <span>États</span>
      </NavLink>,
    );
  }

  return (
    <nav className="bottom-nav" aria-label="Navigation rapide">
      {items}
      <button type="button" className="bn-item" onClick={onMenu} aria-label="Ouvrir le menu complet">
        <Ico><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></Ico>
        <span>Menu</span>
      </button>
    </nav>
  );
}

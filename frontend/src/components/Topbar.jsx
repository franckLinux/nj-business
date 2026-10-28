import { useApp } from '@/context/AppContext';
import { MOIS, anneeCourante } from '@/lib/format';
import NotifBell from './NotifBell';
import RafraichirBouton from './RafraichirBouton';
import SyncBadge from './SyncBadge';
import InstallPwaButton from './InstallPwaButton';

// Barre supérieure : titre de page, sélecteur de période, cloche de
// notifications, badges tenant/devise. Le sélecteur d'années couvre l'année
// en cours et les 5 précédentes, comme initPeriod() dans l'app vanilla.
export default function Topbar({ title, onMenu, sansPeriode = false }) {
  const { mois, setMois, annee, setAnnee, tenantLabel, devise, isAdmin, openTenantSelector } = useApp();

  const yr = anneeCourante();
  const annees = Array.from({ length: 6 }, (_, i) => yr - i);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button type="button" className="btn-menu" onClick={onMenu} aria-label="Ouvrir le menu">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
        </button>
        <span id="page-title">{title}</span>
        {!sansPeriode && (<div className="period-selector">
          <select value={mois} onChange={(e) => setMois(e.target.value)} aria-label="Mois">
            {MOIS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={annee} onChange={(e) => setAnnee(parseInt(e.target.value, 10))} aria-label="Année">
            {annees.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>)}
      </div>

      <div className="topbar-right">
        <RafraichirBouton />
        <NotifBell />
        <span
          className="tenant-badge"
          id="tenant-badge"
          style={isAdmin ? { cursor: 'pointer' } : undefined}
          title={isAdmin ? 'Cliquez pour changer de client' : undefined}
          onClick={isAdmin ? openTenantSelector : undefined}
        >
          {tenantLabel}
        </span>
        <span className="devise-badge" id="devise-badge">{devise}</span>
        <SyncBadge />
        <InstallPwaButton />
      </div>
    </header>
  );
}

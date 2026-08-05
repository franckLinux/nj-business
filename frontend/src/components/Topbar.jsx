import { useApp } from '@/context/AppContext';
import { MOIS, anneeCourante } from '@/lib/format';

// Barre supérieure : titre de page, sélecteur de période, badges tenant/devise.
// Le sélecteur d'années couvre l'année en cours et les 5 précédentes,
// comme initPeriod() dans l'app vanilla.
export default function Topbar({ title }) {
  const { mois, setMois, annee, setAnnee, tenantLabel, devise, isAdmin } = useApp();

  const yr = anneeCourante();
  const annees = Array.from({ length: 6 }, (_, i) => yr - i);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span id="page-title">{title}</span>
        <div className="period-selector">
          <select value={mois} onChange={(e) => setMois(e.target.value)}>
            {MOIS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select value={annee} onChange={(e) => setAnnee(parseInt(e.target.value, 10))}>
            {annees.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="topbar-right">
        <span
          className="tenant-badge"
          id="tenant-badge"
          style={isAdmin ? { cursor: 'pointer' } : undefined}
          title={isAdmin ? 'Sélection du client — à migrer' : undefined}
        >
          {tenantLabel}
        </span>
        <span className="devise-badge" id="devise-badge">{devise}</span>
      </div>
    </header>
  );
}

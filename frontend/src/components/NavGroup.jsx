import { useCallback, useState } from 'react';

// Groupe collapsible de la sidebar. Reprend la persistance localStorage
// de l'app vanilla (clé `navGroupState`) pour que l'état d'ouverture
// soit partagé entre les deux frontends.
const STORAGE_KEY = 'navGroupState';

const readState = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
};

// badge (NJ FINANCE, lot F1) : total affiché sur l'en-tête de la rubrique,
// pour qu'un compteur reste visible quand la rubrique est repliée.
export default function NavGroup({ name, icon, label, defaultOpen = true, badge = 0, badgeTitre = '', children }) {
  const [open, setOpen] = useState(() => {
    const saved = readState();
    return saved[name] !== undefined ? saved[name] : defaultOpen;
  });

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      try {
        const saved = readState();
        saved[name] = next;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      } catch { /* stockage indisponible : l'état reste en mémoire */ }
      return next;
    });
  }, [name]);

  return (
    <div className={'nav-group' + (open ? ' open' : '')} id={`nav-group-${name}`}>
      <div className="nav-group-head" onClick={toggle}>
        {icon}
        <span style={{ flex: 1 }}>{label}</span>
        {badge > 0 && (
          <span className="j-badge" style={{ background: '#dc2626', color: '#fff' }} title={badgeTitre}>{badge}</span>
        )}
        <svg className="nav-chevron" viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18" /></svg>
      </div>
      <div className="nav-sub-container">{children}</div>
    </div>
  );
}

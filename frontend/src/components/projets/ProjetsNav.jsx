import { NavLink } from 'react-router-dom';
import { useAccesProjets } from '@/lib/projets';

// Navigation interne de l'espace Projets (ONG / associations) :
// Projets · Justificatifs à contrôler · Bilan.
export default function ProjetsNav() {
  const acces = useAccesProjets('nav');
  const cls = ({ isActive }) => `pj-onglet-b${isActive ? ' on' : ''}`;
  return (
    <div className="pj-onglets pj-nav" role="navigation" aria-label="Espace Projets">
      <NavLink to="/projets" end className={cls}>Tableau de bord & projets</NavLink>
      {acces?.controle_justificatifs && (
        <NavLink to="/projets/a-controler" className={cls}>
          Justificatifs à contrôler
          {acces.justificatifs_a_controler > 0 && <span className="pj-pastille">{acces.justificatifs_a_controler}</span>}
        </NavLink>
      )}
      <NavLink to="/projets/bilan" className={cls}>Bilan des activités</NavLink>
    </div>
  );
}

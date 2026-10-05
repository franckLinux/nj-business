import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import EntiteTab from '@/components/config/EntiteTab';
import UsersTab from '@/components/config/UsersTab';
import JournauxTab from '@/components/config/JournauxTab';
import PlanComptableTab from '@/components/config/PlanComptableTab';
import RubriquesTab from '@/components/config/RubriquesTab';
import PiecesTab from '@/components/config/PiecesTab';
import RolesTab from '@/components/config/RolesTab';
import { voitOngletConfig } from '@/lib/acces';

// Reprend loadConfig()/switchTab() de legacy/js/app.js (l. 3913-3948).
// Les 6 onglets (+ Rôles : super_admin, ou directeur via roles.edit — décision
// du 02/10/2026) sont maintenant tous portés.
const TABS = [
  { id: 'entite', label: '🏢 Entité', Comp: EntiteTab },
  { id: 'users', label: '👥 Utilisateurs', Comp: UsersTab },
  { id: 'journaux', label: '📒 Journaux', Comp: JournauxTab },
  { id: 'plan', label: '📚 Plan comptable', Comp: PlanComptableTab },
  { id: 'rubriques', label: '📋 Rubriques', Comp: RubriquesTab },
  { id: 'pieces', label: '📎 Pièces justificatives', Comp: PiecesTab },
];

export default function ConfigPage() {
  const { user, can } = useApp();
  const voitRoles = user?.role === 'super_admin' || can('roles.edit');
  const [active, setActive] = useState('entite');

  // Seuls les onglets sur lesquels la personne peut agir sont affichés
  // (voir lib/acces.js) : plus d'onglets inutiles ni de « Permission requise ».
  const visibles = TABS.filter((t) => voitOngletConfig(user, can, t.id));
  const tabs = voitRoles ? [...visibles, { id: 'roles', label: '🎭 Rôles', Comp: RolesTab }] : visibles;
  const courant = tabs.find((t) => t.id === active) || tabs[0];
  const ActiveComp = courant?.Comp;

  if (!ActiveComp) {
    return <div className="loading-msg">Aucun paramètre de configuration n'est accessible avec votre profil.</div>;
  }

  return (
    <>
      <div className="tabs-header">
        {tabs.map((t) => (
          <button key={t.id} className={'tab-btn' + (courant.id === t.id ? ' active' : '')} onClick={() => setActive(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-content active">
        <ActiveComp />
      </div>
    </>
  );
}

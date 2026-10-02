import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import EntiteTab from '@/components/config/EntiteTab';
import UsersTab from '@/components/config/UsersTab';
import JournauxTab from '@/components/config/JournauxTab';
import PlanComptableTab from '@/components/config/PlanComptableTab';
import RubriquesTab from '@/components/config/RubriquesTab';
import PiecesTab from '@/components/config/PiecesTab';
import RolesTab from '@/components/config/RolesTab';

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

  const tabs = voitRoles ? [...TABS, { id: 'roles', label: '🎭 Rôles', Comp: RolesTab }] : TABS;
  const ActiveComp = tabs.find((t) => t.id === active)?.Comp || EntiteTab;

  return (
    <>
      <div className="tabs-header">
        {tabs.map((t) => (
          <button key={t.id} className={'tab-btn' + (active === t.id ? ' active' : '')} onClick={() => setActive(t.id)}>
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

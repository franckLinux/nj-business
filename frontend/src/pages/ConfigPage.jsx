import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import EntiteTab from '@/components/config/EntiteTab';
import UsersTab from '@/components/config/UsersTab';
import JournauxTab from '@/components/config/JournauxTab';
import PlanComptableTab from '@/components/config/PlanComptableTab';
import RubriquesTab from '@/components/config/RubriquesTab';
import PiecesTab from '@/components/config/PiecesTab';
import RolesTab from '@/components/config/RolesTab';
import ActivitesTab from '@/components/config/ActivitesTab';
import ProjetsConfigTab from '@/components/config/ProjetsConfigTab';
import FacturationTab from '@/pages/finance/FacturationTab';
import { TiersListePage } from '@/pages/finance/TiersPages';
import { voitOngletConfig } from '@/lib/acces';
import { useContexteProjets } from '@/lib/projets';

const ClientsTab = () => <TiersListePage key="c" sens="client" />;
const FournisseursTab = () => <TiersListePage key="f" sens="fournisseur" />;

// Reprend loadConfig()/switchTab() de legacy/js/app.js (l. 3913-3948).
// Les 6 onglets (+ Rôles : super_admin, ou directeur via roles.edit — décision
// du 02/10/2026) sont maintenant tous portés.
// NJ FINANCE (menu réorganisé le 25/11/2026) : onglets regroupés en trois familles —
// l'entité, ses tiers (clients, fournisseurs), les paramètres comptables et financiers.
const GROUPES = { entite: "L'entité", tiers: 'Clients et fournisseurs', parametres: 'Paramètres comptables et financiers' };
// 083 : projets, chef de projet, activités et responsables déclarés ici ; la liste
// complète des activités (y compris hors projet) reste accessible en dessous.
function ActivitesProjetsTab(props) {
  const [toutes, setToutes] = useState(false);
  return (
    <div>
      <ProjetsConfigTab />
      <div style={{ marginTop: 18 }}>
        <button type="button" className="cm-btn cm-secondaire cm-petit" onClick={() => setToutes((x) => !x)}>
          {toutes ? 'Masquer la liste détaillée des activités' : 'Liste détaillée des activités (y compris hors projet)'}</button>
      </div>
      {toutes && <div style={{ marginTop: 12 }}><ActivitesTab {...props} /></div>}
    </div>
  );
}

const TABS = [
  { id: 'entite', groupe: 'entite', label: '🏢 Entité', Comp: EntiteTab },
  { id: 'users', groupe: 'entite', label: '👥 Utilisateurs', Comp: UsersTab },
  { id: 'clients', groupe: 'tiers', label: '🤝 Clients', Comp: ClientsTab },
  { id: 'fournisseurs', groupe: 'tiers', label: '🚚 Fournisseurs', Comp: FournisseursTab },
  { id: 'journaux', groupe: 'parametres', label: '📒 Journaux', Comp: JournauxTab },
  { id: 'plan', groupe: 'parametres', label: '📚 Plan comptable', Comp: PlanComptableTab },
  { id: 'rubriques', groupe: 'parametres', label: '📋 Rubriques', Comp: RubriquesTab },
  { id: 'pieces', groupe: 'parametres', label: '📎 Pièces justificatives', Comp: PiecesTab },
  // NJ FINANCE F5 (079) : catégories, prestations, modes de règlement, taxes, numérotation.
  { id: 'facturation', groupe: 'parametres', label: '🧾 Facturation', Comp: FacturationTab },
  { id: 'activites', groupe: 'parametres', label: '🎯 Activités / projets', Comp: ActivitesProjetsTab },
];

export default function ConfigPage() {
  const { user, can } = useApp();
  const location = useLocation();
  const voitRoles = user?.role === 'super_admin' || can('roles.edit');
  const [active, setActive] = useState(location.state?.onglet || 'entite');
  // NJ FINANCE (F1) : « Gestion d'activité → Fiches des activités » ouvre
  // l'onglet Activités, y compris quand la Configuration est déjà affichée.
  useEffect(() => {
    if (location.state?.onglet) setActive(location.state.onglet);
  }, [location.key, location.state?.onglet]);
  // Arrivée depuis l'initialisation des caisses : étapes suivantes proposées.
  const [bienvenue, setBienvenue] = useState(Boolean(location.state?.bienvenue));
  const demo = user?.type_compte === 'demo';

  // Seuls les onglets sur lesquels la personne peut agir sont affichés
  // (voir lib/acces.js) : plus d'onglets inutiles ni de « Permission requise ».
  // Activités / projets : réservés aux ONG et associations (25/11/2026).
  const ctxProjets = useContexteProjets();
  const visibles = TABS.filter((t) => voitOngletConfig(user, can, t.id) && !(t.id === 'activites' && ctxProjets && !ctxProjets.ong));
  const tabs = voitRoles ? [...visibles.slice(0, visibles.filter((t) => t.groupe === 'entite').length),
    { id: 'roles', groupe: 'entite', label: '🎭 Rôles', Comp: RolesTab }, ...visibles.filter((t) => t.groupe !== 'entite')] : visibles;
  const courant = tabs.find((t) => t.id === active) || tabs[0];
  const ActiveComp = courant?.Comp;

  if (!ActiveComp) {
    return <div className="loading-msg">Aucun paramètre de configuration n'est accessible avec votre profil.</div>;
  }

  const etapes = [
    { id: 'entite', titre: 'Votre entreprise', texte: 'raison sociale, logo et coordonnées (imprimés sur les bons de caisse)' },
    { id: 'users', titre: 'Vos utilisateurs', texte: demo ? 'créez les accès de votre équipe (rôles Directeur et Caissier pendant la démonstration)' : 'créez les accès de votre équipe' },
    { id: 'rubriques', titre: 'Vos rubriques', texte: 'adaptez les rubriques de dépenses et de recettes à votre activité' },
  ].filter((e) => tabs.some((t) => t.id === e.id));

  return (
    <>
      {bienvenue && (
        <div style={{ background: 'linear-gradient(135deg,#eff6ff,#dbeafe)', border: '1px solid #bfdbfe', borderRadius: 12, padding: '14px 18px', marginBottom: 16, position: 'relative' }}>
          <button type="button" onClick={() => setBienvenue(false)} aria-label="Fermer"
            style={{ position: 'absolute', top: 8, right: 10, background: 'none', border: 0, fontSize: 16, cursor: 'pointer', color: '#1e40af' }}>✕</button>
          <div style={{ fontWeight: 700, color: '#1e3a8a', fontSize: 15, marginBottom: 4 }}>✓ Vos caisses sont initialisées</div>
          <div style={{ fontSize: 13, color: '#1e40af', marginBottom: 8 }}>Terminez la configuration de votre espace :</div>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#1e293b', lineHeight: 1.8 }}>
            {etapes.map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => setActive(e.id)}
                  style={{ background: 'none', border: 0, padding: 0, color: '#1d4ed8', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>{e.titre}</button>
                {' '}: {e.texte}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="config-groupes">
        {Object.entries(GROUPES).map(([g, libelle]) => {
          const ceux = tabs.filter((t) => t.groupe === g);
          if (!ceux.length) return null;
          return (
            <div key={g} className={`config-groupe${ceux.some((t) => t.id === courant.id) ? ' actif' : ''}`}>
              <div className="config-groupe-titre">{libelle}</div>
              <div className="tabs-header">
                {ceux.map((t) => (
                  <button key={t.id} className={'tab-btn' + (courant.id === t.id ? ' active' : '')} onClick={() => setActive(t.id)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="tab-content active">
        <ActiveComp />
      </div>
    </>
  );
}

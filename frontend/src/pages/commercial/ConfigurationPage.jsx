// NJ COMMERCIAL — Configuration : une seule entrée de menu, les rubriques en onglets
// regroupés (Démarrage, Entreprise, Catalogue, Tiers), comme la configuration de la caisse.
// Chaque onglet garde son adresse (/commercial/configuration/<onglet>) : lien direct,
// retour arrière et rafraîchissement restent sur le bon onglet.
import { useEffect, useRef } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '@/context/AppContext';
import { ICONES } from '@/components/commercial/icones';
import DemarragePage from '@/pages/commercial/DemarragePage';
import SocietePage from '@/pages/commercial/SocietePage';
import AgencesPage from '@/pages/commercial/AgencesPage';
import MagasinsPage from '@/pages/commercial/MagasinsPage';
import UtilisateursPage from '@/pages/commercial/UtilisateursPage';
import FamillesPage from '@/pages/commercial/FamillesPage';
import UnitesPage from '@/pages/commercial/UnitesPage';
import ArticlesPage from '@/pages/commercial/ArticlesPage';
import TaxesPage from '@/pages/commercial/TaxesPage';
import TiersPage from '@/pages/commercial/TiersPage';

const VOIT_REF = ['com.parametrage.voir', 'com.articles.voir'];
export const ONGLETS_CONFIG = [
  { groupe: 'Démarrage', onglets: [
    { id: 'mise-en-route', libelle: 'Mise en route', icone: ICONES.depart, codes: ['com.parametrage.voir', 'com.articles.voir', 'com.da.creer', 'com.tiers.voir'], rendu: () => <DemarragePage /> },
  ] },
  { groupe: 'Entreprise', onglets: [
    { id: 'societe', libelle: 'Société', icone: ICONES.societe, codes: ['com.parametrage.voir'], rendu: () => <SocietePage /> },
    { id: 'agences', libelle: 'Agences', icone: ICONES.agence, codes: ['com.parametrage.voir'], rendu: () => <AgencesPage /> },
    { id: 'magasins', libelle: 'Magasins', icone: ICONES.magasin, codes: VOIT_REF, rendu: () => <MagasinsPage /> },
    { id: 'utilisateurs', libelle: 'Utilisateurs', icone: ICONES.utilisateur, codes: ['com.parametrage.modifier'], rendu: () => <UtilisateursPage /> },
  ] },
  { groupe: 'Catalogue', onglets: [
    { id: 'familles', libelle: 'Familles', icone: ICONES.famille, codes: VOIT_REF, rendu: () => <FamillesPage /> },
    { id: 'unites', libelle: 'Unités', icone: ICONES.unite, codes: VOIT_REF, rendu: () => <UnitesPage /> },
    { id: 'articles', libelle: 'Articles', icone: ICONES.article, codes: ['com.articles.voir', 'com.da.creer'], rendu: () => <ArticlesPage /> },
    { id: 'taxes', libelle: 'Taxes', icone: ICONES.taxe, codes: ['com.parametrage.voir'], rendu: () => <TaxesPage /> },
  ] },
  { groupe: 'Tiers', onglets: [
    { id: 'fournisseurs', libelle: 'Fournisseurs', icone: ICONES.fournisseur, codes: ['com.tiers.voir'], rendu: () => <TiersPage key="f" type="fournisseur" /> },
    { id: 'clients', libelle: 'Clients', icone: ICONES.client, codes: ['com.tiers.voir'], rendu: () => <TiersPage key="c" type="client" /> },
  ] },
];
const TOUS = ONGLETS_CONFIG.flatMap((g) => g.onglets);
export const CODES_CONFIG = [...new Set(TOUS.flatMap((o) => o.codes))];
export const libelleOnglet = (id) => TOUS.find((o) => o.id === id)?.libelle;

export default function ConfigurationPage() {
  const { onglet } = useParams();
  const { can } = useApp();
  const navigate = useNavigate();
  const barre = useRef(null);
  const groupes = ONGLETS_CONFIG.map((g) => ({ ...g, onglets: g.onglets.filter((o) => o.codes.some((c) => can(c))) })).filter((g) => g.onglets.length);
  const visibles = groupes.flatMap((g) => g.onglets);
  const courant = visibles.find((o) => o.id === onglet);

  // Sur téléphone, l'onglet actif reste visible dans la barre qui défile.
  useEffect(() => {
    barre.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [onglet]);

  if (!visibles.length) return <div className="cm-page"><div className="cm-note">Aucune rubrique de configuration n'est accessible avec votre profil.</div></div>;
  if (!courant) return <Navigate to={`/commercial/configuration/${visibles[0].id}`} replace />;

  const clavier = (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = visibles.indexOf(courant);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? visibles.length - 1
      : (i + (e.key === 'ArrowRight' ? 1 : -1) + visibles.length) % visibles.length;
    navigate(`/commercial/configuration/${visibles[j].id}`);
    setTimeout(() => barre.current?.querySelector('[aria-selected="true"]')?.focus(), 0);
  };

  return (
    <div className="cm-config">
      <header className="cm-config-tete">
        <div>
          <h1>Configuration</h1>
          <p>Les réglages de NJ COMMERCIAL, rangés par thème.</p>
        </div>
      </header>
      <nav className="cm-config-barre" ref={barre} role="tablist" aria-label="Rubriques de configuration" onKeyDown={clavier}>
        {groupes.map((g) => (
          <div key={g.groupe} className="cm-config-groupe" role="presentation">
            <span className="cm-config-groupe-lib" aria-hidden="true">{g.groupe}</span>
            <div className="cm-config-onglets" role="presentation">
              {g.onglets.map((o) => {
                const actif = o.id === courant.id;
                return (
                  <button key={o.id} type="button" role="tab" id={`cfg-${o.id}`} aria-selected={actif} aria-controls="cfg-panneau"
                    tabIndex={actif ? 0 : -1} className={'cm-config-onglet' + (actif ? ' actif' : '')}
                    onClick={() => navigate(`/commercial/configuration/${o.id}`)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d={o.icone} /></svg>
                    <span>{o.libelle}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <section id="cfg-panneau" role="tabpanel" aria-labelledby={`cfg-${courant.id}`} className="cm-config-panneau">
        {courant.rendu()}
      </section>
    </div>
  );
}

// Suivi de la caisse des projets (069) — ONG / associations seulement.
// Contexte de saisie lu sur GET /api/projets/saisie : { ong: false } pour une
// PME ; sinon natures de recette, projets actifs et leurs activités (budget
// validé, déjà remis, reste). Le dernier contexte reçu sert hors ligne.
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

let dernier = null;

export const NATURES_RECETTE = [
  { code: 'financement_projet', libelle: 'Financement de projet', affectee: true },
  { code: 'subvention', libelle: 'Subvention', affectee: true },
  { code: 'don_affecte', libelle: 'Don affecté', affectee: true },
  { code: 'contribution_partenaire', libelle: "Contribution d'un partenaire", affectee: true },
  { code: 'financement_complementaire', libelle: 'Financement complémentaire', affectee: true },
  { code: 'fonctionnement', libelle: 'Recette de fonctionnement', affectee: false },
  { code: 'cotisations', libelle: 'Cotisations', affectee: false },
  { code: 'autres', libelle: 'Autres recettes', affectee: false },
];

export const natureAffectee = (code) => NATURES_RECETTE.some((n) => n.code === code && n.affectee);
export const libelleNature = (code) => NATURES_RECETTE.find((n) => n.code === code)?.libelle || '';

/** Contexte des projets. null pendant le premier chargement. */
export function useContexteProjets() {
  const [ctx, setCtx] = useState(dernier);
  useEffect(() => {
    // Hors ligne, le Service Worker sert le dernier contexte mis en cache.
    let annule = false;
    api.get('/projets/saisie').then((r) => {
      if (annule || !r || r.error) return;
      dernier = r;
      setCtx(r);
    });
    return () => { annule = true; };
  }, []);
  return ctx;
}

/** Accès au menu « Projets » (ONG / associations) : { ong, visible, a_valider, … }. */
export function useAccesProjets(cle) {
  const [acces, setAcces] = useState(null);
  // Forme juridique modifiée (PME ↔ ONG / association) : on relit l'accès aussitôt.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const relire = () => setVersion((v) => v + 1);
    window.addEventListener('nj:entite-modifiee', relire);
    return () => window.removeEventListener('nj:entite-modifiee', relire);
  }, []);
  useEffect(() => {
    let annule = false;
    api.get('/projets/acces').then((r) => {
      if (!annule && r && !r.error) setAcces(r);
    });
    return () => { annule = true; };
  }, [cle, version]);
  return acces;
}

export const STATUTS_BUDGET = {
  brouillon: { lib: 'En préparation', cls: 'pj-b-gris' },
  soumis:    { lib: 'À valider',      cls: 'pj-b-ambre' },
  valide:    { lib: 'Validé',         cls: 'pj-b-vert' },
  rejete:    { lib: 'Rejeté',         cls: 'pj-b-rouge' },
  remplace:  { lib: 'Remplacé',       cls: 'pj-b-ardoise' },
};

/** Statut affiché d'un projet d'après ses budgets (liste). */
export const statutProjet = (p) => {
  if (!p.actif) return { lib: 'Clôturé', cls: 'pj-b-ardoise', cle: 'cloture' };
  if (p.budget_ouvert?.statut === 'soumis') return { lib: 'Budget à valider', cls: 'pj-b-ambre', cle: 'a_valider' };
  if (p.budget_valide) return { lib: 'Budget validé', cls: 'pj-b-vert', cle: 'valide' };
  if (p.dernier_rejet && !p.budget_ouvert) return { lib: 'Budget rejeté', cls: 'pj-b-rouge', cle: 'sans_budget' };
  return { lib: 'Sans budget validé', cls: 'pj-b-gris', cle: 'sans_budget' };
};

// Ligne budgétaire par unité (072) : quantité × jours × prix unitaire.
const nb = (v) => Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
/** « 25 participant × 3 j × 2 500 » (vide pour un forfait). */
export const formuleUnite = (po) => (po?.mode === 'unite'
  ? `${nb(po.quantite)}${po.unite ? ` ${po.unite}` : ''} × ${nb(po.jours)} j × ${nb(po.prix_unitaire)}`
  : '');
/** Quantité en « unités × jours » (ex. 75 participant·jours ; « 75 » si un seul jour prévu). */
export const quantiteUnites = (v, po) => `${nb(v)}${po?.unite ? ` ${po.unite}${Number(po.jours) !== 1 ? '·jours' : ''}` : (Number(po?.jours) !== 1 ? ' unités·jours' : '')}`;

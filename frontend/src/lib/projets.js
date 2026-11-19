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

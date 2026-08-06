// Constantes et formateurs — repris à l'identique de legacy/js/app.js
// afin que l'affichage (libellés, séparateurs, devise) reste strictement le même.

export const MOIS = [
  'Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre',
];

export const TYPES_ICONS = {
  caisse: '💵', banque: '🏦', om: '🟠',
  momo: '🟡', carte_prepayee: '💳', autre: '📒',
};

/** Formatage monétaire identique à l'existant : 1 234 567 FCFA */
export const fmt = (n, devise) =>
  (parseFloat(n) || 0).toLocaleString('fr-FR') + ' ' + (devise || 'FCFA');

export const moisCourant = () => MOIS[new Date().getMonth()];
export const anneeCourante = () => new Date().getFullYear();

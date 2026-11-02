// NJ COMMERCIAL — éléments partagés des écrans Stock (lot 4).
export const TYPES_STOCK = {
  entree: { libelle: 'Entrée en stock', pluriel: 'Entrées en stock', route: 'entrees',
    aide: 'Marchandise reçue hors bon de commande (don, retour interne, régularisation). Le coût saisi valorise le stock.' },
  sortie: { libelle: 'Sortie diverse', pluriel: 'Sorties diverses', route: 'sorties',
    aide: 'Consommation interne, casse, perte, échantillon. Elle sort au coût du stock (CMUP ou FIFO).' },
  transfert: { libelle: 'Transfert entre magasins', pluriel: 'Transferts', route: 'transferts',
    aide: 'La marchandise change de magasin avec son coût : un transfert ne crée aucun coût d\'achat.' },
  inventaire: { libelle: 'Inventaire', pluriel: 'Inventaires', route: 'inventaires',
    aide: 'Comptage physique. Le stock théorique est relevé à la validation ; seuls les écarts deviennent des mouvements.' },
};
export const TYPE_PAR_ROUTE = Object.fromEntries(Object.entries(TYPES_STOCK).map(([k, v]) => [v.route, k]));

export const STATUTS_STOCK = {
  brouillon: ['Brouillon', 'cm-off'], a_valider: ['À valider', 'cm-alerte'], valide: ['Validé', 'cm-ok'], annule: ['Annulé', 'cm-rouge'],
};
export function StatutStock({ statut }) {
  const [l, c] = STATUTS_STOCK[statut] || [statut, 'cm-off'];
  return <span className={`cm-pastille ${c}`}>{l}</span>;
}

export const MOUVEMENTS = {
  stock_initial: 'Stock d\'ouverture', entree: 'Entrée diverse', sortie: 'Sortie diverse', transfert_sortie: 'Transfert (départ)',
  transfert_entree: 'Transfert (arrivée)', inventaire_plus: 'Inventaire : excédent', inventaire_moins: 'Inventaire : manquant',
  reception: 'Réception fournisseur', retour_fournisseur: 'Retour fournisseur', livraison: 'Livraison client', retour_client: 'Retour client',
};

export const DROITS_STOCK = ['com.stock.voir', 'com.stock.mouvements', 'com.stock.valider'];

// Nombre saisi à la française (« 1 234,5 ») → nombre, ou null si vide.
export const lireNombre = (v) => {
  const s = String(v ?? '').replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

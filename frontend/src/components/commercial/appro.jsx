// NJ COMMERCIAL — lot 8 (063) : éléments partagés des écrans d'approvisionnement
// (consultations des fournisseurs, frais accessoires, suivi des bons de commande).
export const STATUTS_CONSULTATION = {
  brouillon: ['Brouillon', 'cm-off'], lancee: ['Lancée — offres attendues', 'cm-info'], attribuee: ['Attribuée', 'cm-ok'], annulee: ['Annulée', 'cm-rouge'],
};
export function StatutConsultation({ statut }) {
  const [l, c] = STATUTS_CONSULTATION[statut] || [statut, 'cm-off'];
  return <span className={`cm-pastille ${c}`}>{l}</span>;
}

// Suivi de chaque fournisseur consulté.
export const STATUTS_CF = {
  a_envoyer: ['À envoyer', 'cm-alerte'], envoyee: ['Envoyée', 'cm-info'], consultee: ['Consultée', 'cm-violet'],
  offre_recue: ['Offre reçue', 'cm-ok'], sans_reponse: ['Sans réponse', 'cm-off'], refusee: ['Refusée', 'cm-rouge'],
};
export function StatutFournisseurConsulte({ statut }) {
  const [l, c] = STATUTS_CF[statut] || [statut, 'cm-off'];
  return <span className={`cm-pastille ${c}`}>{l}</span>;
}

export const DISPONIBILITES = { disponible: 'Disponible', partielle: 'Partiellement disponible', indisponible: 'Indisponible' };

// Frais accessoires d'achat.
export const RUBRIQUES_FRAIS = { transport: 'Transport', douane: 'Douane', transit: 'Transit', manutention: 'Manutention', livraison: 'Livraison', assurance: 'Assurance', autre: 'Autre' };
export const METHODES_FRAIS = {
  valeur: ['Au prorata de la valeur', 'Selon le montant HT de chaque ligne du bon.'],
  quantite: ['Au prorata des quantités', 'Selon les quantités commandées, en unité de stock.'],
  poids: ['Au prorata du poids', 'Quantité × poids unitaire de la fiche article (tous les poids requis).'],
  manuel: ['Affectation manuelle', 'Vous fixez le montant de chaque ligne ; leur somme égale le montant HT.'],
};
export const STATUTS_FRAIS = { brouillon: ['Brouillon', 'cm-off'], valide: ['Validé', 'cm-ok'], annule: ['Annulé', 'cm-rouge'] };
export function StatutFrais({ statut }) {
  const [l, c] = STATUTS_FRAIS[statut] || [statut, 'cm-off'];
  return <span className={`cm-pastille ${c}`}>{l}</span>;
}

// Suivi d'un bon de commande (063) : validé (émis), envoyé, partiellement livré, livré…
export const SUIVIS_BC = {
  brouillon: ['Brouillon', 'cm-off'], valide: ['Validé — à envoyer', 'cm-alerte'], envoye: ['Envoyé au fournisseur', 'cm-info'],
  partiellement_livre: ['Partiellement livré', 'cm-violet'], livre: ['Livré', 'cm-ok'], annule: ['Annulé', 'cm-rouge'], remplace: ['Remplacé', 'cm-off'],
};
export function SuiviBon({ suivi }) {
  if (!suivi || !SUIVIS_BC[suivi]) return null;
  const [l, c] = SUIVIS_BC[suivi];
  return <span className={`cm-pastille ${c}`}>{l}</span>;
}

export const delaiTexte = (j, type) => (j === null || j === undefined || j === '' ? '—'
  : `${j} jour${Number(j) > 1 ? 's' : ''} ${type === 'ouvres' ? 'ouvrés' : 'calendaires'}`);

export const nombreSaisi = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};

// Copie un texte (lien de réponse) dans le presse-papiers ; renvoie true si c'est fait.
export async function copier(texte) {
  try { await navigator.clipboard.writeText(texte); return true; } catch {
    const t = document.createElement('textarea');
    t.value = texte; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    t.remove();
    return ok;
  }
}

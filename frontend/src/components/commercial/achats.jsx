// NJ COMMERCIAL — éléments partagés des écrans Achats (livraison B).
export const STATUTS = {
  brouillon: ['Brouillon', 'cm-off'],
  examen_achats: ['À autoriser (achats)', 'cm-alerte'],
  examen_direction: ['À autoriser (direction)', 'cm-alerte'],
  approuvee: ['Approuvée', 'cm-ok'],
  a_corriger: ['À corriger', 'cm-info'],
  rejetee: ['Rejetée', 'cm-rouge'],
  annulee: ['Annulée', 'cm-off'],
};
export const PRIORITES = { basse: 'Basse', normale: 'Normale', haute: 'Haute', urgente: 'Urgente' };

export function StatutDemande({ statut }) {
  const [l, c] = STATUTS[statut] || [statut, 'cm-off'];
  return <span className={`cm-pastille ${c}`}>{l}</span>;
}

export function Priorite({ valeur }) {
  if (valeur === 'normale') return <span className="cm-sous" style={{ marginTop: 0 }}>Normale</span>;
  const c = valeur === 'urgente' ? 'cm-rouge' : valeur === 'haute' ? 'cm-alerte' : 'cm-off';
  return <span className={`cm-pastille ${c}`}>{PRIORITES[valeur] || valeur}</span>;
}

const fq = (n) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 });

// Encart stock d'une ligne : vert si le stock couvre, orange s'il manque, gris si non suivi.
export function EncartStock({ stock, unite }) {
  if (!stock) return <span className="cm-stock-ligne cm-gris">…</span>;
  if (!stock.suivi) {
    return <span className="cm-stock-ligne cm-gris" title="Aucun stock enregistré pour ce magasin">Stock non suivi</span>;
  }
  if (stock.couvert) {
    return (
      <span className="cm-stock-ligne cm-vert" title="Le stock du magasin couvre la quantité demandée">
        Stock {fq(stock.disponible)} {unite} · couvre le besoin
      </span>
    );
  }
  return (
    <span className="cm-stock-ligne cm-orange" title="Quantité manquante à approvisionner">
      Stock {fq(stock.disponible)} {unite} · à approvisionner <strong>{fq(stock.a_approvisionner)}</strong>
    </span>
  );
}

export const dateFr = (d, heure = false) => (d ? new Date(d).toLocaleString('fr-FR', heure
  ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
  : { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

// ── Bons de commande (livraison C) ───────────────────────────────────────
export const STATUTS_BC = {
  brouillon: ['Brouillon', 'cm-off'], emis: ['Émis', 'cm-ok'], annule: ['Annulé', 'cm-rouge'], remplace: ['Remplacé', 'cm-violet'],
};
export function StatutBon({ statut }) {
  const [l, c] = STATUTS_BC[statut] || [statut, 'cm-off'];
  return <span className={`cm-pastille ${c}`}>{l}</span>;
}

// État de commande d'une demande approuvée.
const ETATS_COMMANDE = { a_commander: ['À commander', 'cm-alerte'], partielle: ['Commandée en partie', 'cm-info'], commandee: ['Commandée', 'cm-ok'] };
export function EtatCommande({ etat }) {
  if (!etat || !ETATS_COMMANDE[etat]) return null;
  const [l, c] = ETATS_COMMANDE[etat];
  return <span className={`cm-pastille ${c}`}>{l}</span>;
}

export const tailleFichier = (o) => (o > 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);

// Ouvre un fichier protégé (lu avec le jeton de session, jamais par une URL publique).
export async function ouvrirFichier(api, url, nom, mime, toast) {
  const r = await api.fichier(url);
  if (r.error) { toast?.(r.error, 'error'); return; }
  const lien = URL.createObjectURL(r.blob);
  const a = document.createElement('a');
  a.href = lien; a.rel = 'noopener';
  if (/pdf|image/.test(mime || r.type)) a.target = '_blank'; else a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(lien), 60000);
}

// Lecture d'un fichier choisi par l'utilisateur en data URL (pièces, proformas).
export const lireFichier = (f) => new Promise((ok, ko) => {
  const l = new FileReader();
  l.onload = () => ok(l.result); l.onerror = () => ko(new Error('Lecture du fichier impossible.'));
  l.readAsDataURL(f);
});

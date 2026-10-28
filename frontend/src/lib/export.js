// lib/export.js — Export « Excel » (C8) : fichier CSV au format attendu par
// Excel en français (séparateur « ; », virgule décimale, UTF-8 avec BOM pour
// les accents). Aucune dépendance : le fichier est construit dans le navigateur
// à partir des données déjà affichées à l'écran.
const cellule = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const nomFichier = (base) => `${String(base).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')}.csv`;

/**
 * exporterExcel('Journal_CS1_Octobre_2026', ['N°', 'Date', …], [[1, '2026-10-01', …], …], ['Titre', …])
 * `entete` : lignes de contexte facultatives placées avant le tableau.
 */
export function exporterExcel(base, colonnes, lignes, entete = []) {
  const corps = [
    ...entete.map((l) => (Array.isArray(l) ? l : [l]).map(cellule).join(';')),
    ...(entete.length ? [''] : []),
    colonnes.map(cellule).join(';'),
    ...lignes.map((l) => l.map(cellule).join(';')),
  ].join('\r\n');
  const blob = new Blob(['﻿' + corps], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier(base);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const num = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;

// Bouton commun, affiché seulement avec la permission « rapport.export ».
export const STYLE_BOUTON_EXPORT = {
  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'white',
  border: '1px solid #86efac', borderRadius: 9, fontSize: 12, fontWeight: 600, color: '#15803d', cursor: 'pointer',
};

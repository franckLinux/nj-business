'use strict';
// NJ FINANCE — lot F7 : analyse du texte lu sur une facture fournisseur.
// Fonction pure (aucun accès base) : texte → champs proposés, chacun avec un
// niveau de confiance « haute » | « moyenne » | « basse ». Rien n'est décidé
// ici : la personne qui saisit vérifie chaque champ avant de créer la facture.
//
// Repères camerounais : NIU (M/P + 12 chiffres + 1 lettre), montants en FCFA
// avec séparateur de milliers espace ou point, TVA 19,25 %.

const MOIS = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8,
  septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

const sansAccents = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const norm = (s) => sansAccents(s).toLowerCase();

// ── Nombres ─────────────────────────────────────────────────────────────────
// « 1 234 567 », « 1.234.567 », « 1 234 567,50 », « 217035 ». Les pourcentages sont retirés avant.
const RE_MONTANT = /(?<![\d.,])\d{1,3}(?:[   .]\d{3})+(?:,\d{1,2})?(?![\d])|(?<![\d.,])\d+(?:,\d{1,2})?(?![\d.,]?\d)/g;
const versNombre = (s) => {
  const t = String(s).replace(/[   ]/g, '');
  const [ent, dec] = t.split(',');
  const n = Number(`${ent.replace(/\./g, '')}${dec ? `.${dec}` : ''}`);
  return Number.isFinite(n) ? n : null;
};
const montantsDe = (ligne) => {
  const propre = ligne.replace(/\d+(?:[.,]\d+)?\s*%/g, ' ');       // « 19,25 % »
  return [...propre.matchAll(RE_MONTANT)].map((m) => versNombre(m[0])).filter((n) => n !== null);
};

// ── Dates ───────────────────────────────────────────────────────────────────
const isoValide = (a, m, j) => {
  if (a < 100) a += 2000;
  if (a < 2000 || a > 2100 || m < 1 || m > 12 || j < 1 || j > 31) return null;
  const d = new Date(Date.UTC(a, m - 1, j));
  if (d.getUTCMonth() !== m - 1) return null;
  return d.toISOString().slice(0, 10);
};
const datesDe = (ligne) => {
  const res = [];
  for (const m of ligne.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) {
    const iso = isoValide(Number(m[3]), Number(m[2]), Number(m[1]));
    if (iso) res.push({ iso, index: m.index });
  }
  for (const m of norm(ligne).matchAll(/\b(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(\d{4})\b/g)) {
    const iso = isoValide(Number(m[3]), MOIS[m[2]], Number(m[1]));
    if (iso) res.push({ iso, index: m.index });
  }
  return res.sort((a, b) => a.index - b.index);
};

// ── NIU ─────────────────────────────────────────────────────────────────────
// L'OCR confond souvent O et 0 : on les tolère dans la partie chiffrée.
const niusDe = (texte) => {
  const vus = new Set();
  for (const m of texte.toUpperCase().matchAll(/\b([MP])\s?((?:[\dO]\s?){12})([A-Z])\b/g)) {
    vus.add(`${m[1]}${m[2].replace(/\s/g, '').replace(/O/g, '0')}${m[3]}`);
  }
  return [...vus];
};

// ── Libellés ────────────────────────────────────────────────────────────────
const LIBELLES = {
  ht: /\b(total|montant|base)\s*(hors\s*taxes?|h\.?\s?t\.?)\b|\bnet\s*commercial\b/,
  tva: /\b(t\.?\s?v\.?\s?a\.?|taxe\s*sur\s*la\s*valeur)/,
  ttc: /\b(total|montant)\s*(t\.?\s?t\.?\s?c\.?|toutes\s*taxes)|\bnet\s*a\s*payer\b|\btotal\s*a\s*payer\b|\bmontant\s*a\s*payer\b/,
  echeance: /\b(echeance|date\s*limite|a\s*payer\s*avant|payable\s*(le|avant))\b/,
  date: /\bdate\b/,
};
// Montant porté par une ligne de total : le dernier nombre de la ligne (ou de la suivante).
const montantLibelle = (lignes, re, exclure) => {
  for (let i = lignes.length - 1; i >= 0; i -= 1) {
    const n = norm(lignes[i]);
    if (!re.test(n) || (exclure && exclure.test(n))) continue;
    let ms = montantsDe(lignes[i]).filter((x) => x > 0);
    if (!ms.length && lignes[i + 1]) ms = montantsDe(lignes[i + 1]).filter((x) => x > 0);
    if (ms.length) return ms[ms.length - 1];
  }
  return null;
};

const champ = (valeur, confiance, extra = {}) => ({ valeur, confiance: valeur === null || valeur === undefined ? 'basse' : confiance, ...extra });
const egal = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 1;


// « Ramettes papier A4 80g 20 3 500 70 000 » : les groupes de chiffres de fin de
// ligne se découpent de plusieurs façons ; on garde le découpage où
// quantité × prix unitaire = montant.
const groupeValide = (g) => g.length === 1 ? /^\d+(?:,\d{1,2})?$/.test(g[0])
  : /^\d{1,3}$/.test(g[0]) && g.slice(1, -1).every((x) => /^\d{3}$/.test(x)) && /^\d{3}(?:,\d{1,2})?$/.test(g[g.length - 1]);
const valeurGroupe = (g) => versNombre(g.join(''));
const ligneDetail = (ligne) => {
  const mots = ligne.split(' ');
  let debut = mots.length;
  while (debut > 0 && /^\d+(?:[.,]\d{1,3})?$/.test(mots[debut - 1].replace(/\./g, ''))) debut -= 1;
  const nums = mots.slice(debut).map((m) => m.replace(/\.(?=\d{3}\b)/g, ''));
  if (nums.length < 3 || !/[A-Za-zÀ-ÿ]/.test(mots.slice(0, debut).join(' '))) return null;
  // La quantité est un seul groupe ; on essaie chaque position, de droite à gauche.
  for (let iq = nums.length - 3; iq >= 0; iq -= 1) {
    const q = Number(nums[iq].replace(',', '.'));
    if (!(q > 0) || q > 1e6) continue;
    const reste = nums.slice(iq + 1);
    for (let c = 1; c < reste.length; c += 1) {
      const gPu = reste.slice(0, c); const gMt = reste.slice(c);
      if (!groupeValide(gPu) || !groupeValide(gMt)) continue;
      const pu = valeurGroupe(gPu); const mt = valeurGroupe(gMt);
      if (pu !== null && mt !== null && mt > 0 && egal(q * pu, mt)) {
        const designation = [...mots.slice(0, debut), ...nums.slice(0, iq)].join(' ').trim();
        if (designation) return { designation: designation.slice(0, 300), quantite: q, prix_unitaire: pu, montant: mt };
      }
    }
  }
  return null;
};

/**
 * @param {string} texte    texte lu
 * @param {object} contexte { niuPropre, tiers: [{id, nom, nui}], confianceOcr (0-100 | null) }
 */
const analyser = (texte, { niuPropre = '', tiers = [], confianceOcr = null } = {}) => {
  const lignes = String(texte || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const plat = lignes.join('\n');
  const alertes = [];

  // Type de pièce.
  const tete = norm(lignes.slice(0, 15).join(' '));
  const estAvoir = /\b(facture\s*d'?\s*avoir|avoir\s*n|note\s*de\s*credit)\b/.test(tete);
  if (/\b(pro\s?-?forma|devis)\b/.test(tete)) alertes.push('Le document ressemble à une proforma ou à un devis, pas à une facture.');
  if (estAvoir) alertes.push('Le document ressemble à un avoir : saisissez-le comme avoir, rattaché à la facture d\'origine.');

  // Fournisseur : NIU d'abord, nom ensuite.
  const propre = String(niuPropre || '').toUpperCase().replace(/\s/g, '');
  const nius = niusDe(plat).filter((n) => n !== propre);
  let fournisseur = champ(null, 'basse', { nui_lu: nius[0] || '', nom_lu: lignes[0] || '' });
  const parNiu = new Map(tiers.filter((t) => t.nui).map((t) => [String(t.nui).toUpperCase().replace(/\s/g, ''), t]));
  const trouve = nius.map((n) => parNiu.get(n)).find(Boolean);
  if (trouve) {
    fournisseur = champ({ id: String(trouve.id), nom: trouve.nom }, 'haute', { nui_lu: trouve.nui, nom_lu: lignes[0] || '' });
  } else {
    // Nom du tiers présent tel quel dans les premières lignes (mots de 3 lettres et plus).
    const haut = norm(lignes.slice(0, 12).join(' ')).replace(/[^a-z0-9 ]/g, ' ');
    const candidats = tiers.filter((t) => {
      const mots = norm(t.nom).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((m) => m.length >= 3 && !['sarl', 'sas', 'ets', 'societe', 'groupe'].includes(m));
      return mots.length && mots.every((m) => new RegExp(`\\b${m}\\b`).test(haut));
    });
    if (candidats.length === 1) fournisseur = champ({ id: String(candidats[0].id), nom: candidats[0].nom }, 'moyenne', { nui_lu: nius[0] || '', nom_lu: lignes[0] || '' });
    if (nius.length && !trouve) alertes.push(`NIU lu ${nius[0]} : aucun fournisseur enregistré ne le porte.`);
  }

  // Référence de la pièce.
  let reference = null;
  for (const l of lignes) {
    const m = /\b(?:facture|invoice|avoir)\s*(?:d'avoir\s*)?(?:n\s*[°ºo]|no\.?|num[ée]ro|#|ref\.?)\s*[:.]?\s*([A-Z0-9][A-Z0-9/_.-]{1,39})/i.exec(l)
      || /\bn\s*[°º]\s*(?:de\s*)?facture\s*[:.]?\s*([A-Z0-9][A-Z0-9/_.-]{1,39})/i.exec(l);
    if (m) { reference = m[1].replace(/[.,;:]+$/, ''); break; }
  }

  // Dates : « Date » / « Échéance » ; à défaut, la première date du document.
  let dateFacture = null; let echeance = null; let confDate = 'moyenne';
  for (const l of lignes) {
    const n = norm(l); const ds = datesDe(l);
    if (!ds.length) continue;
    if (!echeance && LIBELLES.echeance.test(n)) { echeance = ds[0].iso; continue; }
    if (!dateFacture && LIBELLES.date.test(n)) { dateFacture = ds[0].iso; confDate = 'haute'; }
  }
  if (!dateFacture) {
    const premiere = lignes.flatMap(datesDe).map((d) => d.iso).find((d) => d !== echeance);
    if (premiere) dateFacture = premiere;
  }
  if (dateFacture && echeance && echeance < dateFacture) { alertes.push('L\'échéance lue précède la date de la facture.'); echeance = null; }

  // Totaux.
  const ht = montantLibelle(lignes, LIBELLES.ht);
  const ttc = montantLibelle(lignes, LIBELLES.ttc);
  let tva = montantLibelle(lignes, LIBELLES.tva, /\b(hors|h\.?\s?t\b|t\.?\s?t\.?\s?c)/);
  let confHt = ht !== null ? 'moyenne' : 'basse'; let confTtc = ttc !== null ? 'moyenne' : 'basse'; let confTva = tva !== null ? 'moyenne' : 'basse';
  if (ht !== null && ttc !== null) {
    if (tva === null && ttc >= ht) { tva = ttc - ht; confTva = 'moyenne'; }
    if (egal(ht + (tva || 0), ttc)) { confHt = 'haute'; confTtc = 'haute'; confTva = tva !== null ? 'haute' : confTva; }
    else alertes.push('Les totaux lus ne concordent pas (HT + TVA ≠ TTC) : vérifiez-les sur la pièce.');
  }
  let taux = null;
  if (ht && tva !== null) {
    const t = Math.round((tva / ht) * 10000) / 100;
    if (Math.abs(t - 19.25) <= 0.05) taux = 19.25;
    else if (tva === 0) taux = 0;
    else alertes.push(`Taux de TVA calculé ${String(t).replace('.', ',')} % : ce n'est pas 19,25 %.`);
  }

  // Lignes de détail : « désignation  quantité  prix unitaire  montant », retenues si quantité × PU = montant.
  const details = [];
  for (const l of lignes) {
    const n = norm(l);
    if (LIBELLES.ht.test(n) || LIBELLES.ttc.test(n) || LIBELLES.tva.test(n)) continue;
    const d = ligneDetail(l);
    if (d) details.push(d);
  }
  const sommeDetails = details.reduce((s, d) => s + d.montant, 0);
  let lignesProposees;
  if (details.length && ht !== null && egal(sommeDetails, ht)) lignesProposees = champ(details, 'haute');
  else if (details.length && ht === null) lignesProposees = champ(details, 'moyenne');
  else if (ht !== null) {
    if (details.length) alertes.push('Les lignes lues ne totalisent pas le montant HT : une seule ligne est proposée.');
    lignesProposees = champ([{ designation: reference ? `Facture n° ${reference}` : 'Facture fournisseur', quantite: 1, prix_unitaire: ht, montant: ht }], 'basse');
  } else lignesProposees = champ(null, 'basse');

  // Une lecture OCR peu sûre abaisse la confiance de tout ce qui a été lu.
  const resultat = {
    type: champ(estAvoir ? 'avoir' : 'facture', 'moyenne'),
    fournisseur,
    reference: champ(reference, 'moyenne'),
    date_facture: champ(dateFacture, confDate),
    date_echeance: champ(echeance, 'moyenne'),
    total_ht: champ(ht, confHt),
    total_tva: champ(tva, confTva),
    total_ttc: champ(ttc, confTtc),
    taux_tva: champ(taux, taux !== null ? 'haute' : 'basse'),
    lignes: lignesProposees,
    alertes,
  };
  if (confianceOcr !== null && confianceOcr < 75) {
    for (const k of Object.keys(resultat)) {
      if (resultat[k]?.confiance === 'haute') resultat[k].confiance = 'moyenne';
    }
    alertes.push(`Lecture OCR peu nette (${Math.round(confianceOcr)} %) : contrôlez chaque champ.`);
  }
  return resultat;
};

module.exports = { analyser, montantsDe, datesDe, niusDe, versNombre };

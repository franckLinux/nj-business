'use strict';
// NJ COMMERCIAL — mise en page PDF du bon de commande (pdfkit, sans binaire système).
// Un bon émis est rendu UNE fois, archivé, et son empreinte SHA-256 publiée sur la
// page de vérification ; un brouillon n'est rendu qu'en aperçu filigrané, sans QR code.
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const BLEU = '#1a2b4a';
const GRIS = '#64748b';
const TRAIT = '#cbd5e1';
const FOND = '#f1f5f9';

const decimales = (devise) => (['FCFA', 'XAF', 'XOF', 'CFA'].includes(String(devise || '').toUpperCase()) ? 0 : 2);
// pdfkit (Helvetica standard) n'a pas d'espace fine insécable : espace simple.
const montant = (n, devise) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: decimales(devise), maximumFractionDigits: decimales(devise) }).replace(/ | /g, ' ');
const qte = (n) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 }).replace(/ | /g, ' ');
const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '');

// Montant en lettres (usage des pièces commerciales en zone OHADA), règles d'accord classiques.
const UNITES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize',
  'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];
const moinsDeCent = (n) => {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10); let u = n % 10;
  if (d === 7 || d === 9) u += 10;                          // soixante-dix, quatre-vingt-dix…
  let mot = DIZAINES[d];
  if (u === 0) return d === 8 ? 'quatre-vingts' : mot;
  if ((u === 1 || u === 11) && d < 8) return `${mot} et ${UNITES[u]}`;
  return `${mot}-${UNITES[u]}`;
};
const moinsDeMille = (n, finale) => {
  const c = Math.floor(n / 100); const r = n % 100;
  let mot = c === 0 ? '' : c === 1 ? 'cent' : `${UNITES[c]} cent${r === 0 && finale ? 's' : ''}`;
  if (r) mot = `${mot ? `${mot} ` : ''}${moinsDeCent(r)}`;
  return r === 80 && !finale ? mot.replace(/quatre-vingts$/, 'quatre-vingt') : mot;
};
const enLettres = (n) => {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zéro';
  const parts = [];
  const groupes = [[1e9, 'milliard'], [1e6, 'million'], [1e3, 'mille']];
  for (const [v, nom] of groupes) {
    const q = Math.floor(n / v);
    if (q) {
      if (nom === 'mille') parts.push(q === 1 ? 'mille' : `${moinsDeMille(q, false)} mille`);
      else parts.push(`${moinsDeMille(q, true)} ${nom}${q > 1 ? 's' : ''}`);
      n %= v;
    }
  }
  if (n) parts.push(moinsDeMille(n, true));
  return parts.join(' ');
};
const montantEnLettres = (n, devise) => {
  const d = String(devise || '').toUpperCase();
  const entier = Math.round(Number(n || 0) * (decimales(devise) ? 100 : 1));
  const de = (t) => (/(million|milliard)s?$/.test(t) ? `${t} de` : t);
  if (['FCFA', 'XAF', 'XOF', 'CFA'].includes(d)) return `${de(enLettres(entier))} franc${entier > 1 ? 's' : ''} CFA`;
  const e = Math.floor(entier / 100); const c = entier % 100;
  return `${de(enLettres(e))} ${d}${c ? ` et ${enLettres(c)} centimes` : ''}`;
};

// Logo de l'Entité : data URL PNG ou JPEG (le WebP n'est pas pris en charge par pdfkit).
const logoBuffer = (dataUrl) => {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  try { return Buffer.from(m[2], 'base64'); } catch { return null; }
};

/**
 * @param {object} o { societe, fournisseur, magasin, bc, lignes, demande, verificationUrl|null, apercu:boolean }
 * @returns {Promise<Buffer>}
 */
const rendre = async (o) => {
  const { societe: s, fournisseur: f, magasin: m, bc, lignes } = o;
  const qr = o.verificationUrl ? await QRCode.toBuffer(o.verificationUrl, { errorCorrectionLevel: 'M', margin: 1, width: 220 }) : null;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 60, left: 40, right: 40 }, bufferPages: true,
    info: { Title: `Bon de commande ${bc.numero_complet}`, Author: s.nom_affiche, Subject: 'Bon de commande', Creator: 'NJ BUSINESS — NJ COMMERCIAL' } });
  const morceaux = [];
  doc.on('data', (c) => morceaux.push(c));
  const fin = new Promise((r) => doc.on('end', () => r(Buffer.concat(morceaux))));
  const L = 40; const R = 555; const W = R - L;

  // ── En-tête : société à gauche, titre à droite ──────────────────────────
  let y = 40;
  const logo = logoBuffer(s.logo_url);
  let xTexte = L;
  if (logo) {
    try { doc.image(logo, L, y, { fit: [80, 56] }); xTexte = L + 92; } catch { /* image illisible : ignorée */ }
  }
  doc.fillColor(BLEU).font('Helvetica-Bold').fontSize(13).text(s.nom_affiche, xTexte, y, { width: 260 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
  const idLignes = [
    s.nom_commercial && s.raison_sociale !== s.nom_affiche ? s.raison_sociale : '',
    [s.forme_juridique, s.sigle].filter(Boolean).join(' · '),
    [s.adresse, s.boite_postale ? `BP ${s.boite_postale}` : ''].filter(Boolean).join(', '),
    [s.ville, s.pays].filter(Boolean).join(' — '),
    [s.telephone ? `Tél. ${s.telephone}` : '', s.email].filter(Boolean).join(' · '),
    [s.nui ? `NUI ${s.nui}` : '', s.registre_commerce ? `RCCM ${s.registre_commerce}` : ''].filter(Boolean).join(' · '),
  ].filter(Boolean);
  doc.text(idLignes.join('\n'), xTexte, doc.y + 2, { width: 260, lineGap: 1 });
  const basSociete = doc.y;

  doc.font('Helvetica-Bold').fontSize(17).fillColor(BLEU).text('BON DE COMMANDE', 330, y, { width: R - 330, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(bc.numero_complet, 330, doc.y + 2, { width: R - 330, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS);
  const meta = [
    `Date d'émission : ${o.apercu ? '— (aperçu)' : dateFr(bc.emis_le)}`,
    `Demande d'achat : ${o.demande.numero}`,
    bc.revision > 0 ? `Révision ${bc.revision} — annule et remplace la version précédente` : '',
    `Devise : ${bc.devise}`,
  ].filter(Boolean);
  doc.text(meta.join('\n'), 330, doc.y + 4, { width: R - 330, align: 'right', lineGap: 1 });
  y = Math.max(basSociete, doc.y) + 14;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1.2).strokeColor(BLEU).stroke();
  y += 12;

  // ── Fournisseur / livraison ─────────────────────────────────────────────
  const boite = (x, w, titre, lignesTexte) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS).text(titre.toUpperCase(), x + 10, y + 8, { width: w - 20, characterSpacing: 0.5 });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0f172a').text(lignesTexte[0], x + 10, doc.y + 3, { width: w - 20 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#334155').text(lignesTexte.slice(1).filter(Boolean).join('\n') || ' ', x + 10, doc.y + 2, { width: w - 20, lineGap: 1 });
    return doc.y + 8;
  };
  const wB = (W - 12) / 2;
  const hautBoites = y;
  const b1 = boite(L, wB, 'Fournisseur', [
    f.nom, f.nom_commercial, f.adresse, [f.ville, f.pays].filter(Boolean).join(' — '),
    [f.telephone ? `Tél. ${f.telephone}` : '', f.email].filter(Boolean).join(' · '),
    f.nui ? `NUI ${f.nui}` : '', f.contact_nom ? `Contact : ${f.contact_nom}${f.contact_telephone ? ` (${f.contact_telephone})` : ''}` : '',
  ]);
  y = hautBoites;
  const b2 = boite(L + wB + 12, wB, 'Livraison', [
    `${m.nom} (${m.code})`, m.localisation, bc.delai_livraison ? `Délai : ${bc.delai_livraison}` : '',
  ]);
  const hB = Math.max(b1, b2) - hautBoites;
  doc.roundedRect(L, hautBoites, wB, hB, 6).lineWidth(0.8).strokeColor(TRAIT).stroke();
  doc.roundedRect(L + wB + 12, hautBoites, wB, hB, 6).lineWidth(0.8).strokeColor(TRAIT).stroke();
  y = hautBoites + hB + 16;

  // ── Tableau des articles ────────────────────────────────────────────────
  const cols = [
    ['Réf.', 62, 'left'], ['Désignation', 152, 'left'], ['Qté', 40, 'right'], ['Unité', 38, 'left'],
    ['P.U. HT', 62, 'right'], ['Rem.', 32, 'right'], ['Taxe', 46, 'right'], ['Montant HT', 83, 'right'],
  ];
  const enTete = () => {
    doc.rect(L, y, W, 18).fill(BLEU);
    let x = L;
    doc.font('Helvetica-Bold').fontSize(7.8).fillColor('#ffffff');
    for (const [t, w, a] of cols) { doc.text(t, x + 4, y + 5.5, { width: w - 8, align: a }); x += w; }
    y += 18;
  };
  enTete();
  doc.font('Helvetica').fontSize(8.3).fillColor('#0f172a');
  lignes.forEach((l, i) => {
    const valeurs = [
      l.reference, l.designation, qte(l.quantite), l.unite, montant(l.prix_unitaire, bc.devise),
      Number(l.remise_pct) ? `${qte(l.remise_pct)} %` : '—', l.taxe_code ? `${qte(l.taxe_taux)} %` : '—', montant(l.montant_ht, bc.devise),
    ];
    const h = Math.max(16, doc.heightOfString(valeurs[1], { width: cols[1][1] - 8 }) + 8);
    if (y + h > 700) { doc.addPage(); y = 50; enTete(); doc.font('Helvetica').fontSize(8.3).fillColor('#0f172a'); }
    if (i % 2 === 1) doc.rect(L, y, W, h).fill(FOND).fillColor('#0f172a');
    let x = L;
    valeurs.forEach((v, k) => { doc.text(String(v), x + 4, y + 4, { width: cols[k][1] - 8, align: cols[k][2] }); x += cols[k][1]; });
    y += h;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.4).strokeColor(TRAIT).stroke();
  });

  // ── Totaux ──────────────────────────────────────────────────────────────
  if (y > 610) { doc.addPage(); y = 50; }
  y += 10;
  const parTaxe = {};
  lignes.forEach((l) => { if (l.taxe_code) { const k = `${l.taxe_code} ${qte(l.taxe_taux)} %`; parTaxe[k] = (parTaxe[k] || 0) + Number(l.montant_taxe); } });
  const totaux = [
    ['Total HT', montant(bc.total_ht, bc.devise), false],
    ...Object.entries(parTaxe).map(([k, v]) => [k, montant(v, bc.devise), false]),
    ...(Object.keys(parTaxe).length ? [] : [['Taxes', montant(0, bc.devise), false]]),
    [`Total TTC (${bc.devise})`, montant(bc.total_ttc, bc.devise), true],
  ];
  const xT = 340;
  const yTotaux = y;
  totaux.forEach(([k, v, fort]) => {
    if (fort) { doc.rect(xT, y - 2, R - xT, 20).fill(BLEU); doc.fillColor('#ffffff'); } else doc.fillColor('#0f172a');
    doc.font(fort ? 'Helvetica-Bold' : 'Helvetica').fontSize(fort ? 10 : 8.8);
    doc.text(k, xT + 8, y + (fort ? 3.5 : 0), { width: 120 });
    doc.text(v, xT + 120, y + (fort ? 3.5 : 0), { width: R - xT - 128, align: 'right' });
    y += fort ? 22 : 15;
  });

  // Conditions (à gauche des totaux)
  let yc = yTotaux;
  const bloc = (titre, texte) => {
    if (!texte) return;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS).text(titre.toUpperCase(), L, yc, { width: 280, characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(8.6).fillColor('#0f172a').text(texte, L, doc.y + 2, { width: 280 });
    yc = doc.y + 8;
  };
  bloc('Conditions de paiement', bc.conditions_paiement);
  bloc('Observations / instructions au fournisseur', bc.observations);
  y = Math.max(y, yc) + 4;
  const lettres = montantEnLettres(bc.total_ttc, bc.devise);
  doc.font('Helvetica').fontSize(8.6).fillColor('#0f172a')
    .text(`Arrêté le présent bon de commande à la somme de ${lettres.charAt(0).toUpperCase()}${lettres.slice(1)} toutes taxes comprises.`, L, y, { width: W });
  y = doc.y + 10;
  if (s.mentions_documents) {
    if (y > 690) { doc.addPage(); y = 50; }
    doc.font('Helvetica-Oblique').fontSize(7.8).fillColor(GRIS).text(s.mentions_documents, L, y, { width: W });
    y = doc.y + 8;
  }

  // ── Émission, autorisation, vérification ────────────────────────────────
  if (y > 640) { doc.addPage(); y = 50; }
  const hautPied = y;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).strokeColor(TRAIT).stroke();
  y += 10;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS).text('ÉMISSION ET AUTORISATION', L, y, { characterSpacing: 0.4 });
  doc.font('Helvetica').fontSize(8.6).fillColor('#0f172a')
    .text(o.apercu ? 'Aperçu avant émission — ce document n\'a aucune valeur.' : `Émis par ${bc.emis_par_nom} le ${dateFr(bc.emis_le)}.`, L, doc.y + 3, { width: qr ? 380 : W })
    .text(bc.autorisation || '', L, doc.y + 2, { width: qr ? 380 : W });
  // Visa et cachet de l'acheteur (signature manuscrite sur l'exemplaire remis au fournisseur).
  const yVisa = doc.y + 10;
  doc.roundedRect(L, yVisa, 220, 62, 5).lineWidth(0.7).dash(3, { space: 2 }).strokeColor(TRAIT).stroke().undash();
  doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text('Visa et cachet de l\'acheteur', L + 8, yVisa + 6, { width: 204 });
  if (qr) {
    doc.image(qr, R - 92, hautPied + 8, { width: 92 });
    doc.font('Helvetica').fontSize(6.8).fillColor(GRIS).text('Vérifier l\'authenticité de ce bon :', R - 250, hautPied + 104, { width: 250, align: 'right' })
      .text(o.verificationUrl, R - 250, doc.y + 1, { width: 250, align: 'right' });
  }

  // ── Filigrane d'aperçu et pied de page sur chaque page ──────────────────
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(i);
    if (o.apercu) {
      doc.save().rotate(-35, { origin: [297, 421] }).font('Helvetica-Bold').fontSize(54).fillColor('#dc2626').fillOpacity(0.12)
        .text('APERÇU — NON VALABLE', 20, 400, { width: 560, align: 'center' }).restore();
      doc.fillOpacity(1);
    }
    // Le pied est sous la marge basse : on la lève le temps de l'écrire (sinon pdfkit ajoute une page).
    const marge = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor(GRIS)
      .text(`${s.nom_affiche} — ${bc.numero_complet} — page ${i + 1} / ${pages.count}`, L, 805, { width: W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = marge;
  }
  doc.end();
  return fin;
};

module.exports = { rendre, decimales, montantEnLettres };

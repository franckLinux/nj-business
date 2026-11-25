'use strict';
// NJ COMMERCIAL — PDF des ventes (lot 6) : devis « bon pour accord » et bon de livraison.
//   • Devis : prix, remises, taxes, totaux, montant en lettres, date de validité et
//     zone « Bon pour accord » (signature et cachet du client). Tant qu'il n'est pas
//     validé, il est filigrané « PROJET — NON VALABLE ».
//   • Bon de livraison : AUCUN prix ; quantités livrées, reste à livrer, zones de
//     signature du magasin, du transporteur et du client (réception).
// Aucun QR code ni lien de vérification ici : pas de page publique pour ces pièces.
const { decimales, montantEnLettres, montant, qte, dateFr, logoBuffer, dependances, COULEURS } = require('./bc_pdf.service');

const { BLEU, GRIS, TRAIT, FOND } = COULEURS;
const L = 40; const R = 555; const W = R - L;

const nouveauDoc = (titre, s) => {
  const { PDFDocument } = dependances();
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 60, left: 40, right: 40 }, bufferPages: true,
    info: { Title: titre, Author: s.nom_affiche, Creator: 'NJ BUSINESS — NJ COMMERCIAL' } });
  const morceaux = [];
  doc.on('data', (c) => morceaux.push(c));
  const fin = new Promise((r) => doc.on('end', () => r(Buffer.concat(morceaux))));
  return { doc, fin };
};

// En-tête : société à gauche, titre, numéro et méta à droite. Renvoie le y suivant.
const entete = (doc, s, titre, numero, meta) => {
  const y = 40;
  const logo = logoBuffer(s.logo_url);
  let xTexte = L;
  if (logo) { try { doc.image(logo, L, y, { fit: [80, 56] }); xTexte = L + 92; } catch { /* image illisible */ } }
  doc.fillColor(BLEU).font('Helvetica-Bold').fontSize(13).text(s.nom_affiche, xTexte, y, { width: 250 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
  const idLignes = [
    s.nom_commercial && s.raison_sociale !== s.nom_affiche ? s.raison_sociale : '',
    [s.forme_juridique, s.sigle].filter(Boolean).join(' · '),
    [s.adresse, s.boite_postale ? `BP ${s.boite_postale}` : ''].filter(Boolean).join(', '),
    [s.ville, s.pays].filter(Boolean).join(' — '),
    [s.telephone ? `Tél. ${s.telephone}` : '', s.email].filter(Boolean).join(' · '),
    [s.nui ? `NUI ${s.nui}` : '', s.registre_commerce ? `RCCM ${s.registre_commerce}` : ''].filter(Boolean).join(' · '),
  ].filter(Boolean);
  doc.text(idLignes.join('\n'), xTexte, doc.y + 2, { width: 250, lineGap: 1 });
  const basSociete = doc.y;
  doc.font('Helvetica-Bold').fontSize(17).fillColor(BLEU).text(titre, 320, y, { width: R - 320, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(numero, 320, doc.y + 2, { width: R - 320, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(meta.filter(Boolean).join('\n'), 320, doc.y + 4, { width: R - 320, align: 'right', lineGap: 1 });
  const y2 = Math.max(basSociete, doc.y) + 14;
  doc.moveTo(L, y2).lineTo(R, y2).lineWidth(1.2).strokeColor(BLEU).stroke();
  return y2 + 12;
};

// Deux boîtes côte à côte (client / livraison…). Renvoie le y suivant.
const boites = (doc, y, gauche, droite) => {
  const wB = (W - 12) / 2;
  const boite = (x, titre, lignes) => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS).text(titre.toUpperCase(), x + 10, y + 8, { width: wB - 20, characterSpacing: 0.5 });
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#0f172a').text(lignes[0] || ' ', x + 10, doc.y + 3, { width: wB - 20 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#334155').text(lignes.slice(1).filter(Boolean).join('\n') || ' ', x + 10, doc.y + 2, { width: wB - 20, lineGap: 1 });
    return doc.y + 8;
  };
  const b1 = boite(L, gauche[0], gauche[1]);
  const b2 = boite(L + wB + 12, droite[0], droite[1]);
  const h = Math.max(b1, b2) - y;
  doc.roundedRect(L, y, wB, h, 6).lineWidth(0.8).strokeColor(TRAIT).stroke();
  doc.roundedRect(L + wB + 12, y, wB, h, 6).lineWidth(0.8).strokeColor(TRAIT).stroke();
  return y + h + 16;
};

// Tableau générique : cols = [[titre, largeur, align]], rangees = [[valeurs]] ; colonne 1 = désignation (hauteur variable).
const tableau = (doc, yDepart, cols, rangees) => {
  let y = yDepart;
  const enTete = () => {
    doc.rect(L, y, W, 18).fill(BLEU);
    let x = L;
    doc.font('Helvetica-Bold').fontSize(7.8).fillColor('#ffffff');
    for (const [t, w, a] of cols) { doc.text(t, x + 4, y + 5.5, { width: w - 8, align: a }); x += w; }
    y += 18;
  };
  enTete();
  doc.font('Helvetica').fontSize(8.3).fillColor('#0f172a');
  rangees.forEach((valeurs, i) => {
    const h = Math.max(16, doc.heightOfString(String(valeurs[1]), { width: cols[1][1] - 8 }) + 8);
    if (y + h > 700) { doc.addPage(); y = 50; enTete(); doc.font('Helvetica').fontSize(8.3).fillColor('#0f172a'); }
    if (i % 2 === 1) doc.rect(L, y, W, h).fill(FOND).fillColor('#0f172a');
    let x = L;
    valeurs.forEach((v, k) => { doc.text(String(v), x + 4, y + 4, { width: cols[k][1] - 8, align: cols[k][2] }); x += cols[k][1]; });
    y += h;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.4).strokeColor(TRAIT).stroke();
  });
  return y;
};

const zoneSignature = (doc, x, y, w, h, titre) => {
  doc.roundedRect(x, y, w, h, 5).lineWidth(0.7).dash(3, { space: 2 }).strokeColor(TRAIT).stroke().undash();
  doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text(titre, x + 8, y + 6, { width: w - 16 });
};

const finaliser = (doc, s, numero, filigrane) => {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(i);
    if (filigrane) {
      doc.save().rotate(-35, { origin: [297, 421] }).font('Helvetica-Bold').fontSize(54).fillColor('#dc2626').fillOpacity(0.12)
        .text(filigrane, 20, 400, { width: 560, align: 'center' }).restore();
      doc.fillOpacity(1);
    }
    const marge = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor(GRIS)
      .text(`${s.nom_affiche} — ${numero} — page ${i + 1} / ${pages.count}`, L, 805, { width: W, align: 'center', lineBreak: false });
    doc.page.margins.bottom = marge;
  }
  doc.end();
};

const lignesClient = (c) => [
  c.nom, c.nom_commercial, c.adresse, [c.ville, c.pays].filter(Boolean).join(' — '),
  [c.telephone ? `Tél. ${c.telephone}` : '', c.email].filter(Boolean).join(' · '),
  c.nui ? `NUI ${c.nui}` : '', c.contact_nom ? `À l'attention de : ${c.contact_nom}${c.contact_telephone ? ` (${c.contact_telephone})` : ''}` : '',
];

/** Devis « bon pour accord ». o = { societe, client, devis, lignes, valable:boolean } */
const rendreDevis = async (o) => {
  const { societe: s, client: c, devis: d, lignes } = o;
  const { doc, fin } = nouveauDoc(`Devis ${d.numero}`, s);
  let y = entete(doc, s, 'DEVIS', d.numero, [
    `Date : ${dateFr(d.date_devis)}`, `Valable jusqu'au : ${dateFr(d.date_validite)}`, `Devise : ${d.devise}`,
  ]);
  y = boites(doc, y, ['Client', lignesClient(c)], ['Objet', [d.objet || 'Proposition commerciale',
    d.delai_livraison ? `Délai de livraison : ${d.delai_livraison}` : '', d.conditions_paiement ? `Paiement : ${d.conditions_paiement}` : '']]);
  const cols = [['Réf.', 60, 'left'], ['Désignation', 154, 'left'], ['Qté', 40, 'right'], ['Unité', 38, 'left'],
    ['P.U. HT', 64, 'right'], ['Rem.', 32, 'right'], ['Taxe', 44, 'right'], ['Montant HT', 83, 'right']];
  y = tableau(doc, y, cols, lignes.map((l) => [l.reference, l.designation, qte(l.quantite), l.unite, montant(l.prix_unitaire, d.devise),
    Number(l.remise_pct) ? `${qte(l.remise_pct)} %` : '—', l.taxe_code ? `${qte(l.taxe_taux)} %` : '—', montant(l.montant_ht, d.devise)]));

  if (y > 600) { doc.addPage(); y = 50; }
  y += 10;
  const parTaxe = {};
  lignes.forEach((l) => { if (l.taxe_code) { const k = `${l.taxe_code} ${qte(l.taxe_taux)} %`; parTaxe[k] = (parTaxe[k] || 0) + Number(l.montant_taxe); } });
  const remise = Number(d.total_brut) - Number(d.total_ht);
  const totaux = [
    ...(remise > 0.004 ? [['Total brut HT', montant(d.total_brut, d.devise), false], ['Remises', `− ${montant(remise, d.devise)}`, false]] : []),
    ['Total HT', montant(d.total_ht, d.devise), false],
    ...Object.entries(parTaxe).map(([k, v]) => [k, montant(v, d.devise), false]),
    [`Total TTC (${d.devise})`, montant(d.total_ttc, d.devise), true],
  ];
  const xT = 340; const yTotaux = y;
  totaux.forEach(([k, v, fort]) => {
    if (fort) { doc.rect(xT, y - 2, R - xT, 20).fill(BLEU); doc.fillColor('#ffffff'); } else doc.fillColor('#0f172a');
    doc.font(fort ? 'Helvetica-Bold' : 'Helvetica').fontSize(fort ? 10 : 8.8);
    doc.text(k, xT + 8, y + (fort ? 3.5 : 0), { width: 120 });
    doc.text(v, xT + 120, y + (fort ? 3.5 : 0), { width: R - xT - 128, align: 'right' });
    y += fort ? 22 : 15;
  });
  let yc = yTotaux;
  const bloc = (titre, texte) => {
    if (!texte) return;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS).text(titre.toUpperCase(), L, yc, { width: 280, characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(8.6).fillColor('#0f172a').text(texte, L, doc.y + 2, { width: 280 });
    yc = doc.y + 8;
  };
  bloc('Observations', d.observations);
  y = Math.max(y, yc) + 4;
  const lettres = montantEnLettres(d.total_ttc, d.devise);
  doc.font('Helvetica').fontSize(8.6).fillColor('#0f172a')
    .text(`Arrêté le présent devis à la somme de ${lettres.charAt(0).toUpperCase()}${lettres.slice(1)} toutes taxes comprises.`, L, y, { width: W });
  y = doc.y + 6;
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(GRIS)
    .text(`Offre valable jusqu'au ${dateFr(d.date_validite)}. Les prix s'entendent sous réserve de disponibilité du stock à la commande.`, L, y, { width: W });
  y = doc.y + 8;
  if (s.mentions_documents) {
    doc.font('Helvetica-Oblique').fontSize(7.8).fillColor(GRIS).text(s.mentions_documents, L, y, { width: W });
    y = doc.y + 8;
  }
  if (y > 650) { doc.addPage(); y = 50; }
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).strokeColor(TRAIT).stroke();
  y += 10;
  const wZ = (W - 16) / 2;
  zoneSignature(doc, L, y, wZ, 86, `Pour ${s.nom_affiche}${d.valide_nom ? ` — validé par ${d.valide_nom}` : ''}`);
  zoneSignature(doc, L + wZ + 16, y, wZ, 86, 'BON POUR ACCORD — date, nom, signature et cachet du client');
  finaliser(doc, s, d.numero, o.valable ? '' : 'PROJET — NON VALABLE');
  return fin;
};

/** Bon de livraison, sans prix. o = { societe, client, livraison, commande, magasin, lignes, valable } */
const rendreLivraison = async (o) => {
  const { societe: s, client: c, livraison: lv, commande: cd, magasin: m, lignes } = o;
  const { doc, fin } = nouveauDoc(`Bon de livraison ${lv.numero}`, s);
  let y = entete(doc, s, 'BON DE LIVRAISON', lv.numero, [
    `Date : ${dateFr(lv.date_livraison)}`, `Commande : ${cd.numero}${cd.reference_client ? ` (réf. client ${cd.reference_client})` : ''}`,
    `Devis : ${cd.devis_numero}`,
  ]);
  y = boites(doc, y, ['Client', lignesClient(c)], ['Livraison', [
    lv.adresse_livraison || c.adresse || '—', `Expédié de : ${m.nom} (${m.code})`, lv.transporteur ? `Transporteur : ${lv.transporteur}` : '']]);
  const cols = [['Réf.', 70, 'left'], ['Désignation', 205, 'left'], ['Commandé', 60, 'right'], ['Livré', 60, 'right'], ['Unité', 45, 'left'], ['Reste', 75, 'right']];
  y = tableau(doc, y, cols, lignes.map((l) => [l.reference, l.designation + (l.observation ? `\n${l.observation}` : ''), qte(l.commande),
    qte(l.quantite), l.unite, Number(l.reste) > 0 ? qte(l.reste) : 'soldé']));
  y += 10;
  if (lv.observations) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS).text('OBSERVATIONS', L, y, { characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(8.6).fillColor('#0f172a').text(lv.observations, L, doc.y + 2, { width: W });
    y = doc.y + 8;
  }
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(GRIS)
    .text('Les marchandises voyagent aux risques du destinataire. Toute réserve doit être portée sur ce bon à la réception.', L, y, { width: W });
  y = doc.y + 12;
  if (y > 650) { doc.addPage(); y = 50; }
  const wZ = (W - 24) / 3;
  zoneSignature(doc, L, y, wZ, 90, `Magasin — ${lv.livre_nom ? `livré par ${lv.livre_nom}` : 'visa'}`);
  zoneSignature(doc, L + wZ + 12, y, wZ, 90, 'Transporteur — nom et signature');
  zoneSignature(doc, L + 2 * (wZ + 12), y, wZ, 90, 'Reçu par le client — date, nom, signature, cachet, réserves');
  finaliser(doc, s, lv.numero, o.valable ? '' : 'NON LIVRÉ — NON VALABLE');
  return fin;
};

module.exports = { rendreDevis, rendreLivraison, decimales,
  // Briques de mise en page, réutilisées par les factures de NJ FINANCE (lot F8).
  nouveauDoc, entete, boites, tableau, zoneSignature, finaliser, lignesClient };

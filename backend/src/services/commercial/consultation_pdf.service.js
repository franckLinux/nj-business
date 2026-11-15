'use strict';
// NJ COMMERCIAL — lot 8 : PDF de la demande de proforma, individualisé par fournisseur
// (pdfkit, comme le bon de commande). Contient le lien de réponse en ligne et son QR code.
const BLEU = '#1a2b4a';
const GRIS = '#64748b';
const TRAIT = '#cbd5e1';
const FOND = '#f1f5f9';
const dependances = () => {
  try { return { PDFDocument: require('pdfkit'), QRCode: require('qrcode') }; } catch (e) {
    const err = new Error('Génération du PDF indisponible sur le serveur : lancez « npm install » dans le dossier du backend.'); err.status = 503; throw err;
  }
};
const qte = (n) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 }).replace(/ | /g, ' ');
const dateFr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }) : '');
const logoBuffer = (dataUrl) => {
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  try { return Buffer.from(m[2], 'base64'); } catch { return null; }
};

/** @param {object} o { societe, fournisseur, consultation, demande, magasin, lignes, lien } */
const rendre = async (o) => {
  const { PDFDocument, QRCode } = dependances();
  const { societe: s, fournisseur: f, consultation: c, lignes } = o;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 60, left: 40, right: 40 }, bufferPages: true,
    info: { Title: `Demande de proforma ${c.numero}`, Author: s.nom_affiche, Subject: 'Demande de proforma', Creator: 'NJ BUSINESS — NJ COMMERCIAL' } });
  const morceaux = [];
  doc.on('data', (x) => morceaux.push(x));
  const fin = new Promise((r) => doc.on('end', () => r(Buffer.concat(morceaux))));
  const L = 40; const R = 555; const W = R - L;
  let y = 40;
  const logo = logoBuffer(s.logo_url);
  let xT = L;
  if (logo) { try { doc.image(logo, L, y, { fit: [80, 56] }); xT = L + 92; } catch { /* ignoré */ } }
  doc.fillColor(BLEU).font('Helvetica-Bold').fontSize(13).text(s.nom_affiche, xT, y, { width: 260 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#334155').text([
    [s.adresse, s.boite_postale ? `BP ${s.boite_postale}` : ''].filter(Boolean).join(', '),
    [s.ville, s.pays].filter(Boolean).join(' — '),
    [s.telephone ? `Tél. ${s.telephone}` : '', s.email].filter(Boolean).join(' · '),
    [s.nui ? `NUI ${s.nui}` : '', s.registre_commerce ? `RCCM ${s.registre_commerce}` : ''].filter(Boolean).join(' · '),
  ].filter(Boolean).join('\n'), xT, doc.y + 2, { width: 260, lineGap: 1 });
  const basS = doc.y;
  doc.font('Helvetica-Bold').fontSize(15).fillColor(BLEU).text('DEMANDE DE PROFORMA', 300, y, { width: R - 300, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(c.numero, 300, doc.y + 2, { width: R - 300, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text([
    `Date d'émission : ${dateFr(c.lancee_le || new Date())}`,
    `Demande d'achat : ${o.demande.numero}`,
    `Réponse attendue au plus tard le : ${dateFr(c.date_limite)}`,
  ].join('\n'), 300, doc.y + 4, { width: R - 300, align: 'right', lineGap: 1 });
  y = Math.max(basS, doc.y) + 16;

  // Destinataire
  doc.roundedRect(L, y, W, 54, 6).fillAndStroke(FOND, TRAIT);
  doc.fillColor(GRIS).font('Helvetica').fontSize(8).text('FOURNISSEUR CONSULTÉ', L + 10, y + 8);
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text(f.nom, L + 10, y + 20, { width: W - 20 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#334155')
    .text([f.contact_nom, f.telephone || f.contact_telephone, f.email].filter(Boolean).join(' · '), L + 10, y + 36, { width: W - 20 });
  y += 68;

  doc.font('Helvetica').fontSize(9.5).fillColor('#0f172a').text(
    `Madame, Monsieur,\nNous vous remercions de bien vouloir nous adresser votre meilleure offre de prix pour les articles ci-dessous, livrables à : ${o.magasin.nom}${o.magasin.localisation ? ` (${o.magasin.localisation})` : ''}.`,
    L, y, { width: W, lineGap: 2 });
  y = doc.y + 10;

  // Tableau des articles
  const cols = [[L, 30, 'N°'], [L + 30, 90, 'Référence'], [L + 120, 255, 'Désignation'], [L + 375, 80, 'Quantité'], [L + 455, 60, 'Unité']];
  doc.rect(L, y, W, 20).fill(BLEU);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8.5);
  cols.forEach(([x, w, t], i) => doc.text(t, x + 4, y + 6, { width: w - 8, align: i === 3 ? 'right' : 'left' }));
  y += 20;
  doc.font('Helvetica').fontSize(9).fillColor('#0f172a');
  lignes.forEach((l, i) => {
    const h = Math.max(18, doc.heightOfString(l.designation, { width: 247 }) + 8);
    if (y + h > 760) { doc.addPage(); y = 40; }
    if (i % 2) doc.rect(L, y, W, h).fill(FOND).fillColor('#0f172a');
    const vals = [String(i + 1), l.reference, l.designation, qte(l.quantite), l.unite];
    cols.forEach(([x, w], k) => doc.fillColor('#0f172a').text(vals[k], x + 4, y + 4, { width: w - 8, align: k === 3 ? 'right' : 'left' }));
    y += h;
    doc.moveTo(L, y).lineTo(R, y).strokeColor(TRAIT).lineWidth(0.5).stroke();
  });
  y += 14;

  // Conditions
  if (y > 640) { doc.addPage(); y = 40; }
  doc.font('Helvetica-Bold').fontSize(10).fillColor(BLEU).text('Conditions de la consultation', L, y);
  doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text([
    `• Délai de livraison souhaité : ${c.delai_souhaite || 'à préciser dans votre offre'}.`,
    `• Date limite de réponse : ${dateFr(c.date_limite)}.`,
    `• Validité minimale de l'offre : ${c.validite_offre_jours} jours.`,
    '• Indiquez pour chaque ligne : prix unitaire hors taxes, taxe applicable, disponibilité ; ainsi que votre délai de livraison et vos conditions de paiement.',
    c.conditions_reponse ? `• ${c.conditions_reponse}` : '',
  ].filter(Boolean).join('\n'), L, doc.y + 4, { width: W, lineGap: 2 });
  y = doc.y + 14;

  // Réponse en ligne
  if (o.lien) {
    if (y > 650) { doc.addPage(); y = 40; }
    const qr = await QRCode.toBuffer(o.lien, { errorCorrectionLevel: 'M', margin: 1, width: 200 });
    doc.roundedRect(L, y, W, 96, 6).fillAndStroke('#eff6ff', '#bfdbfe');
    doc.image(qr, L + 10, y + 8, { width: 80 });
    doc.fillColor(BLEU).font('Helvetica-Bold').fontSize(10).text('Répondez en ligne, sans compte', L + 102, y + 12, { width: W - 112 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a')
      .text('Ce lien vous est personnel : il donne accès à cette seule consultation et à votre seule offre. Vous pouvez y joindre votre facture proforma (PDF).', L + 102, doc.y + 3, { width: W - 112 })
      .fillColor('#1d4ed8').text(o.lien, L + 102, doc.y + 4, { width: W - 112, link: o.lien, underline: true });
    y += 108;
  }
  doc.font('Helvetica').fontSize(8).fillColor(GRIS).text(`${s.nom_affiche} — consultation ${c.numero}. Ce document n'est pas un bon de commande et n'engage pas l'acheteur.`, L, y, { width: W });
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text(`Page ${i + 1} / ${pages.count}`, L, 800, { width: W, align: 'right', lineBreak: false });
  }
  doc.end();
  return fin;
};

module.exports = { rendre };

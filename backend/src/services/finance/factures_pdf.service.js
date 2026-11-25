'use strict';
// NJ FINANCE — PDF des documents clients (lot F8) : facture, avoir, facture proforma.
// En-tête au logo et aux références légales de l'entreprise (configuration centrale
// NJ BUSINESS), figées à la validation ou à l'émission ; tant que le document n'est
// pas validé, il est filigrané « PROJET — NON VALABLE » ; annulé : « ANNULÉ ».
// Même mise en page que les devis de NJ COMMERCIAL.
const { sequelize } = require('../../models');
const { montantEnLettres, montant, qte, dateFr } = require('../commercial/bc_pdf.service');
const mp = require('../commercial/ventes_pdf.service');

const Q = (sql, replacements) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
const L = 40; const R = 555; const W = R - L;
const GRIS = '#64748b'; const BLEU = '#1e3a8a';

class ErreurPdf extends Error { constructor(status, message) { super(message); this.status = status; } }

const TITRES = { facture: 'FACTURE', avoir: 'AVOIR', proforma: 'FACTURE PROFORMA' };

const generer = async (tenantId, idBrut) => {
  const fid = Number(idBrut);
  if (!Number.isInteger(fid) || fid <= 0) throw new ErreurPdf(400, 'Document invalide.');
  const [d] = await Q(
    `SELECT f.*, f.date_facture::text AS date_facture, f.date_echeance::text AS date_echeance, o.numero AS origine_numero,
            o.date_facture::text AS origine_date, p.numero AS proforma_numero, uv.username AS valide_nom,
            CASE WHEN f.type = 'facture' AND f.statut = 'validee' THEN fin_facture_reste('fin', f.id) END AS reste
       FROM fin_factures f LEFT JOIN fin_factures o ON o.id = f.facture_origine_id LEFT JOIN fin_factures p ON p.id = f.proforma_id
       LEFT JOIN users uv ON uv.id = f.valide_par
      WHERE f.id = :fid AND f.tenant_id = :tenantId AND f.sens = 'client'`, { fid, tenantId });
  if (!d) throw new ErreurPdf(404, 'Document introuvable.');
  const [client] = await Q(
    `SELECT r.nom, r.nui, r.telephone, r.email, r.adresse, coalesce(c.nom_commercial, '') AS nom_commercial, coalesce(c.ville, '') AS ville,
            coalesce(c.pays, '') AS pays, coalesce(c.contact_nom, '') AS contact_nom, coalesce(c.contact_telephone, '') AS contact_telephone
       FROM registre_tiers r LEFT JOIN com_tiers c ON c.tiers_id = r.id WHERE r.id = :t`, { t: d.tiers_id });
  const lignes = await Q(
    `SELECT l.designation, l.quantite, l.prix_unitaire, l.remise_pct, l.taxe_taux, l.montant_ht, l.montant_taxe, t.code AS taxe_code,
            coalesce(p.code, '') AS reference, coalesce(p.unite, '') AS unite
       FROM fin_facture_lignes l LEFT JOIN com_taxes t ON t.id = l.taxe_id LEFT JOIN fin_prestations p ON p.id = l.prestation_id
      WHERE l.facture_id = :fid ORDER BY l.ordre, l.id`, { fid });
  const valable = d.statut === 'validee' || d.statut === 'transformee';
  const ident = await require('../entreprise.service').identitePour(tenantId, valable ? d.identite_emetteur : null);
  const [param] = await Q('SELECT mentions_documents FROM com_parametres WHERE tenant_id = :tenantId', { tenantId }).catch(() => [null]);
  const s = { ...ident, mentions_documents: param?.mentions_documents || '' };
  const devise = s.devise || 'FCFA';
  const numero = d.numero || 'BROUILLON';
  const titre = TITRES[d.type];

  const { doc, fin } = mp.nouveauDoc(`${titre} ${numero}`, s);
  const meta = [`Date : ${dateFr(d.date_facture)}`];
  if (d.type === 'facture' && d.date_echeance) meta.push(`Échéance : ${dateFr(d.date_echeance)}`);
  if (d.type === 'proforma' && d.date_echeance) meta.push(`Valable jusqu'au : ${dateFr(d.date_echeance)}`);
  if (d.type === 'avoir') meta.push(`Sur la facture ${d.origine_numero} du ${dateFr(d.origine_date)}`);
  if (d.proforma_numero) meta.push(`Proforma : ${d.proforma_numero}`);
  if (d.reference) meta.push(`Votre référence : ${d.reference}`);
  meta.push(`Devise : ${devise}`);
  let y = mp.entete(doc, s, titre, numero, meta);
  y = mp.boites(doc, y, ['Client', mp.lignesClient(client)], ['Objet', [
    d.objet || (d.type === 'avoir' ? 'Avoir' : 'Prestations'),
    d.conditions_paiement ? `Paiement : ${d.conditions_paiement}` : '',
  ]]);
  const cols = [['Réf.', 52, 'left'], ['Désignation', 170, 'left'], ['Qté', 42, 'right'], ['Unité', 36, 'left'],
    ['P.U. HT', 66, 'right'], ['Rem.', 32, 'right'], ['Taxe', 40, 'right'], ['Montant HT', 77, 'right']];
  y = mp.tableau(doc, y, cols, lignes.map((l) => [l.reference, l.designation, qte(l.quantite), l.unite, montant(l.prix_unitaire, devise),
    Number(l.remise_pct) ? `${qte(l.remise_pct)} %` : '—', l.taxe_code ? `${qte(l.taxe_taux)} %` : '—', montant(l.montant_ht, devise)]));

  if (y > 590) { doc.addPage(); y = 50; }
  y += 10;
  const parTaxe = {};
  lignes.forEach((l) => { if (l.taxe_code && Number(l.montant_taxe)) { const k = `${l.taxe_code} ${qte(l.taxe_taux)} %`; parTaxe[k] = (parTaxe[k] || 0) + Number(l.montant_taxe); } });
  const totaux = [
    ['Total HT', montant(d.total_ht, devise), false],
    ...Object.entries(parTaxe).map(([k, v]) => [k, montant(v, devise), false]),
    [`Total TTC (${devise})`, montant(d.total_ttc, devise), true],
  ];
  if (d.reste !== null && d.reste !== undefined && Number(d.reste) < Number(d.total_ttc)) {
    totaux.push(['Déjà réglé / avoirs', montant(Number(d.total_ttc) - Math.max(Number(d.reste), 0), devise), false]);
    totaux.push(['Reste à payer', montant(Math.max(Number(d.reste), 0), devise), false]);
  }
  const xT = 340; const yTotaux = y;
  totaux.forEach(([k, v, fort]) => {
    if (fort) { doc.rect(xT, y - 2, R - xT, 20).fill(BLEU); doc.fillColor('#ffffff'); } else doc.fillColor('#0f172a');
    doc.font(fort ? 'Helvetica-Bold' : 'Helvetica').fontSize(fort ? 10 : 8.8);
    doc.text(k, xT + 8, y + (fort ? 3.5 : 0), { width: 120 });
    doc.text(v, xT + 120, y + (fort ? 3.5 : 0), { width: R - xT - 128, align: 'right' });
    y += fort ? 22 : 15;
  });
  let yc = yTotaux;
  if (d.observations) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS).text('OBSERVATIONS', L, yc, { width: 280, characterSpacing: 0.4 });
    doc.font('Helvetica').fontSize(8.6).fillColor('#0f172a').text(d.observations, L, doc.y + 2, { width: 280 });
    yc = doc.y + 8;
  }
  y = Math.max(y, yc) + 4;
  const lettres = montantEnLettres(d.total_ttc, devise);
  const quoi = { facture: 'la présente facture', avoir: 'le présent avoir', proforma: 'la présente facture proforma' }[d.type];
  doc.font('Helvetica').fontSize(8.6).fillColor('#0f172a')
    .text(`Arrêté${d.type === 'avoir' ? '' : 'e'} ${quoi} à la somme de ${lettres.charAt(0).toUpperCase()}${lettres.slice(1)} toutes taxes comprises.`, L, y, { width: W });
  y = doc.y + 6;
  if (d.type === 'proforma') {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(GRIS)
      .text(`Facture proforma, sans valeur comptable${d.date_echeance ? `, valable jusqu'au ${dateFr(d.date_echeance)}` : ''}. La facture définitive sera établie à la commande.`, L, y, { width: W });
    y = doc.y + 8;
  }
  if (s.mentions_documents) {
    doc.font('Helvetica-Oblique').fontSize(7.8).fillColor(GRIS).text(s.mentions_documents, L, y, { width: W });
    y = doc.y + 8;
  }
  if (y > 650) { doc.addPage(); y = 50; }
  doc.moveTo(L, y).lineTo(R, y).lineWidth(0.6).strokeColor('#cbd5e1').stroke();
  y += 10;
  const wZ = (W - 16) / 2;
  mp.zoneSignature(doc, L, y, wZ, 86, `Pour ${s.nom_affiche}${d.valide_nom ? ` — validé par ${d.valide_nom}` : ''}`);
  mp.zoneSignature(doc, L + wZ + 16, y, wZ, 86, d.type === 'proforma' ? 'BON POUR ACCORD — date, nom, signature et cachet du client' : 'Reçu par le client — date, nom et signature');
  mp.finaliser(doc, s, numero, d.statut === 'annulee' ? 'ANNULÉ' : valable ? '' : 'PROJET — NON VALABLE');
  const contenu = await fin;
  return { contenu, nom: `${numero}.pdf` };
};

module.exports = { generer, ErreurPdf };

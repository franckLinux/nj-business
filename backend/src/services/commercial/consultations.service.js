'use strict';
// NJ COMMERCIAL — lot 8 (migration 063) : consultation des fournisseurs (demandes de proforma),
// portail de réponse sans compte, comparaison des offres et attribution par article.
//
//   brouillon ──lancer──▶ lancee ──attribuer──▶ attribuee        (annulee : avant attribution, motif)
//
// Règles :
//   • une consultation part d'une demande VALIDÉE, sur ses quantités restant à commander ;
//   • trois fournisseurs au moins, sauf dérogation (permission dédiée + motif) ;
//   • chaque fournisseur reçoit un lien individuel (jeton aléatoire de 256 bits) : il n'y voit
//     que cette consultation et sa propre offre ; aucun compte NJ BUSINESS n'est nécessaire ;
//   • une offre soumise est intangible (déclencheur) ; une nouvelle version n'est possible
//     qu'après réouverture motivée par l'acheteur ; toutes les versions sont conservées ;
//   • après la date limite, plus aucune réponse ; les fournisseurs muets passent « sans réponse » ;
//   • le moins-disant n'est JAMAIS retenu d'office : l'acheteur choisit ligne par ligne, et doit
//     motiver tout choix qui n'est pas le prix le plus bas ;
//   • l'attribution fixe, sur la demande, le fournisseur retenu et le prix approuvé de chaque
//     ligne, puis peut générer un bon de commande (brouillon) par fournisseur retenu.
const crypto = require('crypto');
const { sequelize } = require('../../models');
const docs = require('./documents.service');
const pdf = require('./consultation_pdf.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: T.SELECT, transaction });
const X = (sql, replacements, transaction) => sequelize.query(sql, { replacements, transaction });

class ErreurConsultation extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const STATUTS = { brouillon: 'Brouillon', lancee: 'Lancée — offres attendues', attribuee: 'Attribuée', annulee: 'Annulée' };
const STATUTS_FOURNISSEUR = { a_envoyer: 'À envoyer', envoyee: 'Envoyée', consultee: 'Consultée', offre_recue: 'Offre reçue', sans_reponse: 'Sans réponse', refusee: 'Refusée' };
const DISPOS = { disponible: 'Disponible', partielle: 'Partiellement disponible', indisponible: 'Indisponible' };
const MINIMUM = 3;
const txt = (v) => String(v ?? '').trim();
const m2 = (n) => Math.round(n * 100) / 100;
const q3 = (n) => Math.round(n * 1000) / 1000;
const aujourdhui = () => new Date().toISOString().slice(0, 10);
const dateIso = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const entier = (v, nom) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurConsultation(400, `${nom} invalide.`);
  return n;
};
const nombre = (v, nom, { min = 0, max = 1e13, vide = null } = {}) => {
  if (v === undefined || v === null || txt(v) === '') return vide;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new ErreurConsultation(400, `${nom} invalide.`);
  return n;
};
const lim = (v, n, nom) => { const s = txt(v); if (s.length > n) throw new ErreurConsultation(400, `${nom} : ${n} caractères au plus.`); return s; };
const exiger = (ctx, code = 'com.consultations.gerer', l = 'consulter les fournisseurs') => { if (!ctx.peut(code)) throw new ErreurConsultation(403, `Permission requise : ${l}.`); };
const VOIR = ['com.consultations.gerer', 'com.da.voir_tout', 'com.bc.preparer', 'com.bc.emettre'];
const exigerVue = (ctx) => { if (!VOIR.some((c) => ctx.peut(c))) throw new ErreurConsultation(403, 'Permission requise : consulter les fournisseurs.'); };
const perim = () => require('./demandes.service');
const bons = () => require('./bons.service');
const auditer = (tr, ctx, action, id, apres) => X(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur) VALUES (:t, :u, :a, 'commercial', :id, CAST(:ap AS jsonb))`,
  { t: ctx.tenantId, u: ctx.userId || null, a: action, id: `CON:${id}`, ap: JSON.stringify(apres || {}) }, tr);
const lien = (jeton) => { const b = bons().baseVerification(); return b ? `${b}/offre/${jeton}` : null; };

// ── Lecture ──────────────────────────────────────────────────────────────
const SQL = `
  SELECT c.*, d.numero AS demande_numero, d.magasin_id, d.statut AS demande_statut, m.nom AS magasin_nom, m.code AS magasin_code,
         uc.username AS cree_par_nom, ul.username AS lancee_par_nom, ua.username AS attribuee_par_nom,
         (SELECT COUNT(*)::int FROM com_consultation_fournisseurs cf WHERE cf.consultation_id = c.id) AS nb_fournisseurs,
         (SELECT COUNT(*)::int FROM com_consultation_fournisseurs cf WHERE cf.consultation_id = c.id AND cf.statut = 'offre_recue') AS nb_offres
    FROM com_consultations c
    JOIN com_demandes d ON d.id = c.demande_id
    JOIN com_magasins m ON m.id = d.magasin_id
    LEFT JOIN users uc ON uc.id = c.cree_par LEFT JOIN users ul ON ul.id = c.lancee_par LEFT JOIN users ua ON ua.id = c.attribuee_par`;
const formater = (c) => ({ ...c, id: Number(c.id), demande_id: Number(c.demande_id), magasin_id: Number(c.magasin_id),
  date_limite: dateIso(c.date_limite), statut_libelle: STATUTS[c.statut], expiree: dateIso(c.date_limite) < aujourdhui() });

const charger = async (ctx, id, tr, verrou = false) => {
  const [c] = await Q(`${SQL} WHERE c.tenant_id = :t AND c.id = :id${verrou ? ' FOR UPDATE OF c' : ''}`, { t: ctx.tenantId, id: entier(id, 'Consultation') }, tr);
  if (!c || !perim().dansPerimetre(ctx, c.magasin_id)) throw new ErreurConsultation(404, 'Consultation introuvable.');
  return formater(c);
};

// Fournisseurs restés muets après la date limite : « sans réponse ».
const marquerSansReponse = (consultationId) => X(
  `UPDATE com_consultation_fournisseurs cf SET statut = 'sans_reponse'
     FROM com_consultations c WHERE c.id = cf.consultation_id AND c.id = :c AND c.date_limite < CURRENT_DATE
      AND cf.statut IN ('a_envoyer', 'envoyee', 'consultee')`, { c: consultationId });

const lister = async (ctx, { statut = '', demande_id = '', q = '' } = {}) => {
  exigerVue(ctx);
  const p = perim().sqlPerimetre(ctx, 'd.magasin_id');
  const conds = ['c.tenant_id = :t', p.sql];
  const r = { t: ctx.tenantId, ...p.r };
  if (statut) { if (!STATUTS[statut]) throw new ErreurConsultation(400, 'Statut inconnu.'); conds.push('c.statut = :s'); r.s = statut; }
  if (demande_id) { conds.push('c.demande_id = :d'); r.d = entier(demande_id, 'Demande'); }
  if (txt(q)) { conds.push('(lower(c.numero) LIKE :q OR lower(d.numero) LIKE :q)'); r.q = `%${txt(q).toLowerCase()}%`; }
  return (await Q(`${SQL} WHERE ${conds.join(' AND ')} ORDER BY c.cree_le DESC LIMIT 500`, r)).map(formater);
};

const offresActuelles = async (consultationId, tr) => {
  const offres = await Q(
    `SELECT o.*, cf.fournisseur_id, rt.nom AS fournisseur_nom FROM com_offres o
       JOIN com_consultation_fournisseurs cf ON cf.id = o.consultation_fournisseur_id JOIN registre_tiers rt ON rt.id = cf.fournisseur_id
      WHERE cf.consultation_id = :c AND o.actuelle ORDER BY rt.nom`, { c: consultationId }, tr);
  const lignes = offres.length ? await Q('SELECT * FROM com_offre_lignes WHERE offre_id IN (:o)', { o: offres.map((o) => o.id) }, tr) : [];
  return offres.map((o) => ({
    id: Number(o.id), consultation_fournisseur_id: Number(o.consultation_fournisseur_id), fournisseur_id: Number(o.fournisseur_id), fournisseur_nom: o.fournisseur_nom,
    version: Number(o.version), soumise_le: o.soumise_le, signataire: o.signataire, delai_livraison_jours: o.delai_livraison_jours === null ? null : Number(o.delai_livraison_jours),
    delai_type: o.delai_type, conditions_paiement: o.conditions_paiement, validite_jours: o.validite_jours === null ? null : Number(o.validite_jours),
    observations: o.observations, total_ht: Number(o.total_ht), total_taxes: Number(o.total_taxes), total_ttc: Number(o.total_ttc),
    document_id: o.document_id ? Number(o.document_id) : null,
    lignes: lignes.filter((l) => Number(l.offre_id) === Number(o.id)).map((l) => ({
      id: Number(l.id), consultation_ligne_id: Number(l.consultation_ligne_id), disponibilite: l.disponibilite, disponibilite_libelle: DISPOS[l.disponibilite],
      quantite_proposee: Number(l.quantite_proposee), prix_unitaire: l.prix_unitaire === null ? null : Number(l.prix_unitaire), taux_taxe: Number(l.taux_taxe),
      montant_ht: Number(l.montant_ht), montant_taxe: Number(l.montant_taxe), observation: l.observation })),
  }));
};

const lire = async (ctx, id) => {
  exigerVue(ctx);
  let c = await charger(ctx, id);
  if (c.statut === 'lancee' && c.expiree) { await marquerSansReponse(c.id); c = await charger(ctx, id); }
  const lignes = (await Q('SELECT * FROM com_consultation_lignes WHERE consultation_id = :c ORDER BY ordre, id', { c: c.id }))
    .map((l) => ({ ...l, id: Number(l.id), demande_ligne_id: Number(l.demande_ligne_id), article_id: Number(l.article_id), quantite: Number(l.quantite),
      choix_offre_ligne_id: l.choix_offre_ligne_id ? Number(l.choix_offre_ligne_id) : null }));
  const fournisseurs = (await Q(
    `SELECT cf.*, rt.nom AS fournisseur_nom, COALESCE(NULLIF(t.contact_email, ''), rt.email, '') AS email, t.delai_livraison_jours AS delai_habituel,
            t.delai_type AS delai_habituel_type, ue.username AS envoye_par_nom,
            (SELECT COUNT(*)::int FROM com_offres o WHERE o.consultation_fournisseur_id = cf.id) AS nb_versions,
            (SELECT o.id FROM com_offres o WHERE o.consultation_fournisseur_id = cf.id AND o.actuelle) AS offre_id
       FROM com_consultation_fournisseurs cf JOIN registre_tiers rt ON rt.id = cf.fournisseur_id LEFT JOIN com_tiers t ON t.tiers_id = rt.id
       LEFT JOIN users ue ON ue.id = cf.envoye_par
      WHERE cf.consultation_id = :c ORDER BY lower(rt.nom)`, { c: c.id }))
    .map((f) => ({ ...f, id: Number(f.id), fournisseur_id: Number(f.fournisseur_id), offre_id: f.offre_id ? Number(f.offre_id) : null,
      statut_libelle: STATUTS_FOURNISSEUR[f.statut], lien: c.statut === 'brouillon' ? null : lien(f.jeton), jeton: undefined }));
  const historique = await Q(
    `SELECT a.created_at AS le, a.action, u.username AS par_nom, a.nouvelle_valeur FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = :t AND a.entite = 'commercial' AND a.entite_id = :e ORDER BY a.created_at, a.id`, { t: ctx.tenantId, e: `CON:${c.id}` });
  const bc = (await Q(`SELECT b.id, b.numero_complet, b.statut, b.fournisseur_id, rt.nom AS fournisseur_nom, b.total_ttc FROM com_bons_commande b
                         JOIN registre_tiers rt ON rt.id = b.fournisseur_id WHERE b.consultation_id = :c ORDER BY b.id`, { c: c.id }))
    .map((b) => ({ ...b, id: Number(b.id), fournisseur_id: Number(b.fournisseur_id), total_ttc: Number(b.total_ttc) }));
  const gerer = ctx.peut('com.consultations.gerer');
  return {
    ...c, lignes, fournisseurs, historique, bons: bc, minimum: MINIMUM,
    droits: {
      modifier: gerer && c.statut === 'brouillon', lancer: gerer && c.statut === 'brouillon',
      envoyer: gerer && c.statut === 'lancee' && !c.expiree, attribuer: gerer && c.statut === 'lancee',
      annuler: gerer && ['brouillon', 'lancee'].includes(c.statut), derogation: ctx.peut('com.consultations.derogation'),
      generer_bons: ctx.peut('com.bc.preparer'),
    },
  };
};

// ── Saisie ───────────────────────────────────────────────────────────────
const valeurs = async (ctx, b, demandeId, tr) => {
  const date = txt(b.date_limite);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new ErreurConsultation(400, 'Indiquez la date limite de réponse (AAAA-MM-JJ).');
  if (date < aujourdhui()) throw new ErreurConsultation(400, 'La date limite de réponse est déjà passée.');
  const validite = nombre(b.validite_offre_jours, 'Validité de l\'offre', { min: 1, max: 365, vide: 30 });
  if (!Number.isInteger(validite)) throw new ErreurConsultation(400, 'Validité de l\'offre : un nombre entier de jours.');
  const ids = [...new Set((Array.isArray(b.fournisseur_ids) ? b.fournisseur_ids : []).map((x) => entier(x, 'Fournisseur')))];
  if (ids.length) {
    const ok = await Q(`SELECT id FROM registre_tiers WHERE tenant_id = :t AND id IN (:i) AND actif AND type IN ('fournisseur', 'mixte')`, { t: ctx.tenantId, i: ids }, tr);
    if (ok.length !== ids.length) throw new ErreurConsultation(400, 'Un des fournisseurs choisis est inconnu, inactif ou n\'est pas un fournisseur.');
  }
  // Lignes : les restes à commander de la demande (quantité modifiable à la baisse).
  const restes = await bons().restes(ctx.tenantId, demandeId, [], tr);
  const demandees = Array.isArray(b.lignes) && b.lignes.length ? b.lignes : restes.filter((r) => r.reste > 0).map((r) => ({ demande_ligne_id: r.demande_ligne_id, quantite: r.reste }));
  const lignes = [];
  const vus = new Set();
  for (const x of demandees) {
    const dl = entier(x.demande_ligne_id, 'Ligne de demande');
    if (vus.has(dl)) throw new ErreurConsultation(400, 'Une même ligne figure deux fois.');
    vus.add(dl);
    const r = restes.find((y) => y.demande_ligne_id === dl);
    if (!r) throw new ErreurConsultation(400, 'Cette ligne n\'appartient pas à la demande.');
    const q = nombre(x.quantite, 'Quantité', { min: 0 });
    if (!q) continue;
    if (q > r.reste + 1e-9) throw new ErreurConsultation(409, `« ${r.designation} » : ${q} ${r.unite} pour ${r.reste} restant(s) à commander.`);
    lignes.push({ ...r, quantite: q3(q) });
  }
  if (!lignes.length) throw new ErreurConsultation(400, 'Aucun article à consulter : tout est déjà commandé.');
  return {
    v: { date_limite: date, delai_souhaite: lim(b.delai_souhaite, 200, 'Délai souhaité'), conditions_reponse: lim(b.conditions_reponse, 2000, 'Conditions de réponse'),
      validite_offre_jours: validite, derogation_motif: lim(b.derogation_motif, 1000, 'Motif de dérogation'), observations: lim(b.observations, 2000, 'Observations') },
    fournisseurs: ids, lignes,
  };
};

const controlerMinimum = (ctx, nb, motif) => {
  if (nb >= MINIMUM) return;
  if (!nb) throw new ErreurConsultation(400, 'Choisissez les fournisseurs à consulter.');
  if (!ctx.peut('com.consultations.derogation')) {
    throw new ErreurConsultation(409, `Une consultation comparative exige au moins ${MINIMUM} fournisseurs (${nb} choisi${nb > 1 ? 's' : ''}). La dérogation demande une permission dédiée.`);
  }
  if (txt(motif).length < 10) throw new ErreurConsultation(400, `Moins de ${MINIMUM} fournisseurs : justifiez la dérogation (10 caractères au moins).`);
};

const ecrire = async (ctx, tr, c, demandeId, b) => {
  const { v, fournisseurs, lignes } = await valeurs(ctx, b, demandeId, tr);
  await X(`UPDATE com_consultations SET date_limite = :date_limite, delai_souhaite = :delai_souhaite, conditions_reponse = :conditions_reponse,
             validite_offre_jours = :validite_offre_jours, derogation_motif = :derogation_motif, observations = :observations, modifie_le = NOW() WHERE id = :id`,
  { ...v, id: c }, tr);
  await X('DELETE FROM com_consultation_lignes WHERE consultation_id = :c', { c }, tr);
  for (const [i, l] of lignes.entries()) {
    await X(`INSERT INTO com_consultation_lignes (consultation_id, tenant_id, ordre, demande_ligne_id, article_id, reference, designation, quantite, unite, unite_id)
             VALUES (:c, :t, :o, :dl, :a, :ref, :des, :q, :u, :uid)`,
    { c, t: ctx.tenantId, o: i, dl: l.demande_ligne_id, a: l.article_id, ref: l.reference, des: l.designation, q: l.quantite, u: l.unite, uid: l.unite_id }, tr);
  }
  const avant = (await Q('SELECT fournisseur_id FROM com_consultation_fournisseurs WHERE consultation_id = :c', { c }, tr)).map((r) => Number(r.fournisseur_id));
  await X('DELETE FROM com_consultation_fournisseurs WHERE consultation_id = :c AND NOT (fournisseur_id = ANY (CAST(:f AS BIGINT[])))',
    { c, f: `{${fournisseurs.join(',')}}` }, tr);
  for (const f of fournisseurs.filter((x) => !avant.includes(x))) {
    await X('INSERT INTO com_consultation_fournisseurs (consultation_id, tenant_id, fournisseur_id, jeton) VALUES (:c, :t, :f, :j)',
      { c, t: ctx.tenantId, f, j: crypto.randomBytes(32).toString('base64url') }, tr);
  }
  return { ...v, fournisseurs, nb_lignes: lignes.length };
};

const creer = async (ctx, body = {}) => {
  exiger(ctx);
  const id = await sequelize.transaction(async (tr) => {
    const [d] = await Q('SELECT id, numero, statut, magasin_id FROM com_demandes WHERE id = :d AND tenant_id = :t FOR UPDATE',
      { d: entier(body.demande_id, 'Demande'), t: ctx.tenantId }, tr);
    if (!d || !perim().dansPerimetre(ctx, d.magasin_id)) throw new ErreurConsultation(404, 'Demande introuvable.');
    if (d.statut !== 'approuvee') throw new ErreurConsultation(409, 'Seule une demande validée peut faire l\'objet d\'une consultation.');
    const [deja] = await Q("SELECT numero FROM com_consultations WHERE demande_id = :d AND statut IN ('brouillon', 'lancee')", { d: d.id }, tr);
    if (deja) throw new ErreurConsultation(409, `La consultation ${deja.numero} est déjà en cours pour cette demande.`);
    const numero = await perim().numeroter(tr, ctx.tenantId, 'CON', 'CON');
    const [r] = await Q('INSERT INTO com_consultations (tenant_id, numero, demande_id, date_limite, cree_par) VALUES (:t, :n, :d, :dl, :u) RETURNING id',
      { t: ctx.tenantId, n: numero, d: d.id, dl: /^\d{4}-\d{2}-\d{2}$/.test(txt(body.date_limite)) ? txt(body.date_limite) : aujourdhui(), u: ctx.userId }, tr);
    const v = await ecrire(ctx, tr, Number(r.id), Number(d.id), body);
    await auditer(tr, ctx, 'COM_CONSULTATION_CREATION', r.id, { numero, demande: d.numero, ...v });
    await perim().auditer(tr, ctx, 'COM_DA_CONSULTATION', d.id, null, { consultation: numero });
    return Number(r.id);
  });
  return lire(ctx, id);
};

const modifier = async (ctx, id, body = {}) => {
  exiger(ctx);
  await sequelize.transaction(async (tr) => {
    const c = await charger(ctx, id, tr, true);
    if (c.statut !== 'brouillon') throw new ErreurConsultation(409, 'Une consultation lancée ne se modifie plus (ajoutez un fournisseur ou annulez-la).');
    const actuels = await Q('SELECT fournisseur_id FROM com_consultation_fournisseurs WHERE consultation_id = :c', { c: c.id }, tr);
    const lignes = await Q('SELECT demande_ligne_id, quantite FROM com_consultation_lignes WHERE consultation_id = :c', { c: c.id }, tr);
    const v = await ecrire(ctx, tr, c.id, c.demande_id, {
      ...c, fournisseur_ids: actuels.map((x) => x.fournisseur_id), lignes: lignes.map((l) => ({ demande_ligne_id: l.demande_ligne_id, quantite: l.quantite })), ...body });
    await auditer(tr, ctx, 'COM_CONSULTATION_MODIFICATION', c.id, v);
  });
  return lire(ctx, id);
};

// ── Données des documents ────────────────────────────────────────────────
const societe = async (tenantId, tr) => {
  const [s] = await Q(`SELECT t.nom AS raison_sociale, t.sigle, t.logo_url, t.adresse, t.boite_postale, t.ville, t.pays, t.telephone, t.email, t.nui,
                              t.registre_commerce, COALESCE(p.nom_commercial, '') AS nom_commercial
                         FROM tenants t LEFT JOIN com_parametres p ON p.tenant_id = t.id WHERE t.id = :t`, { t: tenantId }, tr);
  return { ...s, nom_affiche: s.nom_commercial || s.raison_sociale };
};
const rendrePdf = async (tenantId, cf, tr) => {
  const [c] = await Q(`SELECT c.*, d.numero AS demande_numero, m.nom AS magasin_nom, m.localisation FROM com_consultations c JOIN com_demandes d ON d.id = c.demande_id
                        JOIN com_magasins m ON m.id = d.magasin_id WHERE c.id = :c`, { c: cf.consultation_id }, tr);
  const [f] = await Q(`SELECT rt.nom, rt.telephone, rt.email, COALESCE(t.contact_nom, '') AS contact_nom, COALESCE(t.contact_telephone, '') AS contact_telephone
                         FROM registre_tiers rt LEFT JOIN com_tiers t ON t.tiers_id = rt.id WHERE rt.id = :f`, { f: cf.fournisseur_id }, tr);
  const lignes = await Q('SELECT * FROM com_consultation_lignes WHERE consultation_id = :c ORDER BY ordre, id', { c: c.id }, tr);
  return pdf.rendre({ societe: await societe(tenantId, tr), fournisseur: f, consultation: c, demande: { numero: c.demande_numero },
    magasin: { nom: c.magasin_nom, localisation: c.localisation }, lignes, lien: lien(cf.jeton) });
};

const envoyerEmail = async (tenantId, cf, destinataire) => {
  const { envoyer: mail } = require('../email.service');
  const s = await societe(tenantId);
  const [c] = await Q('SELECT numero, date_limite FROM com_consultations WHERE id = :c', { c: cf.consultation_id });
  const url = lien(cf.jeton);
  const contenu = await rendrePdf(tenantId, cf);
  return mail({ to: destinataire, subject: `Demande de proforma ${c.numero} — ${s.nom_affiche}`,
    html: `<p>Bonjour,</p><p>${s.nom_affiche} vous consulte pour une offre de prix (référence <strong>${c.numero}</strong>), à remettre au plus tard le
           <strong>${new Date(c.date_limite).toLocaleDateString('fr-FR')}</strong>. Le détail figure dans le document joint.</p>
           ${url ? `<p>Vous pouvez répondre directement en ligne, sans créer de compte, par ce lien personnel :<br/><a href="${url}">${url}</a></p>` : ''}
           <p>Cordialement,<br/>${s.nom_affiche}</p>`,
    attachments: [{ filename: `Demande-proforma-${c.numero}.pdf`, content: contenu, contentType: 'application/pdf' }] });
};

// ── Lancement et envoi ───────────────────────────────────────────────────
const lancer = async (ctx, id, body = {}) => {
  exiger(ctx);
  const aEnvoyer = await sequelize.transaction(async (tr) => {
    const c = await charger(ctx, id, tr, true);
    if (c.statut !== 'brouillon') throw new ErreurConsultation(409, 'Cette consultation est déjà lancée.');
    if (c.date_limite < aujourdhui()) throw new ErreurConsultation(400, 'La date limite de réponse est passée : modifiez-la avant de lancer.');
    const fs = await Q(`SELECT cf.*, COALESCE(NULLIF(t.contact_email, ''), rt.email, '') AS email FROM com_consultation_fournisseurs cf
                          JOIN registre_tiers rt ON rt.id = cf.fournisseur_id LEFT JOIN com_tiers t ON t.tiers_id = rt.id WHERE cf.consultation_id = :c`, { c: c.id }, tr);
    controlerMinimum(ctx, fs.length, c.derogation_motif);
    const [d] = await Q('SELECT statut FROM com_demandes WHERE id = :d', { d: c.demande_id }, tr);
    if (d.statut !== 'approuvee') throw new ErreurConsultation(409, 'La demande n\'est plus validée.');
    if (!bons().baseVerification()) throw new ErreurConsultation(409, 'Adresse publique du serveur non configurée (APP_URL) : les liens de réponse ne peuvent pas être créés.');
    await X("UPDATE com_consultations SET statut = 'lancee', lancee_par = :u, lancee_le = NOW(), modifie_le = NOW() WHERE id = :id", { u: ctx.userId, id: c.id }, tr);
    await auditer(tr, ctx, 'COM_CONSULTATION_LANCEMENT', c.id, { numero: c.numero, fournisseurs: fs.length, derogation: fs.length < MINIMUM ? c.derogation_motif : '' });
    return body.envoyer_emails === false ? [] : fs.filter((f) => EMAIL_RE.test(f.email));
  });
  // E-mails après validation de la transaction ; un échec laisse le fournisseur « à envoyer ».
  const envois = [];
  for (const cf of aEnvoyer) {
    const r = await envoyerEmail(ctx.tenantId, cf, cf.email).catch((e) => ({ statut: 'non_envoye', erreur: e.message }));
    if (r.statut === 'envoye') {
      await X(`UPDATE com_consultation_fournisseurs SET statut = 'envoyee', envoi_mode = 'email', envoi_destinataire = :d, envoye_le = NOW(), envoye_par = :u
                WHERE id = :id AND statut = 'a_envoyer'`, { d: cf.email, u: ctx.userId, id: cf.id });
    }
    envois.push({ fournisseur_id: Number(cf.fournisseur_id), statut: r.statut, erreur: r.erreur || '' });
  }
  return { ...(await lire(ctx, id)), envois };
};

const chargerFournisseur = async (c, cfId, tr) => {
  const [cf] = await Q(`SELECT cf.*, COALESCE(NULLIF(t.contact_email, ''), rt.email, '') AS email FROM com_consultation_fournisseurs cf
                          JOIN registre_tiers rt ON rt.id = cf.fournisseur_id LEFT JOIN com_tiers t ON t.tiers_id = rt.id
                         WHERE cf.id = :f AND cf.consultation_id = :c${tr ? ' FOR UPDATE OF cf' : ''}`, { f: entier(cfId, 'Fournisseur consulté'), c: c.id }, tr);
  if (!cf) throw new ErreurConsultation(404, 'Fournisseur consulté introuvable.');
  return cf;
};

// Envoi (ou renvoi) : par e-mail, ou envoi constaté (lien transmis par WhatsApp, remise en main propre…).
const envoyer = async (ctx, id, cfId, body = {}) => {
  exiger(ctx);
  const c = await charger(ctx, id);
  if (c.statut !== 'lancee') throw new ErreurConsultation(409, 'Lancez d\'abord la consultation.');
  if (c.expiree) throw new ErreurConsultation(409, 'La date limite de réponse est passée.');
  const cf = await chargerFournisseur(c, cfId);
  const mode = txt(body.mode) || 'email';
  let dest = txt(body.destinataire);
  if (mode === 'email') {
    dest = dest || cf.email;
    if (!EMAIL_RE.test(dest)) throw new ErreurConsultation(400, 'Adresse e-mail du fournisseur absente ou invalide.');
    const r = await envoyerEmail(ctx.tenantId, cf, dest);
    if (r.statut !== 'envoye') throw new ErreurConsultation(502, `E-mail non envoyé : ${r.erreur || r.statut}. Transmettez le lien vous-même puis constatez l'envoi.`);
  } else if (mode === 'manuel') {
    if (dest.length < 2) throw new ErreurConsultation(400, 'Précisez comment le lien a été transmis (ex. « WhatsApp au 699… »).');
  } else throw new ErreurConsultation(400, 'Mode d\'envoi inconnu.');
  await sequelize.transaction(async (tr) => {
    await X(`UPDATE com_consultation_fournisseurs SET envoi_mode = :m, envoi_destinataire = :d, envoye_le = NOW(), envoye_par = :u,
               statut = CASE WHEN statut = 'a_envoyer' THEN 'envoyee' ELSE statut END WHERE id = :id`, { m: mode, d: dest.slice(0, 200), u: ctx.userId, id: cf.id }, tr);
    await auditer(tr, ctx, 'COM_CONSULTATION_ENVOI', c.id, { fournisseur_id: Number(cf.fournisseur_id), mode, destinataire: dest.slice(0, 200) });
  });
  return lire(ctx, id);
};

const ajouterFournisseur = async (ctx, id, body = {}) => {
  exiger(ctx);
  await sequelize.transaction(async (tr) => {
    const c = await charger(ctx, id, tr, true);
    if (!['brouillon', 'lancee'].includes(c.statut) || c.expiree) throw new ErreurConsultation(409, 'Consultation close : aucun fournisseur ne peut y être ajouté.');
    const f = entier(body.fournisseur_id, 'Fournisseur');
    const [ok] = await Q(`SELECT id FROM registre_tiers WHERE id = :f AND tenant_id = :t AND actif AND type IN ('fournisseur', 'mixte')`, { f, t: ctx.tenantId }, tr);
    if (!ok) throw new ErreurConsultation(400, 'Fournisseur inconnu ou inactif.');
    await X('INSERT INTO com_consultation_fournisseurs (consultation_id, tenant_id, fournisseur_id, jeton) VALUES (:c, :t, :f, :j) ON CONFLICT DO NOTHING',
      { c: c.id, t: ctx.tenantId, f, j: crypto.randomBytes(32).toString('base64url') }, tr);
    await auditer(tr, ctx, 'COM_CONSULTATION_AJOUT_FOURNISSEUR', c.id, { fournisseur_id: f });
  });
  return lire(ctx, id);
};

// Réouverture motivée : le fournisseur pourra soumettre une NOUVELLE version (l'ancienne est gardée).
const rouvrir = async (ctx, id, cfId, body = {}) => {
  exiger(ctx);
  const motif = txt(body.motif);
  if (motif.length < 5) throw new ErreurConsultation(400, 'Indiquez le motif de la réouverture.');
  await sequelize.transaction(async (tr) => {
    const c = await charger(ctx, id, tr, true);
    if (c.statut !== 'lancee' || c.expiree) throw new ErreurConsultation(409, 'Seule une consultation lancée, avant sa date limite, peut être rouverte.');
    const cf = await chargerFournisseur(c, cfId, tr);
    if (!['offre_recue', 'refusee'].includes(cf.statut)) throw new ErreurConsultation(409, 'Ce fournisseur peut encore répondre : rien à rouvrir.');
    await X('UPDATE com_consultation_fournisseurs SET reouverte = true, reouverte_par = :u, reouverte_le = NOW(), motif_reouverture = :m WHERE id = :id',
      { u: ctx.userId, m: motif.slice(0, 500), id: cf.id }, tr);
    await auditer(tr, ctx, 'COM_CONSULTATION_REOUVERTURE', c.id, { fournisseur_id: Number(cf.fournisseur_id), motif });
  });
  return lire(ctx, id);
};

const annuler = async (ctx, id, body = {}) => {
  exiger(ctx);
  const motif = txt(body.motif);
  if (motif.length < 3) throw new ErreurConsultation(400, 'Indiquez le motif de l\'annulation.');
  await sequelize.transaction(async (tr) => {
    const c = await charger(ctx, id, tr, true);
    if (!['brouillon', 'lancee'].includes(c.statut)) throw new ErreurConsultation(409, 'Seule une consultation en cours s\'annule.');
    await X("UPDATE com_consultations SET statut = 'annulee', annulee_par = :u, annulee_le = NOW(), motif_annulation = :m, modifie_le = NOW() WHERE id = :id",
      { u: ctx.userId, m: motif.slice(0, 500), id: c.id }, tr);
    await auditer(tr, ctx, 'COM_CONSULTATION_ANNULATION', c.id, { motif });
  });
  return lire(ctx, id);
};

const lirePdf = async (ctx, id, cfId) => {
  exigerVue(ctx);
  const c = await charger(ctx, id);
  const cf = await chargerFournisseur(c, cfId);
  return { buffer: await rendrePdf(ctx.tenantId, cf), nom: `Demande-proforma-${c.numero}.pdf` };
};
const lireProforma = async (ctx, id, offreId) => {
  exigerVue(ctx);
  const c = await charger(ctx, id);
  const [x] = await Q(`SELECT d.* FROM com_offres o JOIN com_consultation_fournisseurs cf ON cf.id = o.consultation_fournisseur_id
                        JOIN com_documents d ON d.id = o.document_id WHERE o.id = :o AND cf.consultation_id = :c`, { o: entier(offreId, 'Offre'), c: c.id });
  if (!x) throw new ErreurConsultation(404, 'Proforma introuvable.');
  return { chemin: docs.resoudre(x.chemin), nom: x.nom, mime: x.mime, sha256: x.sha256 };
};

// ── Comparaison ──────────────────────────────────────────────────────────
// Par article : chaque offre (prix, total, taxe, délai, conditions, disponibilité), meilleur prix
// et meilleur délai mis en évidence ; par fournisseur : le montant total de son offre.
const comparatif = async (ctx, id) => {
  const c = await lire(ctx, id);
  const offres = await offresActuelles(c.id);
  const lignes = c.lignes.map((l) => {
    const props = offres.map((o) => {
      const ol = o.lignes.find((x) => x.consultation_ligne_id === l.id);
      if (!ol) return null;
      const utilisable = ol.disponibilite !== 'indisponible' && ol.prix_unitaire !== null && ol.prix_unitaire > 0;
      return { offre_id: o.id, offre_ligne_id: ol.id, fournisseur_id: o.fournisseur_id, fournisseur_nom: o.fournisseur_nom, prix_unitaire: ol.prix_unitaire,
        quantite_proposee: ol.quantite_proposee, montant_ht: ol.montant_ht, taux_taxe: ol.taux_taxe, montant_taxe: ol.montant_taxe,
        montant_ttc: m2(ol.montant_ht + ol.montant_taxe), disponibilite: ol.disponibilite, disponibilite_libelle: ol.disponibilite_libelle,
        delai_livraison_jours: o.delai_livraison_jours, delai_type: o.delai_type, conditions_paiement: o.conditions_paiement, validite_jours: o.validite_jours,
        observation: ol.observation, utilisable };
    }).filter(Boolean);
    const ok = props.filter((p) => p.utilisable);
    const meilleurPrix = ok.length ? Math.min(...ok.map((p) => p.prix_unitaire)) : null;
    const delais = ok.filter((p) => p.delai_livraison_jours !== null).map((p) => p.delai_livraison_jours);
    const meilleurDelai = delais.length ? Math.min(...delais) : null;
    return { ...l, meilleur_prix: meilleurPrix, meilleur_delai: meilleurDelai,
      propositions: props.map((p) => ({ ...p, meilleur_prix: p.utilisable && p.prix_unitaire === meilleurPrix,
        meilleur_delai: p.utilisable && meilleurDelai !== null && p.delai_livraison_jours === meilleurDelai })) };
  });
  return { consultation: c, offres: offres.map((o) => ({ ...o, lignes: undefined, nb_lignes: o.lignes.filter((l) => l.disponibilite !== 'indisponible').length })), lignes };
};

// ── Attribution (choix par article) et bons de commande ──────────────────
const attribuer = async (ctx, id, body = {}) => {
  exiger(ctx);
  if (!Array.isArray(body.lignes) || !body.lignes.length) throw new ErreurConsultation(400, 'Indiquez le fournisseur retenu pour au moins un article.');
  const generer = body.generer_bons !== false;
  if (generer && !ctx.peut('com.bc.preparer')) throw new ErreurConsultation(403, 'Permission requise pour générer les bons : préparer les bons de commande.');
  const cmp = await comparatif(ctx, id);
  const res = await sequelize.transaction(async (tr) => {
    const c = await charger(ctx, id, tr, true);
    if (c.statut !== 'lancee') throw new ErreurConsultation(409, 'Seule une consultation lancée s\'attribue.');
    await Q('SELECT id FROM com_demandes WHERE id = :d FOR UPDATE', { d: c.demande_id }, tr);
    const choix = [];
    for (const x of body.lignes) {
      const l = cmp.lignes.find((y) => y.id === Number(x.consultation_ligne_id));
      if (!l) throw new ErreurConsultation(400, 'Ligne inconnue dans cette consultation.');
      if (!x.offre_ligne_id) {
        await X('UPDATE com_consultation_lignes SET choix_offre_ligne_id = NULL, choix_motif = :m WHERE id = :id', { m: lim(x.motif, 500, 'Motif'), id: l.id }, tr);
        continue;
      }
      const p = l.propositions.find((y) => y.offre_ligne_id === Number(x.offre_ligne_id));
      if (!p) throw new ErreurConsultation(400, `« ${l.designation} » : cette offre n'est pas une offre en vigueur de la consultation.`);
      if (!p.utilisable) throw new ErreurConsultation(400, `« ${l.designation} » : ${p.fournisseur_nom} n'a pas proposé de prix pour cet article.`);
      const motif = lim(x.motif, 500, 'Motif du choix');
      if (p.prix_unitaire > l.meilleur_prix + 1e-9 && motif.length < 5) {
        throw new ErreurConsultation(400, `« ${l.designation} » : ${p.fournisseur_nom} n'est pas le moins-disant ; justifiez ce choix (délai, conditions, qualité…).`);
      }
      await X('UPDATE com_consultation_lignes SET choix_offre_ligne_id = :o, choix_motif = :m WHERE id = :id', { o: p.offre_ligne_id, m: motif, id: l.id }, tr);
      // La demande porte désormais le fournisseur retenu et le prix approuvé (= prix HT de l'offre).
      await X('UPDATE com_demande_lignes SET fournisseur_id = :f, prix_estime = :p WHERE id = :dl', { f: p.fournisseur_id, p: p.prix_unitaire, dl: l.demande_ligne_id }, tr);
      choix.push({ ligne: l, p, motif });
    }
    if (!choix.length) throw new ErreurConsultation(400, 'Aucun fournisseur retenu.');
    await X("UPDATE com_consultations SET statut = 'attribuee', attribuee_par = :u, attribuee_le = NOW(), modifie_le = NOW() WHERE id = :id", { u: ctx.userId, id: c.id }, tr);
    await auditer(tr, ctx, 'COM_CONSULTATION_ATTRIBUTION', c.id, { choix: choix.map((x) => ({ article: x.ligne.designation, fournisseur: x.p.fournisseur_nom,
      prix: x.p.prix_unitaire, moins_disant: x.ligne.meilleur_prix, motif: x.motif })) });
    await perim().auditer(tr, ctx, 'COM_DA_ATTRIBUTION', c.demande_id, null, { consultation: c.numero, lignes: choix.length });
    const crees = [];
    if (generer) {
      const restes = await bons().restes(ctx.tenantId, c.demande_id, [], tr);
      const taxes = await Q("SELECT id, taux FROM com_taxes WHERE tenant_id = :t AND actif AND usage <> 'vente'", { t: ctx.tenantId }, tr);
      const parFournisseur = new Map();
      for (const x of choix) {
        const r = restes.find((y) => y.demande_ligne_id === x.ligne.demande_ligne_id);
        if (!r || r.reste <= 0) continue;
        const q = q3(Math.min(r.reste, x.ligne.quantite, x.p.disponibilite === 'partielle' && x.p.quantite_proposee > 0 ? x.p.quantite_proposee : Infinity));
        if (!(q > 0)) continue;
        const memeTaux = taxes.filter((t) => Math.abs(Number(t.taux) - x.p.taux_taxe) < 1e-6);
        if (!parFournisseur.has(x.p.fournisseur_id)) parFournisseur.set(x.p.fournisseur_id, { p: x.p, lignes: [] });
        parFournisseur.get(x.p.fournisseur_id).lignes.push({ demande_ligne_id: x.ligne.demande_ligne_id, quantite: q, prix_unitaire: x.p.prix_unitaire, remise_pct: 0,
          taxe_id: x.p.taux_taxe > 0 && memeTaux.length === 1 ? Number(memeTaux[0].id) : null });
      }
      for (const [fournisseurId, g] of parFournisseur) {
        const j = g.p.delai_livraison_jours;
        const delai = j === null ? '' : `${j} jour${j > 1 ? 's' : ''} ${g.p.delai_type === 'ouvres' ? 'ouvrés' : 'calendaires'}`;
        crees.push(await bons().creerDans(ctx, { demande_id: c.demande_id, fournisseur_id: fournisseurId, magasin_id: c.magasin_id, consultation_id: c.id,
          conditions_paiement: g.p.conditions_paiement || undefined, delai_livraison: delai, observations: `Suivant votre offre sur la consultation ${c.numero}.`,
          lignes: g.lignes }, tr));
      }
    }
    return { id: c.id, crees };
  });
  return { ...(await lire(ctx, res.id)), bons_crees: res.crees };
};

// ── Portail fournisseur (public, sans compte) ────────────────────────────
const parJeton = async (jeton, tr, verrou = false) => {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(String(jeton || ''))) throw new ErreurConsultation(404, 'Lien invalide.');
  const [cf] = await Q(`SELECT cf.*, c.numero, c.statut AS consultation_statut, c.date_limite, c.delai_souhaite, c.conditions_reponse, c.validite_offre_jours,
                               c.tenant_id AS c_tenant, rt.nom AS fournisseur_nom, d.numero AS demande_numero, m.nom AS magasin_nom, m.localisation
                          FROM com_consultation_fournisseurs cf JOIN com_consultations c ON c.id = cf.consultation_id
                          JOIN registre_tiers rt ON rt.id = cf.fournisseur_id JOIN com_demandes d ON d.id = c.demande_id JOIN com_magasins m ON m.id = d.magasin_id
                         WHERE cf.jeton = :j${verrou ? ' FOR UPDATE OF cf' : ''}`, { j: jeton }, tr);
  if (!cf || cf.consultation_statut === 'brouillon') throw new ErreurConsultation(404, 'Lien invalide ou expiré.');
  return cf;
};
const etatPublic = (cf) => {
  if (cf.consultation_statut === 'annulee') return { ouverte: false, raison: 'Cette consultation a été annulée par l\'acheteur.' };
  if (cf.consultation_statut === 'attribuee') return { ouverte: false, raison: 'Cette consultation est close : l\'acheteur a fait son choix.' };
  if (dateIso(cf.date_limite) < aujourdhui()) return { ouverte: false, raison: 'La date limite de réponse est passée.' };
  if (['offre_recue', 'refusee'].includes(cf.statut) && !cf.reouverte) {
    return { ouverte: false, raison: cf.statut === 'refusee' ? 'Vous avez décliné cette consultation.' : 'Votre offre a été reçue. Elle ne peut plus être modifiée, sauf réouverture par l\'acheteur.' };
  }
  return { ouverte: true, raison: '' };
};

const publicLire = async (jeton) => {
  const cf = await parJeton(jeton);
  const e = etatPublic(cf);
  await X(`UPDATE com_consultation_fournisseurs SET nb_consultations = nb_consultations + 1,
             statut = CASE WHEN statut IN ('a_envoyer', 'envoyee') AND :o THEN 'consultee' ELSE statut END,
             consulte_le = COALESCE(consulte_le, NOW()) WHERE id = :id`, { id: cf.id, o: e.ouverte });
  const s = await societe(cf.c_tenant);
  const lignes = (await Q('SELECT id, reference, designation, quantite, unite FROM com_consultation_lignes WHERE consultation_id = :c ORDER BY ordre, id', { c: cf.consultation_id }))
    .map((l) => ({ ...l, id: Number(l.id), quantite: Number(l.quantite) }));
  // Uniquement SA dernière offre : jamais celles des autres fournisseurs.
  const [o] = await Q('SELECT * FROM com_offres WHERE consultation_fournisseur_id = :f AND actuelle', { f: cf.id });
  const ol = o ? await Q(`SELECT consultation_ligne_id, disponibilite, quantite_proposee, prix_unitaire, taux_taxe, montant_ht, montant_taxe, observation
                            FROM com_offre_lignes WHERE offre_id = :o`, { o: o.id }) : [];
  const [t] = await Q('SELECT devise FROM tenants WHERE id = :t', { t: cf.c_tenant });
  return {
    acheteur: { nom: s.nom_affiche, adresse: [s.adresse, s.ville, s.pays].filter(Boolean).join(', '), telephone: s.telephone, email: s.email, logo_url: s.logo_url },
    fournisseur: cf.fournisseur_nom,
    consultation: { numero: cf.numero, demande: cf.demande_numero, date_limite: dateIso(cf.date_limite), delai_souhaite: cf.delai_souhaite,
      conditions_reponse: cf.conditions_reponse, validite_offre_jours: Number(cf.validite_offre_jours), livraison: [cf.magasin_nom, cf.localisation].filter(Boolean).join(' — ') },
    devise: t?.devise || 'FCFA', lignes, ...e, reouverte: cf.reouverte,
    offre: o ? { version: Number(o.version), soumise_le: o.soumise_le, signataire: o.signataire, delai_livraison_jours: o.delai_livraison_jours, delai_type: o.delai_type,
      conditions_paiement: o.conditions_paiement, validite_jours: o.validite_jours, observations: o.observations, total_ht: Number(o.total_ht),
      total_taxes: Number(o.total_taxes), total_ttc: Number(o.total_ttc), proforma: Boolean(o.document_id),
      lignes: ol.map((x) => ({ ...x, consultation_ligne_id: Number(x.consultation_ligne_id), quantite_proposee: Number(x.quantite_proposee),
        prix_unitaire: x.prix_unitaire === null ? null : Number(x.prix_unitaire), taux_taxe: Number(x.taux_taxe), montant_ht: Number(x.montant_ht), montant_taxe: Number(x.montant_taxe) })) } : null,
  };
};

const publicPdf = async (jeton) => {
  const cf = await parJeton(jeton);
  return { buffer: await rendrePdf(cf.c_tenant, cf), nom: `Demande-proforma-${cf.numero}.pdf` };
};

const publicSoumettre = async (jeton, body = {}, ip = '') => {
  let fichier = null;
  if (body.proforma && body.proforma.data_base64) {
    fichier = docs.preparer(body.proforma);
    if (fichier.mime !== 'application/pdf') throw new ErreurConsultation(400, 'La facture proforma doit être un fichier PDF.');
  }
  const res = await sequelize.transaction(async (tr) => {
    const cf = await parJeton(jeton, tr, true);
    const e = etatPublic(cf);
    if (!e.ouverte) throw new ErreurConsultation(409, e.raison);
    const signataire = lim(body.signataire, 150, 'Nom du signataire');
    if (signataire.length < 2) throw new ErreurConsultation(400, 'Indiquez le nom de la personne qui soumet l\'offre.');
    const delai = nombre(body.delai_livraison_jours, 'Délai de livraison', { max: 365 });
    if (delai !== null && !Number.isInteger(delai)) throw new ErreurConsultation(400, 'Délai de livraison : un nombre entier de jours.');
    const delaiType = body.delai_type === 'ouvres' ? 'ouvres' : 'calendaires';
    const validite = nombre(body.validite_jours, 'Validité de l\'offre', { min: 1, max: 365 });
    if (validite !== null && !Number.isInteger(validite)) throw new ErreurConsultation(400, 'Validité : un nombre entier de jours.');
    const lignes = await Q('SELECT id, designation, quantite FROM com_consultation_lignes WHERE consultation_id = :c ORDER BY ordre, id', { c: cf.consultation_id }, tr);
    const recues = new Map((Array.isArray(body.lignes) ? body.lignes : []).map((x) => [Number(x.consultation_ligne_id), x]));
    const calc = [];
    let tht = 0; let ttx = 0;
    for (const l of lignes) {
      const x = recues.get(Number(l.id));
      if (!x) throw new ErreurConsultation(400, `Répondez pour chaque article (« ${l.designation} » manquant), au besoin en le déclarant indisponible.`);
      const dispo = txt(x.disponibilite) || 'disponible';
      if (!DISPOS[dispo]) throw new ErreurConsultation(400, 'Disponibilité inconnue.');
      let pu = null; let qp = 0; let taux = 0;
      if (dispo !== 'indisponible') {
        pu = nombre(x.prix_unitaire, `Prix de « ${l.designation} »`);
        if (pu === null || !(pu > 0)) throw new ErreurConsultation(400, `Indiquez le prix unitaire hors taxes de « ${l.designation} ».`);
        qp = dispo === 'partielle' ? nombre(x.quantite_proposee, `Quantité disponible de « ${l.designation} »`, { min: 0.001 }) : Number(l.quantite);
        if (qp === null) throw new ErreurConsultation(400, `Indiquez la quantité disponible de « ${l.designation} ».`);
        if (qp > Number(l.quantite) + 1e-9) throw new ErreurConsultation(400, `« ${l.designation} » : quantité proposée supérieure à la quantité demandée.`);
        taux = nombre(x.taux_taxe, 'Taux de taxe', { max: 100, vide: 0 });
      }
      const ht = pu === null ? 0 : m2(qp * pu);
      const tx = m2(ht * taux / 100);
      tht += ht; ttx += tx;
      calc.push({ l, dispo, qp: q3(qp), pu: pu === null ? null : m2(pu), taux, ht, tx, obs: lim(x.observation, 500, 'Observation') });
    }
    if (calc.every((x) => x.dispo === 'indisponible')) throw new ErreurConsultation(400, 'Aucun article proposé : utilisez plutôt « Décliner la consultation ».');
    const [v] = await Q('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM com_offres WHERE consultation_fournisseur_id = :f', { f: cf.id }, tr);
    await X('UPDATE com_offres SET actuelle = false WHERE consultation_fournisseur_id = :f AND actuelle', { f: cf.id }, tr);
    let docId = null;
    if (fichier) {
      const chemin = await docs.ecrire(cf.c_tenant, 'offre', `${cf.consultation_id}-${cf.id}-${v.v}`, fichier);
      const [d] = await Q(`INSERT INTO com_documents (tenant_id, objet_type, objet_id, categorie, nom, mime, taille, sha256, chemin, ajoute_par)
                           VALUES (:t, 'offre', :o, 'proforma', :nom, :mime, :taille, :sha, :chemin, NULL) RETURNING id`,
      { t: cf.c_tenant, o: cf.id, nom: fichier.nom, mime: fichier.mime, taille: fichier.taille, sha: fichier.sha256, chemin }, tr);
      docId = Number(d.id);
    }
    const [o] = await Q(`INSERT INTO com_offres (consultation_fournisseur_id, tenant_id, version, signataire, delai_livraison_jours, delai_type, conditions_paiement,
                           validite_jours, observations, total_ht, total_taxes, total_ttc, document_id, adresse_ip)
                         VALUES (:f, :t, :v, :sig, :d, :dt, :cp, :val, :obs, :ht, :tx, :ttc, :doc, :ip) RETURNING id, soumise_le`,
    { f: cf.id, t: cf.c_tenant, v: v.v, sig: signataire, d: delai, dt: delaiType, cp: lim(body.conditions_paiement, 300, 'Conditions de paiement'),
      val: validite, obs: lim(body.observations, 2000, 'Observations'), ht: m2(tht), tx: m2(ttx), ttc: m2(tht + ttx), doc: docId, ip: String(ip || '').slice(0, 60) }, tr);
    for (const x of calc) {
      await X(`INSERT INTO com_offre_lignes (offre_id, consultation_ligne_id, disponibilite, quantite_proposee, prix_unitaire, taux_taxe, montant_ht, montant_taxe, observation)
               VALUES (:o, :l, :d, :q, :pu, :tx, :ht, :mt, :obs)`, { o: o.id, l: x.l.id, d: x.dispo, q: x.qp, pu: x.pu, tx: x.taux, ht: x.ht, mt: x.tx, obs: x.obs }, tr);
    }
    await X("UPDATE com_consultation_fournisseurs SET statut = 'offre_recue', reponse_le = NOW(), reouverte = false WHERE id = :id", { id: cf.id }, tr);
    await auditer(tr, { tenantId: cf.c_tenant, userId: null }, 'COM_CONSULTATION_OFFRE_RECUE', cf.consultation_id, { fournisseur: cf.fournisseur_nom,
      version: Number(v.v), signataire, total_ht: m2(tht), proforma: Boolean(docId), ip: String(ip || '').slice(0, 60) });
    return { cf, version: Number(v.v), soumise_le: o.soumise_le };
  });
  try {
    const { usersAvecPermission } = require('../permission.service');
    const { creerNotification } = require('../notification.service');
    for (const u of await usersAvecPermission(res.cf.c_tenant, 'com.consultations.gerer')) {
      await creerNotification({ tenantId: res.cf.c_tenant, destinataireId: u.id, type: 'com_consultation', titre: `Offre reçue — ${res.cf.numero}`,
        message: `${res.cf.fournisseur_nom} a soumis son offre (version ${res.version}) pour la consultation ${res.cf.numero}.`, refType: 'com_consultation', refId: res.cf.consultation_id });
    }
  } catch (e) { console.warn('[Commercial] notification offre :', e.message); }
  return { ok: true, version: res.version, soumise_le: res.soumise_le };
};

const publicRefuser = async (jeton, body = {}) => {
  const motif = txt(body.motif).slice(0, 1000);
  await sequelize.transaction(async (tr) => {
    const cf = await parJeton(jeton, tr, true);
    const e = etatPublic(cf);
    if (!e.ouverte) throw new ErreurConsultation(409, e.raison);
    await X("UPDATE com_consultation_fournisseurs SET statut = 'refusee', reponse_le = NOW(), motif_refus = :m, reouverte = false WHERE id = :id", { m: motif, id: cf.id }, tr);
    await auditer(tr, { tenantId: cf.c_tenant, userId: null }, 'COM_CONSULTATION_REFUS', cf.consultation_id, { fournisseur: cf.fournisseur_nom, motif });
  });
  return { ok: true };
};

module.exports = {
  ErreurConsultation, STATUTS, STATUTS_FOURNISSEUR, MINIMUM, lister, lire, creer, modifier, lancer, envoyer, ajouterFournisseur, rouvrir, annuler,
  lirePdf, lireProforma, comparatif, attribuer, publicLire, publicPdf, publicSoumettre, publicRefuser, offresActuelles,
};

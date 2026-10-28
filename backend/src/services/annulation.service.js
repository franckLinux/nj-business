// src/services/annulation.service.js — Annulation d'écritures de caisse.
//
// Une écriture enregistrée est intangible (migration 027). Pour corriger une
// erreur, on passe une écriture de CONTRE-PASSATION : mêmes journal, rubrique,
// date et libellé, montants en NÉGATIF. Le solde, le budget de la rubrique et
// le compte d'emploi retombent exactement comme si l'écriture fautive n'avait
// pas existé, sans qu'aucune ligne disparaisse : la piste d'audit reste complète
// et la numérotation chronologique (l'annulation reçoit le numéro suivant).
//
// Circuit : la caissière DEMANDE (motif obligatoire) → le directeur AUTORISE
// (contre-passation passée) ou REFUSE. Le directeur peut aussi annuler directement.
const { sequelize } = require('../models');
const { verifierPeriodeOuverte, verifierSoldeNonNegatif, ErreurComptable } = require('./journal.service');
const notif = require('./notification.service');

const SELECT = sequelize.QueryTypes.SELECT;
const q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: SELECT, ...opts });
const fmt = (n) => Math.round(Math.abs(parseFloat(n) || 0)).toLocaleString('fr-FR');

const charger = async (tenantId, id, t, verrou = false) => {
  const [m] = await q(`SELECT * FROM journal WHERE id = :id AND tenant_id = :t ${verrou ? 'FOR UPDATE' : ''}`,
    { id, t: tenantId }, { transaction: t });
  if (!m) throw new ErreurComptable(404, 'Écriture introuvable.');
  return m;
};

const verifierAnnulable = (m) => {
  if (m.annulation_de_id) throw new ErreurComptable(409, `L'écriture n°${m.numero} est elle-même une annulation : elle ne s'annule pas.`);
  if (m.annule) throw new ErreurComptable(409, `L'écriture n°${m.numero} est déjà annulée.`);
};

// Passe la contre-passation (dans la transaction fournie). Renvoie l'écriture créée.
const passerAnnulation = async ({ tenantId, mouvementId, motif, userId, t }) => {
  const m = await charger(tenantId, mouvementId, t, true);
  verifierAnnulable(m);
  await verifierPeriodeOuverte(tenantId, m.journal_id, m.mois, m.annee);
  const e = parseFloat(m.entree) || 0;
  const s = parseFloat(m.sortie) || 0;
  // Annuler une ENTRÉE retire l'argent de la caisse : jamais en dessous de zéro.
  await verifierSoldeNonNegatif(tenantId, m.journal_id, m.mois, m.annee, s - e);

  // Date de la contre-passation : le jour de l'annulation, ramené au dernier
  // jour du mois de l'écriture si ce mois est passé (elle reste dans la même
  // période, donc mêmes solde et budget du mois), jamais avant l'écriture
  // d'origine. Numéro ET date restent ainsi dans l'ordre chronologique.
  const [{ d: dateCp }] = await q(
    `SELECT GREATEST(CAST(:orig AS date),
              LEAST(CURRENT_DATE, (date_trunc('month', CAST(:orig AS date)) + INTERVAL '1 month - 1 day')::date),
              (SELECT MAX(date) FROM journal WHERE tenant_id = :t AND journal_id = :j AND mois = :mois AND annee = :annee)) AS d`,
    { orig: m.date, t: tenantId, j: m.journal_id, mois: m.mois, annee: m.annee }, { transaction: t });

  const [cp] = await q(
    `INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse, rubrique_code, intitule, objet,
                          beneficiaire, piece_identite, telephone, entree, sortie, created_by, annulation_de_id, motif_annulation, activite_id)
     VALUES (:t, :date, :mois, :annee, :jid, :tc, :rub, :intitule, :objet, :benef, :piece, :tel, :e, :s, :u, :orig, :motif, :act)
     RETURNING *`,
    { t: tenantId, date: dateCp, mois: m.mois, annee: m.annee, jid: m.journal_id, tc: m.type_caisse, rub: m.rubrique_code,
      intitule: `ANNULATION n°${m.numero} — ${m.intitule}`.slice(0, 250), objet: motif.slice(0, 250),
      benef: m.beneficiaire || '', piece: m.piece_identite || '', tel: m.telephone || '',
      e: -e, s: -s, u: userId, orig: m.id, motif, act: m.activite_id || null }, { transaction: t });
  await sequelize.query(
    'UPDATE journal SET annule = true, annule_par_id = :cp, motif_annulation = :motif, updated_at = NOW() WHERE id = :id',
    { replacements: { cp: cp.id, motif, id: m.id }, transaction: t });
  await sequelize.query(
    `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
     VALUES (:t, :u, 'ANNULATION_ECRITURE', 'journal', :id, CAST(:av AS jsonb), CAST(:ap AS jsonb))`,
    { replacements: { t: tenantId, u: userId, id: String(m.id),
      av: JSON.stringify({ numero: m.numero, entree: e, sortie: s, rubrique: m.rubrique_code, intitule: m.intitule }),
      ap: JSON.stringify({ contre_passation: cp.id, numero: cp.numero, motif }) }, transaction: t });
  return { original: m, annulation: cp };
};

const motifValide = (motif) => {
  const m = String(motif || '').trim();
  if (m.length < 5) throw new ErreurComptable(400, 'Indiquez le motif de l\'annulation (5 caractères minimum).');
  return m.slice(0, 500);
};

// ── Point d'entrée : demander OU annuler directement selon les droits ──────
const demanderOuAnnuler = async ({ tenantId, user, mouvementId, motif, peutAnnuler }) => {
  const m = motifValide(motif);
  if (peutAnnuler) {
    const r = await sequelize.transaction((t) => passerAnnulation({ tenantId, mouvementId, motif: m, userId: user.id, t }));
    // Une éventuelle demande en cours sur cette écriture est close.
    await sequelize.query(
      `UPDATE demandes_annulation SET statut = 'approuvee', decide_par = :u, decide_le = NOW(), annulation_id = :cp,
              commentaire = 'Annulée directement par le directeur'
        WHERE mouvement_id = :id AND statut = 'en_attente'`,
      { replacements: { u: user.id, cp: r.annulation.id, id: mouvementId } });
    return { annule: true, numero: r.original.numero, numero_annulation: r.annulation.numero,
      message: `Écriture n°${r.original.numero} annulée : contre-passation n°${r.annulation.numero} enregistrée.` };
  }
  const d = await sequelize.transaction(async (t) => {
    const ecriture = await charger(tenantId, mouvementId, t, true);
    verifierAnnulable(ecriture);
    await verifierPeriodeOuverte(tenantId, ecriture.journal_id, ecriture.mois, ecriture.annee);
    const [deja] = await q(`SELECT id FROM demandes_annulation WHERE mouvement_id = :id AND statut = 'en_attente'`, { id: mouvementId }, { transaction: t });
    if (deja) throw new ErreurComptable(409, `Une demande d'annulation de l'écriture n°${ecriture.numero} est déjà en attente.`);
    const [row] = await q(
      `INSERT INTO demandes_annulation (tenant_id, mouvement_id, motif, demande_par) VALUES (:t, :id, :motif, :u) RETURNING *`,
      { t: tenantId, id: mouvementId, motif: m, u: user.id }, { transaction: t });
    return { ...row, ecriture };
  });
  notif.notifierPermission({
    tenantId, permission: 'journal.annuler', type: 'annulation_demandee',
    titre: `Demande d'annulation — écriture n°${d.ecriture.numero}`,
    message: `${user.username} demande l'annulation de « ${d.ecriture.intitule} » (${fmt(d.ecriture.entree || d.ecriture.sortie)} FCFA, ${d.ecriture.mois} ${d.ecriture.annee}). Motif : ${m}`,
    refType: 'demande_annulation', refId: d.id,
  }).catch(() => {});
  return { demande: true, id: d.id, message: `Demande d'annulation de l'écriture n°${d.ecriture.numero} envoyée au directeur.` };
};

// ── Décision du directeur ─────────────────────────────────────────────────
const decider = async ({ tenantId, user, demandeId, decision, commentaire = '' }) => {
  if (!['approuver', 'refuser'].includes(decision)) throw new ErreurComptable(400, 'Décision invalide.');
  const com = String(commentaire || '').trim().slice(0, 500);
  if (decision === 'refuser' && !com) throw new ErreurComptable(400, 'Indiquez le motif du refus.');
  const r = await sequelize.transaction(async (t) => {
    const [d] = await q(`SELECT * FROM demandes_annulation WHERE id = :id AND tenant_id = :t FOR UPDATE`, { id: demandeId, t: tenantId }, { transaction: t });
    if (!d) throw new ErreurComptable(404, 'Demande introuvable.');
    if (d.statut !== 'en_attente') throw new ErreurComptable(409, 'Cette demande a déjà été traitée.');
    let cp = null;
    if (decision === 'approuver') {
      ({ annulation: cp } = await passerAnnulation({ tenantId, mouvementId: d.mouvement_id, motif: d.motif, userId: user.id, t }));
    }
    await sequelize.query(
      `UPDATE demandes_annulation SET statut = :s, decide_par = :u, decide_le = NOW(), commentaire = :c, annulation_id = :cp WHERE id = :id`,
      { replacements: { s: decision === 'approuver' ? 'approuvee' : 'refusee', u: user.id, c: com, cp: cp?.id || null, id: d.id }, transaction: t });
    return { d, cp };
  });
  const [m] = await q('SELECT numero, intitule FROM journal WHERE id = :id', { id: r.d.mouvement_id });
  if (r.d.demande_par) {
    notif.creerNotification({
      tenantId, destinataireId: r.d.demande_par, type: 'annulation_decidee',
      titre: decision === 'approuver' ? `Annulation autorisée — écriture n°${m?.numero}` : `Annulation refusée — écriture n°${m?.numero}`,
      message: decision === 'approuver'
        ? `« ${m?.intitule} » est annulée (contre-passation n°${r.cp.numero}). Ressaisissez l'écriture correcte si besoin.`
        : `Motif du refus : ${com}`,
      refType: 'demande_annulation', refId: r.d.id,
    }).catch(() => {});
  }
  return decision === 'approuver'
    ? { ok: true, message: `Annulation autorisée : contre-passation n°${r.cp.numero} enregistrée.` }
    : { ok: true, message: 'Demande d\'annulation refusée.' };
};

const lister = ({ tenantId, statut = 'en_attente' }) => q(
  `SELECT d.*, j.numero, j.date, j.mois, j.annee, j.intitule, j.rubrique_code, j.entree, j.sortie,
          jx.nom AS journal_nom, jx.code AS journal_code, u.username AS demandeur, v.username AS decideur
     FROM demandes_annulation d
     JOIN journal j ON j.id = d.mouvement_id
     LEFT JOIN journaux jx ON jx.id = j.journal_id
     LEFT JOIN users u ON u.id = d.demande_par
     LEFT JOIN users v ON v.id = d.decide_par
    WHERE d.tenant_id = :t AND (:s = 'toutes' OR d.statut = :s)
    ORDER BY d.demande_le DESC LIMIT 200`, { t: tenantId, s: statut });

module.exports = { demanderOuAnnuler, decider, lister };

// src/services/projets_justificatifs.service.js — Justificatifs et bilan (lot P3, 070)
//
//   • Dépôt   : le responsable de l'activité, ou qui gère le projet (chef de
//               projet, direction). Pièce scannée OBLIGATOIRE (PDF, JPG, PNG,
//               WEBP, 5 Mo), rangée dans le stockage privé.
//   • Contrôle: le chef de CE projet ou le comptable (justificatifs.valider) ;
//               jamais la personne qui a déposé (contrôlé ici ET en base).
//   • Annulation d'une pièce validée : directeur (justificatifs.annuler), motif.
//   • Suppression : seulement une pièce encore « déposée », par qui l'a déposée
//               ou qui gère le projet. Le fichier reste sur le disque (archive).
//   • Bilan   : par activité — alloué, justifié, remboursé, en attente.
const fs = require('fs');
const { sequelize } = require('../models');
const pv = require('./pv_storage.service');
const notif = require('./notification.service');
const { ErreurProjet } = require('./projets.service');
const g = require('./projets_gestion.service');

const SELECT = sequelize.QueryTypes.SELECT;
const q = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: SELECT, transaction });
const n = (v) => (v === null || v === undefined ? 0 : parseFloat(v) || 0);
const err = (status, message, code) => new ErreurProjet(status, message, code);
const texte = (v, max) => String(v ?? '').trim().slice(0, max);

const exigerInstalle = async () => {
  if (!(await g.justifInstalle())) throw err(503, 'Les justificatifs ne sont pas encore installés (migration 070).', 'JUSTIFICATIFS_INDISPONIBLES');
};

const COLONNES = `pj.id, pj.projet_id, pj.activite_id, a.nom AS activite_nom, p.nom AS projet_nom, pj.remise_id,
  r.numero AS remise_numero, r.date AS remise_date, rj.code AS remise_journal,
  pj.date_piece, pj.montant, pj.fournisseur, pj.numero_piece, pj.libelle, pj.poste_cle, pj.poste_libelle,
  pj.fichier_nom, pj.fichier_mime, pj.fichier_taille, (pj.fichier_path IS NOT NULL) AS a_fichier,
  pj.statut, pj.depose_par, ud.username AS depose_par_nom, pj.depose_le,
  pj.decide_par, uv.username AS decide_par_nom, pj.decide_le, pj.motif_rejet,
  ua.username AS annule_par_nom, pj.annule_le, pj.motif_annulation, a.responsable_id`;
const JOINTURES = `FROM projet_justificatifs pj
  JOIN activites a ON a.id = pj.activite_id
  JOIN activites p ON p.id = pj.projet_id
  LEFT JOIN journal r ON r.id = pj.remise_id
  LEFT JOIN journaux rj ON rj.id = r.journal_id
  LEFT JOIN users ud ON ud.id = pj.depose_par
  LEFT JOIN users uv ON uv.id = pj.decide_par
  LEFT JOIN users ua ON ua.id = pj.annule_par`;
const former = (j, req, droitsPiece) => ({
  ...j, id: Number(j.id), montant: n(j.montant), remise_id: j.remise_id ? Number(j.remise_id) : null,
  ...(droitsPiece ? { droits: droitsPiece(j, req) } : {}),
});

// Ce que l'utilisateur peut faire sur une pièce donnée (pour l'écran ; le
// serveur revérifie à chaque action).
const droitsSurPiece = (ctx) => (j, req) => {
  const moi = req.user.id;
  const estDeposant = j.depose_par === moi;
  return {
    valider: j.statut === 'depose' && ctx.validerJustif && !estDeposant,
    supprimer: j.statut === 'depose' && (estDeposant || ctx.acces.gerer),
    annuler: j.statut === 'valide' && ctx.annuler,
  };
};

const contexte = async (req, projetId) => {
  await exigerInstalle();
  const { projet, acces, droits } = await g.chargerProjet(req, projetId);
  return {
    projet, acces, droits,
    validerJustif: acces.estChef || droits.validerJustificatifs,
    annuler: droits.annulerJustificatifs,
  };
};

/** Pièces d'un projet (archives), dans le périmètre de l'utilisateur. */
const lister = async (req, projetId, { activiteId, statut } = {}) => {
  const ctx = await contexte(req, projetId);
  const rows = await q(
    `SELECT ${COLONNES} ${JOINTURES}
      WHERE pj.projet_id = :p
        AND (:tout OR pj.activite_id IN (:mes))
        AND (:act::int IS NULL OR pj.activite_id = :act::int)
        AND (:st::text IS NULL OR pj.statut = :st::text)
      ORDER BY pj.depose_le DESC, pj.id DESC`,
    { p: ctx.projet.id, tout: ctx.acces.voirTout, mes: ctx.droits.responsable.length ? ctx.droits.responsable : [0],
      act: activiteId ? parseInt(activiteId, 10) || 0 : null, st: statut || null });
  const dr = droitsSurPiece(ctx);
  return rows.map((j) => former(j, req, dr));
};

/** Dépôt d'un justificatif (pièce scannée obligatoire). */
const deposer = async (req, projetId, b) => {
  const ctx = await contexte(req, projetId);
  const activiteId = parseInt(b.activite_id, 10);
  const [a] = await q('SELECT id, nom, responsable_id, actif FROM activites WHERE id = :a AND projet_id = :p',
    { a: Number.isInteger(activiteId) ? activiteId : 0, p: ctx.projet.id });
  if (!a) throw err(400, 'Choisissez l\'activité justifiée.', 'ACTIVITE_INVALIDE');
  if (!(ctx.acces.gerer || a.responsable_id === req.user.id)) {
    throw err(403, 'Seul le responsable de cette activité (ou le chef du projet) dépose ses justificatifs.', 'JUSTIFICATIF_NON_AUTORISE');
  }
  const montant = Number(String(b.montant ?? '').replace(/[\s  ]/g, '').replace(',', '.'));
  if (!Number.isFinite(montant) || montant <= 0) throw err(400, 'Le montant de la pièce doit être positif.', 'MONTANT_INVALIDE');
  const datePiece = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date_piece || '')) ? String(b.date_piece) : null;
  if (!datePiece) throw err(400, 'La date de la pièce est obligatoire.', 'DATE_INVALIDE');
  if (datePiece > new Date().toISOString().slice(0, 10)) throw err(400, 'La date de la pièce est dans le futur.', 'DATE_INVALIDE');
  const libelle = texte(b.libelle, 300);
  if (!libelle) throw err(400, 'Indiquez l\'objet de la dépense.', 'CHAMP_REQUIS');
  if (!b.fichier?.data_base64) throw err(400, 'Joignez la pièce scannée (PDF ou photo).', 'FICHIER_REQUIS');
  let fichier;
  try {
    fichier = pv.preparer(b.fichier);
  } catch (e) {
    throw err(400, String(e.message).replace(/le PV scanné/g, 'la pièce scannée').replace(/le PV/g, 'la pièce').replace(/PV /g, 'Pièce '), 'FICHIER_INVALIDE');
  }
  const remiseId = b.remise_id ? parseInt(b.remise_id, 10) : null;
  const m = Math.round(montant * 100) / 100;
  const fmt = (v) => (parseFloat(v) || 0).toLocaleString('fr-FR');

  return sequelize.transaction(async (t) => {
    // Plafond (lot P4, décision du 20/11/2026) : le dépôt est BLOQUÉ s'il fait
    // dépasser le budget validé de sa ligne budgétaire, ou de l'activité quand
    // elle n'a pas de lignes. Les pièces déposées et validées comptent.
    await q('SELECT pg_advisory_xact_lock(hashtext(:k))', { k: `projet_justif:${a.id}` }, t);
    const avecPostes = await g.postesInstalles();
    const postes = avecPostes ? await q(
      `SELECT po.cle, po.libelle, po.montant FROM projet_budget_postes po
         JOIN projet_budgets bv ON bv.id = po.budget_id AND bv.statut = 'valide'
        WHERE po.activite_id = :a ORDER BY po.ordre, po.id`, { a: a.id }, t) : [];
    let poste = null;
    if (postes.length) {
      poste = postes.find((po) => String(po.cle) === String(b.poste_cle || ''));
      if (!poste) throw err(400, `Choisissez la ligne budgétaire de « ${a.nom} » que cette pièce justifie.`, 'LIGNE_REQUISE');
      const [{ pris }] = await q(
        `SELECT COALESCE(SUM(montant), 0) AS pris FROM projet_justificatifs WHERE poste_cle = :c AND statut IN ('depose', 'valide')`,
        { c: poste.cle }, t);
      if (n(pris) + m > n(poste.montant)) {
        throw err(409, `Dépôt refusé : la ligne « ${poste.libelle} » dépasserait son budget de ${fmt(n(pris) + m - n(poste.montant))} FCFA `
          + `(budget ${fmt(poste.montant)}, déjà justifié ou déposé ${fmt(pris)}).`, 'DEPASSEMENT_LIGNE');
      }
    } else {
      const [lb] = await q(
        `SELECT l.montant FROM projet_budget_lignes l JOIN projet_budgets bv ON bv.id = l.budget_id AND bv.statut = 'valide'
          WHERE l.activite_id = :a`, { a: a.id }, t);
      if (!lb) throw err(409, `Dépôt refusé : l'activité « ${a.nom} » n'a pas de budget validé.`, 'BUDGET_PROJET_NON_VALIDE');
      const [{ pris }] = await q(
        `SELECT COALESCE(SUM(montant), 0) AS pris FROM projet_justificatifs WHERE activite_id = :a AND statut IN ('depose', 'valide')`,
        { a: a.id }, t);
      if (n(pris) + m > n(lb.montant)) {
        throw err(409, `Dépôt refusé : l'activité « ${a.nom} » dépasserait son budget de ${fmt(n(pris) + m - n(lb.montant))} FCFA `
          + `(budget ${fmt(lb.montant)}, déjà justifié ou déposé ${fmt(pris)}).`, 'DEPASSEMENT_LIGNE');
      }
    }
    const [row] = await q(
      `INSERT INTO projet_justificatifs (tenant_id, projet_id, activite_id, remise_id, date_piece, montant,
              fournisseur, numero_piece, libelle, depose_par)
       VALUES (:t, :p, :a, :r, :d, :m, :f, :np, :l, :u) RETURNING id`,
      { t: req.tenantId, p: ctx.projet.id, a: a.id, r: remiseId, d: datePiece, m,
        f: texte(b.fournisseur, 150), np: texte(b.numero_piece, 60), l: libelle, u: req.user.id }, t);
    if (poste) {
      await q('UPDATE projet_justificatifs SET poste_cle = :c, poste_libelle = :lib WHERE id = :id RETURNING id',
        { c: poste.cle, lib: poste.libelle, id: row.id }, t);
    }
    const chemin = await pv.enregistrer(req.tenantId, 'justificatifs', row.id, fichier);
    await q(
      `UPDATE projet_justificatifs SET fichier_nom = :nom, fichier_path = :path, fichier_mime = :mime,
              fichier_taille = :taille, fichier_sha256 = :sha WHERE id = :id RETURNING id`,
      { nom: fichier.nom, path: chemin, mime: fichier.mime, taille: fichier.taille, sha: fichier.sha256, id: row.id }, t);
    return { id: Number(row.id), activite: a.nom };
  }).then(async (r) => {
    // Préviens qui contrôle : le chef du projet (s'il n'est pas le déposant).
    if (ctx.projet.chef_projet_id && ctx.projet.chef_projet_id !== req.user.id) {
      await notif.creerNotification({
        tenantId: req.tenantId, destinataireId: ctx.projet.chef_projet_id, type: 'projet_justificatif',
        titre: `Justificatif à contrôler : ${ctx.projet.nom}`,
        message: `${req.user.username || 'Un responsable'} a déposé une pièce de ${montant.toLocaleString('fr-FR')} FCFA (${r.activite}).`,
        refType: 'projet', refId: ctx.projet.id,
      });
    }
    return { id: r.id };
  });
};

const chargerPiece = async (req, projetId, pieceId) => {
  const ctx = await contexte(req, projetId);
  const [j] = await q(`SELECT ${COLONNES}, pj.fichier_path, pj.fichier_sha256 ${JOINTURES} WHERE pj.id = :id AND pj.projet_id = :p`,
    { id: parseInt(pieceId, 10) || 0, p: ctx.projet.id });
  if (!j || !(ctx.acces.voirTout || ctx.droits.responsable.includes(Number(j.activite_id)))) {
    throw err(404, 'Justificatif introuvable.', 'JUSTIFICATIF_INTROUVABLE');
  }
  return { ctx, j };
};

const decider = async (req, projetId, pieceId, { valider, motif }) => {
  const { ctx, j } = await chargerPiece(req, projetId, pieceId);
  if (!ctx.validerJustif) throw err(403, 'Le contrôle des justificatifs revient au chef de ce projet ou au comptable.', 'JUSTIFICATIF_NON_AUTORISE');
  if (j.depose_par === req.user.id) throw err(403, 'Vous ne pouvez pas contrôler une pièce que vous avez déposée.', 'AUTO_VALIDATION');
  if (j.statut !== 'depose') throw err(409, 'Cette pièce a déjà été contrôlée.', 'JUSTIFICATIF_STATUT');
  const m = texte(motif, 2000);
  if (!valider && !m) throw err(400, 'Le motif du rejet est obligatoire.', 'MOTIF_REQUIS');
  await q(
    `UPDATE projet_justificatifs SET statut = :s, decide_par = :u, decide_le = NOW(), motif_rejet = :m
      WHERE id = :id AND statut = 'depose' RETURNING id`,
    { s: valider ? 'valide' : 'rejete', u: req.user.id, m: valider ? '' : m, id: j.id });
  if (j.depose_par && j.depose_par !== req.user.id) {
    await notif.creerNotification({
      tenantId: req.tenantId, destinataireId: j.depose_par, type: 'projet_justificatif',
      titre: valider ? `Justificatif validé : ${j.activite_nom}` : `Justificatif rejeté : ${j.activite_nom}`,
      message: valider ? `${n(j.montant).toLocaleString('fr-FR')} FCFA — ${j.libelle}` : `Motif : ${m}`,
      refType: 'projet', refId: Number(j.projet_id),
    });
  }
};

const annuler = async (req, projetId, pieceId, motif) => {
  const { ctx, j } = await chargerPiece(req, projetId, pieceId);
  if (!ctx.annuler) throw err(403, 'Permission requise : annuler un justificatif validé.', 'JUSTIFICATIF_NON_AUTORISE');
  if (j.statut !== 'valide') throw err(409, 'Seule une pièce validée s\'annule.', 'JUSTIFICATIF_STATUT');
  const m = texte(motif, 2000);
  if (!m) throw err(400, 'Le motif de l\'annulation est obligatoire.', 'MOTIF_REQUIS');
  await q(`UPDATE projet_justificatifs SET statut = 'annule', annule_par = :u, annule_le = NOW(), motif_annulation = :m
            WHERE id = :id AND statut = 'valide' RETURNING id`, { u: req.user.id, m, id: j.id });
};

const supprimer = async (req, projetId, pieceId) => {
  const { ctx, j } = await chargerPiece(req, projetId, pieceId);
  if (j.statut !== 'depose') throw err(409, 'Une pièce contrôlée ne se supprime pas.', 'JUSTIFICATIF_STATUT');
  if (!(j.depose_par === req.user.id || ctx.acces.gerer)) throw err(403, 'Seul l\'auteur du dépôt (ou le chef du projet) peut le retirer.', 'JUSTIFICATIF_NON_AUTORISE');
  await q('DELETE FROM projet_justificatifs WHERE id = :id AND statut = \'depose\' RETURNING id', { id: j.id });
};

/** Fichier d'une pièce, pour l'ouvrir (route authentifiée). */
const fichier = async (req, projetId, pieceId) => {
  const { j } = await chargerPiece(req, projetId, pieceId);
  if (!j.fichier_path) throw err(404, 'Aucun fichier pour cette pièce.', 'FICHIER_ABSENT');
  const chemin = pv.cheminComplet(j.fichier_path);
  await fs.promises.access(chemin, fs.constants.R_OK).catch(() => {
    throw err(410, 'Le fichier de la pièce est introuvable sur le serveur.', 'FICHIER_ABSENT');
  });
  return { chemin, nom: j.fichier_nom, mime: j.fichier_mime, sha256: j.fichier_sha256 };
};

/** File des pièces à contrôler par l'utilisateur, tous projets confondus. */
const aControler = async (req) => {
  await g.exigerOng(req.tenantId);
  await exigerInstalle();
  const d = await g.droits(req);
  if (!d.validerJustificatifs && !d.chef.length) return [];
  const rows = await q(
    `SELECT ${COLONNES} ${JOINTURES}
      WHERE pj.tenant_id = :t AND pj.statut = 'depose' AND pj.depose_par IS DISTINCT FROM :u
        AND (:tous OR pj.projet_id IN (:chef))
      ORDER BY pj.depose_le`,
    { t: req.tenantId, u: req.user.id, tous: d.validerJustificatifs, chef: d.chef.length ? d.chef : [0] });
  return rows.map((j) => ({ ...former(j), droits: { valider: true } }));
};

/** Bilan : activités validées / en attente de justification, projets visibles. */
const bilan = async (req) => {
  await g.exigerOng(req.tenantId);
  const d = await g.droits(req);
  const projets = await q(
    `SELECT p.id, p.code, p.nom, p.actif, p.chef_projet_id, u.username AS chef_nom
       FROM activites p LEFT JOIN users u ON u.id = p.chef_projet_id
      WHERE p.tenant_id = :t AND p.type = 'projet' ORDER BY lower(p.nom)`, { t: req.tenantId });
  const visibles = projets.filter((p) => g.accesProjet(d, p).voir);
  const situation = await g.situationProjets(req.tenantId, visibles.map((p) => Number(p.id)));
  const auj = Date.now();
  const jours = (dt) => (dt ? Math.max(0, Math.floor((auj - new Date(dt).getTime()) / 86400000)) : null);
  const lignes = [];
  for (const p of visibles) {
    const acc = g.accesProjet(d, p);
    const sit = situation.get(Number(p.id));
    const base = { projet_id: Number(p.id), projet_code: p.code, projet_nom: p.nom, projet_actif: p.actif, chef_nom: p.chef_nom };
    // Remise globale au projet (lot P4) : une ligne à part, au nom du chef de projet.
    if (acc.voirTout && sit.global.alloue > 0) {
      lignes.push({
        ...base, activite_id: null, globale: true, activite_nom: 'Remise globale au projet', responsable_nom: p.chef_nom,
        alloue: sit.global.alloue, justifie: sit.global.justifie, rembourse: sit.global.rembourse, a_controler: 0,
        en_attente: sit.global.en_attente, derniere_remise: sit.global.derniere_remise, jours: jours(sit.global.derniere_remise),
        statut: sit.global.en_attente > 0.004 ? 'en_attente' : 'validee',
      });
    }
    for (const a of sit.activites.filter((x) => acc.voirTout || d.responsable.includes(x.id))) {
      if (a.statut_justification === 'non_financee') continue;
      lignes.push({
        ...base, activite_id: a.id, globale: false, activite_nom: a.nom, responsable_nom: a.responsable_nom,
        alloue: a.alloue, justifie: a.justifie, rembourse: a.rembourse, a_controler: a.a_controler, en_attente: a.en_attente,
        derniere_remise: a.derniere_remise, jours: jours(a.derniere_remise),
        // Activité financée par la remise globale : ses justifications sont comptées dans la ligne globale.
        statut: a.statut_justification === 'sur_global' ? 'validee' : a.statut_justification,
        sur_global: a.statut_justification === 'sur_global',
      });
    }
  }
  const somme = (l, k) => l.reduce((s, x) => s + x[k], 0);
  const validees = lignes.filter((l) => l.statut === 'validee');
  const enAttente = lignes.filter((l) => l.statut === 'en_attente').sort((x, y) => (y.jours ?? 0) - (x.jours ?? 0));
  return {
    validees, en_attente: enAttente,
    totaux: {
      alloue: somme(lignes, 'alloue'), justifie: somme(lignes.filter((l) => !l.globale), 'justifie'), rembourse: somme(lignes, 'rembourse'),
      en_attente: somme(lignes, 'en_attente'), a_controler: somme(lignes, 'a_controler'),
      nb_validees: validees.length, nb_en_attente: enAttente.length,
    },
  };
};

/** Nombre de pièces à contrôler (pastille du menu). */
const nbAControler = async (req, d) => {
  if (!(await g.justifInstalle())) return 0;
  if (!d.validerJustificatifs && !d.chef.length) return 0;
  const [{ nb }] = await q(
    `SELECT COUNT(*)::int AS nb FROM projet_justificatifs
      WHERE tenant_id = :t AND statut = 'depose' AND depose_par IS DISTINCT FROM :u AND (:tous OR projet_id IN (:chef))`,
    { t: req.tenantId, u: req.user.id, tous: d.validerJustificatifs, chef: d.chef.length ? d.chef : [0] });
  return nb;
};

module.exports = { lister, deposer, decider, annuler, supprimer, fichier, aControler, bilan, nbAControler };

// src/services/commercial.service.js — Forfaits, paiements et conversion d'un
// prospect en client (réforme prospects, étape 4).
//
// Conversion (décision du 05/10/2026) : « nouvel espace propre ». Le client
// reçoit un espace NEUF ; l'espace de démo est archivé (fermé, données
// conservées, rien n'est supprimé). Le compte de connexion du prospect est
// transféré dans le nouvel espace : il garde son identifiant et son mot de passe.
const crypto = require('crypto');
const { sequelize } = require('../models');
const { ErreurMetier } = require('./plateforme.service');
const pr = require('./prospects.service');
const email = require('./email.service');
const { seedRubriquesDefaut } = require('../controllers/rubriques.controller');
const { seedJournauxDefaut } = require('../controllers/journaux.controller');

const SELECT = sequelize.QueryTypes.SELECT;
const q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: SELECT, ...opts });
const ex = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, ...opts });

const METHODES = ['especes', 'virement', 'orange_money', 'mtn_momo', 'cheque', 'carte', 'autre'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const texte = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const entierOuNull = (v, nom) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new ErreurMetier(400, `${nom} : nombre entier positif attendu.`);
  return n;
};
const montantOuNull = (v, nom) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new ErreurMetier(400, `${nom} invalide.`);
  return Math.round(n * 100) / 100;
};
const date = (v, nom) => {
  const s = String(v || '').slice(0, 10);
  if (!DATE_RE.test(s) || Number.isNaN(new Date(s).getTime())) throw new ErreurMetier(400, `${nom} invalide.`);
  return s;
};
const ajouterMois = (iso, mois) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + mois);
  return d.toISOString().slice(0, 10);
};

// ── Forfaits (catalogue ; prix saisis par le super_admin) ─────────────────
const listerForfaits = ({ tous = false } = {}) => q(
  `SELECT f.*, (SELECT COUNT(*)::int FROM abonnements a WHERE a.forfait_id = f.id AND a.statut = 'actif') AS nb_abonnes
     FROM forfaits f ${tous ? '' : 'WHERE f.actif'} ORDER BY f.ordre, f.nom`);

const champsForfait = (d) => {
  const v = {
    nom: texte(d.nom, 80),
    description: texte(d.description, 1000),
    prix: montantOuNull(d.prix, 'Prix'),
    devise: texte(d.devise || 'FCFA', 10) || 'FCFA',
    duree_mois: entierOuNull(d.duree_mois, 'Durée') || 12,
    nb_utilisateurs_max: entierOuNull(d.nb_utilisateurs_max, 'Utilisateurs max'),
    nb_caisses_max: entierOuNull(d.nb_caisses_max, 'Caisses max'),
    ordre: parseInt(d.ordre, 10) || 0,
    actif: d.actif === undefined ? true : Boolean(d.actif),
  };
  if (!v.nom) throw new ErreurMetier(400, 'Le nom du forfait est obligatoire.');
  if (v.duree_mois > 120) throw new ErreurMetier(400, 'Durée maximale : 120 mois.');
  return v;
};

const creerForfait = async ({ donnees, userId }) => sequelize.transaction(async (t) => {
  const v = champsForfait(donnees);
  const base = v.nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'FORFAIT';
  let code = base;
  for (let i = 2; (await q('SELECT 1 FROM forfaits WHERE code = :code', { code }, { transaction: t })).length; i += 1) code = `${base}_${i}`;
  const [f] = await q(
    `INSERT INTO forfaits (code, nom, description, prix, devise, duree_mois, nb_utilisateurs_max, nb_caisses_max, ordre, actif)
     VALUES (:code, :nom, :description, :prix, :devise, :duree_mois, :nb_utilisateurs_max, :nb_caisses_max, :ordre, :actif)
     RETURNING *`, { ...v, code }, { transaction: t });
  await pr.auditer(t, { userId, action: 'FORFAIT_CREATION', entiteId: String(f.id), apres: v });
  return f;
});

const modifierForfait = async ({ id, donnees, userId }) => sequelize.transaction(async (t) => {
  const [avant] = await q('SELECT * FROM forfaits WHERE id = :id FOR UPDATE', { id }, { transaction: t });
  if (!avant) throw new ErreurMetier(404, 'Forfait introuvable.');
  const v = champsForfait({ ...avant, ...donnees });
  const [f] = await q(
    `UPDATE forfaits SET nom = :nom, description = :description, prix = :prix, devise = :devise, duree_mois = :duree_mois,
            nb_utilisateurs_max = :nb_utilisateurs_max, nb_caisses_max = :nb_caisses_max, ordre = :ordre, actif = :actif,
            updated_at = NOW() WHERE id = :id RETURNING *`, { ...v, id }, { transaction: t });
  // Les abonnements existants gardent leurs conditions (prix figé à la souscription).
  await pr.auditer(t, { userId, action: 'FORFAIT_MODIFICATION', entiteId: String(id),
    avant: { nom: avant.nom, prix: avant.prix, duree_mois: avant.duree_mois, actif: avant.actif }, apres: v });
  return f;
});

// ── Paiements ─────────────────────────────────────────────────────────────
const enregistrerPaiement = async ({ prospectId, donnees, userId }) => sequelize.transaction(async (t) => {
  const p = await pr.charger(prospectId, t, true);
  if (['DEMO_ANNULEE', 'PROSPECT_ABANDONNE'].includes(p.statut)) {
    throw new ErreurMetier(409, 'Prospect clôturé : rouvrez-le avant d\'enregistrer un paiement.');
  }
  const methode = String(donnees.methode || '');
  if (!METHODES.includes(methode)) throw new ErreurMetier(400, 'Méthode de paiement invalide.');
  const statut = donnees.statut === 'en_attente' ? 'en_attente' : 'recu';
  const montant = montantOuNull(donnees.montant, 'Montant');
  if (montant === null) throw new ErreurMetier(400, 'Le montant est obligatoire.');
  const forfaitId = entierOuNull(donnees.forfait_id, 'Forfait');
  if (forfaitId && !(await q('SELECT 1 FROM forfaits WHERE id = :id', { id: forfaitId }, { transaction: t })).length) {
    throw new ErreurMetier(400, 'Forfait introuvable.');
  }
  const reference = texte(donnees.reference, 100);
  if (['virement', 'orange_money', 'mtn_momo', 'cheque', 'carte'].includes(methode) && !reference) {
    throw new ErreurMetier(400, 'La référence de la transaction est obligatoire pour ce mode de paiement.');
  }
  let pa;
  try {
    [pa] = await q(
      `INSERT INTO paiements (prospect_id, tenant_id, forfait_id, montant, devise, date_paiement, methode, reference, statut, notes, created_by)
       VALUES (:pid, :tid, :fid, :montant, :devise, :date, :methode, :reference, :statut, :notes, :userId) RETURNING *`,
      { pid: prospectId, tid: p.client_tenant_id || null, fid: forfaitId, montant, devise: texte(donnees.devise || 'FCFA', 10) || 'FCFA',
        date: date(donnees.date_paiement, 'Date de paiement'), methode, reference, statut, notes: texte(donnees.notes, 1000), userId },
      { transaction: t });
  } catch (err) {
    if (/uq_paiements_reference/.test(err.message || '') || err.parent?.constraint === 'uq_paiements_reference') {
      throw new ErreurMetier(409, 'Cette référence de transaction est déjà enregistrée.');
    }
    throw err;
  }
  let nouveau = p.statut;
  if (['PROSPECT', 'INVITATION_ENVOYEE', 'DEMO_ACTIVE', 'DEMO_EXPIREE'].includes(p.statut)) nouveau = 'PAIEMENT_EN_ATTENTE';
  if (nouveau !== p.statut) {
    await ex('UPDATE prospects SET statut = :s, demande_traitee = true, updated_at = NOW() WHERE id = :id', { s: nouveau, id: prospectId }, { transaction: t });
  }
  await pr.historiser(t, { prospectId, ancien: p.statut, nouveau, action: 'PAIEMENT_ENREGISTRE', userId,
    details: { montant, devise: pa.devise, methode, reference, statut } });
  await pr.auditer(t, { tenantId: p.client_tenant_id || null, userId, action: 'PAIEMENT_ENREGISTRE', entiteId: prospectId,
    apres: { paiement: pa.id, montant, methode, reference, statut } });
  return pa;
});

const changerStatutPaiement = async ({ id, statut, motif, userId }) => sequelize.transaction(async (t) => {
  if (!['recu', 'annule'].includes(statut)) throw new ErreurMetier(400, 'Statut de paiement invalide.');
  const [pa] = await q('SELECT * FROM paiements WHERE id = :id FOR UPDATE', { id }, { transaction: t });
  if (!pa) throw new ErreurMetier(404, 'Paiement introuvable.');
  if (pa.statut === statut) return pa;
  if (pa.statut === 'annule') throw new ErreurMetier(409, 'Un paiement annulé ne peut plus être modifié.');
  if (statut === 'annule' && pa.abonnement_id) throw new ErreurMetier(409, 'Ce paiement est rattaché à un abonnement : annulation impossible ici.');
  if (statut === 'annule' && !texte(motif)) throw new ErreurMetier(400, 'Le motif d\'annulation est obligatoire.');
  const [maj] = await q('UPDATE paiements SET statut = :statut, updated_at = NOW() WHERE id = :id RETURNING *', { statut, id }, { transaction: t });
  if (pa.prospect_id) {
    await pr.historiser(t, { prospectId: pa.prospect_id, action: statut === 'recu' ? 'PAIEMENT_RECU' : 'PAIEMENT_ANNULE',
      motif: texte(motif, 300), userId, details: { paiement: id, montant: pa.montant, reference: pa.reference } });
  }
  await pr.auditer(t, { tenantId: pa.tenant_id, userId, action: statut === 'recu' ? 'PAIEMENT_RECU' : 'PAIEMENT_ANNULE',
    entiteId: id, avant: { statut: pa.statut }, apres: { statut, motif: texte(motif, 300) } });
  return maj;
});

// ── Conversion en client ──────────────────────────────────────────────────
const slugLibre = async (nom, t) => {
  const base = nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'client';
  let slug = base;
  while ((await q('SELECT 1 FROM tenants WHERE slug = :slug', { slug }, { transaction: t })).length) {
    slug = `${base}-${crypto.randomBytes(2).toString('hex')}`;
  }
  return slug;
};

const convertir = async ({ id, donnees, userId }) => {
  const r = await sequelize.transaction(async (t) => {
    const p = await pr.charger(id, t, true);
    if (!['PROSPECT', 'INVITATION_ENVOYEE', 'DEMO_ACTIVE', 'DEMO_EXPIREE', 'PAIEMENT_EN_ATTENTE'].includes(p.statut)) {
      throw new ErreurMetier(409, `Conversion impossible au statut ${p.statut}.`);
    }
    // Paiement reçu, non encore rattaché à un abonnement : condition de la conversion.
    const [paiement] = await q(
      `SELECT * FROM paiements WHERE prospect_id = :id AND statut = 'recu' AND abonnement_id IS NULL
         AND (CAST(:pid AS uuid) IS NULL OR id = CAST(:pid AS uuid))
       ORDER BY date_paiement DESC, created_at DESC LIMIT 1 FOR UPDATE`,
      { id, pid: donnees.paiement_id || null }, { transaction: t });
    if (!paiement) throw new ErreurMetier(409, 'Enregistrez d\'abord un paiement reçu (ou confirmez la réception d\'un paiement en attente).');

    const forfaitId = entierOuNull(donnees.forfait_id || paiement.forfait_id, 'Forfait');
    const [forfait] = forfaitId ? await q('SELECT * FROM forfaits WHERE id = :id', { id: forfaitId }, { transaction: t }) : [];
    if (!forfait) throw new ErreurMetier(400, 'Choisissez le forfait souscrit.');
    const debut = date(donnees.date_debut || new Date().toISOString(), 'Date de début d\'abonnement');
    const fin = donnees.date_fin ? date(donnees.date_fin, 'Date de fin d\'abonnement') : ajouterMois(debut, forfait.duree_mois);
    if (fin <= debut) throw new ErreurMetier(400, 'La fin de l\'abonnement doit être postérieure au début.');
    const nom = texte(donnees.nom || p.entreprise || p.nom_complet, 120);
    if (!nom) throw new ErreurMetier(400, 'Nom du client obligatoire.');
    const devise = texte(donnees.devise || 'FCFA', 10) || 'FCFA';

    // 1. Espace client NEUF (mêmes étapes que la création manuelle d'un client).
    const slug = await slugLibre(nom, t);
    const [tenant] = await q(
      `INSERT INTO tenants (slug, nom, devise, contact_nom, contact_email, contact_telephone, pays, ville)
       VALUES (:slug, :nom, :devise, :cnom, :cmail, :ctel, :pays, :ville) RETURNING id`,
      { slug, nom, devise, cnom: p.nom_complet, cmail: p.email, ctel: p.telephone, pays: p.pays, ville: p.ville }, { transaction: t });
    await seedRubriquesDefaut(tenant.id, { transaction: t });
    await seedJournauxDefaut(tenant.id, { transaction: t });
    const [fn] = await q("SELECT 1 AS ok FROM pg_proc WHERE proname = 'plan_client_initialiser'", {}, { transaction: t });
    if (fn) await q('SELECT plan_client_initialiser(:id, NULL, :userId)', { id: tenant.id, userId }, { transaction: t });
    await ex(
      `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
       VALUES (:id, :userId, 'CREATION_CLIENT', 'plateforme', :id, CAST(:v AS jsonb))`,
      { id: tenant.id, userId, v: JSON.stringify({ nom, slug, origine: 'conversion prospect', prospect: id }) }, { transaction: t });

    // 2. Abonnement (conditions figées) et rattachement du paiement.
    const [abo] = await q(
      `INSERT INTO abonnements (tenant_id, prospect_id, forfait_id, forfait_nom, prix, devise, date_debut, date_fin, conditions, notes, created_by)
       VALUES (:tid, :pid, :fid, :fnom, :prix, :devise, :debut, :fin, :conditions, :notes, :userId) RETURNING *`,
      { tid: tenant.id, pid: id, fid: forfait.id, fnom: forfait.nom, prix: forfait.prix, devise: forfait.devise,
        debut, fin, conditions: texte(donnees.conditions, 2000), notes: texte(donnees.notes, 2000), userId }, { transaction: t });
    await ex('UPDATE paiements SET tenant_id = :tid, abonnement_id = :aid, updated_at = NOW() WHERE id = :id',
      { tid: tenant.id, aid: abo.id, id: paiement.id }, { transaction: t });
    // Autres paiements du prospect : rattachés au client pour l'historique.
    await ex('UPDATE paiements SET tenant_id = :tid WHERE prospect_id = :pid AND tenant_id IS NULL', { tid: tenant.id, pid: id }, { transaction: t });

    // 3. Compte du prospect transféré (même identifiant, même mot de passe).
    let compteTransfere = false;
    if (p.user_id && donnees.transferer_compte !== false) {
      const [u] = await q('SELECT id, actif, username FROM users WHERE id = :u', { u: p.user_id }, { transaction: t });
      const [act] = await q('SELECT 1 FROM prospect_invitations WHERE prospect_id = :id AND utilise_le IS NOT NULL LIMIT 1', { id }, { transaction: t });
      if (u && act) {
        await ex('UPDATE users SET tenant_id = :tid, actif = true WHERE id = :u', { tid: tenant.id, u: u.id }, { transaction: t });
        compteTransfere = true;
      }
    }

    // 4. Espace de démo archivé : fermé, données conservées, rien de supprimé.
    if (p.tenant_id) {
      await ex(`UPDATE tenants SET type_compte = 'demo_archive', actif = false, suspension_motif = 'Converti en client',
                  donnees_conservees_jusqu_au = NOW() + make_interval(days => :j) WHERE id = :tid`,
      { tid: p.tenant_id, j: pr.CONSERVATION_JOURS }, { transaction: t });
      await ex('UPDATE users SET actif = false WHERE tenant_id = :tid', { tid: p.tenant_id }, { transaction: t });
    }
    await ex(`UPDATE prospect_invitations SET annule_le = NOW() WHERE prospect_id = :id AND utilise_le IS NULL AND annule_le IS NULL`,
      { id }, { transaction: t });
    await ex(`UPDATE prospects SET statut = 'CLIENT_ACTIF', client_tenant_id = :tid, demande_traitee = true, updated_at = NOW()
               WHERE id = :id`, { tid: tenant.id, id }, { transaction: t });
    const details = { client: nom, slug, forfait: forfait.nom, debut, fin, paiement: paiement.id, compte_transfere: compteTransfere };
    await pr.historiser(t, { prospectId: id, ancien: p.statut, nouveau: 'CLIENT_ACTIF', action: 'CONVERSION', userId, details });
    await pr.auditer(t, { tenantId: tenant.id, userId, action: 'CONVERSION_CLIENT', entiteId: id, apres: details });
    return { p, tenantId: tenant.id, nom, abo, compteTransfere };
  });

  const envoi = await email.sendBienvenueClient({
    to: r.p.email, nom: r.p.nom_complet || r.p.entreprise, client: r.nom, forfait: r.abo.forfait_nom,
    debut: r.abo.date_debut, fin: r.abo.date_fin, compteTransfere: r.compteTransfere,
    lien: (process.env.APP_URL || '').split(',')[0].trim(),
  });
  return { tenant_id: r.tenantId, abonnement: r.abo, compte_transfere: r.compteTransfere, statut_email: envoi.statut, erreur_email: envoi.erreur || '' };
};

// ── Tâche quotidienne : abonnements arrivés à échéance ────────────────────
// Marque « expiré » sans couper l'accès du client (décision au cabinet).
const abonnementsEchus = async () => {
  const echus = await q(
    `UPDATE abonnements a SET statut = 'expire' FROM tenants t
      WHERE t.id = a.tenant_id AND a.statut = 'actif' AND a.date_fin < CURRENT_DATE
      RETURNING a.id, a.forfait_nom, a.date_fin, t.nom AS client`);
  const bientot = await q(
    `SELECT a.forfait_nom, a.date_fin, t.nom AS client FROM abonnements a JOIN tenants t ON t.id = a.tenant_id
      WHERE a.statut = 'actif' AND a.date_fin = CURRENT_DATE + 15`);
  return { echus, bientot };
};

module.exports = {
  METHODES, listerForfaits, creerForfait, modifierForfait, enregistrerPaiement, changerStatutPaiement, convertir, abonnementsEchus,
};

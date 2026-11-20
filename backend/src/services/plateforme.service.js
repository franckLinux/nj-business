// src/services/plateforme.service.js
// Administration PLATEFORME (réforme, étape 8) — super_admin uniquement.
// Vue administrative et technique des clients : AUCUNE donnée de transaction
// (montants, mouvements, budgets) n'est lue ici.
const { sequelize } = require('../models');
const support = require('./support.service');

const SELECT = sequelize.QueryTypes.SELECT;
class ErreurMetier extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const ACTIONS_PLATEFORME = [
  'CREATION_CLIENT', 'MODIF_CLIENT', 'SUSPENSION_CLIENT', 'REACTIVATION_CLIENT',
  'SUPPORT_OUVERT', 'SUPPORT_FERME', 'INIT_PLAN_COMPTABLE', 'SYNC_PLAN_COMPTABLE', 'ROLES_CLIENT',
  'MODULE_ACTIVATION', 'MODULE_DESACTIVATION',   // 048 : modules NJ BUSINESS par client
  'SUPPRESSION_CLIENT',                            // suppression définitive d'un client vide
];

const journaliser = (t, { tenantId, userId, action, avant, apres }) => sequelize.query(
  `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
   VALUES (:tenantId, :userId, :action, 'plateforme', :tenantId, CAST(:avant AS jsonb), CAST(:apres AS jsonb))`,
  { replacements: { tenantId, userId, action, avant: avant ? JSON.stringify(avant) : null, apres: apres ? JSON.stringify(apres) : null },
    transaction: t, type: sequelize.QueryTypes.INSERT }
);

const SQL_CLIENTS = `
  SELECT t.id, t.nom, t.slug, t.actif, t.suspension_motif, t.created_at, t.devise, t.type_compte, t.demo_expire_le,
         t.contact_nom, t.contact_email, t.contact_telephone, t.pays, t.ville,
         COALESCE(NULLIF(t.contact_nom, ''), NULLIF(t.dirigeant_nom, ''), NULLIF(t.directeur_nom, '')) AS responsable,
         v.code AS plan_version, t.plan_initialise_le, t.plan_derniere_synchro, t.plan_derniere_modif,
         (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS nb_utilisateurs,
         (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id AND u.actif) AS nb_utilisateurs_actifs,
         (SELECT MAX(u.derniere_connexion) FROM users u WHERE u.tenant_id = t.id) AS dernier_acces,
         (SELECT COALESCE(json_agg(DISTINCT u.role), '[]') FROM users u WHERE u.tenant_id = t.id) AS roles,
         (SELECT COUNT(*)::int FROM journaux j WHERE j.tenant_id = t.id AND j.actif) AS nb_journaux,
         (SELECT id FROM plan_modele_versions WHERE statut = 'publiee' LIMIT 1) AS version_publiee_id,
         t.plan_modele_version_id,
         (SELECT row_to_json(x) FROM (SELECT a.forfait_nom, a.date_fin, a.statut FROM abonnements a
            WHERE a.tenant_id = t.id ORDER BY a.date_fin DESC LIMIT 1) x) AS abonnement
    FROM tenants t
    LEFT JOIN plan_modele_versions v ON v.id = t.plan_modele_version_id`;

const alertes = (c) => {
  const a = [];
  if (!c.actif) a.push('Client suspendu');
  if (!c.plan_initialise_le) a.push('Plan comptable non initialisé');
  else if (c.plan_modele_version_id !== c.version_publiee_id) a.push('Plan comptable en retard sur le modèle');
  if (c.abonnement && c.abonnement.statut === 'expire') a.push('Abonnement échu');
  if (c.nb_utilisateurs_actifs === 0) a.push('Aucun utilisateur actif');
  if (!c.dernier_acces) a.push('Aucune connexion enregistrée');
  else if (Date.now() - new Date(c.dernier_acces).getTime() > 30 * 86400000) a.push('Aucune connexion depuis 30 jours');
  return a;
};

const listerClients = async () => {
  const rows = await sequelize.query(`${SQL_CLIENTS} ORDER BY t.nom`, { type: SELECT });
  const clients = rows.map((c) => ({ ...c, alertes: alertes(c) }));
  return {
    stats: {
      clients: clients.length,
      actifs: clients.filter((c) => c.actif).length,
      utilisateurs: clients.reduce((s, c) => s + c.nb_utilisateurs, 0),
      avec_alertes: clients.filter((c) => c.alertes.length).length,
    },
    clients,
  };
};

const detailClient = async (tenantId) => {
  const [c] = await sequelize.query(`${SQL_CLIENTS} WHERE t.id = :tenantId`, { replacements: { tenantId }, type: SELECT });
  if (!c) throw new ErreurMetier(404, 'Client introuvable.');
  const [utilisateurs, profils, syncs] = await Promise.all([
    sequelize.query(
      `SELECT u.id, u.username, u.email, u.role, u.actif, u.derniere_connexion, u.created_at, r.nom AS profil
         FROM users u LEFT JOIN roles r ON r.id = u.custom_role_id
        WHERE u.tenant_id = :tenantId ORDER BY u.role, u.username`,
      { replacements: { tenantId }, type: SELECT }),
    sequelize.query(
      `SELECT r.id, r.nom, (SELECT COUNT(*)::int FROM users u WHERE u.custom_role_id = r.id) AS nb_utilisateurs
         FROM roles r WHERE r.tenant_id = :tenantId ORDER BY r.nom`,
      { replacements: { tenantId }, type: SELECT }),
    sequelize.query(
      `SELECT s.created_at, vs.code AS version_source, vc.code AS version_cible, s.nb_appliques, s.nb_proposes
         FROM plan_synchronisations s
         LEFT JOIN plan_modele_versions vs ON vs.id = s.version_source
         LEFT JOIN plan_modele_versions vc ON vc.id = s.version_cible
        WHERE s.tenant_id = :tenantId ORDER BY s.created_at DESC LIMIT 10`,
      { replacements: { tenantId }, type: SELECT }),
  ]);
  return { client: { ...c, alertes: alertes(c) }, utilisateurs, profils, synchronisations: syncs };
};

const CHAMPS = ['nom', 'contact_nom', 'contact_email', 'contact_telephone', 'pays', 'ville', 'adresse', 'devise'];

const modifierClient = async ({ tenantId, userId, champs }) => sequelize.transaction(async (t) => {
  const [c] = await sequelize.query(`SELECT ${CHAMPS.join(', ')} FROM tenants WHERE id = :tenantId FOR UPDATE`,
    { replacements: { tenantId }, type: SELECT, transaction: t });
  if (!c) throw new ErreurMetier(404, 'Client introuvable.');
  const n = {};
  for (const k of CHAMPS) n[k] = champs[k] !== undefined ? String(champs[k] ?? '').trim() : (c[k] ?? '');
  if (!n.nom) throw new ErreurMetier(400, 'Le nom du client est obligatoire.');
  if (n.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n.contact_email)) throw new ErreurMetier(400, 'Adresse e-mail invalide.');
  if (!n.devise) n.devise = 'FCFA';
  await sequelize.query(
    `UPDATE tenants SET ${CHAMPS.map((k) => `${k} = :${k}`).join(', ')}, updated_at = NOW() WHERE id = :tenantId`,
    { replacements: { tenantId, ...n }, transaction: t, type: sequelize.QueryTypes.UPDATE });
  const avant = {}; const apres = {};
  for (const k of CHAMPS) if ((c[k] ?? '') !== n[k]) { avant[k] = c[k]; apres[k] = n[k]; }
  if (Object.keys(apres).length) await journaliser(t, { tenantId, userId, action: 'MODIF_CLIENT', avant, apres });
  return { id: tenantId, ...n };
});

/** Suspension / réactivation : un client suspendu ne peut plus se connecter à ses données (tenantGuard). */
const changerActif = async ({ tenantId, userId, actif, motif }) => sequelize.transaction(async (t) => {
  if (!actif && String(motif || '').trim().length < 5) throw new ErreurMetier(400, 'Indiquez le motif de la suspension.');
  const [c] = await sequelize.query('SELECT actif FROM tenants WHERE id = :tenantId FOR UPDATE',
    { replacements: { tenantId }, type: SELECT, transaction: t });
  if (!c) throw new ErreurMetier(404, 'Client introuvable.');
  await sequelize.query('UPDATE tenants SET actif = :actif, suspension_motif = :motif, updated_at = NOW() WHERE id = :tenantId',
    { replacements: { tenantId, actif: Boolean(actif), motif: actif ? '' : String(motif).trim() }, transaction: t, type: sequelize.QueryTypes.UPDATE });
  await journaliser(t, { tenantId, userId, action: actif ? 'REACTIVATION_CLIENT' : 'SUSPENSION_CLIENT',
    avant: { actif: c.actif }, apres: { actif: Boolean(actif), motif: actif ? undefined : String(motif).trim() } });
  return { id: tenantId, actif: Boolean(actif) };
});

// ── Suppression définitive d'un client (ajouté manuellement, jamais utilisé) ──
// Garde-fous, tous vérifiés DANS la transaction de suppression :
//   1. le client est suspendu (deux gestes distincts : suspendre, puis supprimer) ;
//   2. aucune donnée comptable ou de gestion (écritures, attentes, budgets, arrêtés…) :
//      les pièces de caisse se conservent (OHADA) — un client qui a travaillé se
//      suspend, il ne se supprime pas ;
//   3. aucun lien commercial (prospect / démo, abonnement, paiement) : ces clients
//      relèvent de l'écran Prospects ;
//   4. aucun compte du cabinet (super_admin, comptable cabinet) rattaché ;
//   5. l'administrateur retape l'identifiant (slug) du client.
// Seul le paramétrage créé avec le client (rubriques, caisses, plan comptable,
// utilisateurs, modules, permissions…) disparaît. Le journal d'audit est conservé :
// ses lignes sont détachées du client et la suppression y est tracée.
const DONNEES_METIER = [
  ['journal', 'écriture(s) de caisse'], ['mouvements_attente', 'dépense(s) en attente'],
  ['arrets_caisse', 'arrêté(s) de caisse'], ['budget', 'ligne(s) de budget'],
  ['budget_validation', 'validation(s) de budget'], ['budget_caisse', 'budget(s) de caisse'],
  ['appel_fonds', 'demande(s) de fonds'], ['depenses_attente', 'prévision(s) de dépense'],
  ['ressources_attente', 'prévision(s) de ressource'], ['demandes_depassement', 'demande(s) de dépassement'],
  ['banque', 'opération(s) bancaire(s)'], ['ran', 'report(s) à nouveau'], ['inventaires', 'inventaire(s)'],
  ['registre_tiers', 'tiers'], ['pieces_jointes', 'pièce(s) jointe(s)'], ['exports_sage', 'export(s) Sage'],
  ['controles_pieces', 'contrôle(s) de pièces'], ['controles_anomalies', 'anomalie(s) de contrôle'],
  ['controles_arrets', 'contrôle(s) d\'arrêté'],
  // NJ COMMERCIAL (050) : un client qui a commencé à travailler ne se supprime plus.
  ['com_articles', 'article(s)'], ['com_stock_mouvements', 'mouvement(s) de stock'], ['com_demandes', 'demande(s) d\'achat'],
  // Projets des ONG / associations (069).
  ['projet_budgets', 'budget(s) de projet'], ['journal_imputations_projet', 'financement(s) imputé(s) à un projet'],
  ['projet_justificatifs', 'justificatif(s) de projet'],
];
const LIENS_COMMERCIAUX = [
  ['prospects', 'fiche prospect / espace de démonstration'], ['abonnements', 'abonnement(s)'],
  ['paiements', 'paiement(s)'], ['demandes_annulation', 'demande(s) d\'annulation'],
];

const bilanSuppression = async (tenantId, transaction) => {
  const opts = { replacements: { tenantId }, type: SELECT, transaction };
  const [c] = await sequelize.query(
    `SELECT id, nom, slug, actif, created_at FROM tenants WHERE id = :tenantId${transaction ? ' FOR UPDATE' : ''}`, opts);
  if (!c) throw new ErreurMetier(404, 'Client introuvable.');
  // Tables présentes dans CETTE base (une migration manquante ne doit pas tout bloquer).
  const presentes = new Set((await sequelize.query(
    `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
    { type: SELECT, transaction })).map((r) => r.table_name));
  const compter = async (liste) => {
    const out = [];
    for (const [table, libelle] of liste) {
      if (!presentes.has(table)) continue;
      const [{ n }] = await sequelize.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE tenant_id = :tenantId`, opts);
      if (n > 0) out.push({ table, libelle, n });
    }
    return out;
  };
  const donnees = await compter(DONNEES_METIER);
  const liens = await compter(LIENS_COMMERCIAUX);
  const cabinet = await sequelize.query(
    `SELECT username, role FROM users WHERE tenant_id = :tenantId AND role IN ('super_admin', 'comptable_cabinet')`, opts);
  const [{ n: nbUsers }] = await sequelize.query('SELECT COUNT(*)::int AS n FROM users WHERE tenant_id = :tenantId', opts);

  const raisons = [];
  if (c.actif) raisons.push('Le client est actif : suspendez-le d\'abord.');
  if (donnees.length) raisons.push(`Le client contient des données : ${donnees.map((d) => `${d.n} ${d.libelle}`).join(', ')}. `
    + 'Un client qui a travaillé se suspend, il ne se supprime pas (conservation des pièces comptables).');
  if (liens.length) raisons.push(`Client issu du circuit commercial (${liens.map((d) => `${d.n} ${d.libelle}`).join(', ')}) : `
    + 'gérez-le depuis l\'écran Prospects / abonnements.');
  if (cabinet.length) raisons.push(`Comptes du cabinet rattachés : ${cabinet.map((u) => u.username).join(', ')}.`);
  return {
    client: { id: c.id, nom: c.nom, slug: c.slug, actif: c.actif, created_at: c.created_at },
    nb_utilisateurs: nbUsers, donnees, liens, supprimable: raisons.length === 0, raisons,
  };
};

const supprimerClient = async ({ tenantId, userId, confirmation, motif }) => {
  try {
    return await sequelize.transaction(async (t) => {
      const b = await bilanSuppression(tenantId, t);
      if (!b.supprimable) throw new ErreurMetier(409, b.raisons.join(' '));
      if (String(confirmation || '').trim().toLowerCase() !== String(b.client.slug).toLowerCase()) {
        throw new ErreurMetier(400, `Confirmation incorrecte : tapez exactement l'identifiant « ${b.client.slug} ».`);
      }
      if (String(motif || '').trim().length < 5) throw new ErreurMetier(400, 'Indiquez le motif de la suppression.');
      const ex = (sql) => sequelize.query(sql, { replacements: { tenantId }, transaction: t });
      const users = await sequelize.query('SELECT username, role FROM users WHERE tenant_id = :tenantId ORDER BY username',
        { replacements: { tenantId }, type: SELECT, transaction: t });
      // Le journal d'audit survit au client : on détache ses lignes avant la cascade.
      await ex('UPDATE audit_log SET user_id = NULL WHERE user_id IN (SELECT id FROM users WHERE tenant_id = :tenantId)');
      await ex('UPDATE audit_log SET tenant_id = NULL WHERE tenant_id = :tenantId');
      await ex('DELETE FROM tenant_modules WHERE tenant_id = :tenantId');   // FK sans cascade (048)
      await ex('DELETE FROM tenants WHERE id = :tenantId');                  // cascade : paramétrage du client
      await sequelize.query(
        `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
         VALUES (NULL, :userId, 'SUPPRESSION_CLIENT', 'plateforme', :tenantId, CAST(:avant AS jsonb), CAST(:apres AS jsonb))`,
        { replacements: { tenantId, userId, avant: JSON.stringify({
            nom: b.client.nom, slug: b.client.slug, cree_le: b.client.created_at, utilisateurs: users.map((u) => `${u.username} (${u.role})`) }),
          apres: JSON.stringify({ client: b.client.nom, motif: String(motif).trim() }) },
          transaction: t, type: sequelize.QueryTypes.INSERT });
      return { ok: true, supprime: { id: tenantId, nom: b.client.nom, slug: b.client.slug } };
    });
  } catch (err) {
    if (err instanceof ErreurMetier) throw err;
    // Un trigger de protection ou une référence inattendue : RIEN n'a été supprimé (transaction annulée).
    console.error('[Plateforme] suppression client :', err.message);
    throw new ErreurMetier(409, `Suppression refusée par la base, rien n'a été supprimé : ${err.message}`);
  }
};

const journalAudit = (tenantId) => sequelize.query(
  `SELECT a.created_at, a.action, a.ancienne_valeur, a.nouvelle_valeur, u.username,
          COALESCE(t.nom, a.ancienne_valeur->>'nom') AS client
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN tenants t ON t.id = a.tenant_id
    WHERE a.action IN (:actions)
      AND (CAST(:tenantId AS uuid) IS NULL OR a.tenant_id = CAST(:tenantId AS uuid))
    ORDER BY a.created_at DESC, a.id DESC LIMIT 200`,
  { replacements: { actions: ACTIONS_PLATEFORME, tenantId: tenantId || null }, type: SELECT }
);

// ── Accès support ─────────────────────────────────────────────────────────
const ouvrirSupport = async ({ tenantId, userId, motif, dureeMinutes }) => sequelize.transaction(async (t) => {
  motif = String(motif || '').trim();
  const duree = Number.parseInt(dureeMinutes, 10);
  if (motif.length < 10) throw new ErreurMetier(400, 'Le motif doit faire au moins 10 caractères (ex. « Correction RAN demandée par le directeur »).');
  if (!(duree >= 5 && duree <= support.DUREE_MAX_MIN)) throw new ErreurMetier(400, `Durée invalide (5 à ${support.DUREE_MAX_MIN} minutes).`);
  const [c] = await sequelize.query('SELECT id, nom FROM tenants WHERE id = :tenantId', { replacements: { tenantId }, type: SELECT, transaction: t });
  if (!c) throw new ErreurMetier(404, 'Client introuvable.');
  // Une seule session ouverte par administrateur et par client.
  await sequelize.query(
    'UPDATE support_acces SET revoque_le = NOW() WHERE user_id = :userId AND tenant_id = :tenantId AND revoque_le IS NULL AND expire_le > NOW()',
    { replacements: { userId, tenantId }, transaction: t, type: sequelize.QueryTypes.UPDATE });
  const [s] = await sequelize.query(
    `INSERT INTO support_acces (tenant_id, user_id, motif, expire_le)
     VALUES (:tenantId, :userId, :motif, NOW() + make_interval(mins => :duree))
     RETURNING id, debut, expire_le`,
    { replacements: { tenantId, userId, motif, duree }, type: SELECT, transaction: t });
  await journaliser(t, { tenantId, userId, action: 'SUPPORT_OUVERT', apres: { session: s.id, motif, duree_minutes: duree, expire_le: s.expire_le } });
  return { ...s, tenant_id: tenantId, client: c.nom, motif };
});

const fermerSupport = async ({ id, userId }) => sequelize.transaction(async (t) => {
  const [s] = await sequelize.query(
    `UPDATE support_acces SET revoque_le = NOW()
      WHERE id = :id AND user_id = :userId AND revoque_le IS NULL RETURNING id, tenant_id`,
    { replacements: { id, userId }, type: SELECT, transaction: t });
  if (!s) throw new ErreurMetier(404, 'Accès support introuvable ou déjà fermé.');
  await journaliser(t, { tenantId: s.tenant_id, userId, action: 'SUPPORT_FERME', apres: { session: s.id } });
  return { id: s.id, ferme: true };
});

const mesSessions = (userId) => sequelize.query(
  `SELECT s.id, s.tenant_id, t.nom AS client, s.motif, s.debut, s.expire_le
     FROM support_acces s JOIN tenants t ON t.id = s.tenant_id
    WHERE s.user_id = :userId AND s.revoque_le IS NULL AND s.expire_le > NOW()
    ORDER BY s.expire_le DESC`,
  { replacements: { userId }, type: SELECT }
);

module.exports = {
  ErreurMetier, listerClients, detailClient, modifierClient, changerActif, journalAudit,
  bilanSuppression, supprimerClient,
  ouvrirSupport, fermerSupport, mesSessions,
};

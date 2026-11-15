// src/services/plan_synchro.service.js
// Synchronisation du modèle global vers le plan d'un client (réforme, étape 7).
//
// JAMAIS automatique : l'administrateur plateforme demande un APERÇU, choisit
// les changements, puis confirme. Règles appliquées :
//   - les comptes ajoutés par le client (origine 'client') ne sont jamais
//     modifiés ni supprimés ;
//   - rien n'est supprimé physiquement ; aucun numéro de compte n'est changé ;
//   - les mouvements de caisse et rubriques ne sont jamais touchés ;
//   - un compte que le client a personnalisé n'est écrasé que si
//     l'administrateur coche explicitement « écraser » (conflit) ;
//   - un choix du client (libellé, statut) que le modèle n'a pas fait évoluer
//     entre la version du client et la version cible est respecté (rien proposé) ;
//   - application dans UNE transaction par client : tout ou rien ;
//   - journal : plan_synchronisations (avant/après de chaque changement) +
//     audit_log du client.
const { sequelize } = require('../models');

const SELECT = sequelize.QueryTypes.SELECT;
const CHAMPS = ['intitule', 'description', 'classe', 'nature'];

class ErreurMetier extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const versionCible = async (versionId, t) => {
  const [v] = await sequelize.query(
    versionId
      ? "SELECT id, code, libelle, statut FROM plan_modele_versions WHERE id = :v AND statut <> 'brouillon'"
      : "SELECT id, code, libelle, statut FROM plan_modele_versions WHERE statut = 'publiee' LIMIT 1",
    { replacements: { v: versionId || null }, type: SELECT, transaction: t }
  );
  if (!v) throw new ErreurMetier(404, 'Version du modèle introuvable ou non publiée.');
  return v;
};

const lireClient = async (tenantId, t) => {
  const [c] = await sequelize.query(
    `SELECT t.id, t.nom, t.actif, t.plan_modele_version_id, t.plan_initialise_le, t.plan_derniere_synchro,
            t.plan_referentiel, v.code AS version_code
       FROM tenants t LEFT JOIN plan_modele_versions v ON v.id = t.plan_modele_version_id
      WHERE t.id = :tenantId`,
    { replacements: { tenantId }, type: SELECT, transaction: t }
  );
  if (!c) throw new ErreurMetier(404, 'Client introuvable.');
  return c;
};

/** Liste des clients avec leur version et l'écart avec la version publiée. */
const listerClients = async () => {
  const v = await versionCible(null);
  const clients = await sequelize.query(
    `SELECT t.id, t.nom, t.actif, t.plan_modele_version_id, v.code AS version_code, t.plan_referentiel,
            t.plan_initialise_le, t.plan_derniere_synchro, t.plan_derniere_modif,
            (SELECT COUNT(*)::int FROM plan_comptable_client c WHERE c.tenant_id = t.id AND c.origine = 'client') AS nb_comptes_client,
            (SELECT COUNT(*)::int FROM plan_comptable_client c WHERE c.tenant_id = t.id AND c.personnalise) AS nb_personnalises
       FROM tenants t LEFT JOIN plan_modele_versions v ON v.id = t.plan_modele_version_id
      ORDER BY t.nom`,
    { type: SELECT }
  );
  // 060 : un client SYCEBNL ne suit pas le modèle SYSCOHADA (hors synchronisation).
  return { version_publiee: v, clients: clients.map((c) => ({ ...c,
    hors_synchro: c.plan_referentiel === 'SYCEBNL',
    a_jour: c.plan_referentiel === 'SYCEBNL' || c.plan_modele_version_id === v.id })) };
};

/**
 * Calcule les changements proposés pour un client vers une version.
 * Chaque élément : { cle, compte_id, compte, type, conflit, motif, avant, apres, utilise }
 *   type : ajout | modification | archivage | desactivation | reactivation | lier
 */
const calculer = async (tenantId, versionId, t) => {
  const client = await lireClient(tenantId, t);
  if (client.plan_referentiel === 'SYCEBNL') {
    throw new ErreurMetier(409, `${client.nom} applique le SYCEBNL (association / ONG) : la synchronisation avec le modèle SYSCOHADA ne s'applique pas à son plan.`);
  }
  const v = await versionCible(versionId, t);
  if (!client.plan_initialise_le) {
    return { client, version: v, initialisation: true, changements: [] };
  }
  const rows = await sequelize.query(
    `WITH s AS (SELECT * FROM plan_modele_version_comptes WHERE version_id = :v),
          b AS (SELECT * FROM plan_modele_version_comptes WHERE version_id = :base),
          c AS (SELECT * FROM plan_comptable_client WHERE tenant_id = :t)
     SELECT s.compte_id, s.compte, s.intitule, s.description, s.classe, s.nature, s.statut,
            c.id AS c_id, c.compte AS c_compte, c.intitule AS c_intitule, c.description AS c_description,
            c.classe AS c_classe, c.nature AS c_nature, c.statut AS c_statut, c.personnalise AS c_personnalise,
            b.compte_id IS NOT NULL AS b_existe, b.intitule AS b_intitule, b.description AS b_description,
            b.classe AS b_classe, b.nature AS b_nature, b.statut AS b_statut,
            h.id AS h_id, h.compte AS h_compte, h.intitule AS h_intitule, h.origine AS h_origine,
            plan_client_est_utilise(:t, COALESCE(c.compte, s.compte)) AS utilise
       FROM s
       LEFT JOIN c ON c.modele_compte_id = s.compte_id
       LEFT JOIN b ON b.compte_id = s.compte_id
       LEFT JOIN LATERAL (
         SELECT h.id, h.compte, h.intitule, h.origine FROM plan_comptable_client h
          WHERE h.tenant_id = :t AND lower(btrim(h.compte)) = lower(btrim(s.compte))
            AND c.id IS NULL
          LIMIT 1) h ON true
      ORDER BY s.compte`,
    { replacements: { v: v.id, base: client.plan_modele_version_id || null, t: tenantId }, type: SELECT, transaction: t }
  );

  const changements = [];
  const pousser = (r, type, extra = {}) => changements.push({
    cle: `${r.compte_id}:${type}`, compte_id: Number(r.compte_id), compte: r.compte, type,
    conflit: false, motif: '', utilise: r.utilise, ...extra,
  });

  for (const r of rows) {
    if (!r.c_id) {
      if (r.statut === 'archive') continue;
      if (r.h_id) {
        pousser(r, 'lier', {
          conflit: true,
          motif: `Le client possède déjà le numéro ${r.h_compte} (« ${r.h_intitule} », ${r.h_origine === 'client' ? 'compte qu\'il a ajouté' : 'compte du modèle'}). Proposition : le rattacher au modèle sans changer son libellé.`,
          avant: { compte: r.h_compte, intitule: r.h_intitule }, apres: { compte: r.compte, intitule: r.h_intitule },
        });
      } else {
        pousser(r, 'ajout', { avant: null, apres: { compte: r.compte, intitule: r.intitule, statut: r.statut } });
      }
      continue;
    }

    // Statut : on ne propose que si le MODÈLE a changé de statut depuis la
    // version du client (sinon l'écart est un choix du client).
    if (r.statut !== r.c_statut && (!r.b_existe || r.b_statut !== r.statut)) {
      const type = r.statut === 'archive' ? 'archivage' : r.statut === 'inactif' ? 'desactivation' : 'reactivation';
      pousser(r, type, {
        avant: { statut: r.c_statut }, apres: { statut: r.statut },
        motif: r.utilise && r.statut !== 'actif' ? 'Compte utilisé par une rubrique du client : il restera visible dans les rubriques mais ne sera plus proposé.' : '',
      });
    }

    // Libellé / description / classe / nature.
    const ecarts = CHAMPS.filter((k) => (r[k] ?? '') !== (r[`c_${k}`] ?? ''));
    if (ecarts.length) {
      const modeleAChange = !r.b_existe || CHAMPS.some((k) => (r[k] ?? '') !== (r[`b_${k}`] ?? ''));
      if (!modeleAChange) continue; // écart voulu par le client, le modèle n'a pas bougé
      const avant = {}; const apres = {};
      for (const k of ecarts) { avant[k] = r[`c_${k}`]; apres[k] = r[k]; }
      pousser(r, 'modification', r.c_personnalise
        ? { conflit: true, motif: 'Le client a personnalisé ce compte : n\'appliquer que pour écraser sa version.', avant, apres }
        : { avant, apres });
    }
  }
  return { client, version: v, initialisation: false, changements };
};

const apercu = async (tenantId, versionId) => {
  const r = await calculer(tenantId, versionId);
  const par = (type) => r.changements.filter((c) => c.type === type).length;
  return {
    ...r,
    resume: {
      total: r.changements.length,
      conflits: r.changements.filter((c) => c.conflit).length,
      ajouts: par('ajout'), modifications: par('modification'), archivages: par('archivage'),
      desactivations: par('desactivation'), reactivations: par('reactivation'), liaisons: par('lier'),
    },
  };
};

/**
 * Applique les changements choisis (liste de « cle » issues de l'aperçu).
 * L'aperçu est RECALCULÉ dans la transaction : une clé qui ne correspond plus
 * (le client a modifié son plan entre-temps) est ignorée et signalée.
 */
const appliquer = async ({ tenantId, versionId, cles, userId }) => {
  if (!Array.isArray(cles)) throw new ErreurMetier(400, 'Liste des changements à appliquer manquante.');
  return sequelize.transaction(async (t) => {
    // Verrou du client : pas deux synchronisations simultanées.
    await sequelize.query('SELECT 1 FROM tenants WHERE id = :tenantId FOR UPDATE',
      { replacements: { tenantId }, type: SELECT, transaction: t });
    const calc = await calculer(tenantId, versionId, t);
    const { client, version } = calc;

    if (calc.initialisation) {
      const [{ n }] = await sequelize.query('SELECT plan_client_initialiser(:tenantId, :v, :userId) AS n',
        { replacements: { tenantId, v: version.id, userId }, type: SELECT, transaction: t });
      await sequelize.query(
        `INSERT INTO plan_synchronisations (tenant_id, version_source, version_cible, user_id, nb_proposes, nb_appliques, resume)
         VALUES (:tenantId, NULL, :v, :userId, :n, :n, CAST(:resume AS jsonb))`,
        { replacements: { tenantId, v: version.id, userId, n, resume: JSON.stringify({ initialisation: true, comptes: n }) },
          type: sequelize.QueryTypes.INSERT, transaction: t });
      return { initialisation: true, comptes: n, version: version.code };
    }

    const voulus = new Set(cles.map(String));
    const choisis = calc.changements.filter((c) => voulus.has(c.cle));
    const inconnues = [...voulus].filter((k) => !calc.changements.some((c) => c.cle === k));
    const details = [];

    for (const ch of choisis) {
      const r = { replacements: { tenantId, id: ch.compte_id, v: version.id, userId }, transaction: t };
      if (ch.type === 'ajout') {
        await sequelize.query(
          `INSERT INTO plan_comptable_client
                  (tenant_id, compte, intitule, description, classe, nature, origine, modele_compte_id, modele_version_id, statut, created_by)
           SELECT :tenantId, s.compte, s.intitule, s.description, s.classe, s.nature, 'modele', s.compte_id, :v, s.statut, :userId
             FROM plan_modele_version_comptes s WHERE s.version_id = :v AND s.compte_id = :id`,
          { ...r, type: sequelize.QueryTypes.INSERT });
      } else if (ch.type === 'lier') {
        await sequelize.query(
          `UPDATE plan_comptable_client c
              SET modele_compte_id = s.compte_id, modele_version_id = :v,
                  personnalise = (c.intitule <> s.intitule)
             FROM plan_modele_version_comptes s
            WHERE s.version_id = :v AND s.compte_id = :id
              AND c.tenant_id = :tenantId AND lower(btrim(c.compte)) = lower(btrim(s.compte))
              AND c.modele_compte_id IS NULL`,
          { ...r, type: sequelize.QueryTypes.UPDATE });
      } else if (ch.type === 'modification') {
        await sequelize.query(
          `UPDATE plan_comptable_client c
              SET intitule = s.intitule, description = s.description, classe = s.classe, nature = s.nature,
                  personnalise = false, modele_version_id = :v
             FROM plan_modele_version_comptes s
            WHERE s.version_id = :v AND s.compte_id = :id AND c.tenant_id = :tenantId AND c.modele_compte_id = s.compte_id`,
          { ...r, type: sequelize.QueryTypes.UPDATE });
      } else {
        await sequelize.query(
          `UPDATE plan_comptable_client SET statut = :statut, modele_version_id = :v
            WHERE tenant_id = :tenantId AND modele_compte_id = :id`,
          { ...r, replacements: { ...r.replacements, statut: ch.apres.statut }, type: sequelize.QueryTypes.UPDATE });
      }
      details.push({ cle: ch.cle, compte: ch.compte, type: ch.type, conflit: ch.conflit, avant: ch.avant, apres: ch.apres });
    }

    // Parents des comptes ajoutés (et de leurs éventuels enfants).
    if (choisis.some((c) => c.type === 'ajout')) {
      await sequelize.query(
        `UPDATE plan_comptable_client c
            SET parent_id = (SELECT q.id FROM plan_comptable_client q
                              WHERE q.tenant_id = c.tenant_id AND length(q.compte) < length(c.compte)
                                AND c.compte LIKE q.compte || '%'
                              ORDER BY length(q.compte) DESC LIMIT 1)
          WHERE c.tenant_id = :tenantId`,
        { replacements: { tenantId }, transaction: t, type: sequelize.QueryTypes.UPDATE });
    }

    await sequelize.query(
      `UPDATE tenants SET plan_modele_version_id = :v, plan_derniere_synchro = NOW(),
              plan_derniere_modif = CASE WHEN :n > 0 THEN NOW() ELSE plan_derniere_modif END
        WHERE id = :tenantId`,
      { replacements: { tenantId, v: version.id, n: details.length }, transaction: t, type: sequelize.QueryTypes.UPDATE });

    const resume = {
      version_source: client.version_code, version_cible: version.code,
      appliques: details.length, ignores: calc.changements.length - details.length, cles_obsoletes: inconnues,
    };
    const [sync] = await sequelize.query(
      `INSERT INTO plan_synchronisations
              (tenant_id, version_source, version_cible, user_id, nb_proposes, nb_appliques, nb_conflits, resume, details)
       VALUES (:tenantId, :src, :v, :userId, :np, :na, :nc, CAST(:resume AS jsonb), CAST(:details AS jsonb))
       RETURNING id, created_at`,
      { replacements: { tenantId, src: client.plan_modele_version_id || null, v: version.id, userId,
          np: calc.changements.length, na: details.length, nc: details.filter((d) => d.conflit).length,
          resume: JSON.stringify(resume), details: JSON.stringify(details) },
        type: SELECT, transaction: t });
    await sequelize.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
       VALUES (:tenantId, :userId, 'SYNC_PLAN_COMPTABLE', 'plan_comptable_client', :sid, CAST(:resume AS jsonb))`,
      { replacements: { tenantId, userId, sid: String(sync.id), resume: JSON.stringify(resume) },
        transaction: t, type: sequelize.QueryTypes.INSERT });

    return { synchronisation_id: sync.id, ...resume };
  });
};

const historique = (tenantId) => sequelize.query(
  `SELECT s.id, s.created_at, t.nom AS client, vs.code AS version_source, vc.code AS version_cible,
          u.username, s.nb_proposes, s.nb_appliques, s.nb_conflits, s.resume, s.details
     FROM plan_synchronisations s
     JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN plan_modele_versions vs ON vs.id = s.version_source
     LEFT JOIN plan_modele_versions vc ON vc.id = s.version_cible
     LEFT JOIN users u ON u.id = s.user_id
    WHERE (CAST(:tenantId AS uuid) IS NULL OR s.tenant_id = CAST(:tenantId AS uuid))
    ORDER BY s.created_at DESC LIMIT 100`,
  { replacements: { tenantId: tenantId || null }, type: SELECT }
);

module.exports = { ErreurMetier, listerClients, apercu, appliquer, historique };

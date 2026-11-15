// src/services/plan_client.service.js
// Plan comptable PAR CLIENT (réforme du plan, étape 3 — lecture et écriture).
//
// Table plan_comptable_client (migration 019). Les réponses gardent EXACTEMENT
// la forme des anciennes routes du plan global, pour que le frontend n'ait
// rien à changer :
//   origine 'modele' → source 'syscohada' ; origine 'client' → source 'custom'.
// Un client dont le plan n'est pas encore initialisé (tenants.plan_initialise_le
// NULL) continue d'être servi par le plan global : voir planClientActif().
const { sequelize } = require('../models');

const Q = (sql, replacements, type = sequelize.QueryTypes.SELECT) =>
  sequelize.query(sql, { replacements, type });

const COLS = `compte, intitule, classe, nature,
              CASE WHEN origine = 'client' THEN 'custom' ELSE 'syscohada' END AS source`;

/** true si le client consulté a son propre plan (sinon : plan global). */
const planClientActif = async (tenantId) => {
  if (!tenantId) return false;
  try {
    const rows = await Q(
      'SELECT plan_initialise_le IS NOT NULL AS ok FROM tenants WHERE id = :tenantId',
      { tenantId }
    );
    return Boolean(rows[0]?.ok);
  } catch (err) {
    // Migration 019 pas encore appliquée (colonne absente) → plan global.
    return false;
  }
};

const filtres = ({ q, classe, nature }) => {
  const sql = [];
  const rep = {};
  if (q && q.trim()) { sql.push('(compte ILIKE :q OR intitule ILIKE :q)'); rep.q = `%${q.trim()}%`; }
  if (classe)        { sql.push('classe = :classe'); rep.classe = parseInt(classe, 10); }
  if (nature)        { sql.push('nature = :nature'); rep.nature = nature; }
  return { sql: sql.length ? ' AND ' + sql.join(' AND ') : '', rep };
};

const rechercher = async (tenantId, opts, limit) => {
  const f = filtres(opts);
  return Q(
    `SELECT ${COLS} FROM plan_comptable_client
      WHERE tenant_id = :tenantId AND statut = 'actif'${f.sql}
      ORDER BY compte ASC LIMIT :limit`,
    { tenantId, limit, ...f.rep }
  );
};

const statsParClasse = async (tenantId) => {
  const rows = await Q(
    `SELECT classe, COUNT(*)::int AS nb FROM plan_comptable_client
      WHERE tenant_id = :tenantId AND statut = 'actif' AND classe IS NOT NULL
      GROUP BY classe ORDER BY classe`,
    { tenantId }
  );
  return { par_classe: rows, total: rows.reduce((s, r) => s + r.nb, 0) };
};

/**
 * Ajoute un compte au plan DU CLIENT, ou le réactive / renomme s'il existe.
 * Ne touche jamais au modèle global ni au plan d'un autre client.
 */
// Nature par défaut selon la classe — même règle que le référentiel
// (db/data/plan-comptable-syscohada.js).
const NATURE_PAR_CLASSE = {
  1: 'passif', 2: 'actif', 3: 'actif', 4: 'actif', 5: 'tresorerie',
  6: 'charge', 7: 'produit', 8: 'hors_activites_ordinaires',
};

const ajouterCompte = async ({ tenantId, userId, compte, intitule, classe, nature }) =>
  sequelize.transaction(async (transaction) => {
    nature = nature || NATURE_PAR_CLASSE[classe] || null;
    const opts = (type = sequelize.QueryTypes.SELECT) => ({ transaction, type });
    const [existant] = await sequelize.query(
      `SELECT id, compte, intitule, statut, origine FROM plan_comptable_client
        WHERE tenant_id = :tenantId AND lower(btrim(compte)) = lower(btrim(:compte))
        FOR UPDATE`,
      { replacements: { tenantId, compte }, ...opts() }
    );

    // Parent : plus long préfixe existant dans le plan du client.
    const [parent] = await sequelize.query(
      `SELECT id FROM plan_comptable_client
        WHERE tenant_id = :tenantId AND length(compte) < length(:compte)
          AND :compte LIKE compte || '%'
        ORDER BY length(compte) DESC LIMIT 1`,
      { replacements: { tenantId, compte }, ...opts() }
    );

    let ligne;
    if (existant) {
      [ligne] = await sequelize.query(
        `UPDATE plan_comptable_client
            SET intitule = :intitule, statut = 'actif',
                classe = COALESCE(:classe, classe), nature = COALESCE(:nature, nature),
                personnalise = (origine = 'modele' AND (personnalise OR intitule <> :intitule))
          WHERE id = :id
          RETURNING ${COLS}`,
        { replacements: { id: existant.id, intitule, classe, nature }, ...opts() }
      );
      await sequelize.query(
        `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
         VALUES (:tenantId, :userId, 'MODIF_COMPTE', 'plan_comptable_client', :id,
                 CAST(:avant AS jsonb), CAST(:apres AS jsonb))`,
        { replacements: { tenantId, userId, id: String(existant.id),
            avant: JSON.stringify({ intitule: existant.intitule, statut: existant.statut }),
            apres: JSON.stringify({ intitule, statut: 'actif' }) }, ...opts(sequelize.QueryTypes.INSERT) }
      );
    } else {
      const [cree] = await sequelize.query(
        `INSERT INTO plan_comptable_client
                (tenant_id, compte, intitule, classe, nature, parent_id, origine, statut, created_by)
         VALUES (:tenantId, :compte, :intitule, :classe, :nature, :parentId, 'client', 'actif', :userId)
         RETURNING id, ${COLS}`,
        { replacements: { tenantId, compte, intitule, classe, nature: nature || null,
                          parentId: parent?.id || null, userId }, ...opts() }
      );
      const { id, ...reste } = cree;
      ligne = reste;
      await sequelize.query(
        `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
         VALUES (:tenantId, :userId, 'AJOUT_COMPTE', 'plan_comptable_client', :id, CAST(:apres AS jsonb))`,
        { replacements: { tenantId, userId, id: String(id),
            apres: JSON.stringify({ compte, intitule, classe }) }, ...opts(sequelize.QueryTypes.INSERT) }
      );
    }
    await sequelize.query(
      'UPDATE tenants SET plan_derniere_modif = NOW() WHERE id = :tenantId',
      { replacements: { tenantId }, ...opts(sequelize.QueryTypes.UPDATE) }
    );
    return ligne;
  });

/**
 * Désactive un compte AJOUTÉ PAR LE CLIENT (même règle qu'avant : les comptes
 * issus du référentiel ne se retirent pas d'ici). Jamais de suppression
 * physique. Renvoie false si le compte n'existe pas ou vient du modèle.
 */
const desactiverCompte = async ({ tenantId, userId, compte }) =>
  sequelize.transaction(async (transaction) => {
    const [ligne] = await sequelize.query(
      `UPDATE plan_comptable_client SET statut = 'inactif'
        WHERE tenant_id = :tenantId AND origine = 'client'
          AND lower(btrim(compte)) = lower(btrim(:compte))
        RETURNING id, compte`,
      { replacements: { tenantId, compte }, transaction, type: sequelize.QueryTypes.SELECT }
    );
    if (!ligne) return false;
    await sequelize.query(
      `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
       VALUES (:tenantId, :userId, 'DESACTIVATION_COMPTE', 'plan_comptable_client', :id, CAST(:apres AS jsonb))`,
      { replacements: { tenantId, userId, id: String(ligne.id),
          apres: JSON.stringify({ compte: ligne.compte, statut: 'inactif' }) },
        transaction, type: sequelize.QueryTypes.INSERT }
    );
    await sequelize.query(
      'UPDATE tenants SET plan_derniere_modif = NOW() WHERE id = :tenantId',
      { replacements: { tenantId }, transaction, type: sequelize.QueryTypes.UPDATE }
    );
    return true;
  });

// ── Gestion complète du plan par le client (réforme, étape 5) ─────────────

const STATUTS = ['actif', 'inactif', 'archive'];

/**
 * Plan complet du client, TOUS statuts, avec l'usage de chaque compte
 * (rubriques du client qui le citent). Lecture seule.
 */
const listerComptes = async (tenantId) => Q(
  `SELECT c.id, c.compte, c.intitule, c.description, c.classe, c.nature, c.statut,
          c.origine, c.personnalise, c.updated_at, c.referentiel,
          CASE WHEN c.origine = 'client' THEN 'custom' ELSE 'syscohada' END AS source,
          p.compte AS parent_compte,
          COALESCE(u.rubriques, '[]'::json) AS rubriques,
          (u.rubriques IS NOT NULL) AS utilise
     FROM plan_comptable_client c
     LEFT JOIN plan_comptable_client p ON p.id = c.parent_id
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('code', r.code, 'intitule', r.intitule) ORDER BY r.ordre, r.code) AS rubriques
         FROM rubriques r
        WHERE r.tenant_id = c.tenant_id
          AND lower(btrim(coalesce(r.code_comptable, ''))) = lower(btrim(c.compte))
     ) u ON true
    WHERE c.tenant_id = :tenantId
    ORDER BY c.compte`,
  { tenantId }
);

/** Compte du client (verrouillé pour mise à jour), ou null s'il n'est pas à CE client. */
const compteDuClient = async (transaction, tenantId, id) => {
  const [c] = await sequelize.query(
    `SELECT id, compte, intitule, description, statut, origine, personnalise,
            plan_client_est_utilise(tenant_id, compte) AS utilise
       FROM plan_comptable_client WHERE id = :id AND tenant_id = :tenantId FOR UPDATE`,
    { replacements: { id, tenantId }, transaction, type: sequelize.QueryTypes.SELECT }
  );
  return c || null;
};

const journaliser = (transaction, { tenantId, userId, action, id, avant, apres }) => Promise.all([
  sequelize.query(
    `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
     VALUES (:tenantId, :userId, :action, 'plan_comptable_client', :id, CAST(:avant AS jsonb), CAST(:apres AS jsonb))`,
    { replacements: { tenantId, userId, action, id: String(id),
        avant: avant ? JSON.stringify(avant) : null, apres: apres ? JSON.stringify(apres) : null },
      transaction, type: sequelize.QueryTypes.INSERT }
  ),
  sequelize.query('UPDATE tenants SET plan_derniere_modif = NOW() WHERE id = :tenantId',
    { replacements: { tenantId }, transaction, type: sequelize.QueryTypes.UPDATE }),
]);

class ErreurMetier extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * Modifie libellé / description (tout compte) et numéro (uniquement un compte
 * ajouté par le client et non utilisé — le trigger de la 019 le garantit aussi
 * en base). Le numéro d'un compte issu du modèle n'est jamais modifiable : il
 * sert de lien avec le modèle pour la synchronisation.
 */
const modifierCompte = async ({ tenantId, userId, id, intitule, description, compte }) =>
  sequelize.transaction(async (transaction) => {
    const c = await compteDuClient(transaction, tenantId, id);
    if (!c) throw new ErreurMetier(404, 'Compte introuvable dans le plan de ce client.');

    const nouveau = {
      intitule: intitule !== undefined ? String(intitule).trim() : c.intitule,
      description: description !== undefined ? String(description).trim() : c.description,
      compte: compte !== undefined ? String(compte).trim() : c.compte,
    };
    if (!nouveau.intitule) throw new ErreurMetier(400, "L'intitulé est obligatoire.");
    const changeNumero = nouveau.compte.toLowerCase() !== c.compte.toLowerCase();
    if (changeNumero) {
      if (!nouveau.compte) throw new ErreurMetier(400, 'Le numéro de compte est obligatoire.');
      if (c.origine === 'modele') throw new ErreurMetier(409, 'Le numéro d\'un compte du référentiel ne peut pas être modifié.');
      if (c.utilise) throw new ErreurMetier(409, `Le compte ${c.compte} est utilisé par une rubrique : son numéro ne peut pas être modifié.`);
      const [doublon] = await sequelize.query(
        `SELECT 1 FROM plan_comptable_client WHERE tenant_id = :tenantId AND id <> :id
            AND lower(btrim(compte)) = lower(btrim(:compte))`,
        { replacements: { tenantId, id, compte: nouveau.compte }, transaction, type: sequelize.QueryTypes.SELECT }
      );
      if (doublon) throw new ErreurMetier(409, `Le compte ${nouveau.compte} existe déjà dans votre plan.`);
    }
    if (!changeNumero && nouveau.intitule === c.intitule && nouveau.description === c.description) {
      return { ...c, inchange: true };
    }

    const [maj] = await sequelize.query(
      `UPDATE plan_comptable_client
          SET intitule = :intitule, description = :description, compte = :compte,
              classe = CASE WHEN :changeNumero THEN COALESCE(NULLIF(substring(:compte from '^[1-9]'), '')::int, classe) ELSE classe END,
              personnalise = (origine = 'modele') OR personnalise
        WHERE id = :id
        RETURNING id, compte, intitule, description, statut`,
      { replacements: { id, ...nouveau, changeNumero }, transaction, type: sequelize.QueryTypes.SELECT }
    );
    await journaliser(transaction, {
      tenantId, userId, action: 'MODIF_COMPTE', id,
      avant: { compte: c.compte, intitule: c.intitule, description: c.description },
      apres: { compte: maj.compte, intitule: maj.intitule, description: maj.description },
    });
    return maj;
  });

/** Active / désactive / archive (aucune suppression physique). */
const changerStatut = async ({ tenantId, userId, id, statut }) =>
  sequelize.transaction(async (transaction) => {
    if (!STATUTS.includes(statut)) throw new ErreurMetier(400, 'Statut invalide (actif, inactif ou archive).');
    const c = await compteDuClient(transaction, tenantId, id);
    if (!c) throw new ErreurMetier(404, 'Compte introuvable dans le plan de ce client.');
    if (c.statut === statut) return { ...c, inchange: true };
    await sequelize.query('UPDATE plan_comptable_client SET statut = :statut WHERE id = :id',
      { replacements: { id, statut }, transaction, type: sequelize.QueryTypes.UPDATE });
    const action = { actif: 'ACTIVATION_COMPTE', inactif: 'DESACTIVATION_COMPTE', archive: 'ARCHIVAGE_COMPTE' }[statut];
    await journaliser(transaction, {
      tenantId, userId, action, id,
      avant: { compte: c.compte, statut: c.statut }, apres: { compte: c.compte, statut },
    });
    return { id: c.id, compte: c.compte, statut, utilise: c.utilise };
  });

/** Historique d'un compte du client (journal d'audit), le plus récent d'abord. */
const historique = async (tenantId, id) => {
  const [c] = await Q('SELECT id FROM plan_comptable_client WHERE id = :id AND tenant_id = :tenantId', { id, tenantId });
  if (!c) throw new ErreurMetier(404, 'Compte introuvable dans le plan de ce client.');
  return Q(
    `SELECT a.created_at, a.action, a.ancienne_valeur, a.nouvelle_valeur, u.username
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = :tenantId AND a.entite = 'plan_comptable_client' AND a.entite_id = :id
      ORDER BY a.created_at DESC, a.id DESC LIMIT 200`,
    { tenantId, id: String(id) }
  );
};

module.exports = {
  planClientActif, rechercher, statsParClasse, ajouterCompte, desactiverCompte,
  listerComptes, modifierCompte, changerStatut, historique, ErreurMetier,
};

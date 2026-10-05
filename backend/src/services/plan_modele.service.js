// src/services/plan_modele.service.js
// Administration du MODÈLE GLOBAL de plan comptable (réforme du plan, étape 6).
// Réservé à l'administrateur plateforme (super_admin) — voir routes/index.js.
//
// Le modèle « vivant » = plan_comptable_syscohada (sources 'syscohada' et
// 'modele' ; les anciennes lignes 'custom' ajoutées par des clients n'en font
// pas partie). Une version publiée = instantané figé dans
// plan_modele_version_comptes (migration 020). Les clients ne voient jamais
// les modifications tant qu'elles ne sont pas publiées, et même alors, seuls
// les NOUVEAUX clients les reçoivent automatiquement (la synchronisation des
// clients existants est une action explicite, étape 7).
const { sequelize } = require('../models');

const SELECT = sequelize.QueryTypes.SELECT;
const STATUTS = ['actif', 'inactif', 'archive'];
const NATURES = ['actif', 'passif', 'charge', 'produit', 'tresorerie', 'hors_activites_ordinaires'];
const NATURE_PAR_CLASSE = {
  1: 'passif', 2: 'actif', 3: 'actif', 4: 'actif', 5: 'tresorerie',
  6: 'charge', 7: 'produit', 8: 'hors_activites_ordinaires',
};
const DU_MODELE = "source IN ('syscohada','modele')";

class ErreurMetier extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const versionPubliee = async (t) => {
  const [v] = await sequelize.query(
    "SELECT id, code, libelle, publiee_le FROM plan_modele_versions WHERE statut = 'publiee' LIMIT 1",
    { type: SELECT, transaction: t }
  );
  return v || null;
};

const listerVersions = () => sequelize.query(
  `SELECT v.id, v.code, v.libelle, v.statut, v.notes, v.publiee_le, v.created_at, u.username AS publiee_par,
          (SELECT COUNT(*)::int FROM plan_modele_version_comptes s WHERE s.version_id = v.id) AS nb_comptes,
          (SELECT COUNT(*)::int FROM tenants t WHERE t.plan_modele_version_id = v.id) AS nb_clients
     FROM plan_modele_versions v LEFT JOIN users u ON u.id = v.created_by
    ORDER BY v.id DESC`,
  { type: SELECT }
);

/**
 * Comptes du modèle vivant, tous statuts, avec leur état par rapport à la
 * version publiée : 'publie' (identique), 'modifie', 'nouveau'.
 */
const listerComptes = async () => {
  const v = await versionPubliee();
  return sequelize.query(
    `SELECT m.id, m.compte, m.intitule, m.description, m.classe, m.nature, m.parent_compte,
            m.statut, m.source, m.updated_at,
            CASE
              WHEN s.compte_id IS NULL THEN 'nouveau'
              WHEN (s.compte, s.intitule, s.description, s.classe, s.nature, s.parent_compte, s.statut)
                   IS DISTINCT FROM
                   (m.compte, m.intitule, m.description, m.classe, m.nature, m.parent_compte, m.statut)
                THEN 'modifie'
              ELSE 'publie'
            END AS etat_publication,
            (SELECT COUNT(DISTINCT c.tenant_id)::int FROM plan_comptable_client c
              WHERE c.modele_compte_id = m.id) AS nb_clients
       FROM plan_comptable_syscohada m
       LEFT JOIN plan_modele_version_comptes s ON s.compte_id = m.id AND s.version_id = :v
      WHERE m.${DU_MODELE}
      ORDER BY m.compte`,
    { replacements: { v: v ? v.id : null }, type: SELECT }
  );
};

const historiser = (t, { compteId = null, compte = null, versionId = null, action, avant, apres, userId }) =>
  sequelize.query(
    `INSERT INTO plan_modele_historique (version_id, compte_id, compte, action, ancienne_valeur, nouvelle_valeur, user_id)
     VALUES (:versionId, :compteId, :compte, :action, CAST(:avant AS jsonb), CAST(:apres AS jsonb), :userId)`,
    { replacements: { versionId, compteId, compte, action, userId,
        avant: avant ? JSON.stringify(avant) : null, apres: apres ? JSON.stringify(apres) : null },
      transaction: t, type: sequelize.QueryTypes.INSERT }
  );

const lireCompte = async (t, id) => {
  const [c] = await sequelize.query(
    `SELECT id, compte, intitule, description, classe, nature, parent_compte, statut, source,
            EXISTS (SELECT 1 FROM plan_modele_version_comptes s WHERE s.compte_id = m.id) AS deja_publie,
            EXISTS (SELECT 1 FROM plan_comptable_client c WHERE c.modele_compte_id = m.id) AS chez_clients
       FROM plan_comptable_syscohada m WHERE id = :id AND ${DU_MODELE} FOR UPDATE`,
    { replacements: { id }, type: SELECT, transaction: t }
  );
  if (!c) throw new ErreurMetier(404, 'Compte introuvable dans le modèle.');
  return c;
};

const verifierParent = async (t, parent, compte) => {
  if (!parent) return null;
  if (String(parent).trim().toLowerCase() === String(compte).trim().toLowerCase()) {
    throw new ErreurMetier(400, 'Un compte ne peut pas être son propre parent.');
  }
  const [p] = await sequelize.query(
    `SELECT compte FROM plan_comptable_syscohada WHERE ${DU_MODELE} AND lower(btrim(compte)) = lower(btrim(:parent))`,
    { replacements: { parent }, type: SELECT, transaction: t }
  );
  if (!p) throw new ErreurMetier(400, `Le compte parent ${parent} n'existe pas dans le modèle.`);
  return p.compte;
};

const parentParDefaut = async (t, compte) => {
  const [p] = await sequelize.query(
    `SELECT compte FROM plan_comptable_syscohada
      WHERE ${DU_MODELE} AND length(compte) < length(:compte) AND :compte LIKE compte || '%'
      ORDER BY length(compte) DESC LIMIT 1`,
    { replacements: { compte }, type: SELECT, transaction: t }
  );
  return p ? p.compte : null;
};

const ajouterCompte = async ({ userId, compte, intitule, description, classe, nature, parent_compte }) =>
  sequelize.transaction(async (t) => {
    compte = String(compte || '').trim();
    intitule = String(intitule || '').trim();
    if (!compte || !intitule) throw new ErreurMetier(400, 'Numéro de compte et intitulé obligatoires.');
    let classeNum = parseInt(classe, 10);
    if (!(classeNum >= 1 && classeNum <= 9)) {
      const d = compte.match(/\d/);
      classeNum = d ? parseInt(d[0], 10) : null;
    }
    if (nature && !NATURES.includes(nature)) throw new ErreurMetier(400, 'Nature invalide.');
    const [existe] = await sequelize.query(
      'SELECT source FROM plan_comptable_syscohada WHERE lower(btrim(compte)) = lower(btrim(:compte))',
      { replacements: { compte }, type: SELECT, transaction: t }
    );
    if (existe) {
      throw new ErreurMetier(409, existe.source === 'custom'
        ? `Le numéro ${compte} existe déjà comme ancien compte additif d'un client (plan global d'avant la réforme).`
        : `Le compte ${compte} existe déjà dans le modèle.`);
    }
    const parent = parent_compte ? await verifierParent(t, parent_compte, compte) : await parentParDefaut(t, compte);
    const [c] = await sequelize.query(
      `INSERT INTO plan_comptable_syscohada
              (compte, intitule, description, classe, nature, parent_compte, source, actif, statut, created_by)
       VALUES (:compte, :intitule, :description, :classe, :nature, :parent, 'modele', true, 'actif', :userId)
       RETURNING id, compte, intitule, description, classe, nature, parent_compte, statut`,
      { replacements: { compte, intitule, description: String(description || '').trim(), classe: classeNum,
          nature: nature || NATURE_PAR_CLASSE[classeNum] || null, parent, userId },
        type: SELECT, transaction: t }
    );
    await historiser(t, { compteId: c.id, compte: c.compte, action: 'AJOUT', apres: c, userId });
    return c;
  });

/**
 * Modification. Le numéro n'est modifiable que pour un compte jamais publié
 * et présent chez aucun client : il est la référence des clients et des
 * versions publiées.
 */
const modifierCompte = async ({ userId, id, champs }) =>
  sequelize.transaction(async (t) => {
    const c = await lireCompte(t, id);
    const n = {
      compte:        champs.compte !== undefined ? String(champs.compte).trim() : c.compte,
      intitule:      champs.intitule !== undefined ? String(champs.intitule).trim() : c.intitule,
      description:   champs.description !== undefined ? String(champs.description).trim() : c.description,
      classe:        champs.classe !== undefined && champs.classe !== null && champs.classe !== '' ? parseInt(champs.classe, 10) : c.classe,
      nature:        champs.nature !== undefined ? (champs.nature || null) : c.nature,
      parent_compte: champs.parent_compte !== undefined ? (String(champs.parent_compte || '').trim() || null) : c.parent_compte,
    };
    if (!n.intitule) throw new ErreurMetier(400, "L'intitulé est obligatoire.");
    if (n.classe !== null && !(n.classe >= 1 && n.classe <= 9)) throw new ErreurMetier(400, 'Classe invalide (1 à 9).');
    if (n.nature && !NATURES.includes(n.nature)) throw new ErreurMetier(400, 'Nature invalide.');

    if (n.compte.toLowerCase() !== c.compte.toLowerCase()) {
      if (!n.compte) throw new ErreurMetier(400, 'Le numéro de compte est obligatoire.');
      if (c.deja_publie || c.chez_clients) {
        throw new ErreurMetier(409, 'Ce compte a déjà été publié ou copié chez des clients : son numéro ne peut plus changer. Archivez-le et créez-en un nouveau.');
      }
      const [doublon] = await sequelize.query(
        'SELECT 1 FROM plan_comptable_syscohada WHERE id <> :id AND lower(btrim(compte)) = lower(btrim(:compte))',
        { replacements: { id, compte: n.compte }, type: SELECT, transaction: t }
      );
      if (doublon) throw new ErreurMetier(409, `Le numéro ${n.compte} existe déjà.`);
    }
    if (n.parent_compte !== c.parent_compte) n.parent_compte = await verifierParent(t, n.parent_compte, n.compte);

    const [maj] = await sequelize.query(
      `UPDATE plan_comptable_syscohada
          SET compte = :compte, intitule = :intitule, description = :description, classe = :classe,
              nature = :nature, parent_compte = :parent_compte, updated_at = NOW()
        WHERE id = :id
        RETURNING id, compte, intitule, description, classe, nature, parent_compte, statut`,
      { replacements: { id, ...n }, type: SELECT, transaction: t }
    );
    const avant = {}; const apres = {};
    for (const k of Object.keys(n)) {
      if ((c[k] ?? null) !== (maj[k] ?? null)) { avant[k] = c[k]; apres[k] = maj[k]; }
    }
    if (Object.keys(apres).length) {
      await historiser(t, { compteId: id, compte: maj.compte, action: 'MODIFICATION', avant, apres, userId });
    }
    return maj;
  });

/** actif / inactif / archive — `actif` (lu par l'application) suit le statut. */
const changerStatut = async ({ userId, id, statut }) =>
  sequelize.transaction(async (t) => {
    if (!STATUTS.includes(statut)) throw new ErreurMetier(400, 'Statut invalide (actif, inactif ou archive).');
    const c = await lireCompte(t, id);
    if (c.statut === statut) return { id: c.id, compte: c.compte, statut };
    await sequelize.query(
      'UPDATE plan_comptable_syscohada SET statut = :statut, actif = (:statut = \'actif\'), updated_at = NOW() WHERE id = :id',
      { replacements: { id, statut }, transaction: t, type: sequelize.QueryTypes.UPDATE }
    );
    const action = { actif: 'ACTIVATION', inactif: 'DESACTIVATION', archive: 'ARCHIVAGE' }[statut];
    await historiser(t, { compteId: id, compte: c.compte, action, avant: { statut: c.statut }, apres: { statut }, userId });
    return { id: c.id, compte: c.compte, statut };
  });

const historiqueCompte = (id) => sequelize.query(
  `SELECT h.created_at, h.action, h.ancienne_valeur, h.nouvelle_valeur, u.username, v.code AS version
     FROM plan_modele_historique h
     LEFT JOIN users u ON u.id = h.user_id
     LEFT JOIN plan_modele_versions v ON v.id = h.version_id
    WHERE h.compte_id = :id
    ORDER BY h.created_at DESC, h.id DESC LIMIT 200`,
  { replacements: { id }, type: SELECT }
);

/** Différences entre le modèle vivant et la version publiée (aperçu avant publication). */
const apercu = async (t) => {
  const v = await versionPubliee(t);
  const rows = await sequelize.query(
    `SELECT m.id, m.compte, m.intitule, m.statut,
            s.compte AS ancien_compte, s.intitule AS ancien_intitule, s.statut AS ancien_statut,
            CASE
              WHEN s.compte_id IS NULL THEN 'ajoute'
              WHEN s.statut <> m.statut AND m.statut = 'archive' THEN 'archive'
              ELSE 'modifie'
            END AS changement
       FROM plan_comptable_syscohada m
       LEFT JOIN plan_modele_version_comptes s ON s.compte_id = m.id AND s.version_id = :v
      WHERE m.${DU_MODELE}
        AND (s.compte_id IS NULL
             OR (s.compte, s.intitule, s.description, s.classe, s.nature, s.parent_compte, s.statut)
                IS DISTINCT FROM
                (m.compte, m.intitule, m.description, m.classe, m.nature, m.parent_compte, m.statut))
      ORDER BY m.compte`,
    { replacements: { v: v ? v.id : null }, type: SELECT, transaction: t }
  );
  const par = (k) => rows.filter((r) => r.changement === k);
  return {
    version_publiee: v,
    ajoutes: par('ajoute'), modifies: par('modifie'), archives: par('archive'),
    total: rows.length,
  };
};

/**
 * Publie une nouvelle version = instantané du modèle vivant. L'ancienne
 * version passe « archivée » (les clients qui l'utilisent la conservent).
 * Les clients existants NE SONT PAS modifiés (synchronisation : étape 7).
 */
const publier = async ({ userId, libelle, notes }) =>
  sequelize.transaction(async (t) => {
    // Une seule publication à la fois.
    await sequelize.query("SELECT pg_advisory_xact_lock(hashtext('plan_modele_publication'))", { transaction: t, type: SELECT });
    const diff = await apercu(t);
    if (diff.total === 0) throw new ErreurMetier(409, 'Aucune modification depuis la dernière publication : rien à publier.');

    const [{ n }] = await sequelize.query('SELECT COUNT(*)::int + 1 AS n FROM plan_modele_versions', { type: SELECT, transaction: t });
    const code = `SYSCOHADA-${new Date().getFullYear()}-V${n}`;
    await sequelize.query("UPDATE plan_modele_versions SET statut = 'archivee' WHERE statut = 'publiee'",
      { transaction: t, type: sequelize.QueryTypes.UPDATE });
    const [v] = await sequelize.query(
      `INSERT INTO plan_modele_versions (code, libelle, statut, notes, publiee_le, created_by)
       VALUES (:code, :libelle, 'publiee', :notes, NOW(), :userId) RETURNING id, code, libelle, publiee_le`,
      { replacements: { code, libelle: String(libelle || '').trim() || `Version ${n}`, notes: String(notes || '').trim(), userId },
        type: SELECT, transaction: t }
    );
    await sequelize.query(
      `UPDATE plan_comptable_syscohada SET version_id = :v WHERE ${DU_MODELE} AND version_id IS NULL`,
      { replacements: { v: v.id }, transaction: t, type: sequelize.QueryTypes.UPDATE }
    );
    const [{ nb }] = await sequelize.query(
      `WITH ins AS (
         INSERT INTO plan_modele_version_comptes
                (version_id, compte_id, compte, intitule, description, classe, nature, parent_compte, statut)
         SELECT :v, id, compte, intitule, description, classe, nature, parent_compte, statut
           FROM plan_comptable_syscohada WHERE ${DU_MODELE}
         RETURNING 1)
       SELECT COUNT(*)::int AS nb FROM ins`,
      { replacements: { v: v.id }, type: SELECT, transaction: t }
    );
    await historiser(t, {
      versionId: v.id, action: 'PUBLICATION_VERSION', userId,
      apres: { code, nb_comptes: nb, ajoutes: diff.ajoutes.length, modifies: diff.modifies.length, archives: diff.archives.length },
    });
    return { ...v, nb_comptes: nb, ajoutes: diff.ajoutes.length, modifies: diff.modifies.length, archives: diff.archives.length };
  });

module.exports = {
  ErreurMetier, listerVersions, listerComptes, ajouterCompte, modifierCompte,
  changerStatut, historiqueCompte, apercu: () => apercu(null), publier,
};

// src/services/roles_client.service.js
// Rôles autorisés par client (migration 038).
//
// Règle unique, appliquée par l'API des utilisateurs (création, changement de
// rôle, réactivation) et affichée par l'interface :
//   - tenants.roles_autorises renseigné → choix du super_admin ;
//   - sinon : démonstration → directeur + caissier ; client → tous les rôles.
// Le nombre d'utilisateurs n'est pas limité.
const { sequelize } = require('../models');

const T = sequelize.QueryTypes;
const ROLES_TENANT = ['directeur', 'caissier', 'auditeur'];
const ROLES_DEMO_DEFAUT = ['directeur', 'caissier'];
const LIBELLES = { directeur: 'Directeur', caissier: 'Caissier(ère)', auditeur: 'Comptable' };   // code technique « auditeur » (044)

class ErreurMetier extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const parDefaut = (typeCompte) => (typeCompte === 'demo' ? ROLES_DEMO_DEFAUT : ROLES_TENANT);

// Colonne absente (migration 038 pas encore jouée) → comportement par défaut.
let colonne = null;
const aColonne = async () => {
  if (colonne === true) return true;
  const rows = await sequelize.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'roles_autorises'",
    { type: T.SELECT });
  colonne = rows.length > 0;
  return colonne;
};

/** { roles, personnalise, type_compte, defaut } pour un client. */
const lire = async (tenantId, transaction) => {
  const avecColonne = await aColonne();
  const [t] = await sequelize.query(
    `SELECT type_compte${avecColonne ? ', roles_autorises' : ''} FROM tenants WHERE id = :tenantId`,
    { replacements: { tenantId }, type: T.SELECT, transaction });
  if (!t) throw new ErreurMetier(404, 'Client introuvable.');
  const defaut = parDefaut(t.type_compte);
  const choix = Array.isArray(t.roles_autorises) && t.roles_autorises.length ? t.roles_autorises : null;
  return {
    roles: ROLES_TENANT.filter((r) => (choix || defaut).includes(r)),  // ordre stable
    personnalise: Boolean(choix),
    type_compte: t.type_compte,
    defaut,
  };
};

const rolesAutorises = async (tenantId) => (await lire(tenantId)).roles;

const libelles = (roles) => roles.map((r) => LIBELLES[r] || r).join(', ');

/** Message d'erreur quand un rôle n'est pas autorisé pour le client. */
const messageRefus = (role, info) => (info.type_compte === 'demo' && !info.personnalise
  ? `Espace de démonstration : seuls les rôles ${libelles(info.roles)} sont disponibles (utilisateurs en nombre illimité). `
    + 'Tous les rôles seront disponibles après souscription.'
  : `Le rôle « ${LIBELLES[role] || role} » n'est pas autorisé pour ce client. Rôles disponibles : ${libelles(info.roles)}. `
    + 'Contactez le cabinet pour en ouvrir d\'autres.');

/** Lève une ErreurMetier 403 si le rôle n'est pas autorisé pour le client. */
const verifierRole = async (tenantId, role) => {
  if (!tenantId) return;
  const info = await lire(tenantId);
  if (!info.roles.includes(role)) throw new ErreurMetier(403, messageRefus(role, info));
};

/**
 * Définit les rôles autorisés (super_admin). `roles` = null → retour à la
 * valeur par défaut du type de compte. Refuse de retirer un rôle encore porté
 * par des utilisateurs ACTIFS : leur rôle doit être changé d'abord.
 */
const definir = async ({ tenantId, userId, roles }) => sequelize.transaction(async (transaction) => {
  if (!(await aColonne())) throw new ErreurMetier(503, 'Migration 038 non appliquée : lancez « node db/migrate.js ».');
  const avant = await lire(tenantId, transaction);
  let cible = null;
  if (roles !== null && roles !== undefined) {
    if (!Array.isArray(roles)) throw new ErreurMetier(400, 'Liste de rôles attendue.');
    const inconnus = roles.filter((r) => !ROLES_TENANT.includes(r));
    if (inconnus.length) throw new ErreurMetier(400, `Rôle(s) inconnu(s) : ${inconnus.join(', ')}.`);
    cible = ROLES_TENANT.filter((r) => roles.includes(r));
    if (cible.length === 0) throw new ErreurMetier(400, 'Au moins un rôle doit rester autorisé.');
  }
  const effectifs = cible || parDefaut(avant.type_compte);

  const portes = await sequelize.query(
    `SELECT role, string_agg(username, ', ' ORDER BY username) AS noms, COUNT(*)::int AS n
       FROM users WHERE tenant_id = :tenantId AND actif AND NOT (role = ANY(CAST(:roles AS text[])))
        AND role = ANY(CAST(:tenantRoles AS text[]))
      GROUP BY role`,
    { replacements: { tenantId, roles: `{${effectifs.join(',')}}`, tenantRoles: `{${ROLES_TENANT.join(',')}}` },
      type: T.SELECT, transaction });
  if (portes.length) {
    throw new ErreurMetier(409, 'Impossible de retirer un rôle encore attribué à des utilisateurs actifs : '
      + portes.map((p) => `${LIBELLES[p.role] || p.role} (${p.noms})`).join(' ; ')
      + '. Changez leur rôle ou désactivez-les d\'abord.');
  }

  await sequelize.query(
    'UPDATE tenants SET roles_autorises = CAST(:v AS text[]) WHERE id = :tenantId',
    { replacements: { v: cible ? `{${cible.join(',')}}` : null, tenantId }, type: T.UPDATE, transaction });
  await sequelize.query(
    `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
     VALUES (:tenantId, :userId, 'ROLES_CLIENT', 'tenants', :tenantId, CAST(:avant AS jsonb), CAST(:apres AS jsonb))`,
    { replacements: { tenantId, userId,
        avant: JSON.stringify({ roles: avant.roles, personnalise: avant.personnalise }),
        apres: JSON.stringify({ roles: effectifs, personnalise: Boolean(cible) }) },
      type: T.INSERT, transaction });
  return lire(tenantId, transaction);
});

module.exports = {
  ErreurMetier, ROLES_TENANT, ROLES_DEMO_DEFAUT, LIBELLES,
  lire, rolesAutorises, verifierRole, definir,
};

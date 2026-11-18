// src/controllers/users.controller.js
// Rôles autorisés par client (038) : remplace l'ancienne limite « 2 utilisateurs » des démos.
const rolesClient = require('../services/roles_client.service');
const bcrypt = require('bcryptjs');
const { sequelize, User, Role } = require('../models');
const { getEffectivePermissions, getBasePermissions, verifierCodesAccordables } = require('../services/permission.service');

// Rôles (« types de compte ») — liste unique côté serveur.
//  - ROLES_TENANT  : attribuables à l'intérieur d'un client ;
//  - ROLES_CABINET_CREABLES : attribuables par le super_admin hors client.
// super_admin n'est JAMAIS attribuable via l'API : auparavant, un directeur
// disposant de users.edit pouvait promouvoir un compte de son client en
// super_admin et prendre le contrôle de toute la plateforme.
const ROLES_TENANT = ['directeur', 'caissier', 'auditeur', 'collaborateur'];   // collaborateur : 050
const ROLES_CABINET_CREABLES = ['comptable_cabinet', 'commercial'];
const TOUS_ROLES = ['super_admin', 'comptable_cabinet', 'commercial', ...ROLES_TENANT];
const ROLES_VALIDES = [...ROLES_TENANT, ...ROLES_CABINET_CREABLES]; // compat (validators)
const ROLES_LABELS = {
  directeur: 'Directeur',
  caissier: 'Caissier(ère)',
  auditeur: 'Comptable',   // ex-« Auditeur » (044) : profil de contrôle comptable
  comptable_cabinet: 'Comptable Cabinet',
  commercial: 'Commercial',
  collaborateur: 'Collaborateur',   // 050 : modules de gestion, sans caisse
  super_admin: 'Super Admin',
};
const PRIORITE_ROLE = { directeur: 1, comptable_cabinet: 2, caissier: 3, auditeur: 4, collaborateur: 5 };

// Rôles que l'appelant peut attribuer dans le contexte courant.
const rolesAttribuables = (req) => {
  if (req.tenantId) return ROLES_TENANT;
  return req.user.role === 'super_admin' ? ROLES_CABINET_CREABLES : [];
};

// Le profil métier doit appartenir au client courant (sinon : IDOR — un
// directeur pouvait rattacher un profil d'un autre client par son id).
const verifierProfil = async (customRoleId, tenantId) => {
  if (customRoleId === null) return null;
  if (!Number.isInteger(customRoleId)) return 'Profil métier invalide.';
  const r = await Role.findOne({ where: { id: customRoleId, tenant_id: tenantId }, attributes: ['id'], raw: true });
  return r ? null : 'Profil métier introuvable pour ce client.';
};

const msgRoleRefuse = (req) => {
  const ok = rolesAttribuables(req);
  return ok.length
    ? `Rôle non attribuable ici. Valeurs acceptées : ${ok.join(', ')}.`
    : 'Aucun rôle attribuable dans ce contexte.';
};

// GET /api/users
const getUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      where: { tenant_id: req.tenantId },
      attributes: ['id', 'username', 'email', 'role', 'actif', 'derniere_connexion', 'created_at', 'custom_role_id'],
      include: [{ model: Role, as: 'roleCustom', attributes: ['nom', 'couleur', 'code'], required: false }],
    });
    const rows = users
      .map((u) => {
        const { roleCustom, ...rest } = u.toJSON();
        return {
          ...rest,
          custom_role_nom: roleCustom ? roleCustom.nom : null,
          custom_role_couleur: roleCustom ? roleCustom.couleur : null,
          custom_role_code: roleCustom ? roleCustom.code : null,
        };
      })
      .sort((a, b) => {
        const pa = PRIORITE_ROLE[a.role] || 5;
        const pb = PRIORITE_ROLE[b.role] || 5;
        return pa !== pb ? pa - pb : a.username.localeCompare(b.username);
      });
    // Droit de saisie en rattrapage (033), pour l'interrupteur du directeur.
    await Promise.all(rows.map(async (u) => {
      const eff = await getEffectivePermissions({ tenantId: req.tenantId, userId: u.id, role: u.role });
      u.rattrapage = eff === null || eff.includes('journal.rattrapage');
    }));
    // Activité / projet obligatoire (039) — to_jsonb : neutre avant la migration.
    const flags = await sequelize.query(
      `SELECT id, (to_jsonb(u)->>'activite_obligatoire')::boolean IS TRUE AS ao FROM users u WHERE u.id IN (:ids)`,
      { replacements: { ids: rows.length ? rows.map((u) => u.id) : ['00000000-0000-0000-0000-000000000000'] }, type: sequelize.QueryTypes.SELECT });
    const ao = new Map(flags.map((f) => [f.id, f.ao]));
    for (const u of rows) u.activite_obligatoire = Boolean(ao.get(u.id));
    res.json(rows);
  } catch (err) {
    console.error('[Users] getUsers :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// POST /api/users
const createUser = async (req, res) => {
  const { username, password, role, email, custom_role_id } = req.body;
  // 066 : modules auxquels le compte est rattaché dès sa création (ceux de
  // l'écran d'où il est créé). Aucun autre module ne lui est ouvert.
  const modulesCompte = req.body.modules === undefined ? [] : req.body.modules;
  if (!Array.isArray(modulesCompte) || modulesCompte.some((c) => typeof c !== 'string')) {
    return res.status(400).json({ error: 'Modules : liste attendue.' });
  }
  if (!username || !password || password.length < 6 || !role) {
    return res.status(400).json({ error: 'Tous les champs sont requis. Mot de passe : minimum 6 caractères.' });
  }
  if (!rolesAttribuables(req).includes(role)) {
    return res.status(400).json({ error: msgRoleRefuse(req) });
  }
  const roleId = custom_role_id ? parseInt(custom_role_id, 10) : null;
  try {
    const errProfil = await verifierProfil(roleId, req.tenantId);
    if (errProfil) return res.status(400).json({ error: errProfil });
    // Rôles autorisés pour ce client (démo : directeur + caissier par défaut).
    try { await rolesClient.verifierRole(req.tenantId, role); }
    catch (e) { if (e instanceof rolesClient.ErreurMetier) return res.status(e.status).json({ error: e.message }); throw e; }

    if (modulesCompte.length) {
      const [{ n }] = await sequelize.query(
        'SELECT COUNT(*)::int AS n FROM tenant_modules WHERE tenant_id = :t AND actif AND module_code IN (:m)',
        { replacements: { t: req.tenantId, m: [...new Set(modulesCompte)] }, type: sequelize.QueryTypes.SELECT });
      if (n !== new Set(modulesCompte).size) return res.status(400).json({ error: 'Module non activé pour ce client.' });
    }
    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12);
    const user = await sequelize.transaction(async (transaction) => {
      const u = await User.create({
        tenant_id: req.tenantId,
        username: username.trim(),
        email: email || null,
        password_hash: hash,
        role,
        custom_role_id: roleId,
      }, { transaction });
      const db = require('../services/modules.service').clientSequelize(sequelize, transaction);
      const um = require('../services/utilisateurs_modules.service');
      for (const code of [...new Set(modulesCompte)]) {
        await um.affecter({ tenantId: req.tenantId, code, cibleId: u.id, roleId: null, par: req.user.id, origine: 'creation', db });
      }
      return u;
    });
    res.status(201).json({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      actif: user.actif,
      created_at: user.created_at,
      custom_role_id: user.custom_role_id,
      modules: [...new Set(modulesCompte)],
    });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: "Ce nom d'utilisateur existe déjà." });
    console.error('[Users] createUser :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PUT /api/users/:id — mise à jour PARTIELLE : un champ absent du corps n'est
// pas modifié. Auparavant un champ absent était écrit à NULL (username/role →
// erreur 500, email et profil métier effacés en silence).
const updateUser = async (req, res) => {
  const { username, email, role, custom_role_id } = req.body;
  try {
    const cible = await User.findOne({ where: { id: req.params.id, tenant_id: req.tenantId } });
    if (!cible) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    const patch = {};
    if (username !== undefined) {
      if (!String(username).trim()) return res.status(400).json({ error: 'Identifiant obligatoire.' });
      patch.username = String(username).trim();
    }
    if (email !== undefined) patch.email = email ? String(email).trim() : null;
    if (role !== undefined && role !== '' && role !== cible.role) {
      if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre rôle.' });
      }
      if (!rolesAttribuables(req).includes(role)) return res.status(400).json({ error: msgRoleRefuse(req) });
      try { await rolesClient.verifierRole(req.tenantId, role); }
      catch (e) { if (e instanceof rolesClient.ErreurMetier) return res.status(e.status).json({ error: e.message }); throw e; }
      patch.role = role;
    }
    if (custom_role_id !== undefined) {
      const roleId = custom_role_id ? parseInt(custom_role_id, 10) : null;
      const errProfil = await verifierProfil(roleId, req.tenantId);
      if (errProfil) return res.status(400).json({ error: errProfil });
      patch.custom_role_id = roleId;
    }

    await cible.update(patch);
    const u = cible;
    res.json({ id: u.id, username: u.username, email: u.email, role: u.role, actif: u.actif, custom_role_id: u.custom_role_id });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: "Ce nom d'utilisateur existe déjà." });
    console.error('[Users] updateUser :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PATCH /api/users/:id/actif  — activer ou désactiver
const toggleActif = async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Impossible de désactiver votre propre compte.' });
  }
  try {
    // Réactivation : le rôle doit être autorisé pour le client (038).
    const cible = await User.findOne({ where: { id: req.params.id, tenant_id: req.tenantId }, attributes: ['role', 'actif'], raw: true });
    if (!cible) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    if (!cible.actif && req.tenantId) {
      try { await rolesClient.verifierRole(req.tenantId, cible.role); }
      catch (e) { if (e instanceof rolesClient.ErreurMetier) return res.status(e.status).json({ error: `Réactivation impossible. ${e.message}` }); throw e; }
    }
    const [count, rows] = await User.update(
      { actif: sequelize.literal('NOT actif') },
      { where: { id: req.params.id, tenant_id: req.tenantId }, returning: true }
    );
    if (count === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    const u = rows[0];
    // 067 : un compte désactivé perd ses sessions (aucune ne survit à une réactivation).
    if (!u.actif) {
      await require('../services/sessions.service').terminer({ userId: u.id, statut: 'revoquee', par: req.user.id,
        motif: 'Compte désactivé', tenantId: req.tenantId, action: 'SESSION_REVOCATION' });
    }
    const statut = u.actif ? 'activé' : 'désactivé';
    res.json({ message: `Compte ${statut} avec succès.`, user: { id: u.id, username: u.username, role: u.role, actif: u.actif } });
  } catch (err) {
    console.error('[Users] toggleActif :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// GET /api/users/roles-attribuables — rôles proposés à la création / modification.
// Dans un client : rôles autorisés par le cabinet (038). Hors client
// (super_admin) : comptes du cabinet.
const getRolesAttribuables = async (req, res) => {
  try {
    if (!req.tenantId) return res.json({ roles: rolesAttribuables(req), personnalise: false, type_compte: null });
    const info = await rolesClient.lire(req.tenantId);
    res.json({ roles: info.roles, personnalise: info.personnalise, type_compte: info.type_compte });
  } catch (err) {
    if (err instanceof rolesClient.ErreurMetier) return res.status(err.status).json({ error: err.message });
    console.error('[Users] rolesAttribuables :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// POST /api/users/:id/password  — réinitialiser mot de passe
const resetPassword = async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Minimum 6 caractères.' });
  }
  try {
    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12);
    const [count] = await User.update(
      { password_hash: hash },
      { where: { id: req.params.id, tenant_id: req.tenantId } }
    );
    if (count === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    // 067 : la personne devra se reconnecter avec le nouveau mot de passe.
    await require('../services/sessions.service').terminer({ userId: req.params.id, statut: 'revoquee', par: req.user.id,
      motif: 'Mot de passe réinitialisé par un administrateur', tenantId: req.tenantId, action: 'SESSION_REVOCATION' });
    res.json({ message: 'Mot de passe réinitialisé.' });
  } catch (err) {
    console.error('[Users] resetPassword :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// DELETE /api/users/:id
const deleteUser = async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Impossible de supprimer votre propre compte.' });
  }
  try {
    // C13 : un compte qui a déjà saisi ou décidé ne se supprime pas (la trace
    // des écritures, arrêts et validations doit garder son auteur).
    const [trace] = await User.sequelize.query(
      `SELECT EXISTS (SELECT 1 FROM journal WHERE created_by = :u)
           OR EXISTS (SELECT 1 FROM mouvements_attente WHERE created_by = :u) AS a_trace`,
      { replacements: { u: req.params.id }, type: User.sequelize.QueryTypes.SELECT });
    if (trace && trace.a_trace) {
      return res.status(409).json({ error: 'Cet utilisateur a déjà enregistré des opérations : il ne peut pas être supprimé. Désactivez-le (⏸) pour lui retirer l\'accès en gardant la trace de son travail.' });
    }
    const count = await User.destroy({ where: { id: req.params.id, tenant_id: req.tenantId } });
    if (count === 0) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    res.json({ message: 'Utilisateur supprimé.' });
  } catch (err) {
    console.error('[Users] deleteUser :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PUT /api/users/:id/rattrapage { autorise: true|false }
// Le directeur accorde ou retire à une personne de SON espace le droit de
// saisir des écritures antidatées (permission journal.rattrapage), sous forme
// d'exception individuelle : le reste de ses droits est inchangé.
const setRattrapage = async (req, res) => {
  const autorise = req.body?.autorise === true || req.body?.autorise === 'true';
  try {
    const u = await User.findOne({ where: { id: req.params.id, tenant_id: req.tenantId } });
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable dans cet espace.' });
    if (u.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre autorisation.' });
    if (u.role === 'super_admin') return res.status(400).json({ error: 'Compte non modifiable.' });
    if (autorise) {
      const { erreur } = await verifierCodesAccordables(['journal.rattrapage'], req.tenantId);
      if (erreur) return res.status(400).json({ error: erreur });
    }
    const base = await getBasePermissions(u.id);
    const dansBase = base.includes('journal.rattrapage');
    await sequelize.transaction(async (t) => {
      await sequelize.query(
        `DELETE FROM user_permissions WHERE user_id = :u AND permission_code = 'journal.rattrapage'`,
        { replacements: { u: u.id }, transaction: t });
      if (autorise !== dansBase) {
        await sequelize.query(
          `INSERT INTO user_permissions (user_id, permission_code, effet) VALUES (:u, 'journal.rattrapage', :e)`,
          { replacements: { u: u.id, e: autorise ? 'grant' : 'deny' }, transaction: t });
      }
      await sequelize.query(
        `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
         VALUES (:t, :me, :a, 'user', :u, CAST(:v AS jsonb))`,
        { replacements: { t: req.tenantId, me: req.user.id, a: autorise ? 'RATTRAPAGE_AUTORISE' : 'RATTRAPAGE_RETIRE',
          u: String(u.id), v: JSON.stringify({ username: u.username }) }, transaction: t });
    });
    res.json({
      autorise,
      message: autorise
        ? `${u.username} peut désormais saisir en rattrapage (opérations antidatées).`
        : `Rattrapage retiré à ${u.username} : retour à la saisie chronologique.`,
    });
  } catch (err) {
    console.error('[Users] setRattrapage :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PUT /api/users/:id/activite-obligatoire { obligatoire: true|false }
// Le directeur exige (ou non) d'une personne qu'elle rattache chacune de ses
// saisies à une activité / un projet (039). Réglage individuel, journalisé.
const setActiviteObligatoire = async (req, res) => {
  const obligatoire = req.body?.obligatoire === true || req.body?.obligatoire === 'true';
  try {
    const u = await User.findOne({ where: { id: req.params.id, tenant_id: req.tenantId }, attributes: ['id', 'username', 'role'] });
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable dans cet espace.' });
    if (u.id === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas modifier votre propre réglage.' });
    if (u.role === 'super_admin' || u.role === 'auditeur') return res.status(400).json({ error: 'Ce compte ne saisit pas d\'opérations.' });
    const [{ col }] = await sequelize.query(
      "SELECT COUNT(*)::int AS col FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'activite_obligatoire'",
      { type: sequelize.QueryTypes.SELECT });
    if (!col) return res.status(503).json({ error: 'Migration 039 non appliquée : lancez « node db/migrate.js » puis réessayez.' });
    const [{ n }] = await sequelize.query(
      'SELECT COUNT(*)::int AS n FROM activites WHERE tenant_id = :t AND actif',
      { replacements: { t: req.tenantId }, type: sequelize.QueryTypes.SELECT });
    await sequelize.transaction(async (t) => {
      await sequelize.query('UPDATE users SET activite_obligatoire = :o WHERE id = :u',
        { replacements: { o: obligatoire, u: u.id }, transaction: t });
      await sequelize.query(
        `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
         VALUES (:t, :me, :a, 'user', :u, CAST(:v AS jsonb))`,
        { replacements: { t: req.tenantId, me: req.user.id, a: obligatoire ? 'ACTIVITE_OBLIGATOIRE_ACTIVEE' : 'ACTIVITE_OBLIGATOIRE_RETIREE',
          u: String(u.id), v: JSON.stringify({ username: u.username }) }, transaction: t });
    });
    res.json({
      obligatoire,
      message: obligatoire
        ? `${u.username} devra désormais choisir une activité / un projet pour chaque opération saisie.`
          + (n === 0 ? ' Aucune activité active pour l\'instant : la règle s\'appliquera dès la première créée.' : '')
        : `Activité / projet redevenu facultatif pour ${u.username}.`,
    });
  } catch (err) {
    console.error('[Users] setActiviteObligatoire :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  setRattrapage, setActiviteObligatoire,
  getUsers, createUser, updateUser, toggleActif, resetPassword, deleteUser, getRolesAttribuables,
  ROLES_LABELS, ROLES_VALIDES, ROLES_TENANT, TOUS_ROLES,
};

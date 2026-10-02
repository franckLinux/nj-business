// src/controllers/permissions.controller.js
const { sequelize, Permission, TenantPermission, UserPermission, User } = require('../models');
const { getEffectivePermissions, getBasePermissions, verifierCodesAccordables } = require('../services/permission.service');
const { isCabinet } = require('../middleware/auth');
const { peutAccederTenant } = require('../services/affectation.service');

// ── Catalogue des permissions ──────────────────────────────────────────────

const getPermissions = async (req, res) => {
  try {
    let permissions = await Permission.findAll({ order: [['module', 'ASC'], ['code', 'ASC']], raw: true });
    // Hors cabinet (ex. directeur qui compose un profil métier) : seulement
    // les permissions qu'il détient lui-même — il ne peut pas en accorder
    // davantage (voir roles.controller → setRolePermissions).
    if (!isCabinet(req.user)) {
      const miennes = new Set(await getEffectivePermissions({
        tenantId: req.user.tenantId, userId: req.user.id, role: req.user.role,
      }) || []);
      permissions = permissions.filter((p) => miennes.has(p.code));
    }
    res.json(permissions);
  } catch (err) {
    console.error('[Permissions]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// Le catalogue est défini par les migrations SQL (002, 012, 014…) et lu par le
// code (requirePermission('xxx.yyy')). Créer ou supprimer un code depuis
// l'interface ne servait à rien (aucune route ne le vérifiait) ou cassait des
// droits (suppression en cascade). Seuls le libellé et la description restent
// modifiables.
const updatePermission = async (req, res) => {
  const { code } = req.params;
  const patch = {};
  if (req.body.nom !== undefined) {
    if (!String(req.body.nom).trim()) return res.status(400).json({ error: 'Nom obligatoire.' });
    patch.nom = String(req.body.nom).trim();
  }
  if (req.body.module !== undefined && String(req.body.module).trim()) patch.module = String(req.body.module).trim();
  if (req.body.description !== undefined) patch.description = req.body.description || '';
  try {
    const [count, rows] = await Permission.update(patch, { where: { code }, returning: true });
    if (count === 0) return res.status(404).json({ error: 'Permission introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[Permissions] updatePermission :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── Permissions par tenant ─────────────────────────────────────────────────

const getTenantPermissions = async (req, res) => {
  const { tenantId } = req.params;
  try {
    if (!(await peutAccederTenant(req.user, tenantId))) {
      return res.status(403).json({ error: 'Ce client ne vous est pas affecté.' });
    }
    const perms = await TenantPermission.findAll({ where: { tenant_id: tenantId }, attributes: ['permission_code'], raw: true });
    // Aucun plafond = aucune restriction : on présente tout le catalogue coché.
    // Sinon la modale s'ouvrait vide et décocher UNE case créait un plafond
    // réduit à presque rien pour tout le client (même piège que côté utilisateur).
    if (perms.length === 0) {
      const toutes = await Permission.findAll({ attributes: ['code'], raw: true });
      return res.json(toutes.map((p) => p.code));
    }
    res.json(perms.map((r) => r.permission_code));
  } catch (err) {
    console.error('[Permissions]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const setTenantPermissions = async (req, res) => {
  const { tenantId } = req.params;
  let { codes } = req.body; // tableau de codes à accorder
  if (!Array.isArray(codes)) return res.status(400).json({ error: 'codes doit être un tableau.' });
  try {
    // Tout le catalogue coché = pas de plafond (on n'écrit rien). Ainsi une
    // permission ajoutée plus tard au catalogue (ex. journal.ran en 012) n'est
    // pas bloquée en silence pour ce client.
    const catalogue = (await Permission.findAll({ attributes: ['code'], raw: true })).map((p) => p.code);
    codes = [...new Set(codes)].filter((c) => catalogue.includes(c));
    const toutCoche = catalogue.every((c) => codes.includes(c));
    if (codes.length === 0) {
      return res.status(400).json({ error: 'Un client sans aucune permission ne pourrait plus rien faire. Cochez au moins une fonctionnalité.' });
    }
    await sequelize.transaction(async (t) => {
      await TenantPermission.destroy({ where: { tenant_id: tenantId }, transaction: t });
      if (!toutCoche) {
        await TenantPermission.bulkCreate(
          codes.map((permission_code) => ({ tenant_id: tenantId, permission_code })),
          { transaction: t, ignoreDuplicates: true }
        );
      }
    });
    res.json({ ok: true, count: codes.length });
  } catch (err) {
    console.error('[Permissions]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── Permissions par utilisateur ────────────────────────────────────────────

// Renvoie les permissions EFFECTIVES de la personne (ce qu'elle peut
// réellement faire aujourd'hui), et non les seules lignes de user_permissions.
//
// C'est indispensable pour l'écran d'attribution : enregistrer y remplace la
// totalité de la liste (une permission individuelle est exclusive, elle ne
// s'ajoute pas au défaut du rôle). Si la modale s'ouvrait vide pour quelqu'un
// qui n'a encore aucune surcharge, cocher une seule case lui retirerait tout
// le reste — accorder un droit reviendrait à en supprimer dix.
const getUserPermissions = async (req, res) => {
  const { userId } = req.params;
  try {
    const u = await User.findByPk(userId, { attributes: ['id', 'role', 'tenant_id'], raw: true });
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    if (u.tenant_id && !(await peutAccederTenant(req.user, u.tenant_id))) {
      return res.status(403).json({ error: 'Ce client ne vous est pas affecté.' });
    }

    const effectives = await getEffectivePermissions({
      tenantId: u.tenant_id, userId: u.id, role: u.role,
    });
    // null = super_admin, aucune restriction : on présente tout le catalogue.
    if (effectives === null) {
      const toutes = await Permission.findAll({ attributes: ['code'], raw: true });
      return res.json(toutes.map((p) => p.code));
    }
    res.json(effectives);
  } catch (err) {
    console.error('[Permissions]', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// Enregistre la liste COCHÉE (droits effectifs voulus) sous forme
// d'EXCEPTIONS par rapport au rôle de la personne :
//   grant = coché mais absent du rôle ; deny = dans le rôle mais décoché.
// La modale n'a pas changé (elle envoie toujours la liste complète), mais un
// changement ultérieur du rôle ou du catalogue profite désormais à la personne.
const setUserPermissions = async (req, res) => {
  const { userId } = req.params;
  let { codes } = req.body;
  if (!Array.isArray(codes)) return res.status(400).json({ error: 'codes doit être un tableau.' });
  try {
    const u = await User.findByPk(userId, { attributes: ['id', 'tenant_id', 'role'], raw: true });
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    if (u.role === 'super_admin') return res.status(400).json({ error: 'Un super_admin a déjà tous les droits.' });
    const verif = await verifierCodesAccordables(codes, u.tenant_id);
    if (verif.erreur) return res.status(400).json({ error: verif.erreur });
    codes = new Set(verif.codes);

    const base = new Set(await getBasePermissions(userId));
    // Un code bloqué par le plafond n'apparaît jamais coché : ne pas le
    // transformer en « deny » qui survivrait à un élargissement du plafond.
    const plafondRows = u.tenant_id
      ? await TenantPermission.findAll({ where: { tenant_id: u.tenant_id }, attributes: ['permission_code'], raw: true })
      : [];
    const plafond = plafondRows.length ? new Set(plafondRows.map((r) => r.permission_code)) : null;

    const grants = [...codes].filter((c) => !base.has(c));
    const denies = [...base].filter((c) => !codes.has(c) && (!plafond || plafond.has(c)));

    await sequelize.transaction(async (t) => {
      await UserPermission.destroy({ where: { user_id: userId }, transaction: t });
      const lignes = [
        ...grants.map((permission_code) => ({ user_id: userId, permission_code, effet: 'grant' })),
        ...denies.map((permission_code) => ({ user_id: userId, permission_code, effet: 'deny' })),
      ];
      if (lignes.length) await UserPermission.bulkCreate(lignes, { transaction: t });
    });
    res.json({ ok: true, ajoutees: grants, retirees: denies });
  } catch (err) {
    console.error('[Permissions] setUserPermissions :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// DELETE /users/:userId/permissions — supprime toutes les exceptions : la
// personne revient exactement aux droits de son rôle / profil métier.
const resetUserPermissions = async (req, res) => {
  try {
    const n = await UserPermission.destroy({ where: { user_id: req.params.userId } });
    res.json({ ok: true, supprimees: n });
  } catch (err) {
    console.error('[Permissions] resetUserPermissions :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getPermissions, updatePermission,
  getTenantPermissions, setTenantPermissions,
  getUserPermissions, setUserPermissions, resetUserPermissions,
};

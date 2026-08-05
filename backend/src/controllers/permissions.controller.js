// src/controllers/permissions.controller.js
const { query } = require('../config/database');

// ── Catalogue des permissions ──────────────────────────────────────────────

const getPermissions = async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM permissions ORDER BY module, code');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const createPermission = async (req, res) => {
  const { code, nom, module, description } = req.body;
  if (!code || !nom || !module) return res.status(400).json({ error: 'code, nom et module sont obligatoires.' });
  if (!/^[a-z_]+\.[a-z_]+$/.test(code)) return res.status(400).json({ error: 'Format code invalide (ex: journal.create).' });
  try {
    const { rows } = await query(
      'INSERT INTO permissions(code,nom,module,description) VALUES($1,$2,$3,$4) RETURNING *',
      [code, nom, module, description || '']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce code de permission existe déjà.' });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const updatePermission = async (req, res) => {
  const { code } = req.params;
  const { nom, module, description } = req.body;
  try {
    const { rows } = await query(
      'UPDATE permissions SET nom=$1, module=$2, description=$3 WHERE code=$4 RETURNING *',
      [nom, module, description || '', code]
    );
    if (!rows.length) return res.status(404).json({ error: 'Permission introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const deletePermission = async (req, res) => {
  const { code } = req.params;
  try {
    await query('DELETE FROM permissions WHERE code=$1', [code]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── Permissions par tenant ─────────────────────────────────────────────────

const getTenantPermissions = async (req, res) => {
  const { tenantId } = req.params;
  try {
    const { rows } = await query(
      'SELECT permission_code FROM tenant_permissions WHERE tenant_id=$1',
      [tenantId]
    );
    res.json(rows.map(r => r.permission_code));
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const setTenantPermissions = async (req, res) => {
  const { tenantId } = req.params;
  const { codes } = req.body; // tableau de codes à accorder
  if (!Array.isArray(codes)) return res.status(400).json({ error: 'codes doit être un tableau.' });
  try {
    await query('BEGIN');
    await query('DELETE FROM tenant_permissions WHERE tenant_id=$1', [tenantId]);
    if (codes.length > 0) {
      const values = codes.map((c, i) => `($1,$${i + 2})`).join(',');
      await query(
        `INSERT INTO tenant_permissions(tenant_id,permission_code) VALUES ${values} ON CONFLICT DO NOTHING`,
        [tenantId, ...codes]
      );
    }
    await query('COMMIT');
    res.json({ ok: true, count: codes.length });
  } catch (err) {
    await query('ROLLBACK');
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── Permissions par utilisateur ────────────────────────────────────────────

const getUserPermissions = async (req, res) => {
  const { userId } = req.params;
  try {
    const { rows } = await query(
      'SELECT permission_code FROM user_permissions WHERE user_id=$1::uuid',
      [userId]
    );
    res.json(rows.map(r => r.permission_code));
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

const setUserPermissions = async (req, res) => {
  const { userId } = req.params;
  const { codes } = req.body;
  if (!Array.isArray(codes)) return res.status(400).json({ error: 'codes doit être un tableau.' });
  try {
    await query('BEGIN');
    await query('DELETE FROM user_permissions WHERE user_id=$1::uuid', [userId]);
    if (codes.length > 0) {
      const values = codes.map((c, i) => `($1::uuid,$${i + 2})`).join(',');
      await query(
        `INSERT INTO user_permissions(user_id,permission_code) VALUES ${values} ON CONFLICT DO NOTHING`,
        [userId, ...codes]
      );
    }
    await query('COMMIT');
    res.json({ ok: true, count: codes.length });
  } catch (err) {
    await query('ROLLBACK');
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getPermissions, createPermission, updatePermission, deletePermission,
  getTenantPermissions, setTenantPermissions,
  getUserPermissions, setUserPermissions,
};

const { query, pool } = require('../config/database');

// ── Liste des rôles du tenant ────────────────────────────────────────────────
const getRoles = async (req, res) => {
  try {
    const result = await query(
      `SELECT r.*, COUNT(rp.permission_code)::int AS nb_permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE r.tenant_id = $1
       GROUP BY r.id
       ORDER BY r.created_at ASC`,
      [req.tenantId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Créer un rôle ────────────────────────────────────────────────────────────
const createRole = async (req, res) => {
  const { nom, code, description, couleur } = req.body;
  if (!nom || !code) return res.status(400).json({ error: 'Nom et code obligatoires.' });
  const safeCode = code.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  try {
    const result = await query(
      `INSERT INTO roles (nom, code, description, couleur, tenant_id)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [nom.trim(), safeCode, description||'', couleur||'#6366f1', req.tenantId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Le code "${code}" existe déjà.` });
    res.status(500).json({ error: err.message });
  }
};

// ── Modifier un rôle ─────────────────────────────────────────────────────────
const updateRole = async (req, res) => {
  const { id } = req.params;
  const { nom, description, couleur } = req.body;
  if (!nom) return res.status(400).json({ error: 'Nom obligatoire.' });
  try {
    const result = await query(
      `UPDATE roles SET nom=$1, description=$2, couleur=$3
       WHERE id=$4 AND tenant_id=$5 RETURNING *`,
      [nom.trim(), description||'', couleur||'#6366f1', id, req.tenantId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Rôle introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Supprimer un rôle ────────────────────────────────────────────────────────
const deleteRole = async (req, res) => {
  const { id } = req.params;
  try {
    await query('DELETE FROM roles WHERE id=$1 AND tenant_id=$2', [id, req.tenantId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Permissions d'un rôle ────────────────────────────────────────────────────
const getRolePermissions = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query(
      `SELECT permission_code FROM role_permissions WHERE role_id=$1`,
      [id]
    );
    res.json(result.rows.map(r => r.permission_code));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Définir les permissions d'un rôle (remplace tout) ───────────────────────
const setRolePermissions = async (req, res) => {
  const { id } = req.params;
  const codes = Array.isArray(req.body.codes) ? req.body.codes : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM role_permissions WHERE role_id=$1', [id]);
    if (codes.length > 0) {
      const vals = codes.map((c, i) => `($1, $${i+2})`).join(',');
      await client.query(`INSERT INTO role_permissions (role_id, permission_code) VALUES ${vals}`, [id, ...codes]);
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: codes.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

module.exports = { getRoles, createRole, updateRole, deleteRole, getRolePermissions, setRolePermissions };

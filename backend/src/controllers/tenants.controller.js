// src/controllers/tenants.controller.js
const { Op } = require('sequelize');
const { Tenant } = require('../models');
const { query, getClient } = require('../config/database');
const { tenantsAccessibles } = require('../services/affectation.service');
const { seedRubriquesDefaut } = require('./rubriques.controller');
const { seedJournauxDefaut } = require('./journaux.controller');

// ── GET /api/tenants ───────────────────────────────────────────────────────
const getTenants = async (req, res) => {
  try {
    // Comptable cabinet : uniquement ses clients affectés (migration 015).
    const accessibles = await tenantsAccessibles(req.user);
    const tenants = await Tenant.findAll({
      where: accessibles === null ? {} : { id: { [Op.in]: accessibles } },
      attributes: ['id', 'slug', 'nom', 'actif', 'created_at'],
      order: [['nom', 'ASC']],
    });
    res.json(tenants);
  } catch (err) {
    console.error('[Tenants] getTenants :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/tenants ──────────────────────────────────────────────────────
const createTenant = async (req, res) => {
  const { slug, nom, caissier_nom, directeur_nom, devise } = req.body;
  if (!slug || !nom) return res.status(400).json({ error: 'Nom et slug obligatoires.' });
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'Slug invalide.' });
  try {
    const tenant = await Tenant.create({
      slug,
      nom,
      caissier_nom: caissier_nom || '',
      directeur_nom: directeur_nom || '',
      devise: devise || 'FCFA',
    });
    await seedRubriquesDefaut(tenant.id);
    await seedJournauxDefaut(tenant.id);
    res.status(201).json(tenant);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: 'Slug déjà utilisé.' });
    console.error('[Tenants] createTenant :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PATCH /api/tenants/:id/actif ───────────────────────────────────────────
const toggleActif = async (req, res) => {
  const { actif } = req.body;
  try {
    await Tenant.update({ actif: !!actif }, { where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Tenants] toggleActif :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── Affectations d'un comptable cabinet (super_admin) ─────────────────────
// GET /api/users/:userId/affectations → [tenant_id…]
const getAffectations = async (req, res) => {
  try {
    const { rows } = await query('SELECT tenant_id FROM cabinet_affectations WHERE user_id = $1', [req.params.userId]);
    res.json(rows.map((r) => r.tenant_id));
  } catch (err) {
    console.error('[Tenants] getAffectations :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PUT /api/users/:userId/affectations { tenantIds: [...] } — remplace la liste.
const setAffectations = async (req, res) => {
  const { tenantIds } = req.body;
  if (!Array.isArray(tenantIds)) return res.status(400).json({ error: 'tenantIds doit être un tableau.' });
  try {
    const { rows: [u] } = await query('SELECT role, tenant_id FROM users WHERE id = $1', [req.params.userId]);
    if (!u) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    if (u.role !== 'comptable_cabinet' || u.tenant_id) {
      return res.status(400).json({ error: 'Les affectations ne concernent que les comptables du cabinet.' });
    }
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ids = [...new Set(tenantIds.map(String))];
    if (ids.some((id) => !UUID_RE.test(id))) return res.status(400).json({ error: 'Identifiant client invalide.' });
    // Transaction sur UNE connexion dédiée (query() passe par le pool).
    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM cabinet_affectations WHERE user_id = $1', [req.params.userId]);
      if (ids.length) {
        await client.query(
          `INSERT INTO cabinet_affectations(user_id, tenant_id)
           SELECT $1, t.id FROM tenants t WHERE t.id = ANY($2::uuid[])`,
          [req.params.userId, ids]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true, count: ids.length });
  } catch (err) {
    console.error('[Tenants] setAffectations :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { getTenants, createTenant, toggleActif, getAffectations, setAffectations };

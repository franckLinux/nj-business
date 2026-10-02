// src/controllers/tenants.controller.js
const { Tenant } = require('../models');
const { seedRubriquesDefaut } = require('./rubriques.controller');
const { seedJournauxDefaut } = require('./journaux.controller');

// ── GET /api/tenants ───────────────────────────────────────────────────────
const getTenants = async (req, res) => {
  try {
    const tenants = await Tenant.findAll({
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

module.exports = { getTenants, createTenant, toggleActif };

// src/controllers/journaux.controller.js
// Gestion dynamique des journaux (Caisse, OM, MOMO, Banque, Carte prépayée, Autre)
// + Génération automatique du code par type (CS1, BQ1, OM1, MM1, CP1, AU1)
const { Op } = require('sequelize');
const { Journal, Mouvement, User } = require('../models');

const TYPES_JOURNAUX = {
  caisse:         { label: 'Journal de Caisse',     icon: '💵' },
  banque:         { label: 'Journal Banque',         icon: '🏦' },
  om:             { label: 'Orange Money',          icon: '🟠' },
  momo:           { label: 'MTN Mobile Money',      icon: '🟡' },
  carte_prepayee: { label: 'Carte Prépayée',        icon: '💳' },
  autre:          { label: 'Autre',                 icon: '📒' },
};

// ── Mapping type → préfixe code journal ──────────────────────────────────
const PREFIX_BY_TYPE = {
  caisse:         'CS',
  banque:         'BQ',
  om:             'OM',
  momo:           'MM',
  carte_prepayee: 'CP',
  autre:          'AU',
};

// ── Calcul du prochain numéro disponible pour un (tenant, prefix) ─────────
// Cherche tous les codes existants du tenant qui matchent ^PREFIX\d+$,
// extrait le max et retourne max+1.
const nextNumberForPrefix = async (tenantId, prefix) => {
  const rows = await Journal.findAll({
    where: { tenant_id: tenantId, code: { [Op.regexp]: `^${prefix}[0-9]+$` } },
    attributes: ['code'],
    raw: true,
  });
  if (rows.length === 0) return 1;
  const nums = rows
    .map(r => parseInt(r.code.substring(prefix.length), 10))
    .filter(n => Number.isFinite(n) && n > 0);
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
};

// ── GET /api/journaux/next-code?type=banque ───────────────────────────────
const getNextCode = async (req, res) => {
  const { type } = req.query;
  if (!type || !PREFIX_BY_TYPE[type]) {
    return res.status(400).json({
      error: `Paramètre 'type' requis. Valeurs : ${Object.keys(PREFIX_BY_TYPE).join(', ')}`,
    });
  }
  try {
    const prefix = PREFIX_BY_TYPE[type];
    const n      = await nextNumberForPrefix(req.tenantId, prefix);
    res.json({ code: `${prefix}${n}`, prefix, numero: n });
  } catch (err) {
    console.error('[Journaux] getNextCode :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/journaux ─────────────────────────────────────────────────────
const getJournaux = async (req, res) => {
  try {
    const journaux = await Journal.findAll({
      where: { tenant_id: req.tenantId },
      include: [
        { model: User, as: 'responsableSaisie', attributes: ['username'], required: false },
        { model: User, as: 'responsableArret', attributes: ['username'], required: false },
      ],
      order: [['ordre', 'ASC'], ['type', 'ASC'], ['nom', 'ASC']],
    });
    const rows = journaux.map((j) => {
      const { responsableSaisie, responsableArret, ...rest } = j.toJSON();
      return {
        ...rest,
        responsable_saisie_nom: responsableSaisie ? responsableSaisie.username : null,
        responsable_arret_nom: responsableArret ? responsableArret.username : null,
      };
    });
    const grouped = {};
    rows.forEach(j => {
      if (!grouped[j.type]) grouped[j.type] = [];
      grouped[j.type].push(j);
    });
    res.json({ journaux: rows, grouped, types: TYPES_JOURNAUX });
  } catch (err) {
    console.error('[Journaux] getJournaux :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/journaux ────────────────────────────────────────────────────
// Si le client ne fournit pas de code, on le génère automatiquement.
const createJournal = async (req, res) => {
  let { code, nom, type, devise, responsable_saisie, responsable_arret, ordre } = req.body;
  if (!nom || !type) {
    return res.status(400).json({ error: 'Nom et type obligatoires.' });
  }
  if (!Object.keys(TYPES_JOURNAUX).includes(type)) {
    return res.status(400).json({
      error: `Type invalide. Valeurs : ${Object.keys(TYPES_JOURNAUX).join(', ')}`,
    });
  }

  try {
    if (!code || !code.trim()) {
      const prefix = PREFIX_BY_TYPE[type];
      const n      = await nextNumberForPrefix(req.tenantId, prefix);
      code         = `${prefix}${n}`;
    } else {
      code = code.trim().toUpperCase();
    }

    const journal = await Journal.create({
      tenant_id: req.tenantId, code, nom, type, devise: devise || 'FCFA',
      responsable_saisie: responsable_saisie || null,
      responsable_arret: responsable_arret || null,
      ordre: ordre || 0,
    });
    res.status(201).json(journal);
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      // Course concurrente : retry une fois avec un nouveau numéro
      try {
        const prefix = PREFIX_BY_TYPE[type];
        const n      = await nextNumberForPrefix(req.tenantId, prefix);
        const retryCode = `${prefix}${n}`;
        const journal = await Journal.create({
          tenant_id: req.tenantId, code: retryCode, nom, type, devise: devise || 'FCFA',
          responsable_saisie: responsable_saisie || null,
          responsable_arret: responsable_arret || null,
          ordre: ordre || 0,
        });
        return res.status(201).json(journal);
      } catch (e2) {
        return res.status(409).json({ error: 'Ce code de journal existe déjà.' });
      }
    }
    console.error('[Journaux] createJournal :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PUT /api/journaux/:id ─────────────────────────────────────────────────
const updateJournal = async (req, res) => {
  const { nom, devise, responsable_saisie, responsable_arret, ordre, actif } = req.body;
  try {
    const [count, rows] = await Journal.update(
      {
        nom,
        devise: devise || 'FCFA',
        responsable_saisie: responsable_saisie || null,
        responsable_arret: responsable_arret || null,
        ordre: ordre || 0,
        actif: actif !== false,
      },
      { where: { id: req.params.id, tenant_id: req.tenantId }, returning: true }
    );
    if (count === 0) return res.status(404).json({ error: 'Journal introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/journaux/:id ──────────────────────────────────────────────
const deleteJournal = async (req, res) => {
  try {
    const count = await Mouvement.count({ where: { journal_id: req.params.id } });
    if (count > 0) {
      return res.status(400).json({
        error: `Ce journal contient ${count} mouvement(s). Désactivez-le plutôt que de le supprimer.`,
      });
    }
    await Journal.destroy({ where: { id: req.params.id, tenant_id: req.tenantId } });
    res.json({ message: 'Journal supprimé.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── Seed journaux par défaut pour un nouveau tenant ──────────────────────
// Utilise la nouvelle convention de codes (CS1, OM1, MM1, BQ1, CP1).
// `transaction` (facultative) : voir seedRubriquesDefaut.
const JOURNAUX_DEFAUT = [
  { code:'CS1', nom:'Caisse Principale',  type:'caisse',         ordre:1 },
  { code:'OM1', nom:'Orange Money',        type:'om',             ordre:2 },
  { code:'MM1', nom:'MTN Mobile Money',    type:'momo',           ordre:3 },
  { code:'BQ1', nom:'Compte Banque',       type:'banque',         ordre:4 },
  { code:'CP1', nom:'Carte Prépayée',      type:'carte_prepayee', ordre:5 },
];
const seedJournauxDefaut = async (tenantId, { transaction } = {}) => {
  const defauts = JOURNAUX_DEFAUT;
  for (const j of defauts) {
    await Journal.findOrCreate({
      transaction,
      where: { tenant_id: tenantId, code: j.code },
      defaults: { nom: j.nom, type: j.type, ordre: j.ordre },
    });
  }
};

module.exports = {
  getJournaux, createJournal, updateJournal, deleteJournal,
  getNextCode, seedJournauxDefaut, JOURNAUX_DEFAUT,
  TYPES_JOURNAUX, PREFIX_BY_TYPE,
};

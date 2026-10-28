// src/controllers/rubriques.controller.js
const { Rubrique } = require('../models');
const passerelle = require('../services/passerelle.service');
const { userHasPermission } = require('../services/permission.service');

const RUBRIQUES_DEFAUT = [
  { code:'ABQ',  intitule:'APPROV BANQUE',              type:'entree',  est_virement_interne:false, code_comptable:'',     ordre:1 },
  { code:'ACH',  intitule:'APPROV CHINOIS',             type:'entree',  est_virement_interne:false, code_comptable:'',     ordre:2 },
  { code:'ACA',  intitule:'APPROV CAISSE',              type:'entree',  est_virement_interne:false, code_comptable:'',     ordre:3 },
  { code:'ANJ',  intitule:'APPROV NJ',                  type:'entree',  est_virement_interne:false, code_comptable:'',     ordre:4 },
  { code:'AFO',  intitule:'APPROV FORMATION',           type:'entree',  est_virement_interne:false, code_comptable:'',     ordre:5 },
  { code:'VCOM', intitule:'VIREMENT CAISSE OM',         type:'entree',  est_virement_interne:true,  code_comptable:'',     ordre:6 },
  { code:'VOMC', intitule:'VIREMENT OM CAISSE',         type:'entree',  est_virement_interne:true,  code_comptable:'',     ordre:7 },
  { code:'1',    intitule:'ACHAT MATERIEL DE BUREAU',   type:'depense', est_virement_interne:false, code_comptable:'6015', ordre:1 },
  { code:'2',    intitule:'ACHAT JOURNAUX HEBDOMADAIRE',type:'depense', est_virement_interne:false, code_comptable:'6181', ordre:2 },
  { code:'3',    intitule:'FACTURE ENEO ET CAMWATER',   type:'depense', est_virement_interne:false, code_comptable:'6053', ordre:3 },
  { code:'4',    intitule:'FACTURE INTERNET',           type:'depense', est_virement_interne:false, code_comptable:'6282', ordre:4 },
  { code:'5',    intitule:'FRAIS IMPRESSIONS',          type:'depense', est_virement_interne:false, code_comptable:'6252', ordre:5 },
  { code:'6',    intitule:'FRAIS DE TRANSPORT DIVERS',  type:'depense', est_virement_interne:false, code_comptable:'6251', ordre:6 },
  { code:'7',    intitule:"FRAIS D ENTRETIEN BUREAU",   type:'depense', est_virement_interne:false, code_comptable:'6135', ordre:7 },
  { code:'8',    intitule:"FRAIS D INDEMNITES DE TRANSPORT",type:'depense',est_virement_interne:false,code_comptable:'6611',ordre:8 },
  { code:'9',    intitule:'FRAIS CNPS',                 type:'depense', est_virement_interne:false, code_comptable:'6641', ordre:9 },
  { code:'10',   intitule:'IMPREVUS',                   type:'depense', est_virement_interne:false, code_comptable:'6599', ordre:10 },
  { code:'11',   intitule:'FRAIS IMPOTS',               type:'depense', est_virement_interne:false, code_comptable:'6441', ordre:11 },
  { code:'12',   intitule:'FRAIS OM',                   type:'depense', est_virement_interne:false, code_comptable:'6285', ordre:12 },
  { code:'13',   intitule:'FRAIS MOMO',                 type:'depense', est_virement_interne:false, code_comptable:'6285', ordre:13 },
  { code:'SCOM', intitule:'SORTIE CAISSE VERS OM',      type:'depense', est_virement_interne:true,  code_comptable:'',     ordre:14 },
  { code:'SOMC', intitule:'SORTIE OM VERS CAISSE',      type:'depense', est_virement_interne:true,  code_comptable:'',     ordre:15 },
];

// GET /api/rubriques
const getRubriques = async (req, res) => {
  try {
    const rows = await Rubrique.findAll({
      where: { tenant_id: req.tenantId, actif: true },
      order: [['type', 'ASC'], ['ordre', 'ASC'], ['code', 'ASC']],
    });
    res.json({
      entrees: rows.filter((r) => r.type === 'entree'),
      depenses: rows.filter((r) => r.type === 'depense'),
    });
  } catch (err) {
    console.error('[Rubriques] getRubriques :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// POST /api/rubriques
const createRubrique = async (req, res) => {
  const { code, intitule, type, est_virement_interne, code_comptable, ordre } = req.body;
  if (!code || !intitule || !type) {
    return res.status(400).json({ error: 'Code, intitulé et type requis.' });
  }
  try {
    // Sans « Gérer les rubriques » (rubriques.create seul, 044) : la rubrique
    // est créée pour la saisie, sans compte comptable ni virement interne —
    // ces choix relèvent du comptable (passerelle comptable).
    const complet = await userHasPermission({ tenantId: req.tenantId, userId: req.user.id, role: req.user.role }, 'rubriques.edit');
    const rubrique = await Rubrique.create({
      tenant_id: req.tenantId,
      code: code.toUpperCase(),
      intitule,
      type,
      est_virement_interne: complet ? (est_virement_interne || false) : false,
      code_comptable: complet ? (code_comptable || '') : '',
      ordre: ordre || 0,
    });
    res.status(201).json({ ...rubrique.toJSON(),
      ...(!complet && (code_comptable || est_virement_interne)
        ? { message: 'Rubrique créée. Le code comptable et le virement interne seront définis par le comptable.' } : {}) });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: 'Ce code existe déjà.' });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PUT /api/rubriques/:id
const updateRubrique = async (req, res) => {
  const { intitule, est_virement_interne, code_comptable, ordre, actif } = req.body;
  try {
    // Passerelle comptable (037) : une rubrique dont le compte a été VALIDÉ par
    // le cabinet garde ce compte ; un nouveau code devient une proposition.
    let codeRetenu = code_comptable || '';
    let passerelleMessage = null;
    const existe = await Rubrique.findOne({ where: { id: req.params.id, tenant_id: req.tenantId }, attributes: ['id'] });
    if (!existe) return res.status(404).json({ error: 'Rubrique introuvable.' });
    const interception = await passerelle.interceptionModificationRubrique({
      tenantId: req.tenantId, userId: req.user.id, rubriqueId: existe.id, nouveauCode: codeRetenu,
    });
    if (interception) {
      codeRetenu = interception.conserver;
      passerelleMessage = interception.message;
    }

    const [count, rows] = await Rubrique.update(
      {
        intitule,
        est_virement_interne: est_virement_interne !== undefined ? est_virement_interne : false,
        code_comptable: codeRetenu,
        ordre: ordre || 0,
        actif: actif !== false,
      },
      { where: { id: req.params.id, tenant_id: req.tenantId }, returning: true }
    );
    if (count === 0) return res.status(404).json({ error: 'Rubrique introuvable.' });
    res.json(passerelleMessage ? { ...rows[0].toJSON(), passerelle_message: passerelleMessage } : rows[0]);
  } catch (err) {
    if (err instanceof passerelle.ErreurMetier) return res.status(err.status).json({ error: err.message });
    console.error('[Rubriques] updateRubrique :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/rubriques/:id ─────────────────────────────────────────────
// Désactivation logique (actif=false) : on ne supprime jamais une rubrique
// déjà référencée par des mouvements existants.
const deleteRubrique = async (req, res) => {
  await Rubrique.update({ actif: false }, { where: { id: req.params.id, tenant_id: req.tenantId } });
  res.json({ message: 'Rubrique désactivée.' });
};

// Seed rubriques par défaut pour un nouveau tenant
// `transaction` (facultative) : permet à la création d'un client de tout
// faire dans une seule transaction (tenants.controller → createTenant).
const seedRubriquesDefaut = async (tenantId, { transaction } = {}) => {
  for (const r of RUBRIQUES_DEFAUT) {
    await Rubrique.findOrCreate({
      transaction,
      where: { tenant_id: tenantId, code: r.code },
      defaults: {
        intitule: r.intitule,
        type: r.type,
        est_virement_interne: r.est_virement_interne,
        code_comptable: r.code_comptable,
        ordre: r.ordre,
      },
    });
  }
};

module.exports = { getRubriques, createRubrique, updateRubrique, deleteRubrique, seedRubriquesDefaut, RUBRIQUES_DEFAUT };

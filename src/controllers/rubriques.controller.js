// src/controllers/rubriques.controller.js
const { query } = require('../config/database');

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
    // Patch auto : ajouter code_comptable si absent
    await query('ALTER TABLE rubriques ADD COLUMN IF NOT EXISTS code_comptable TEXT DEFAULT \'\'').catch(()=>{});

    const { rows } = await query(
      `SELECT * FROM rubriques
       WHERE tenant_id=$1 AND actif=true
       ORDER BY type, ordre, code`,
      [req.tenantId]
    );
    res.json({
      entrees:  rows.filter(r => r.type === 'entree'),
      depenses: rows.filter(r => r.type === 'depense'),
    });
  } catch (err) {
    console.error('[Rubriques] getRubriques :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// POST /api/rubriques
const createRubrique = async (req, res) => {
  if (!['directeur','super_admin','comptable_cabinet'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Action non autorisée.' });
  }
  const { code, intitule, type, est_virement_interne, code_comptable, ordre } = req.body;
  if (!code || !intitule || !type) {
    return res.status(400).json({ error: 'Code, intitulé et type requis.' });
  }
  try {
    const { rows } = await query(
      `INSERT INTO rubriques(tenant_id, code, intitule, type, est_virement_interne, code_comptable, ordre)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.tenantId, code.toUpperCase(), intitule, type,
       est_virement_interne || false, code_comptable || '', ordre || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce code existe déjà.' });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PUT /api/rubriques/:id
const updateRubrique = async (req, res) => {
  if (!['directeur','super_admin','comptable_cabinet'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Action non autorisée.' });
  }
  const { intitule, est_virement_interne, code_comptable, ordre, actif } = req.body;
  try {
    const { rows } = await query(
      `UPDATE rubriques
       SET intitule=$1, est_virement_interne=$2, code_comptable=$3, ordre=$4, actif=$5
       WHERE id=$6 AND tenant_id=$7 RETURNING *`,
      [intitule, est_virement_interne !== undefined ? est_virement_interne : false,
       code_comptable || '', ordre || 0, actif !== false,
       req.params.id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Rubrique introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// Seed rubriques par défaut pour un nouveau tenant
const seedRubriquesDefaut = async (tenantId) => {
  // Patch auto colonne
  await query('ALTER TABLE rubriques ADD COLUMN IF NOT EXISTS code_comptable TEXT DEFAULT \'\'').catch(()=>{});
  for (const r of RUBRIQUES_DEFAUT) {
    await query(
      `INSERT INTO rubriques(tenant_id, code, intitule, type, est_virement_interne, code_comptable, ordre)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(tenant_id, code) DO NOTHING`,
      [tenantId, r.code, r.intitule, r.type, r.est_virement_interne, r.code_comptable, r.ordre]
    );
  }
};

module.exports = { getRubriques, createRubrique, updateRubrique, seedRubriquesDefaut, RUBRIQUES_DEFAUT };

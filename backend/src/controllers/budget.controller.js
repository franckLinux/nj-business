const { Op } = require('sequelize');
const { sequelize, Budget, BudgetValidation, DepenseAttente, RessourceAttente } = require('../models');
const hebdo = require('../services/budget_hebdo.service');

// Budget hebdomadaire (040) : une erreur métier du calendrier → 4xx explicite.
const refusHebdo = (res, err) => {
  if (err instanceof hebdo.ErreurMetier) { res.status(err.status).json({ error: err.message }); return true; }
  return false;
};
const libelleSemaine = (mois, annee, k) => {
  const s = hebdo.semainesDuMois(mois, annee).find((x) => x.num === k);
  return s ? `la semaine ${s.libelle.replace(/^S\d+ · /, `S${k} (`)}) de ${mois} ${annee}` : `${mois} ${annee}`;
};
const periodeLib = (mois, annee, k) => (k ? libelleSemaine(mois, annee, k) : `${mois} ${annee}`);

// ── Vue d'un mois hebdomadaire (GET /budget sans semaine) ─────────────────
// Prévu par semaine (et statut de chaque semaine) + réalisé par semaine,
// pour le Suivi budgétaire. Le « réalisé » d'une semaine = sorties dont la
// DATE tombe dans la semaine (le calendrier est celui du service).
const vueMoisHebdo = async (tenantId, mois, an) => {
  const semaines = hebdo.semainesDuMois(mois, an);
  const [lignes, validations, sorties] = await Promise.all([
    Budget.findAll({ where: { tenant_id: tenantId, mois, annee: an, semaine: { [Op.ne]: null } }, raw: true }),
    BudgetValidation.findAll({ where: { tenant_id: tenantId, mois, annee: an, semaine: { [Op.ne]: null } }, raw: true }),
    sequelize.query(
      `SELECT rubrique_code, date::text AS date, COALESCE(SUM(sortie), 0) AS v
         FROM journal WHERE tenant_id = :t AND mois = :m AND annee = :a AND sortie > 0
        GROUP BY rubrique_code, date`,
      { replacements: { t: tenantId, m: mois, a: an }, type: sequelize.QueryTypes.SELECT }),
  ]);
  const statut = new Map(validations.map((v) => [v.semaine, v]));
  const parSemaine = {};
  const intitules = {};
  for (const l of lignes) {
    parSemaine[l.rubrique_code] = parSemaine[l.rubrique_code] || {};
    parSemaine[l.rubrique_code][l.semaine] = (parSemaine[l.rubrique_code][l.semaine] || 0) + (parseFloat(l.montant) || 0);
    intitules[l.rubrique_code] = l.intitule;
  }
  const realise = {};
  for (const r of sorties) {
    const k = (semaines.find((x) => r.date.slice(0, 10) >= x.debut && r.date.slice(0, 10) <= x.fin) || {}).num;
    if (!k) continue;
    realise[r.rubrique_code] = realise[r.rubrique_code] || {};
    realise[r.rubrique_code][k] = (realise[r.rubrique_code][k] || 0) + (parseFloat(r.v) || 0);
  }
  const dotations = Object.keys(parSemaine).sort().map((code) => ({
    rubrique_code: code, intitule: intitules[code],
    montant: Object.values(parSemaine[code]).reduce((a, b) => a + b, 0),
  }));
  return {
    periodicite: 'hebdomadaire',
    semaines: semaines.map((x) => {
      const v = statut.get(x.num);
      const total = Object.values(parSemaine).reduce((t, p) => t + (p[x.num] || 0), 0);
      return { ...x, statut: v?.statut || 'en_attente', commentaire: v?.commentaire || '', validated_at: v?.validated_at || null, total };
    }),
    dotations, par_semaine: parSemaine, realise_par_semaine: realise,
    validation: { statut: 'hebdomadaire' }, mois_saisie: mois, annee_saisie: an,
    depenses_attente: [], ressources_attente: [],
  };
};

// ── GET /api/budget?mois=&annee= ──────────────────────────────────────────
// Renvoie le budget APPLICABLE au mois demandé :
//   1. d'abord celui saisi pour s'appliquer ce mois (mois_applic/annee_applic)
//   2. à défaut, le budget saisi directement ce mois-là
// La validation retournée est celle du mois de SAISIE du budget applicable.
const getBudget = async (req, res) => {
  const { mois, annee } = req.query;
  if (!mois || !annee) {
    return res.status(400).json({ error: 'Paramètres mois et annee requis.' });
  }
  const an = parseInt(annee, 10);
  try {
    // Budget hebdomadaire (040) : une semaine précise, ou la vue du mois.
    if (await hebdo.estHebdo(req.tenantId, mois, an)) {
      if (req.query.semaine === undefined || req.query.semaine === '') {
        return res.json(await vueMoisHebdo(req.tenantId, mois, an));
      }
      const k = await hebdo.exigerSemaine(req.tenantId, mois, an, req.query.semaine);
      const [rows, validation, depAtt, resAtt] = await Promise.all([
        Budget.findAll({ where: { tenant_id: req.tenantId, mois, annee: an, semaine: k }, order: [['rubrique_code', 'ASC']] }),
        BudgetValidation.findOne({ where: { tenant_id: req.tenantId, mois, annee: an, semaine: k }, attributes: ['statut', 'commentaire', 'validated_at'] }),
        DepenseAttente.findAll({ where: { tenant_id: req.tenantId, mois, annee: an, semaine: k }, order: [['id', 'ASC']] }),
        RessourceAttente.findAll({ where: { tenant_id: req.tenantId, mois, annee: an, semaine: k }, order: [['id', 'ASC']] }),
      ]);
      return res.json({
        periodicite: 'hebdomadaire', semaine: k, semaines: hebdo.semainesDuMois(mois, an),
        dotations: rows, validation: validation || { statut: 'en_attente' },
        mois_saisie: mois, annee_saisie: an, semaine_saisie: k,
        depenses_attente: depAtt, ressources_attente: resAtt,
      });
    }
    if (req.query.semaine) {
      return res.status(400).json({ error: `Le budget de ${mois} ${an} est mensuel : aucune semaine à indiquer.` });
    }
    // 1. Budget applicable (saisi un autre mois pour s'appliquer ici)
    let budgetRows = await Budget.findAll({
      where: { tenant_id: req.tenantId, mois_applic: mois, annee_applic: an, semaine: null },
      order: [['rubrique_code', 'ASC']],
    });

    // Mois de saisie (pour retrouver la bonne validation)
    let moisSaisie = mois, anneeSaisie = an;
    if (budgetRows.length > 0) {
      moisSaisie  = budgetRows[0].mois;
      anneeSaisie = budgetRows[0].annee;
    } else {
      // 2. Fallback : budget saisi directement ce mois
      budgetRows = await Budget.findAll({
        where: { tenant_id: req.tenantId, mois, annee: an, semaine: null },
        order: [['rubrique_code', 'ASC']],
      });
    }

    const [validation, depAtt, resAtt] = await Promise.all([
      BudgetValidation.findOne({
        where: { tenant_id: req.tenantId, mois: moisSaisie, annee: anneeSaisie, semaine: null },
        attributes: ['statut', 'commentaire', 'validated_at'],
      }),
      DepenseAttente.findAll({ where: { tenant_id: req.tenantId, mois, annee: an, semaine: null }, order: [['id', 'ASC']] }),
      RessourceAttente.findAll({ where: { tenant_id: req.tenantId, mois, annee: an, semaine: null }, order: [['id', 'ASC']] }),
    ]);

    res.json({
      periodicite:        'mensuel',
      dotations:          budgetRows,
      validation:         validation || { statut: 'en_attente' },
      mois_saisie:        moisSaisie,
      annee_saisie:       anneeSaisie,
      depenses_attente:   depAtt,
      ressources_attente: resAtt,
    });
  } catch (err) {
    if (refusHebdo(res, err)) return;
    console.error('[Budget] getBudget :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// Une demande de fonds VALIDÉE est figée : ses montants sont le budget de la
// caisse pour le mois d'application. Pour la modifier, le directeur la remet
// « en attente » (réouverture tracée), puis la revalide.
const demandeFigee = async (tenantId, mois, annee, semaine = null) => {
  const v = await BudgetValidation.findOne({ where: { tenant_id: tenantId, mois, annee: parseInt(annee, 10), semaine }, attributes: ['statut'], raw: true });
  return v?.statut === 'valide';
};
const MSG_FIGEE = (mois, annee, semaine = null) => `La demande de fonds de ${periodeLib(mois, parseInt(annee, 10), semaine)} est validée par le directeur : elle ne peut plus être modifiée. `
  + 'Le directeur doit d\'abord la remettre « en attente ».';

// ── PUT /api/budget ───────────────────────────────────────────────────────
const setBudgetLine = async (req, res) => {
  const { mois, annee, rubrique_code, intitule, montant, mois_applic, annee_applic } = req.body;
  if (!mois || !annee || !rubrique_code || !intitule) {
    return res.status(400).json({ error: 'Champs obligatoires manquants.' });
  }
  try {
    const semaine = await hebdo.exigerSemaine(req.tenantId, mois, parseInt(annee, 10), req.body.semaine);
    if (await demandeFigee(req.tenantId, mois, annee, semaine)) return res.status(409).json({ error: MSG_FIGEE(mois, annee, semaine) });
    await sequelize.transaction(async (t) => {
      const [row] = await Budget.findOrCreate({
        where: { tenant_id: req.tenantId, mois, annee: parseInt(annee, 10), semaine, rubrique_code },
        defaults: { intitule },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      row.intitule = intitule;
      row.montant = parseFloat(montant) || 0;
      row.mois_applic = mois_applic || '';
      row.annee_applic = parseInt(annee_applic, 10) || 0;
      await row.save({ transaction: t });
    });
    res.json({ message: 'Dotation mise à jour.' });
  } catch (err) {
    if (refusHebdo(res, err)) return;
    console.error('[Budget] setBudgetLine :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/budget/validation ───────────────────────────────────────────
const setValidation = async (req, res) => {
  const { mois, annee, statut, commentaire } = req.body;
  try {
    const semaine = await hebdo.exigerSemaine(req.tenantId, mois, parseInt(annee, 10), req.body.semaine);
    // Valider = approuver les prévisions saisies ce mois-ci pour le mois
    // suivant : il faut qu'il y en ait (sinon la caisse resterait bloquée
    // alors que la notification annonce une validation).
    if (statut === 'valide') {
      const n = await Budget.count({ where: { tenant_id: req.tenantId, mois, annee: parseInt(annee, 10), semaine, mois_applic: { [Op.ne]: '' } } });
      if (n === 0) {
        return res.status(409).json({ error: `Aucune prévision de dépenses n'est saisie dans la demande de fonds de ${periodeLib(mois, parseInt(annee, 10), semaine)} : rien à valider.` });
      }
    }
    await sequelize.transaction(async (t) => {
      const [row] = await BudgetValidation.findOrCreate({
        where: { tenant_id: req.tenantId, mois, annee: parseInt(annee, 10), semaine },
        defaults: {},
        transaction: t, lock: t.LOCK.UPDATE,
      });
      row.statut = statut;
      row.commentaire = commentaire || '';
      row.validated_by = req.user.id;
      row.validated_at = new Date();
      await row.save({ transaction: t });
      await sequelize.query(
        `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, nouvelle_valeur)
         VALUES (:t, :u, :a, 'budget_validation', :id, CAST(:v AS jsonb))`,
        { replacements: { t: req.tenantId, u: req.user.id, a: `DEMANDE_FONDS_${String(statut).toUpperCase()}`, id: `${mois}-${annee}${semaine ? `-S${semaine}` : ''}`,
          v: JSON.stringify({ mois, annee, semaine, statut, commentaire: commentaire || '' }) }, transaction: t });
    });
    // Mois sur lequel ce budget s'applique (et seulement celui-là).
    const cible = await Budget.findOne({
      where: { tenant_id: req.tenantId, mois, annee: parseInt(annee, 10), semaine, mois_applic: { [Op.ne]: '' } },
      attributes: ['mois_applic', 'annee_applic'], raw: true,
    });
    const pour = semaine ? periodeLib(mois, parseInt(annee, 10), semaine) : (cible ? `${cible.mois_applic} ${cible.annee_applic}` : '');
    const messages = {
      valide: `Demande de fonds validée : le budget s'applique à la caisse pour ${pour}.`,
      rejete: `Demande de fonds rejetée : aucun budget ouvert pour ${pour}.`,
      en_attente: `Demande de fonds remise en attente : le budget de ${pour} est suspendu et les prévisions sont de nouveau modifiables.`,
    };
    // Gestion des activités (085) : la caisse et les demandeurs dont le réapprovisionnement
    // attendait cette Demande de fonds sont prévenus (mail + application).
    require('../services/projets_demandes.service').annoncerDecisionDemandeFonds({ tenantId: req.tenantId, user: req.user, mois, annee, semaine, statut })
      .catch((e) => console.warn('[Budget] annonce aux demandes de fonds d\'activité :', e.message));
    res.json({ message: messages[statut] || `Budget ${statut}.`, mois_applic: cible?.mois_applic || null, annee_applic: cible?.annee_applic || null, semaine });
  } catch (err) {
    if (refusHebdo(res, err)) return;
    console.error('[Budget] setValidation :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/budget/depenses-attente ─────────────────────────────────────
const addDepenseAttente = async (req, res) => {
  const { mois, annee, rubrique_code, intitule, montant } = req.body;
  try {
    const semaine = await hebdo.exigerSemaine(req.tenantId, mois, parseInt(annee, 10), req.body.semaine);
    const row = await DepenseAttente.create({
      tenant_id: req.tenantId, mois, annee: parseInt(annee, 10), semaine, rubrique_code, intitule, montant: parseFloat(montant) || 0,
    });
    res.status(201).json(row);
  } catch (err) {
    if (refusHebdo(res, err)) return;
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: 'Cette rubrique figure déjà dans la liste : modifiez la ligne existante.' });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/budget/:id ────────────────────────────────────────────────
const deleteBudgetLine = async (req, res) => {
  try {
    const ligne = await Budget.findOne({ where: { id: req.params.id, tenant_id: req.tenantId }, attributes: ['mois', 'annee', 'semaine'], raw: true });
    if (ligne && await demandeFigee(req.tenantId, ligne.mois, ligne.annee, ligne.semaine)) return res.status(409).json({ error: MSG_FIGEE(ligne.mois, ligne.annee, ligne.semaine) });
    await Budget.destroy({ where: { id: req.params.id, tenant_id: req.tenantId } });
    res.json({ message: 'Ligne budget supprimée.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/budget/depenses-attente/:id ───────────────────────────────
const deleteDepenseAttente = async (req, res) => {
  try {
    await DepenseAttente.destroy({ where: { id: parseInt(req.params.id, 10), tenant_id: req.tenantId } });
    res.json({ message: 'Dépense supprimée.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/budget/ressources-attente ───────────────────────────────────
const addRessourceAttente = async (req, res) => {
  const { mois, annee, rubrique_code, intitule, montant } = req.body;
  try {
    const semaine = await hebdo.exigerSemaine(req.tenantId, mois, parseInt(annee, 10), req.body.semaine);
    const row = await RessourceAttente.create({
      tenant_id: req.tenantId, mois, annee: parseInt(annee, 10), semaine, rubrique_code, intitule, montant: parseFloat(montant) || 0,
    });
    res.status(201).json(row);
  } catch (err) {
    if (refusHebdo(res, err)) return;
    if (err.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ error: 'Cette rubrique figure déjà dans la liste : modifiez la ligne existante.' });
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── DELETE /api/budget/ressources-attente/:id ─────────────────────────────
const deleteRessourceAttente = async (req, res) => {
  try {
    await RessourceAttente.destroy({ where: { id: parseInt(req.params.id, 10), tenant_id: req.tenantId } });
    res.json({ message: 'Ressource supprimée.' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PUT /api/budget/depenses-attente/batch ────────────────────────────────
// Body: { mois, annee, lignes:[{rubrique_code,intitule,montant}, ...] }
// Stratégie DELETE+INSERT dans une transaction — pas besoin de contrainte UNIQUE.
// montant>0 → enregistre ; montant<=0 → supprime la ligne.
const batchDepenseAttente = async (req, res) => {
  const { mois, annee, lignes } = req.body;
  if (!mois || !annee || !Array.isArray(lignes)) {
    return res.status(400).json({ error: 'Données invalides.' });
  }
  const an = parseInt(annee, 10);
  const toInsert = lignes.filter(l => parseFloat(l.montant) > 0);
  const allCodes = lignes.map(l => l.rubrique_code);
  try {
    const semaine = await hebdo.exigerSemaine(req.tenantId, mois, an, req.body.semaine);
    await sequelize.transaction(async (t) => {
      await DepenseAttente.destroy({
        where: { tenant_id: req.tenantId, mois, annee: an, semaine, rubrique_code: { [Op.in]: allCodes } },
        transaction: t,
      });
      if (toInsert.length) {
        await DepenseAttente.bulkCreate(
          toInsert.map(l => ({
            tenant_id: req.tenantId, mois, annee: an, semaine,
            rubrique_code: l.rubrique_code, intitule: l.intitule || l.rubrique_code, montant: parseFloat(l.montant),
          })),
          { transaction: t },
        );
      }
    });
    res.json({ message: 'Dépenses en attente enregistrées.' });
  } catch (err) {
    if (refusHebdo(res, err)) return;
    console.error('[Budget] batchDepenseAttente :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PUT /api/budget/ressources-attente/batch ──────────────────────────────
const batchRessourceAttente = async (req, res) => {
  const { mois, annee, lignes } = req.body;
  if (!mois || !annee || !Array.isArray(lignes)) {
    return res.status(400).json({ error: 'Données invalides.' });
  }
  const an = parseInt(annee, 10);
  const toInsert = lignes.filter(l => parseFloat(l.montant) > 0);
  const allCodes = lignes.map(l => l.rubrique_code);
  try {
    const semaine = await hebdo.exigerSemaine(req.tenantId, mois, an, req.body.semaine);
    await sequelize.transaction(async (t) => {
      await RessourceAttente.destroy({
        where: { tenant_id: req.tenantId, mois, annee: an, semaine, rubrique_code: { [Op.in]: allCodes } },
        transaction: t,
      });
      if (toInsert.length) {
        await RessourceAttente.bulkCreate(
          toInsert.map(l => ({
            tenant_id: req.tenantId, mois, annee: an, semaine,
            rubrique_code: l.rubrique_code, intitule: l.intitule || l.rubrique_code, montant: parseFloat(l.montant),
          })),
          { transaction: t },
        );
      }
    });
    res.json({ message: 'Ressources attendues enregistrées.' });
  } catch (err) {
    if (refusHebdo(res, err)) return;
    console.error('[Budget] batchRessourceAttente :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/budget/periode?mois=&annee= ──────────────────────────────────
// Réglage (mensuel/hebdomadaire) et calendrier des semaines d'un mois.
const getPeriode = async (req, res) => {
  try {
    if (!req.query.mois || !req.query.annee) return res.status(400).json({ error: 'Paramètres mois et annee requis.' });
    res.json(await hebdo.periode(req.tenantId, req.query.mois, parseInt(req.query.annee, 10)));
  } catch (err) {
    if (refusHebdo(res, err)) return;
    console.error('[Budget] getPeriode :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET / PUT /api/budget/periodicite ─────────────────────────────────────
const getPeriodicite = async (req, res) => {
  try {
    res.json(await hebdo.etatPeriodicite(req.tenantId));
  } catch (err) {
    console.error('[Budget] getPeriodicite :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};
const putPeriodicite = async (req, res) => {
  try {
    const r = await hebdo.definirPeriodicite({ tenantId: req.tenantId, userId: req.user.id,
      periodicite: req.body.periodicite, mois: req.body.mois, annee: req.body.annee });
    res.json({ ...r, message: `Budget ${r.periodicite === 'hebdomadaire' ? 'hebdomadaire' : 'mensuel'} à partir de ${r.mois} ${r.annee}.` });
  } catch (err) {
    if (refusHebdo(res, err)) return;
    console.error('[Budget] putPeriodicite :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getPeriode, getPeriodicite, putPeriodicite,
  getBudget, setBudgetLine, deleteBudgetLine, setValidation,
  addDepenseAttente, deleteDepenseAttente,
  addRessourceAttente, deleteRessourceAttente,
  batchDepenseAttente, batchRessourceAttente,
};

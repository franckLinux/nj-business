// src/controllers/appel_fonds_synthese.controller.js
// Synthèse Demande de Fonds — transposition de prev_ui / app_26.r
// treso_dispo <- tres + total_ress  (formule R)
const { query } = require('../config/database');

const MOIS = ['Janvier','Fevrier','Mars','Avril','Mai','Juin',
              'Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];

const moisSuivant = (mois, annee) => {
  const idx = MOIS.indexOf(mois);
  if (idx === 11) return { mois: MOIS[0], annee: annee + 1 };
  return { mois: MOIS[idx + 1], annee };
};

// GET /api/appel-fonds/synthese?mois=&annee=
const getSynthese = async (req, res) => {
  const { mois, annee } = req.query;
  if (!mois || !annee) {
    return res.status(400).json({ error: 'Paramètres mois et annee requis.' });
  }
  const an = parseInt(annee);
  const tenantId = req.tenantId;
  const next = moisSuivant(mois, an);

  try {
    // ── 1. Trésorerie courante ───────────────────────────────────────────────
    // Solde espèces : RAN + cumul journal (especes)
    // Solde OM      : RAN + cumul journal (om)
    // Solde banque  : banque.solde_final du mois courant

    const [ranEspRow, ranOMRow, bqRow, journalCumul] = await Promise.all([
      query('SELECT COALESCE(montant,0) AS v FROM ran WHERE tenant_id=$1 AND mois=$2 AND annee=$3 AND type_caisse=$4',
            [tenantId, mois, an, 'especes']),
      query('SELECT COALESCE(montant,0) AS v FROM ran WHERE tenant_id=$1 AND mois=$2 AND annee=$3 AND type_caisse=$4',
            [tenantId, mois, an, 'om']),
      query('SELECT COALESCE(solde_final,0) AS v FROM banque WHERE tenant_id=$1 AND mois=$2 AND annee=$3',
            [tenantId, mois, an]),
      query(`SELECT type_caisse,
                    COALESCE(SUM(entree),0) AS total_e,
                    COALESCE(SUM(sortie),0) AS total_s
             FROM journal
             WHERE tenant_id=$1 AND mois=$2 AND annee=$3
             GROUP BY type_caisse`,
            [tenantId, mois, an]),
    ]);

    const ranEspece = parseFloat(ranEspRow.rows[0]?.v || 0);
    const ranOM     = parseFloat(ranOMRow.rows[0]?.v  || 0);
    const soldeBanque = parseFloat(bqRow.rows[0]?.v   || 0);

    let jEspE = 0, jEspS = 0, jOME = 0, jOMS = 0;
    journalCumul.rows.forEach(r => {
      if (r.type_caisse === 'especes') { jEspE = parseFloat(r.total_e); jEspS = parseFloat(r.total_s); }
      else                             { jOME  = parseFloat(r.total_e); jOMS  = parseFloat(r.total_s); }
    });

    const solde_espece = ranEspece + jEspE - jEspS;
    const solde_om     = ranOM     + jOME  - jOMS;
    const total_tres   = solde_espece + solde_om + soldeBanque;

    // ── 2. Ressources & dépenses en attente ──────────────────────────────────
    const [resAttRows, depAttRows] = await Promise.all([
      query('SELECT * FROM ressources_attente WHERE tenant_id=$1 AND mois=$2 AND annee=$3 ORDER BY id',
            [tenantId, mois, an]),
      query('SELECT * FROM depenses_attente WHERE tenant_id=$1 AND mois=$2 AND annee=$3 ORDER BY id',
            [tenantId, mois, an]),
    ]);

    const total_ressources = resAttRows.rows.reduce((s, r) => s + parseFloat(r.montant || 0), 0);
    const total_attente    = depAttRows.rows.reduce((s, r) => s + parseFloat(r.montant || 0), 0);

    // treso_dispo <- tres + total_ress  (formule R)
    const tresorerie_disponible  = total_tres + total_ressources;
    const tresorerie_apres_attente = tresorerie_disponible - total_attente;

    // ── 3. Prévision pour mois_cible ─────────────────────────────────────────
    // Budget saisi pour s'appliquer au mois suivant
    const { rows: prevRows } = await query(
      `SELECT rubrique_code, intitule, montant
       FROM budget
       WHERE tenant_id=$1 AND mois_applic=$2 AND annee_applic=$3
       ORDER BY rubrique_code`,
      [tenantId, next.mois, next.annee]
    );

    const total_prevision = prevRows.reduce((s, r) => s + parseFloat(r.montant || 0), 0);

    // ── 4. Validation (cherche sur le mois de saisie du budget applicable) ───
    let moisSaisie = mois, anneeSaisie = an;
    if (prevRows.length > 0) {
      // Retrouver le mois de saisie via la table budget elle-même
      const { rows: saisieRows } = await query(
        'SELECT mois, annee FROM budget WHERE tenant_id=$1 AND mois_applic=$2 AND annee_applic=$3 LIMIT 1',
        [tenantId, next.mois, next.annee]
      );
      if (saisieRows.length > 0) {
        moisSaisie  = saisieRows[0].mois;
        anneeSaisie = saisieRows[0].annee;
      }
    }

    const { rows: valRows } = await query(
      `SELECT bv.statut, bv.commentaire, bv.validated_at, u.username AS validated_by_nom
       FROM budget_validation bv
       LEFT JOIN users u ON u.id = bv.validated_by
       WHERE bv.tenant_id=$1 AND bv.mois=$2 AND bv.annee=$3`,
      [tenantId, moisSaisie, anneeSaisie]
    );
    const validation = valRows[0] || { statut: 'en_attente' };

    // ── 5. Bilan ──────────────────────────────────────────────────────────────
    const besoin   = Math.max(0, total_prevision - tresorerie_disponible);
    const excedent = Math.max(0, tresorerie_disponible - total_prevision);

    res.json({
      mois,
      annee: an,
      mois_cible:  next.mois,
      annee_cible: next.annee,
      tresorerie: {
        solde_espece: solde_espece,
        solde_om:     solde_om,
        solde_banque: soldeBanque,
        total:        total_tres,
      },
      tresorerie_apres_attente,
      ressources_attente: resAttRows.rows,
      depenses_attente:   depAttRows.rows,
      total_ressources,
      total_attente,
      prevision:          prevRows,
      total_prevision,
      validation,
      tresorerie_disponible,
      besoin,
      excedent,
    });

  } catch (err) {
    console.error('[AfSynthese] getSynthese :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

module.exports = { getSynthese };

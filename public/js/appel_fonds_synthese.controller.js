// src/controllers/appel_fonds_synthese.controller.js
// Demande de Fonds — synthèse calculée (transposition de prev_ui / app_26.r)
//
// Logique experte-comptable :
//   1. Trésorerie actuelle = solde caisse espèces + solde caisse OM + solde final banque
//        solde caisse = RAN du mois + (entrées − sorties du mois) par type de caisse
//        solde banque = saisi dans l'écran Appel de fonds (table banque.solde_final)
//   2. + Ressources additionnelles attendues  (ressources_attente, saisie manuelle)
//   3. − Dépenses en attente                   (depenses_attente, saisie manuelle)
//   4. comparé à la Prévision saisie CE mois pour M+1 (table budget, mois courant)
//        besoin   = max(0, prévision − trésorerie disponible)
//        excédent = max(0, trésorerie disponible − prévision)
//      où trésorerie disponible = trésorerie + ressources attendues
//
// La demande devient « officielle » (imprimable) lorsque le budget du mois
// courant est validé (budget_validation.statut = 'valide').

const { query } = require('../config/database');

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
              'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

const moisSuivant = (mois, annee) => {
  const i = MOIS.indexOf(mois);
  if (i === -1) return { mois, annee };
  return i === 11 ? { mois: MOIS[0], annee: annee + 1 }
                  : { mois: MOIS[i + 1], annee };
};

// GET /api/appel-fonds/synthese?mois=&annee=
const getSynthese = async (req, res) => {
  const { mois, annee } = req.query;
  if (!mois || !annee) {
    return res.status(400).json({ error: 'Paramètres mois et annee requis.' });
  }
  const an = parseInt(annee);
  const t = req.tenantId;

  try {
    // ── 1. Trésorerie actuelle ──────────────────────────────────────────────
    // RAN (report à nouveau) espèces & OM
    const [ranEsp, ranOM] = await Promise.all([
      query(`SELECT COALESCE(montant,0) AS m FROM ran
             WHERE tenant_id=$1 AND mois=$2 AND annee=$3 AND type_caisse='especes'`, [t, mois, an]),
      query(`SELECT COALESCE(montant,0) AS m FROM ran
             WHERE tenant_id=$1 AND mois=$2 AND annee=$3 AND type_caisse='om'`, [t, mois, an]),
    ]);
    const ranEspece = parseFloat(ranEsp.rows[0]?.m || 0);
    const ranOm     = parseFloat(ranOM.rows[0]?.m  || 0);

    // Mouvements du mois groupés par caisse
    const mvts = await query(
      `SELECT type_caisse,
              COALESCE(SUM(entree),0) AS tot_e,
              COALESCE(SUM(sortie),0) AS tot_s
       FROM journal
       WHERE tenant_id=$1 AND mois=$2 AND annee=$3
       GROUP BY type_caisse`, [t, mois, an]
    );
    let espE = 0, espS = 0, omE = 0, omS = 0;
    mvts.rows.forEach(r => {
      if (r.type_caisse === 'especes') { espE = +r.tot_e; espS = +r.tot_s; }
      if (r.type_caisse === 'om')      { omE  = +r.tot_e; omS  = +r.tot_s; }
    });
    const soldeEspece = ranEspece + espE - espS;
    const soldeOm     = ranOm     + omE  - omS;

    // Solde final banque (saisi dans l'écran)
    const bq = await query(
      `SELECT COALESCE(solde_final,0) AS sf FROM banque
       WHERE tenant_id=$1 AND mois=$2 AND annee=$3`, [t, mois, an]
    );
    const soldeBanque = parseFloat(bq.rows[0]?.sf || 0);
    const tresorerie  = soldeEspece + soldeOm + soldeBanque;

    // ── 2. Ressources additionnelles attendues ───────────────────────────────
    const ressAtt = await query(
      `SELECT id, rubrique_code, intitule, montant FROM ressources_attente
       WHERE tenant_id=$1 AND mois=$2 AND annee=$3 ORDER BY id`, [t, mois, an]
    );
    const totalRessources = ressAtt.rows.reduce((s, r) => s + parseFloat(r.montant || 0), 0);

    // ── 3. Dépenses en attente ────────────────────────────────────────────────
    const depAtt = await query(
      `SELECT id, rubrique_code, intitule, montant FROM depenses_attente
       WHERE tenant_id=$1 AND mois=$2 AND annee=$3 ORDER BY id`, [t, mois, an]
    );
    const totalAttente = depAtt.rows.reduce((s, r) => s + parseFloat(r.montant || 0), 0);

    // ── 4. Prévision (budget saisi CE mois pour M+1) + validation ─────────────
    const [bgt, val] = await Promise.all([
      query(`SELECT rubrique_code, intitule, montant, mois_applic, annee_applic
             FROM budget WHERE tenant_id=$1 AND mois=$2 AND annee=$3 ORDER BY rubrique_code`,
            [t, mois, an]),
      query(`SELECT statut, commentaire, validated_at,
                    (SELECT username FROM users WHERE id=budget_validation.validated_by) AS validated_by_nom
             FROM budget_validation WHERE tenant_id=$1 AND mois=$2 AND annee=$3`, [t, mois, an]),
    ]);
    const prevision = bgt.rows;
    const totalPrevision = prevision.reduce((s, r) => s + parseFloat(r.montant || 0), 0);
    const validation = val.rows[0] || { statut: 'en_attente', commentaire: '', validated_at: null };

    // Mois cible (par défaut M+1, ou mois_applic du budget si défini)
    const ms = moisSuivant(mois, an);
    const premier = prevision[0];
    const moisCible  = (premier && premier.mois_applic)      ? premier.mois_applic  : ms.mois;
    const anneeCible = (premier && premier.annee_applic > 0) ? premier.annee_applic : ms.annee;

    // ── Bilans ────────────────────────────────────────────────────────────────
    const tresoApresAttente = tresorerie + totalRessources - totalAttente;
    const tresoDispo        = tresorerie + totalRessources;     // base de comparaison (cf. R)
    const besoin   = Math.max(0, totalPrevision - tresoDispo);
    const excedent = Math.max(0, tresoDispo - totalPrevision);

    res.json({
      mois, annee: an,
      mois_cible: moisCible, annee_cible: anneeCible,
      tresorerie: {
        solde_espece: soldeEspece,
        solde_om:     soldeOm,
        solde_banque: soldeBanque,
        total:        tresorerie,
      },
      ressources_attente: ressAtt.rows,
      total_ressources:   totalRessources,
      depenses_attente:   depAtt.rows,
      total_attente:      totalAttente,
      tresorerie_apres_attente: tresoApresAttente,
      tresorerie_disponible:    tresoDispo,
      prevision,
      total_prevision: totalPrevision,
      validation,
      besoin,
      excedent,
    });
  } catch (err) {
    console.error('[AppelFonds] getSynthese :', err.message);
    res.status(500).json({ error: 'Erreur serveur lors du calcul de la demande de fonds.' });
  }
};

module.exports = { getSynthese };

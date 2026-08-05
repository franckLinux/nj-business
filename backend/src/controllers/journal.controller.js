// src/controllers/journal.controller.js — v2 (journaux dynamiques)
// Contrôles budgétaires caisse (RG-01 à RG-06) :
//   RG-01  La dotation (table budget) ne garde plus la caisse — supprimé.
//   RG-03  Sortie sur un mois non validé (budget_validation != 'valide') → mise en attente.
//   RG-04  Mois validé mais cumul sorties rubrique > montant prévu (appel_fonds) → mise en attente.
//   RG-05  Contrôles sur les SORTIES uniquement ; entrées exemptées.
//   RG-06  Plafond du journal (budget_caisse) dépassé → mise en attente (refus sec).
//   Tout blocage suit le même circuit : refus sec + mouvements_attente + validation directeur.
//   Contrôle appliqué à la création (POST) ET à la modification (PUT) ; fail-closed.
const { query } = require('../config/database');
const notif = require('../services/notification.service');

const MOIS = ['Janvier','Fevrier','Mars','Avril','Mai','Juin',
              'Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];

// ── Mois précédent ───────────────────────────────────────────────────────
const moisPrecedent = (mois, annee) => {
  const idx = MOIS.indexOf(mois);
  if (idx === 0) return { mois: MOIS[11], annee: annee - 1 };
  return { mois: MOIS[idx - 1], annee };
};

// ── Résoudre journal_id → type_caisse (rétrocompatibilité) ──────────────
// Si journal_id fourni → on l'utilise comme filtre principal
// Si caisse fourni (ancien mode) → on filtre par type_caisse
// Si les deux absents → on prend tout
const resolveFiltre = async (tenantId, journalId, caisse) => {
  if (journalId) {
    // Récupérer le type du journal pour mapper type_caisse
    const { rows } = await query(
      'SELECT id, type, code FROM journaux WHERE id=$1 AND tenant_id=$2',
      [parseInt(journalId), tenantId]
    );
    if (rows.length === 0) throw new Error('Journal introuvable.');
    const j = rows[0];
    // Mapper type journal → type_caisse (rétrocompatibilité)
    const typeCaisse = ['om','momo','carte_prepayee'].includes(j.type) ? 'om' : 'especes';
    return { journal_id: j.id, type_caisse: typeCaisse };
  }
  if (caisse) {
    return { journal_id: null, type_caisse: caisse };
  }
  // Aucun filtre → retourner tout (pour cumuls globaux)
  return { journal_id: null, type_caisse: null };
};

// ── Calcul solde final ───────────────────────────────────────────────────
const calcSoldeFinal = async (tenantId, mois, annee, filtre) => {
  // Construire les conditions WHERE dynamiquement
  const conditions = ['j.tenant_id=$1', 'j.mois=$2', 'j.annee=$3'];
  const params     = [tenantId, mois, annee];

  if (filtre.journal_id) {
    params.push(filtre.journal_id);
    conditions.push(`j.journal_id=$${params.length}`);
  } else if (filtre.type_caisse) {
    params.push(filtre.type_caisse);
    conditions.push(`j.type_caisse=$${params.length}`);
  }

  const whereClause = conditions.join(' AND ');

  const [ranRes, mvtRes] = await Promise.all([
    filtre.journal_id
      ? query('SELECT COALESCE(montant,0) AS montant FROM ran WHERE tenant_id=$1 AND mois=$2 AND annee=$3 AND journal_id=$4',
              [tenantId, mois, annee, filtre.journal_id])
      : filtre.type_caisse
        ? query('SELECT COALESCE(montant,0) AS montant FROM ran WHERE tenant_id=$1 AND mois=$2 AND annee=$3 AND type_caisse=$4 AND journal_id IS NULL',
                [tenantId, mois, annee, filtre.type_caisse])
        : Promise.resolve({ rows: [{ montant: 0 }] }),
    query(
      `SELECT COALESCE(SUM(entree),0) AS total_entrees,
              COALESCE(SUM(sortie),0) AS total_sorties
       FROM journal j WHERE ${whereClause}`,
      params
    ),
  ]);

  const ran     = parseFloat(ranRes.rows[0]?.montant || 0);
  const entrees = parseFloat(mvtRes.rows[0]?.total_entrees || 0);
  const sorties = parseFloat(mvtRes.rows[0]?.total_sorties || 0);
  return { ran, entrees, sorties, solde: ran + entrees - sorties };
};

// ── RAN automatique depuis mois précédent ────────────────────────────────
const autoRan = async (tenantId, mois, annee, filtre) => {
  // Vérifier si un RAN existe déjà
  let existingQuery, existingParams;
  if (filtre.journal_id) {
    existingQuery  = 'SELECT montant FROM ran WHERE tenant_id=$1 AND mois=$2 AND annee=$3 AND journal_id=$4';
    existingParams = [tenantId, mois, annee, filtre.journal_id];
  } else {
    existingQuery  = 'SELECT montant FROM ran WHERE tenant_id=$1 AND mois=$2 AND annee=$3 AND type_caisse=$4 AND journal_id IS NULL';
    existingParams = [tenantId, mois, annee, filtre.type_caisse || 'especes'];
  }

  const existing = await query(existingQuery, existingParams);
  if (existing.rows.length > 0) {
    return parseFloat(existing.rows[0].montant);
  }

  // Calculer solde du mois précédent
  const prev = moisPrecedent(mois, annee);
  const soldePrev = await calcSoldeFinal(tenantId, prev.mois, prev.annee, filtre);

  if (soldePrev.solde !== 0) {
    // Insérer le RAN automatiquement
    if (filtre.journal_id) {
      await query(
        `INSERT INTO ran(tenant_id, mois, annee, journal_id, type_caisse, montant)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING`,
        [tenantId, mois, annee, filtre.journal_id, filtre.type_caisse || 'especes', soldePrev.solde]
      );
    } else {
      await query(
        `INSERT INTO ran(tenant_id, mois, annee, type_caisse, montant)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(tenant_id,mois,annee,type_caisse) DO NOTHING`,
        [tenantId, mois, annee, filtre.type_caisse || 'especes', soldePrev.solde]
      );
    }
    return soldePrev.solde;
  }
  return 0;
};

// ── GET /api/journal?mois=&annee=&journal_id=&rubrique_code= ─────────────
const getJournal = async (req, res) => {
  const { mois, annee, journal_id, caisse, rubrique_code } = req.query;

  if (!mois || !annee) {
    return res.status(400).json({ error: 'Paramètres mois et annee requis.' });
  }

  try {
    const filtre = await resolveFiltre(req.tenantId, journal_id, caisse);

    // RAN automatique
    const ranAuto = await autoRan(req.tenantId, mois, parseInt(annee), filtre);

    // Construire la requête mouvements
    const conditions = ['j.tenant_id=$1', 'j.mois=$2', 'j.annee=$3'];
    const params     = [req.tenantId, mois, parseInt(annee)];

    if (filtre.journal_id) {
      params.push(filtre.journal_id);
      conditions.push(`j.journal_id=$${params.length}`);
    } else if (filtre.type_caisse) {
      params.push(filtre.type_caisse);
      conditions.push(`j.type_caisse=$${params.length}`);
    }

    if (rubrique_code) {
      params.push(rubrique_code);
      conditions.push(`j.rubrique_code=$${params.length}`);
    }

    const { rows } = await query(
      `SELECT j.*, r.intitule AS rubrique_intitule,
              jx.nom AS journal_nom, jx.code AS journal_code
       FROM journal j
       LEFT JOIN rubriques r  ON r.tenant_id=j.tenant_id AND r.code=j.rubrique_code
       LEFT JOIN journaux  jx ON jx.id=j.journal_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY j.date, j.id`,
      params
    );

    const soldes = await calcSoldeFinal(req.tenantId, mois, parseInt(annee), filtre);

    // Info mois précédent
    const prev = moisPrecedent(mois, parseInt(annee));
    const soldePrev = await calcSoldeFinal(req.tenantId, prev.mois, prev.annee, filtre);

    // Arrêt de caisse pour ce journal/mois
    let arret = null;
    if (filtre.journal_id) {
      try {
        const arretRes = await query(
          `SELECT ac.*, u.username AS arrete_par_nom
           FROM arrets_caisse ac
           LEFT JOIN users u ON u.id = ac.arrete_par
           WHERE ac.tenant_id=$1 AND ac.journal_id=$2 AND ac.mois=$3 AND ac.annee=$4`,
          [req.tenantId, filtre.journal_id, mois, parseInt(annee)]
        );
        arret = arretRes.rows[0] || null;
      } catch (_) { /* table pas encore créée */ }
    }

    res.json({
      mouvements:      rows,
      soldes,
      ran_auto:        ranAuto,
      solde_precedent: soldePrev.solde,
      arret,
    });
  } catch (err) {
    console.error('[Journal] getJournal :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── Mise en attente d'une sortie bloquée (RG-03 / RG-06 / RG-04) ──────────
// Persiste la dépense dans mouvements_attente (hors calcul de solde), puis notifie
// le directeur (best-effort). Lève une erreur si la persistance échoue : on ne
// doit JAMAIS répondre "en attente" sans avoir réellement enregistré la dépense.
const mettreEnAttente = async (req, m, motif, snap) => {
  const { rows: [row] } = await query(
    `INSERT INTO mouvements_attente
      (tenant_id, date, mois, annee, journal_id, type_caisse, rubrique_code,
       intitule, objet, beneficiaire, piece_identite, telephone, sortie,
       motif_attente, montant_prevu, cumul_sorties, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [req.tenantId, m.date, m.mois, m.annee, m.journal_id, m.type_caisse, m.rubrique_code,
     m.intitule, m.objet || '', m.beneficiaire || '', m.piece_identite || '', m.telephone || '',
     m.sortie, motif, snap.montant_prevu || 0, snap.cumul || 0, req.user.id]
  );
  // Notification directeur — best-effort, ne bloque jamais la réponse au caissier
  notif.notifyMouvementEnAttente({
    tenantId: req.tenantId, mouvement: row, caissierNom: req.user.username,
  }).catch(e => console.warn('[Journal] notif attente :', e.message));
  return row;
};

// ── Contrôle budgétaire d'une SORTIE (RG-03 / RG-06 / RG-04) ──────────────
// Priorité : mois non validé → plafond journal → montant prévu rubrique.
// Retourne { bloque, motif, message, plafond, montant_prevu, cumul, warning }.
// excludeId : mouvement à exclure des cumuls (cas d'une modification).
const controleBudgetSortie = async (req, p) => {
  const jid     = p.journal_id ? parseInt(p.journal_id) : null;
  const an      = parseInt(p.annee);
  const montant = parseFloat(p.sortie) || 0;
  const fmt     = n => (parseFloat(n) || 0).toLocaleString('fr-FR');

  // Exclusion de l'écriture en cours (cas d'une modification uniquement).
  // À la création : aucune clause (évite toute comparaison sur journal.id).
  // On passe l'id en TEXTE : Postgres le caste vers le vrai type de la colonne
  // (uuid ou bigint), sans supposition côté application.
  const hasExcl = p.excludeId !== undefined && p.excludeId !== null && p.excludeId !== '';
  const params  = [req.tenantId, jid, p.mois, an, p.rubrique_code];
  let exclClause = '';
  if (hasExcl) { params.push(String(p.excludeId)); exclClause = ` AND id <> $${params.length}`; }

  // Contrôles principaux (tables à tenant_id UUID) — requête isolée.
  // Référence budgétaire = montant APPROUVÉ de la rubrique dans la demande de fonds
  // (statuts 'approuve' et 'partiellement_approuve'), pour la période cible.
  const { rows: [chk] } = await query(`
    WITH
      appr AS (SELECT COALESCE(SUM(montant_approuve),0) AS v FROM appel_fonds
               WHERE tenant_id=$1 AND rubrique_code=$5 AND mois_cible=$3 AND annee_cible=$4
                 AND statut IN ('approuve','partiellement_approuve')),
      sj AS (SELECT COALESCE(SUM(sortie),0) AS v FROM journal
             WHERE tenant_id=$1 AND journal_id=$2 AND mois=$3 AND annee=$4${exclClause}),
      sr AS (SELECT COALESCE(SUM(sortie),0) AS v FROM journal
             WHERE tenant_id=$1 AND mois=$3 AND annee=$4 AND rubrique_code=$5${exclClause})
    SELECT (SELECT v FROM appr) AS montant_approuve,
           (SELECT v FROM sj)   AS sorties_journal,
           (SELECT v FROM sr)   AS sorties_rubrique
  `, params);

  // Plafond du journal (budget_caisse) — requête SÉPARÉE et tolérante :
  // un souci sur cette table (ex. schéma) ne doit pas faire tomber tout le contrôle.
  let plafond = 0;
  if (jid) {
    try {
      const { rows: [pl] } = await query(
        `SELECT COALESCE(montant,0) AS v FROM budget_caisse
         WHERE tenant_id=$1 AND journal_id=$2 AND mois=$3 AND annee=$4 LIMIT 1`,
        [req.tenantId, jid, p.mois, an]
      );
      plafond = parseFloat(pl?.v) || 0;
    } catch (plafondErr) {
      console.warn('[Journal] plafond budget_caisse ignoré :', plafondErr.message);
      plafond = 0;
    }
  }

  const approuve = parseFloat(chk?.montant_approuve) || 0;
  const sj       = parseFloat(chk?.sorties_journal)  || 0;
  const sr       = parseFloat(chk?.sorties_rubrique) || 0;
  let warning    = null;

  // ── CŒUR · Budget de la rubrique = montant approuvé (demande de fonds) ────
  // 1. Rubrique sans budget approuvé → dépense non prévue → blocage.
  if (approuve <= 0) {
    return { bloque: true, motif: 'rubrique_non_approuvee', montant_prevu: 0, cumul: sr, plafond,
      message: `la rubrique "${p.rubrique_code}" n'a pas de budget approuvé dans la demande de fonds de ${p.mois} ${an}. Sortie mise en attente : le directeur doit l'autoriser.` };
  }
  // 2. Cumul des sorties de la rubrique > montant approuvé → dépassement → blocage.
  const apresR = sr + montant;
  if (apresR > approuve) {
    return { bloque: true, motif: 'depassement_rubrique', montant_prevu: approuve, cumul: sr, plafond,
      message: `la rubrique "${p.rubrique_code}" dépasse le budget approuvé de ${fmt(apresR - approuve)} FCFA (approuvé : ${fmt(approuve)} FCFA). Sortie mise en attente : autorisation du directeur requise.` };
  }
  const tauxR = Math.round((apresR / approuve) * 100);
  if (tauxR >= 80) warning = { type: 'rubrique', taux: tauxR, restant: approuve - apresR, rubrique_code: p.rubrique_code,
    message: tauxR >= 95
      ? `🔴 Rubrique ${p.rubrique_code} quasi-épuisée : ${tauxR}% du budget approuvé consommé.`
      : `🟡 Rubrique ${p.rubrique_code} consommée à ${tauxR}% — restant : ${fmt(approuve - apresR)} FCFA.` };

  // ── Garde-fou SECONDAIRE · Plafond global du journal (optionnel) ──────────
  if (plafond > 0) {
    const apres = sj + montant;
    if (apres > plafond) {
      return { bloque: true, motif: 'depassement_journal', montant_prevu: plafond, cumul: sj, plafond,
        message: `le plafond de caisse est dépassé de ${fmt(apres - plafond)} FCFA. Sortie mise en attente : autorisation du directeur requise.` };
    }
    const taux = Math.round((apres / plafond) * 100);
    if (taux >= 80 && !warning) warning = { type: 'journal', taux, restant: plafond - apres,
      message: taux >= 95
        ? `🔴 Plafond caisse quasi-épuisé : ${taux}% consommé, il reste ${fmt(plafond - apres)} FCFA.`
        : `🟡 Plafond caisse consommé à ${taux}% — restant : ${fmt(plafond - apres)} FCFA.` };
  }

  return { bloque: false, motif: null, montant_prevu: approuve, cumul: sr, plafond, warning };
};

// ── POST /api/journal ─────────────────────────────────────────────────────
const createMouvement = async (req, res) => {
  const { date, mois, annee, journal_id, type_caisse,
          rubrique_code, intitule, objet, beneficiaire,
          piece_identite, telephone, entree, sortie } = req.body;

  if (!date || !mois || !annee || !rubrique_code) {
    return res.status(400).json({ error: 'Champs obligatoires manquants (date, mois, annee, rubrique_code).' });
  }
  if (!journal_id && !type_caisse) {
    return res.status(400).json({ error: 'journal_id ou type_caisse requis.' });
  }
  if ((parseFloat(entree)||0) === 0 && (parseFloat(sortie)||0) === 0) {
    return res.status(400).json({ error: 'Montant entrée ou sortie requis.' });
  }

  // ── Résolution type_caisse + contrôles budgétaires (RG-03 / RG-06 / RG-04) ──
  const montantSortie = parseFloat(sortie) || 0;
  let resolvedCaisse = type_caisse || 'especes';
  let budgetWarning  = null;
  const jid = journal_id ? parseInt(journal_id) : null;
  const an  = parseInt(annee);

  // Résolution type_caisse (nécessaire aussi pour les entrées)
  if (jid && !type_caisse) {
    try {
      const { rows: [j] } = await query('SELECT type FROM journaux WHERE id=$1 LIMIT 1', [jid]);
      if (j?.type) resolvedCaisse = ['om','momo','carte_prepayee'].includes(j.type) ? 'om' : 'especes';
    } catch (_) { /* défaut 'especes' */ }
  }

  // RG-05 : les contrôles ne s'appliquent qu'aux SORTIES (entrées exemptées).
  if (montantSortie > 0) {
    let ctrl;
    try {
      ctrl = await controleBudgetSortie(req, {
        mois, annee: an, journal_id: jid, rubrique_code, sortie: montantSortie,
      });
    } catch (budgetErr) {
      // Fail-closed : si le contrôle échoue, on REFUSE la sortie (jamais de dépassement silencieux).
      console.error('[Journal] contrôle budgétaire indisponible :', budgetErr.message);
      return res.status(503).json({
        error: `Contrôle budgétaire indisponible (${budgetErr.message}) — sortie refusée par sécurité. Réessayez.`,
      });
    }

    // Blocage (RG-03 / RG-06 / RG-04) — refus sec + mise en attente du directeur
    if (ctrl.bloque) {
      let row;
      try {
        row = await mettreEnAttente(req,
          { date, mois, annee: an, journal_id: jid, type_caisse: resolvedCaisse,
            rubrique_code, intitule, objet, beneficiaire, piece_identite, telephone,
            sortie: montantSortie },
          ctrl.motif, { montant_prevu: ctrl.montant_prevu, cumul: ctrl.cumul });
      } catch (attenteErr) {
        // La mise en attente a échoué (ex. table absente / migration non lancée) :
        // on NE prétend PAS "en attente" et on n'écrit rien dans le journal.
        console.error('[Journal] échec mise en attente :', attenteErr.message);
        return res.status(503).json({
          error: `La dépense n'a pas pu être mise en attente (${attenteErr.message}). `
               + `Aucune écriture n'a été effectuée. Vérifiez que la migration mouvements_attente est appliquée, puis réessayez.`,
        });
      }
      return res.status(200).json({
        en_attente:   true,
        motif:        ctrl.motif,
        mouvement_id: row.id,
        message:      `Sortie refusée : ${ctrl.message}`,
      });
    }

    budgetWarning = ctrl.warning || null;
  }

  try {
    const { rows } = await query(
      `INSERT INTO journal (tenant_id, date, mois, annee, journal_id, type_caisse,
         rubrique_code, intitule, objet, beneficiaire, piece_identite, telephone,
         entree, sortie, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        req.tenantId, date, mois, parseInt(annee),
        journal_id ? parseInt(journal_id) : null,
        resolvedCaisse,
        rubrique_code, intitule, objet||'', beneficiaire||'',
        piece_identite||'', telephone||'',
        parseFloat(entree)||0, parseFloat(sortie)||0, req.user.id,
      ]
    );
    res.status(201).json({ ...rows[0], budget_warning: budgetWarning });
  } catch (err) {
    console.error('[Journal] createMouvement :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── PUT /api/journal/:id ──────────────────────────────────────────────────
const updateMouvement = async (req, res) => {
  const { date, rubrique_code, intitule, objet, beneficiaire,
          piece_identite, telephone, entree, sortie } = req.body;
  const id = req.params.id;   // texte : Postgres caste vers le type réel (uuid/bigint)
  const montantSortie = parseFloat(sortie) || 0;
  try {
    // Mouvement existant (pour retrouver mois/annee/journal et exclure sa propre sortie du cumul)
    const { rows: [old] } = await query(
      'SELECT mois, annee, journal_id FROM journal WHERE id=$1 AND tenant_id=$2',
      [id, req.tenantId]
    );
    if (!old) return res.status(404).json({ error: 'Mouvement introuvable.' });

    // Contrôle budgétaire sur la NOUVELLE valeur (RG-03 / RG-06 / RG-04) — refus sec.
    // On ferme ainsi le contournement : impossible de gonfler une sortie par édition.
    if (montantSortie > 0) {
      let ctrl;
      try {
        ctrl = await controleBudgetSortie(req, {
          mois: old.mois, annee: old.annee, journal_id: old.journal_id,
          rubrique_code, sortie: montantSortie, excludeId: id,
        });
      } catch (budgetErr) {
        console.error('[Journal] contrôle budgétaire (edit) indisponible :', budgetErr.message);
        return res.status(503).json({
          error: `Contrôle budgétaire indisponible (${budgetErr.message}) — modification refusée par sécurité.`,
        });
      }
      if (ctrl.bloque) {
        // La sortie d'origine reste inchangée ; la modification est refusée.
        return res.status(200).json({
          refus_modification: true,
          motif:   ctrl.motif,
          message: `Modification refusée : ${ctrl.message}`,
        });
      }
    }

    const { rows } = await query(
      `UPDATE journal SET date=$1, rubrique_code=$2, intitule=$3, objet=$4,
         beneficiaire=$5, piece_identite=$6, telephone=$7, entree=$8, sortie=$9
       WHERE id=$10 AND tenant_id=$11 RETURNING *`,
      [date, rubrique_code, intitule, objet||'', beneficiaire||'',
       piece_identite||'', telephone||'', parseFloat(entree)||0,
       montantSortie, id, req.tenantId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Mouvement introuvable.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[Journal] updateMouvement :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── DELETE /api/journal/:id ────────────────────────────────────────────────
const deleteMouvement = async (req, res) => {
  if (!['directeur','super_admin','comptable_cabinet'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Suppression réservée au directeur.' });
  }
  await query('DELETE FROM journal WHERE id=$1 AND tenant_id=$2',
              [req.params.id, req.tenantId]);
  res.json({ message: 'Mouvement supprimé.' });
};

// ── GET /api/journal/soldes ────────────────────────────────────────────────
const getSoldes = async (req, res) => {
  const { mois, annee } = req.query;
  try {
    const [especes, om] = await Promise.all([
      calcSoldeFinal(req.tenantId, mois, parseInt(annee), { type_caisse: 'especes' }),
      calcSoldeFinal(req.tenantId, mois, parseInt(annee), { type_caisse: 'om' }),
    ]);
    res.json({ especes, om });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/journal/ran ───────────────────────────────────────────────────
const getRan = async (req, res) => {
  const { mois, annee, caisse, journal_id } = req.query;
  try {
    const filtre = await resolveFiltre(req.tenantId, journal_id, caisse || 'especes');
    const montant = await autoRan(req.tenantId, mois, parseInt(annee), filtre);
    const prev = moisPrecedent(mois, parseInt(annee));
    const soldePrev = await calcSoldeFinal(req.tenantId, prev.mois, prev.annee, filtre);
    res.json({
      montant,
      mois_precedent:   prev.mois,
      annee_precedente: prev.annee,
      solde_precedent:  soldePrev.solde,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── POST /api/journal/ran — saisie manuelle ──────────────────────────────
const setRan = async (req, res) => {
  const { mois, annee, caisse, journal_id, montant } = req.body;
  if (!['directeur','super_admin','comptable_cabinet'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Réservé au directeur.' });
  }
  try {
    if (journal_id) {
      // Ajouter journal_id à la table ran si la colonne existe
      await query(
        `INSERT INTO ran(tenant_id, mois, annee, journal_id, type_caisse, montant)
         VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(tenant_id,mois,annee,type_caisse) DO UPDATE SET montant=EXCLUDED.montant`,
        [req.tenantId, mois, parseInt(annee), parseInt(journal_id), caisse||'especes', parseFloat(montant)||0]
      ).catch(() =>
        // Fallback si colonne journal_id pas encore migrée
        query(
          `INSERT INTO ran(tenant_id, mois, annee, type_caisse, montant)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(tenant_id,mois,annee,type_caisse) DO UPDATE SET montant=EXCLUDED.montant`,
          [req.tenantId, mois, parseInt(annee), caisse||'especes', parseFloat(montant)||0]
        )
      );
    } else {
      await query(
        `INSERT INTO ran(tenant_id, mois, annee, type_caisse, montant)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(tenant_id,mois,annee,type_caisse) DO UPDATE SET montant=EXCLUDED.montant`,
        [req.tenantId, mois, parseInt(annee), caisse||'especes', parseFloat(montant)||0]
      );
    }
    res.json({ message: 'RAN mis à jour.' });
  } catch (err) {
    console.error('[Journal] setRan :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/journal/recap?mois=&annee= ───────────────────────────────────
// Vue consolidée de tous les journaux (hors banque) pour la période
const getJournauxRecap = async (req, res) => {
  const { mois, annee } = req.query;
  if (!mois || !annee) return res.status(400).json({ error: 'mois et annee requis.' });
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Client requis.' });
  const yr = parseInt(annee);

  try {
    // Tous les journaux actifs (hors banque) avec leurs stats du mois
    const { rows: journaux } = await query(
      `SELECT
         j.id, j.nom, j.code, j.type, j.ordre,
         COALESCE(r.montant, 0)         AS ran,
         COALESCE(SUM(mv.entree), 0)    AS total_entrees,
         COALESCE(SUM(mv.sortie), 0)    AS total_sorties,
         COALESCE(r.montant, 0)
           + COALESCE(SUM(mv.entree), 0)
           - COALESCE(SUM(mv.sortie), 0) AS solde_final
       FROM journaux j
       LEFT JOIN ran r
         ON r.journal_id = j.id AND r.tenant_id = $1 AND r.mois = $2 AND r.annee = $3
       LEFT JOIN journal mv
         ON mv.journal_id = j.id AND mv.tenant_id = $1 AND mv.mois = $2 AND mv.annee = $3
       WHERE j.tenant_id = $1 AND j.actif = true AND j.type != 'banque'
       GROUP BY j.id, j.nom, j.code, j.type, j.ordre, r.montant
       ORDER BY j.ordre NULLS LAST, j.nom`,
      [tenantId, mois, yr]
    );

    // Banque du mois
    const { rows: bqRows } = await query(
      `SELECT COALESCE(solde_initial,0) AS solde_initial,
              COALESCE(fonds_recus,0)   AS fonds_recus,
              COALESCE(solde_final,0)   AS solde_final
       FROM banque WHERE tenant_id=$1 AND mois=$2 AND annee=$3`,
      [tenantId, mois, yr]
    );
    const banque = bqRows[0] || { solde_initial: 0, fonds_recus: 0, solde_final: 0 };

    // Arrêts de caisse du mois
    const { rows: arretRows } = await query(
      `SELECT journal_id, solde_final AS solde_arrete, arrete_le
       FROM arrets_caisse WHERE tenant_id=$1 AND mois=$2 AND annee=$3`,
      [tenantId, mois, yr]
    );
    const arretByJournal = {};
    arretRows.forEach(a => { arretByJournal[a.journal_id] = a; });

    res.json({
      journaux: journaux.map(j => ({
        ...j,
        ran:          parseFloat(j.ran),
        total_entrees: parseFloat(j.total_entrees),
        total_sorties: parseFloat(j.total_sorties),
        solde_final:   parseFloat(j.solde_final),
        arrete:        arretByJournal[j.id] || null,
      })),
      banque: {
        solde_initial: parseFloat(banque.solde_initial),
        fonds_recus:   parseFloat(banque.fonds_recus),
        solde_final:   parseFloat(banque.solde_final),
      },
      mois, annee: yr,
    });
  } catch (err) {
    console.error('[Journal] recap :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── GET /api/journal/cumuls ────────────────────────────────────────────────
const getCumuls = async (req, res) => {
  const { mois, annee, journal_id } = req.query;
  try {
    let whereExtra = '', params = [req.tenantId, mois, parseInt(annee)];
    if (journal_id) {
      params.push(parseInt(journal_id));
      whereExtra = `AND journal_id=$${params.length}`;
    }
    const { rows } = await query(
      `SELECT rubrique_code, type_caisse,
              COALESCE(SUM(entree),0) AS total_entrees,
              COALESCE(SUM(sortie),0) AS total_sorties
       FROM journal
       WHERE tenant_id=$1 AND mois=$2 AND annee=$3 ${whereExtra}
       GROUP BY rubrique_code, type_caisse`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── GET /api/journal/controle-context?journal_id=&mois=&annee= ──────────
// Snapshot des données nécessaires au pré-contrôle budgétaire hors-ligne
// (miroir de controleBudgetSortie, mais pour toutes les rubriques du mois).
const getControleContext = async (req, res) => {
  const { journal_id, mois, annee } = req.query;
  if (!mois || !annee) return res.status(400).json({ error: 'mois et annee requis.' });
  try {
    const jid = journal_id ? parseInt(journal_id) : null;
    const an  = parseInt(annee);

    const [plafondRes, sjRes, apprRes, srRes] = await Promise.all([
      query(`SELECT COALESCE(montant,0) AS v FROM budget_caisse
             WHERE tenant_id=$1 AND journal_id=$2 AND mois=$3 AND annee=$4 LIMIT 1`,
        [req.tenantId, jid, mois, an]).catch(() => ({ rows: [] })),
      query(`SELECT COALESCE(SUM(sortie),0) AS v FROM journal
             WHERE tenant_id=$1 AND journal_id=$2 AND mois=$3 AND annee=$4`,
        [req.tenantId, jid, mois, an]),
      query(`SELECT rubrique_code, COALESCE(SUM(montant_approuve),0) AS v FROM appel_fonds
             WHERE tenant_id=$1 AND mois_cible=$2 AND annee_cible=$3
               AND statut IN ('approuve','partiellement_approuve')
             GROUP BY rubrique_code`,
        [req.tenantId, mois, an]),
      query(`SELECT rubrique_code, COALESCE(SUM(sortie),0) AS v FROM journal
             WHERE tenant_id=$1 AND mois=$2 AND annee=$3 GROUP BY rubrique_code`,
        [req.tenantId, mois, an]),
    ]);

    const approuve_by_rubrique = {};
    apprRes.rows.forEach(r => { approuve_by_rubrique[r.rubrique_code]  = parseFloat(r.v) || 0; });
    const sorties_by_rubrique  = {};
    srRes.rows.forEach(r  => { sorties_by_rubrique[r.rubrique_code]    = parseFloat(r.v) || 0; });

    res.json({
      journal_id: jid, mois, annee: an,
      plafond:            parseFloat(plafondRes.rows[0]?.v) || 0,
      sorties_journal:    parseFloat(sjRes.rows[0]?.v)      || 0,
      approuve_by_rubrique,
      sorties_by_rubrique,
      cached_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Journal] controle-context :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = {
  getJournal, createMouvement, updateMouvement, deleteMouvement,
  getSoldes, getRan, setRan, getCumuls, getJournauxRecap, getControleContext,
};

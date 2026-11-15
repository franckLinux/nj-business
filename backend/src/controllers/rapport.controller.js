const { Op, fn, col } = require('sequelize');
const { Journal, Ran, Banque, Mouvement, Tenant, Rubrique, sequelize } = require('../models');
const { soldesJournaux } = require('../services/journal.service');

const MOIS = ['Janvier','Fevrier','Mars','Avril','Mai','Juin',
              'Juillet','Aout','Septembre','Octobre','Novembre','Decembre'];

const moisPrecedent = (mois, annee) => {
  const idx = MOIS.indexOf(mois);
  if (idx === 0) return { mois: MOIS[11], annee: annee - 1 };
  return { mois: MOIS[idx - 1], annee };
};

// Rubriques virements internes — exclus des ressources et emplois (évite double comptage)
const RUBRIQUES_NEUTRES = ['VCOM','VOMC','SCOM','SOMC'];

// ── Présentation des emplois PAR COMPTE COMPTABLE (09/11/2026) ────────────
// Le compte d'une rubrique est rubriques.code_comptable (reçu de la passerelle
// à la validation de l'équivalence). Son intitulé vient du plan DU CLIENT
// (SYSCOHADA ou SYCEBNL), à défaut du plan global. Les rubriques sans compte
// sont regroupées sous « Sans compte comptable » : rien ne disparaît, les
// totaux sont identiques à la présentation par rubrique.
const intitulesComptes = async (tenantId, comptes) => {
  const liste = [...new Set(comptes.filter(Boolean).map((c) => c.toLowerCase()))];
  if (!liste.length) return new Map();
  // Intitulé exact, sinon celui du plus proche compte parent (6181 → 618),
  // d'abord dans le plan du client, puis dans le plan global.
  const rows = await sequelize.query(
    `SELECT x.k,
            COALESCE(c.intitule, g.intitule) AS intitule,
            COALESCE(c.compte, g.compte)     AS trouve
       FROM unnest(CAST(:liste AS text[])) AS x(k)
       LEFT JOIN LATERAL (
         SELECT compte, intitule FROM plan_comptable_client
          WHERE tenant_id = :t AND statut <> 'archive' AND x.k LIKE lower(btrim(compte)) || '%'
          ORDER BY length(compte) DESC LIMIT 1) c ON true
       LEFT JOIN LATERAL (
         SELECT compte, intitule FROM plan_comptable_syscohada
          WHERE c.compte IS NULL AND x.k LIKE lower(btrim(compte)) || '%'
          ORDER BY length(compte) DESC LIMIT 1) g ON true`,
    { replacements: { t: tenantId, liste: `{${liste.map((c) => `"${c.replace(/["\\]/g, '')}"`).join(',')}}` }, type: sequelize.QueryTypes.SELECT }
  ).catch((err) => { console.error('[Rapport] intitulés des comptes :', err.message); return []; });
  return new Map(rows.filter((r) => r.intitule).map((r) => [r.k,
    String(r.trouve).toLowerCase() === r.k ? r.intitule : `${r.intitule} (rattaché au ${r.trouve})`]));
};

const regrouperParCompte = (lignes) => {
  const parCompte = new Map();
  for (const e of lignes) {
    const cle = e.code_comptable || '';
    if (!parCompte.has(cle)) {
      parCompte.set(cle, {
        compte: cle,
        intitule: cle ? (e.compte_intitule || `Compte ${cle}`) : 'Sans compte comptable',
        classe: cle && /^\d/.test(cle) ? Number(cle[0]) : null,
        esp: 0, om: 0, total: 0, rubriques: [],
      });
    }
    const g = parCompte.get(cle);
    g.esp += e.esp; g.om += e.om; g.total += e.total;
    g.rubriques.push({ rubrique_code: e.rubrique_code, intitule: e.intitule, esp: e.esp, om: e.om, total: e.total });
  }
  // Comptes triés par numéro ; « Sans compte » en dernier.
  return [...parCompte.values()].sort((a, b) => {
    if (!a.compte) return 1;
    if (!b.compte) return -1;
    return a.compte.localeCompare(b.compte);
  });
};

// ── GET /api/rapport/compte-emploi?mois=&annee= ──────────────────────────
const getCompteEmploi = async (req, res) => {
  const { mois, annee } = req.query;
  if (!mois || !annee) return res.status(400).json({ error: 'Paramètres mois et annee requis.' });

  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: "Sélectionnez un client pour voir son compte d'emploi." });

  const yr   = parseInt(annee, 10);
  const prev = moisPrecedent(mois, yr);

  try {
    // ── 1. Journaux actifs (toutes caisses — hors type banque) ───────────────
    // ── 2. RAN du mois (par journal_id ou par type_caisse) ───────────────────
    // ── 3. Banque + 4. Mouvements du mois groupés par journal + rubrique ─────
    const [journaux, ranRows, bqPrev, bqCourant, mvtRows, tenant, rubriquesRows] = await Promise.all([
      Journal.findAll({
        // Tous les journaux, BANQUE comprise : ses mouvements étaient déjà
        // comptés dans les emplois alors que son RAN et son solde ne l'étaient pas.
        where: { tenant_id: tenantId, actif: true },
        attributes: ['id', 'nom', 'code', 'type'],
        order: [['ordre', 'ASC'], ['nom', 'ASC']],
        raw: true,
      }),
      Ran.findAll({
        where: { tenant_id: tenantId, mois, annee: yr },
        attributes: ['journal_id', 'type_caisse', [fn('COALESCE', fn('SUM', col('montant')), 0), 'montant']],
        group: ['journal_id', 'type_caisse'], raw: true,
      }),
      Banque.findOne({ where: { tenant_id: tenantId, mois: prev.mois, annee: prev.annee } }),
      Banque.findOne({ where: { tenant_id: tenantId, mois, annee: yr } }),
      Mouvement.findAll({
        where: { tenant_id: tenantId, mois, annee: yr },
        attributes: [
          'journal_id', 'type_caisse', 'rubrique_code',
          [fn('COALESCE', fn('SUM', col('entree')), 0), 'total_entree'],
          [fn('COALESCE', fn('SUM', col('sortie')), 0), 'total_sortie'],
        ],
        // Regroupement par RUBRIQUE (et non par libellé) : une contre-passation
        // « ANNULATION n°X — … » porte un autre libellé mais la même rubrique,
        // ses montants négatifs doivent s'imputer sur la même ligne.
        group: ['journal_id', 'type_caisse', 'rubrique_code'],
        order: [['rubrique_code', 'ASC']],
        raw: true,
      }),
      Tenant.findOne({ where: { id: tenantId }, attributes: ['nom', 'devise', 'directeur_nom', 'caissier_nom'] }),
      Rubrique.findAll({ where: { tenant_id: tenantId }, attributes: ['code', 'intitule', 'code_comptable'], raw: true }),
    ]);
    const libRubrique = Object.fromEntries(rubriquesRows.map((r) => [r.code, r.intitule]));
    const compteRubrique = Object.fromEntries(rubriquesRows.map((r) => [r.code, String(r.code_comptable || '').trim()]));
    const libCompte = await intitulesComptes(tenantId, Object.values(compteRubrique));

    // RAN de chaque journal = solde final du mois précédent (ou solde
    // d'ouverture), calculé comme partout ailleurs — plus la ligne ran brute.
    const soldes = await soldesJournaux(tenantId, mois, yr, journaux.map((j) => j.id));
    const ranByJournalId = {};
    journaux.forEach((j) => { ranByJournalId[j.id] = soldes.get(Number(j.id))?.ran || 0; });
    const ranLegacy = {};   // type_caisse → montant (anciennes saisies sans journal)
    ranRows.forEach(r => {
      if (r.journal_id === null) ranLegacy[r.type_caisse] = (ranLegacy[r.type_caisse] || 0) + parseFloat(r.montant);
    });

    // Ancienne saisie manuelle de la banque : seulement s'il n'existe aucun
    // journal banque (sinon double comptage).
    const banqueManuelle     = !journaux.some((j) => j.type === 'banque');
    const soldeBanqueInitial = banqueManuelle ? (parseFloat(bqPrev?.solde_final) || 0) : 0;
    const fondsRecusBanque   = banqueManuelle ? (parseFloat(bqCourant?.fonds_recus) || 0) : 0;
    const soldeBanqueFinal   = banqueManuelle ? (parseFloat(bqCourant?.solde_final) || 0) : 0;

    // ── 5. Agréger par journal + pivot rubriques pour Section II ─────────────
    const mvtByJournal  = {};
    const pivotRubrique = {};

    mvtRows.forEach(r => {
      const jid      = r.journal_id;
      const isNeutre = RUBRIQUES_NEUTRES.includes(r.rubrique_code);
      const e = parseFloat(r.total_entree);
      const s = parseFloat(r.total_sortie);

      if (!mvtByJournal[jid]) mvtByJournal[jid] = { total_entree: 0, total_sortie: 0, fonds_recus: 0 };
      mvtByJournal[jid].total_entree += e;
      mvtByJournal[jid].total_sortie += s;
      if (!isNeutre) mvtByJournal[jid].fonds_recus += e; // entrées hors virements = fonds reçus

      // Section II — emplois par rubrique : montant NET (sorties − annulations).
      if (!isNeutre && s !== 0) {
        if (!pivotRubrique[r.rubrique_code]) {
          pivotRubrique[r.rubrique_code] = { intitule: libRubrique[r.rubrique_code] || r.rubrique_code, esp_s: 0, om_s: 0 };
        }
        if (r.type_caisse === 'especes') pivotRubrique[r.rubrique_code].esp_s += s;
        else                             pivotRubrique[r.rubrique_code].om_s  += s;
      }
    });

    // ── 6. Section I — Ressources par journal ─────────────────────────────────
    const ressources_journaux = journaux.map(j => ({
      journal_id:   j.id,
      journal_nom:  j.nom,
      journal_type: j.type,
      ran:          ranByJournalId[j.id] || 0,
      fonds_recus:  mvtByJournal[j.id]?.fonds_recus || 0,
    }));

    // RAN legacy (type_caisse, sans journal_id) — fallback si pas de journaux configurés
    const legacyEntries = [];
    if (ranLegacy.especes > 0 && !journaux.some(j => j.type === 'caisse')) {
      legacyEntries.push({ journal_id: null, journal_nom: 'Caisse Espèces', journal_type: 'caisse',
                           ran: ranLegacy.especes, fonds_recus: mvtByJournal[null]?.fonds_recus || 0 });
    }
    if (ranLegacy.om > 0 && !journaux.some(j => j.type === 'om')) {
      legacyEntries.push({ journal_id: null, journal_nom: 'Orange Money', journal_type: 'om',
                           ran: ranLegacy.om, fonds_recus: 0 });
    }

    const allJournauxRessources = [...legacyEntries, ...ressources_journaux];
    const totalRanJournaux      = allJournauxRessources.reduce((s, j) => s + j.ran, 0);
    const totalFondsJournaux    = allJournauxRessources.reduce((s, j) => s + j.fonds_recus, 0);
    const totalRessources       = totalRanJournaux + soldeBanqueInitial + fondsRecusBanque + totalFondsJournaux;

    // ── 7. Section II — Emplois par rubrique ──────────────────────────────────
    const emplois = Object.entries(pivotRubrique)
      .map(([code, p]) => ({
        rubrique_code: code,
        intitule:      p.intitule,
        code_comptable:  compteRubrique[code] || '',
        compte_intitule: libCompte.get((compteRubrique[code] || '').toLowerCase()) || '',
        esp:           p.esp_s,
        om:            p.om_s,
        total:         p.esp_s + p.om_s,
      }))
      // Rubrique entièrement annulée : plus aucun emploi à présenter.
      .filter((e) => Math.abs(e.total) > 0.004)
      .sort((a, b) => a.rubrique_code.localeCompare(b.rubrique_code));

    const totalEmplois = emplois.reduce((s, e) => s + e.total, 0);

    // ── 8. Section III — Trésorerie finale par journal ────────────────────────
    const tresorerie_journaux = journaux.map(j => {
      const ran = ranByJournalId[j.id] || 0;
      const mvt = mvtByJournal[j.id]   || { total_entree: 0, total_sortie: 0 };
      return {
        journal_id:   j.id,
        journal_nom:  j.nom,
        journal_type: j.type,
        solde_final:  ran + mvt.total_entree - mvt.total_sortie,
      };
    });
    const allJournauxTreso   = [
      ...legacyEntries.map(j => ({ ...j, solde_final: j.ran })),
      ...tresorerie_journaux,
    ];
    const totalSoldesJournaux = allJournauxTreso.reduce((s, j) => s + j.solde_final, 0);
    const disponibleFinal     = totalSoldesJournaux + soldeBanqueFinal;
    const ecart               = totalRessources - totalEmplois - disponibleFinal;

    res.json({
      meta: {
        mois, annee: yr,
        tenant_nom:    tenant?.nom           || '',
        directeur_nom: tenant?.directeur_nom || '',
        caissier_nom:  tenant?.caissier_nom  || '',
        devise:        tenant?.devise        || 'FCFA',
      },
      ressources: {
        journaux:             allJournauxRessources,
        solde_banque_initial: soldeBanqueInitial,
        fonds_recus_banque:   fondsRecusBanque,
        total:                totalRessources,
      },
      emplois: {
        lignes: emplois,
        // Même montants, regroupés par compte comptable (avec le détail des rubriques).
        par_compte: regrouperParCompte(emplois),
        total:  totalEmplois,
      },
      tresorerie_finale: {
        journaux:     allJournauxTreso,
        solde_banque: soldeBanqueFinal,
        disponible:   disponibleFinal,
        ecart,
      },
      solde_net: totalRessources - totalEmplois,
    });

  } catch (err) {
    console.error('[Rapport] compte-emploi :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── GET /api/rapport/synthese-annuelle?annee= ──────────────────────────────
// Synthèse mois par mois pour le super_admin (tous les clients)
const getSyntheseAnnuelle = async (req, res) => {
  const { annee } = req.query;
  const yr = parseInt(annee, 10) || new Date().getFullYear();
  const tenantId = req.tenantId;
  if (!tenantId) return res.status(400).json({ error: 'Sélectionnez un client.' });

  try {
    const rows = await Mouvement.findAll({
      where: { tenant_id: tenantId, annee: yr },
      attributes: [
        'mois',
        [fn('COALESCE', fn('SUM', col('entree')), 0), 'total_entrees'],
        [fn('COALESCE', fn('SUM', col('sortie')), 0), 'total_sorties'],
        [fn('COUNT', col('id')), 'nb_mouvements'],
      ],
      group: ['mois'],
      order: [[fn('MIN', col('date')), 'ASC']],
      raw: true,
    });

    const tenant = await Tenant.findOne({ where: { id: tenantId }, attributes: ['nom'] });

    res.json({
      tenant_nom: tenant?.nom || '',
      annee: yr,
      mois: rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

module.exports = { getCompteEmploi, getSyntheseAnnuelle };

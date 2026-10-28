// src/services/passerelle.service.js
// Passerelle comptable — lot 1 : paramétrage (migration 037).
//
// Rattache chaque élément de la caisse à un compte du plan du client :
//   - rubrique  → compte de charge / produit / tiers (equivalences_comptables,
//                 versionnée : le directeur PROPOSE, le cabinet VALIDE) ;
//   - journal   → compte de trésorerie (classe 5) + code journal comptable ;
//   - virements → compte des virements internes du client (585 par défaut).
// Le lot 2 (moteur d'écritures) lira exclusivement la version VALIDÉE.
//
// Tout passe par des transactions : une validation archive l'ancienne version,
// active la nouvelle, recopie le compte dans rubriques.code_comptable et
// journalise — tout ou rien. Les index uniques partiels de la 037 garantissent
// en base « une seule version en vigueur, une seule proposition en attente ».
const { sequelize } = require('../models');
const { planClientActif } = require('./plan_client.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements, opts = {}) =>
  sequelize.query(sql, { replacements, type: T.SELECT, ...opts });

class ErreurMetier extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Comptes de trésorerie suggérés (SYSCOHADA révisé) et codes journaux usuels.
const SUGGESTIONS_TRESORERIE = {
  caisse:         { racine: '571', code: 'CA' },
  banque:         { racine: '521', code: 'BQ' },
  om:             { racine: '552', code: 'OM' },
  momo:           { racine: '552', code: 'MM' },
  carte_prepayee: { racine: '551', code: 'CP' },
  autre:          { racine: '',    code: '' },
};

const FORMATS = ['csv', 'sage_i7'];
const norm = (c) => String(c ?? '').trim();

const exigerClient = (tenantId) => {
  if (!tenantId) throw new ErreurMetier(400, 'Choisissez d\'abord un client.');
};

// ── Plan comptable du client (ou plan global s'il n'est pas initialisé) ────
const chercherCompte = async (tenantId, compte, transaction) => {
  const c = norm(compte);
  if (!c) return null;
  const rows = (await planClientActif(tenantId))
    ? await Q(`SELECT compte, intitule, classe, statut = 'actif' AS actif
                 FROM plan_comptable_client
                WHERE tenant_id = :tenantId AND lower(btrim(compte)) = lower(:c)`,
      { tenantId, c }, { transaction })
    : await Q(`SELECT compte, intitule, classe, actif
                 FROM plan_comptable_syscohada WHERE lower(btrim(compte)) = lower(:c)`,
      { c }, { transaction });
  return rows[0] || null;
};

/** Contrôle bloquant : compte existant et actif ; `classe5` pour la trésorerie. */
const verifierCompte = async (tenantId, compte, { classe5 = false, transaction } = {}) => {
  const c = norm(compte);
  if (!c) throw new ErreurMetier(400, 'Compte obligatoire.');
  const trouve = await chercherCompte(tenantId, c, transaction);
  if (!trouve) throw new ErreurMetier(400, `Le compte ${c} n'existe pas dans le plan comptable du client.`);
  if (!trouve.actif) throw new ErreurMetier(400, `Le compte ${c} est inactif ou archivé dans le plan du client.`);
  if (classe5 && !c.startsWith('5')) {
    throw new ErreurMetier(400, `Le compte ${c} n'est pas un compte de trésorerie (classe 5).`);
  }
  return trouve;
};

// ── Cohérence comptable (lot « validation du paramétrage », 22/10/2026) ────
// Sens : une dépense ne s'impute jamais sur un produit (classe 7), une recette
// jamais sur une charge (classe 6) → BLOQUANT. Les autres classes inhabituelles
// (immobilisation, tiers, trésorerie, HAO…) sont acceptées avec un AVERTISSEMENT.
const AVERT_DEPENSE = {
  1: 'compte de capitaux (remboursement d\'emprunt ?)', 2: 'compte d\'immobilisation (achat d\'équipement ?)', 3: 'compte de stock',
  4: 'compte de tiers (avance, fournisseur, personnel ?)', 5: 'compte de trésorerie (virement interne ?)', 8: 'compte hors activités ordinaires', 9: 'compte analytique',
};
const AVERT_ENTREE = {
  1: 'compte de capitaux (apport ou emprunt ?)', 2: 'compte d\'immobilisation (cession ?)', 3: 'compte de stock',
  4: 'compte de tiers (client, remboursement d\'avance ?)', 5: 'compte de trésorerie (virement interne ?)', 8: 'compte hors activités ordinaires', 9: 'compte analytique',
};
const coherenceSens = (typeRubrique, compte) => {
  const classe = norm(compte).charAt(0);
  if (typeRubrique === 'depense' && classe === '7') {
    return { bloquant: `Une rubrique de dépense ne peut pas être imputée sur le compte ${compte} : c'est un compte de produit (classe 7). Choisissez un compte de charge (classe 6).` };
  }
  if (typeRubrique === 'entree' && classe === '6') {
    return { bloquant: `Une rubrique d'entrée ne peut pas être imputée sur le compte ${compte} : c'est un compte de charge (classe 6). Choisissez un compte de produit (classe 7).` };
  }
  const table = typeRubrique === 'entree' ? AVERT_ENTREE : AVERT_DEPENSE;
  const lib = table[classe];
  return lib ? { avertissement: `Compte ${compte} : ${lib}. Accepté, à vérifier.` } : {};
};

// Compte de regroupement : il a des sous-comptes actifs dans le plan du client
// (ex. 571 alors que 5711 et 5712 existent). Les écritures doivent porter sur
// un compte de détail, sinon l'import dans le logiciel comptable échoue.
const sousComptes = async (tenantId, compte, transaction) => {
  const c = norm(compte);
  if (!c) return [];
  const rows = (await planClientActif(tenantId))
    ? await Q(`SELECT compte FROM plan_comptable_client
                WHERE tenant_id = :tenantId AND statut = 'actif' AND compte LIKE :p AND compte <> :c
                ORDER BY compte LIMIT 6`, { tenantId, p: `${c}%`, c }, { transaction })
    : await Q(`SELECT compte FROM plan_comptable_syscohada
                WHERE actif AND compte LIKE :p AND compte <> :c ORDER BY compte LIMIT 6`, { p: `${c}%`, c }, { transaction });
  return rows.map((r) => r.compte);
};
const exigerCompteDetail = async (tenantId, compte, transaction) => {
  const sc = await sousComptes(tenantId, compte, transaction);
  if (sc.length) {
    throw new ErreurMetier(400, `Le compte ${norm(compte)} est un compte de regroupement : choisissez un compte de détail (${sc.slice(0, 5).join(', ')}${sc.length > 5 ? '…' : ''}).`);
  }
};

const CODE_JOURNAL_RE = /^[A-Z0-9]{1,6}$/;

/** Premier compte actif du plan commençant par `racine` (suggestion). */
const suggererCompte = async (tenantId, racine) => {
  if (!racine) return null;
  const client = await planClientActif(tenantId);
  const rows = client
    ? await Q(`SELECT compte FROM plan_comptable_client
                WHERE tenant_id = :tenantId AND statut = 'actif' AND compte LIKE :p
                ORDER BY length(compte) DESC, compte LIMIT 1`, { tenantId, p: `${racine}%` })
    : await Q(`SELECT compte FROM plan_comptable_syscohada
                WHERE actif AND compte LIKE :p ORDER BY length(compte) DESC, compte LIMIT 1`,
      { p: `${racine}%` });
  return rows[0]?.compte || null;
};

const journaliser = (transaction, { tenantId, userId, action, entite, id, avant, apres }) =>
  sequelize.query(
    `INSERT INTO audit_log (tenant_id, user_id, action, entite, entite_id, ancienne_valeur, nouvelle_valeur)
     VALUES (:tenantId, :userId, :action, :entite, :id, CAST(:avant AS jsonb), CAST(:apres AS jsonb))`,
    { replacements: { tenantId, userId, action, entite, id: String(id),
        avant: avant ? JSON.stringify(avant) : null, apres: apres ? JSON.stringify(apres) : null },
      transaction, type: T.INSERT }
  );

// ── Lecture : état complet du paramétrage ───────────────────────────────────
const etat = async (tenantId) => {
  exigerClient(tenantId);
  const [tenant] = await Q(
    'SELECT compte_virements, format_export FROM tenants WHERE id = :tenantId', { tenantId });

  const journaux = await Q(
    `SELECT id, code, nom, type, actif, compte_tresorerie, code_journal_compta
       FROM journaux WHERE tenant_id = :tenantId ORDER BY actif DESC, ordre, code`, { tenantId });

  const rubriques = await Q(
    `SELECT r.id, r.code, r.intitule, r.type, r.est_virement_interne, r.actif,
            coalesce(r.code_comptable, '') AS code_comptable,
            v.id AS v_id, v.compte AS v_compte, v.version AS v_version, v.decide_le AS v_decide_le,
            uv.username AS v_decide_par,
            b.id AS b_id, b.compte AS b_compte, b.commentaire AS b_commentaire, b.propose_le AS b_propose_le,
            ub.username AS b_propose_par,
            coalesce(m.nb, 0)::int AS nb_a_exporter, coalesce(m.montant, 0) AS montant_a_exporter
       FROM rubriques r
       LEFT JOIN equivalences_comptables v ON v.rubrique_id = r.id AND v.statut = 'valide'
       LEFT JOIN users uv ON uv.id = v.decide_par
       LEFT JOIN equivalences_comptables b ON b.rubrique_id = r.id AND b.statut = 'brouillon'
       LEFT JOIN users ub ON ub.id = b.propose_par
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS nb, SUM(abs(coalesce(j.entree, 0)) + abs(coalesce(j.sortie, 0))) AS montant
           FROM journal j
          WHERE j.tenant_id = r.tenant_id AND j.rubrique_code = r.code AND NOT coalesce(j.exporte_sage, false)
       ) m ON true
      WHERE r.tenant_id = :tenantId AND (r.actif OR coalesce(m.nb, 0) > 0)
      ORDER BY r.type, r.ordre, r.code`, { tenantId });

  // Validité des comptes cités (une requête par compte distinct, peu nombreux).
  const cache = new Map();
  const infoCompte = async (c) => {
    const k = norm(c).toLowerCase();
    if (!k) return null;
    if (!cache.has(k)) cache.set(k, await chercherCompte(tenantId, c));
    return cache.get(k);
  };

  const anomalies = [];

  const compteVirements = norm(tenant?.compte_virements);
  const infoVir = await infoCompte(compteVirements);
  const virementsOk = Boolean(infoVir?.actif && compteVirements.startsWith('5'));
  const aDesVirements = rubriques.some((r) => r.est_virement_interne);
  if (aDesVirements && !virementsOk) {
    anomalies.push(`Compte des virements internes ${compteVirements || '(vide)'} absent, inactif ou hors classe 5.`);
  }

  const journauxOut = [];
  const actifsJ = journaux.filter((x) => x.actif);
  const compter = (cle) => actifsJ.reduce((m, x) => { const k = cle(x); if (k) m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());
  const nbCode = compter((x) => norm(x.code_journal_compta).toUpperCase());
  const nbCompte = compter((x) => norm(x.compte_tresorerie).toLowerCase());
  for (const j of journaux) {
    const info = await infoCompte(j.compte_tresorerie);
    const regroupement = info?.actif ? (await sousComptes(tenantId, j.compte_tresorerie)).length > 0 : false;
    const compteOk = Boolean(info?.actif && norm(j.compte_tresorerie).startsWith('5') && !regroupement);
    const codeJ = norm(j.code_journal_compta).toUpperCase();
    const codeDoublon = j.actif && codeJ && nbCode.get(codeJ) > 1;
    const codeOk = codeJ !== '' && !codeDoublon;
    const partage = j.actif && norm(j.compte_tresorerie) && nbCompte.get(norm(j.compte_tresorerie).toLowerCase()) > 1;
    if (j.actif && regroupement) anomalies.push(`Journal ${j.code} : ${j.compte_tresorerie} est un compte de regroupement, choisissez un compte de détail.`);
    if (codeDoublon) anomalies.push(`Journal ${j.code} : code journal ${codeJ} utilisé par plusieurs caisses.`);
    const sugg = SUGGESTIONS_TRESORERIE[j.type] || SUGGESTIONS_TRESORERIE.autre;
    const suggestion = compteOk ? null : {
      compte_tresorerie: await suggererCompte(tenantId, sugg.racine),
      code_journal_compta: norm(j.code_journal_compta) || sugg.code,
    };
    if (j.actif && !compteOk && !regroupement) anomalies.push(`Journal ${j.code} : compte de trésorerie manquant ou invalide.`);
    if (j.actif && !codeJ) anomalies.push(`Journal ${j.code} : code journal comptable manquant.`);
    journauxOut.push({
      ...j, intitule_compte: info?.intitule || null,
      etat: compteOk && codeOk ? 'ok' : 'incomplet', suggestion,
      alerte: regroupement ? `Compte de regroupement : choisissez un sous-compte de ${j.compte_tresorerie}.`
        : codeDoublon ? `Code journal ${codeJ} déjà utilisé par une autre caisse.`
          : partage ? `Compte ${j.compte_tresorerie} partagé avec une autre caisse : rapprochement impossible caisse par caisse.` : null,
    });
  }

  const rubriquesOut = [];
  for (const r of rubriques) {
    let etatR;
    let alerte = null;
    if (r.est_virement_interne) {
      etatR = virementsOk ? 'virement' : 'incomplet';
    } else if (r.v_id) {
      const info = await infoCompte(r.v_compte);
      if (!info?.actif) {
        etatR = 'compte_invalide';
        alerte = `Le compte validé ${r.v_compte} est absent ou inactif dans le plan.`;
      } else if (coherenceSens(r.type, r.v_compte).bloquant) {
        etatR = 'incoherent';
        alerte = coherenceSens(r.type, r.v_compte).bloquant;
      } else if ((await sousComptes(tenantId, r.v_compte)).length) {
        etatR = 'regroupement';
        alerte = `Le compte validé ${r.v_compte} est un compte de regroupement : validez un compte de détail.`;
      } else if (norm(r.code_comptable).toLowerCase() !== norm(r.v_compte).toLowerCase()) {
        etatR = 'ecart';
        alerte = `Le code de la rubrique (${r.code_comptable || 'vide'}) diffère du compte validé (${r.v_compte}).`;
      } else {
        etatR = 'valide';
        alerte = coherenceSens(r.type, r.v_compte).avertissement || null;
      }
    } else {
      etatR = r.b_id ? 'a_valider' : 'non_mappe';
    }
    if (!r.est_virement_interne && etatR !== 'valide') {
      const libelle = { a_valider: 'en attente de validation', non_mappe: 'sans compte', ecart: 'écart avec le code de la rubrique',
        compte_invalide: 'compte validé invalide', incoherent: 'compte de sens contraire', regroupement: 'compte de regroupement' }[etatR];
      anomalies.push(`Rubrique ${r.code} (${r.intitule}) : ${libelle}.`);
    }
    // Écran interactif (28/10/2026) : intitulé des comptes affichés, et
    // suggestion = code comptable déjà saisi sur la rubrique, s'il est valable
    // (compte actif, de détail, de sens cohérent). Information seulement : rien
    // n'est enregistré sans action de l'utilisateur.
    const intitule = async (c) => (c ? (await infoCompte(c))?.intitule || null : null);
    let suggestion = null;
    if (!r.est_virement_interne && !r.v_id && !r.b_id && norm(r.code_comptable)) {
      const info = await infoCompte(r.code_comptable);
      if (info?.actif && !coherenceSens(r.type, r.code_comptable).bloquant
          && !(await sousComptes(tenantId, r.code_comptable)).length) {
        suggestion = { compte: norm(r.code_comptable), intitule: info.intitule || null };
      }
    }
    rubriquesOut.push({
      archivee: !r.actif, nb_a_exporter: r.nb_a_exporter, montant_a_exporter: parseFloat(r.montant_a_exporter) || 0,
      id: r.id, code: r.code, intitule: r.intitule, type: r.type,
      est_virement_interne: r.est_virement_interne, code_comptable: r.code_comptable,
      validee: r.v_id ? { id: r.v_id, compte: r.v_compte, version: r.v_version, decide_le: r.v_decide_le, decide_par: r.v_decide_par,
        intitule: await intitule(r.v_compte) } : null,
      proposition: r.b_id ? { id: r.b_id, compte: r.b_compte, commentaire: r.b_commentaire, propose_le: r.b_propose_le, propose_par: r.b_propose_par,
        intitule: await intitule(r.b_compte) } : null,
      suggestion,
      etat: etatR, alerte,
    });
  }

  const aMapper = rubriquesOut.filter((r) => !r.est_virement_interne);
  const journauxActifs = journauxOut.filter((j) => j.actif);
  const completude = {
    rubriques_total: aMapper.length,
    rubriques_ok: aMapper.filter((r) => r.etat === 'valide').length,
    rubriques_a_valider: aMapper.filter((r) => r.etat === 'a_valider').length,
    propositions_en_attente: aMapper.filter((r) => r.proposition).length,
    journaux_total: journauxActifs.length,
    journaux_ok: journauxActifs.filter((j) => j.etat === 'ok').length,
    virements_ok: !aDesVirements || virementsOk,
  };
  completude.pret = completude.rubriques_ok === completude.rubriques_total
    && completude.journaux_ok === completude.journaux_total
    && completude.virements_ok && completude.journaux_total > 0;

  return {
    parametres: {
      compte_virements: compteVirements,
      intitule_compte_virements: infoVir?.intitule || null,
      format_export: tenant?.format_export || 'csv',
      formats_disponibles: [{ code: 'csv', libelle: 'CSV (tout logiciel)', actif: true },
        { code: 'sage_i7', libelle: 'SAGE i7 (.ecr) — dès réception d\'un fichier client', actif: false }],
    },
    journaux: journauxOut, rubriques: rubriquesOut, completude, anomalies,
  };
};

// ── Paramètres généraux (cabinet) ───────────────────────────────────────────
const enregistrerParametres = async ({ tenantId, userId, compte_virements, format_export }) => {
  exigerClient(tenantId);
  return sequelize.transaction(async (transaction) => {
    const [avant] = await Q('SELECT compte_virements, format_export FROM tenants WHERE id = :tenantId FOR UPDATE',
      { tenantId }, { transaction });
    const apres = { ...avant };
    if (compte_virements !== undefined) {
      await verifierCompte(tenantId, compte_virements, { classe5: true, transaction });
      apres.compte_virements = norm(compte_virements);
    }
    if (format_export !== undefined) {
      if (!FORMATS.includes(format_export)) throw new ErreurMetier(400, 'Format d\'export inconnu.');
      if (format_export === 'sage_i7') {
        throw new ErreurMetier(400, 'Le format SAGE i7 sera disponible après validation sur un fichier .ecr réel d\'un client. Utilisez CSV pour l\'instant.');
      }
      apres.format_export = format_export;
    }
    await sequelize.query(
      'UPDATE tenants SET compte_virements = :cv, format_export = :fe WHERE id = :tenantId',
      { replacements: { cv: apres.compte_virements, fe: apres.format_export, tenantId }, transaction, type: T.UPDATE });
    await journaliser(transaction, { tenantId, userId, action: 'PASSERELLE_PARAMETRES', entite: 'tenants', id: tenantId, avant, apres });
    return apres;
  });
};

// ── Journal : compte de trésorerie et code journal (cabinet) ────────────────
const enregistrerJournal = async ({ tenantId, userId, journalId, compte_tresorerie, code_journal_compta }) => {
  exigerClient(tenantId);
  const code = norm(code_journal_compta).toUpperCase();
  if (!code) throw new ErreurMetier(400, 'Code journal comptable obligatoire.');
  if (!CODE_JOURNAL_RE.test(code)) {
    throw new ErreurMetier(400, 'Code journal comptable : 1 à 6 lettres ou chiffres, sans espace ni accent (ex. CA, BQ1, OM).');
  }
  return sequelize.transaction(async (transaction) => {
    const [avant] = await Q(
      `SELECT id, code, compte_tresorerie, code_journal_compta FROM journaux
        WHERE id = :journalId AND tenant_id = :tenantId FOR UPDATE`, { journalId, tenantId }, { transaction });
    if (!avant) throw new ErreurMetier(404, 'Journal introuvable.');
    await verifierCompte(tenantId, compte_tresorerie, { classe5: true, transaction });
    await exigerCompteDetail(tenantId, compte_tresorerie, transaction);
    const [doublon] = await Q(
      `SELECT code FROM journaux WHERE tenant_id = :tenantId AND id <> :journalId AND actif
          AND upper(btrim(code_journal_compta)) = :code`, { tenantId, journalId, code }, { transaction });
    if (doublon) throw new ErreurMetier(409, `Le code journal ${code} est déjà utilisé par le journal ${doublon.code} : chaque caisse doit avoir son propre code.`);
    const partages = await Q(
      `SELECT code FROM journaux WHERE tenant_id = :tenantId AND id <> :journalId AND actif
          AND lower(btrim(compte_tresorerie)) = lower(:ct)`, { tenantId, journalId, ct: norm(compte_tresorerie) }, { transaction });
    const apres = { compte_tresorerie: norm(compte_tresorerie), code_journal_compta: code };
    await sequelize.query(
      'UPDATE journaux SET compte_tresorerie = :ct, code_journal_compta = :cj WHERE id = :journalId',
      { replacements: { ct: apres.compte_tresorerie, cj: code, journalId }, transaction, type: T.UPDATE });
    await journaliser(transaction, { tenantId, userId, action: 'PASSERELLE_JOURNAL', entite: 'journaux', id: journalId,
      avant: { compte_tresorerie: avant.compte_tresorerie, code_journal_compta: avant.code_journal_compta }, apres });
    return {
      id: avant.id, code: avant.code, ...apres,
      avertissement: partages.length
        ? `Le compte ${apres.compte_tresorerie} est aussi utilisé par ${partages.map((x) => x.code).join(', ')} : le rapprochement caisse par caisse sera impossible. Préférez un sous-compte par caisse.`
        : null,
    };
  });
};

// ── Équivalences ────────────────────────────────────────────────────────────
const rubriqueDuClient = async (transaction, tenantId, rubriqueId) => {
  const [r] = await Q(
    `SELECT r.id, r.code, r.intitule, r.type, r.est_virement_interne, coalesce(r.code_comptable, '') AS code_comptable
       FROM rubriques r
      WHERE r.id = :rubriqueId AND r.tenant_id = :tenantId
        AND (r.actif OR EXISTS (SELECT 1 FROM journal j WHERE j.tenant_id = r.tenant_id AND j.rubrique_code = r.code
                                   AND NOT coalesce(j.exporte_sage, false)))
      FOR UPDATE OF r`,
    { rubriqueId, tenantId }, { transaction });
  if (!r) throw new ErreurMetier(404, 'Rubrique introuvable, ou désactivée sans mouvement à exporter.');
  if (r.est_virement_interne) {
    throw new ErreurMetier(400, `La rubrique ${r.code} est un virement interne : elle utilise le compte des virements du client.`);
  }
  return r;
};

const prochaineVersion = async (transaction, rubriqueId) => {
  const [{ v }] = await Q(
    'SELECT coalesce(max(version), 0) + 1 AS v FROM equivalences_comptables WHERE rubrique_id = :rubriqueId',
    { rubriqueId }, { transaction });
  return v;
};

/** Valide une ligne brouillon (dans la transaction de l'appelant). */
const validerLigne = async (transaction, { tenantId, userId, ligne, rubrique }) => {
  const [ancienne] = await Q(
    `SELECT id, compte, version FROM equivalences_comptables
      WHERE rubrique_id = :rid AND statut = 'valide' FOR UPDATE`, { rid: rubrique.id }, { transaction });
  if (ancienne) {
    await sequelize.query(
      "UPDATE equivalences_comptables SET statut = 'archive' WHERE id = :id",
      { replacements: { id: ancienne.id }, transaction, type: T.UPDATE });
  }
  await sequelize.query(
    `UPDATE equivalences_comptables SET statut = 'valide', decide_par = :userId, decide_le = NOW()
      WHERE id = :id`, { replacements: { id: ligne.id, userId }, transaction, type: T.UPDATE });
  await sequelize.query(
    'UPDATE rubriques SET code_comptable = :compte WHERE id = :rid',
    { replacements: { compte: ligne.compte, rid: rubrique.id }, transaction, type: T.UPDATE });
  await journaliser(transaction, {
    tenantId, userId, action: 'PASSERELLE_VALIDATION', entite: 'equivalences_comptables', id: ligne.id,
    avant: ancienne ? { compte: ancienne.compte, version: ancienne.version } : null,
    apres: { rubrique: rubrique.code, compte: ligne.compte, version: ligne.version },
  });
};

/**
 * Propose un compte pour une rubrique. Avec `valider` (cabinet), la proposition
 * est validée dans la même transaction. Une proposition en attente est
 * remplacée (une seule par rubrique).
 */
const proposerDans = async (transaction, { tenantId, userId, rubriqueId, compte, commentaire = '', valider = false }) => {
  const rubrique = await rubriqueDuClient(transaction, tenantId, rubriqueId);
  const info = await verifierCompte(tenantId, compte, { transaction });
  const c = norm(info.compte);
  await exigerCompteDetail(tenantId, c, transaction);
  const sens = coherenceSens(rubrique.type, c);
  if (sens.bloquant) throw new ErreurMetier(400, sens.bloquant);
  const avertissement = sens.avertissement || null;

  const [enVigueur] = await Q(
    "SELECT compte FROM equivalences_comptables WHERE rubrique_id = :rid AND statut = 'valide'",
    { rid: rubrique.id }, { transaction });
  if (enVigueur && enVigueur.compte.toLowerCase() === c.toLowerCase()) {
    // Rien à changer ; on retire une éventuelle proposition devenue sans objet.
    await sequelize.query(
      "DELETE FROM equivalences_comptables WHERE rubrique_id = :rid AND statut = 'brouillon'",
      { replacements: { rid: rubrique.id }, transaction, type: T.DELETE });
    if (norm(rubrique.code_comptable).toLowerCase() !== c.toLowerCase() && valider) {
      await sequelize.query('UPDATE rubriques SET code_comptable = :c WHERE id = :rid',
        { replacements: { c, rid: rubrique.id }, transaction, type: T.UPDATE });
    }
    return { rubrique: rubrique.code, compte: c, statut: 'inchange', avertissement };
  }

  await sequelize.query(
    "DELETE FROM equivalences_comptables WHERE rubrique_id = :rid AND statut = 'brouillon'",
    { replacements: { rid: rubrique.id }, transaction, type: T.DELETE });
  const version = await prochaineVersion(transaction, rubrique.id);
  const [ligne] = await Q(
    `INSERT INTO equivalences_comptables (tenant_id, rubrique_id, compte, version, statut, commentaire, propose_par)
     VALUES (:tenantId, :rid, :c, :version, 'brouillon', :commentaire, :userId)
     RETURNING id, compte, version`,
    { tenantId, rid: rubrique.id, c, version, commentaire: String(commentaire || '').slice(0, 500), userId },
    { transaction, type: T.SELECT });

  if (valider) {
    await validerLigne(transaction, { tenantId, userId, ligne, rubrique });
    return { rubrique: rubrique.code, compte: c, version, statut: 'valide', avertissement };
  }
  await journaliser(transaction, {
    tenantId, userId, action: 'PASSERELLE_PROPOSITION', entite: 'equivalences_comptables', id: ligne.id,
    apres: { rubrique: rubrique.code, compte: c, version },
  });
  return { rubrique: rubrique.code, compte: c, version, statut: 'brouillon', avertissement };
};

const proposer = async (opts) => {
  exigerClient(opts.tenantId);
  return sequelize.transaction((transaction) => proposerDans(transaction, opts));
};

/**
 * Import en lot : [{ rubrique_code | rubrique_id, compte }]. Chaque ligne est
 * traitée dans un point de sauvegarde : une ligne en erreur n'annule pas les
 * autres, et le rapport dit exactement ce qui a été fait.
 */
const proposerLot = async ({ tenantId, userId, lignes, valider = false }) => {
  exigerClient(tenantId);
  if (!Array.isArray(lignes) || lignes.length === 0) throw new ErreurMetier(400, 'Aucune ligne à importer.');
  if (lignes.length > 500) throw new ErreurMetier(400, '500 lignes au maximum par import.');
  const rubriques = await Q(
    `SELECT r.id, upper(r.code) AS code FROM rubriques r
      WHERE r.tenant_id = :tenantId
        AND (r.actif OR EXISTS (SELECT 1 FROM journal j WHERE j.tenant_id = r.tenant_id AND j.rubrique_code = r.code
                                   AND NOT coalesce(j.exporte_sage, false)))`, { tenantId });
  const parCode = new Map(rubriques.map((r) => [r.code, r.id]));

  const rapport = { traitees: 0, valide: 0, brouillon: 0, inchange: 0, erreurs: [], avertissements: [] };
  await sequelize.transaction(async (transaction) => {
    for (const [i, l] of lignes.entries()) {
      const code = norm(l.rubrique_code).toUpperCase();
      const rubriqueId = l.rubrique_id || parCode.get(code);
      const repere = code || `ligne ${i + 1}`;
      if (!rubriqueId) { rapport.erreurs.push(`${repere} : rubrique inconnue.`); continue; }
      await sequelize.query(`SAVEPOINT ligne_${i}`, { transaction, type: T.RAW });
      try {
        const r = await proposerDans(transaction, { tenantId, userId, rubriqueId, compte: l.compte, commentaire: l.commentaire || 'Import en lot', valider });
        await sequelize.query(`RELEASE SAVEPOINT ligne_${i}`, { transaction, type: T.RAW });
        rapport.traitees += 1;
        rapport[r.statut] += 1;
        if (r.avertissement) rapport.avertissements.push(`${repere} : ${r.avertissement}`);
      } catch (err) {
        await sequelize.query(`ROLLBACK TO SAVEPOINT ligne_${i}`, { transaction, type: T.RAW });
        if (!(err instanceof ErreurMetier)) throw err; // erreur technique : on annule tout
        rapport.erreurs.push(`${repere} : ${err.message}`);
      }
    }
  });
  return rapport;
};

/** Décision du cabinet sur une proposition en attente. */
const decider = async ({ tenantId, userId, equivalenceId, decision, motif = '' }) => {
  exigerClient(tenantId);
  if (!['valider', 'rejeter'].includes(decision)) throw new ErreurMetier(400, 'Décision attendue : valider ou rejeter.');
  return sequelize.transaction(async (transaction) => {
    const [ligne] = await Q(
      `SELECT id, rubrique_id, compte, version, statut FROM equivalences_comptables
        WHERE id = :equivalenceId AND tenant_id = :tenantId FOR UPDATE`,
      { equivalenceId, tenantId }, { transaction });
    if (!ligne) throw new ErreurMetier(404, 'Proposition introuvable.');
    if (ligne.statut !== 'brouillon') throw new ErreurMetier(409, 'Cette proposition a déjà été traitée.');
    const rubrique = await rubriqueDuClient(transaction, tenantId, ligne.rubrique_id);

    if (decision === 'rejeter') {
      const m = norm(motif);
      if (!m) throw new ErreurMetier(400, 'Motif du rejet obligatoire.');
      await sequelize.query(
        `UPDATE equivalences_comptables SET statut = 'rejete', motif_rejet = :m, decide_par = :userId, decide_le = NOW()
          WHERE id = :id`, { replacements: { id: ligne.id, m: m.slice(0, 500), userId }, transaction, type: T.UPDATE });
      await journaliser(transaction, { tenantId, userId, action: 'PASSERELLE_REJET', entite: 'equivalences_comptables',
        id: ligne.id, apres: { rubrique: rubrique.code, compte: ligne.compte, motif: m } });
      return { statut: 'rejete', rubrique: rubrique.code };
    }

    // Le compte a pu être désactivé ou subdivisé depuis la proposition : on revérifie.
    await verifierCompte(tenantId, ligne.compte, { transaction });
    await exigerCompteDetail(tenantId, ligne.compte, transaction);
    const sens = coherenceSens(rubrique.type, ligne.compte);
    if (sens.bloquant) throw new ErreurMetier(400, sens.bloquant);
    await validerLigne(transaction, { tenantId, userId, ligne, rubrique });
    return { statut: 'valide', rubrique: rubrique.code, compte: ligne.compte, version: ligne.version, avertissement: sens.avertissement || null };
  });
};

/** Historique complet d'une rubrique (toutes versions, tous statuts). */
const historique = async (tenantId, rubriqueId) => {
  exigerClient(tenantId);
  return Q(
    `SELECT e.id, e.compte, e.version, e.statut, e.commentaire, e.motif_rejet,
            e.propose_le, up.username AS propose_par, e.decide_le, ud.username AS decide_par
       FROM equivalences_comptables e
       LEFT JOIN users up ON up.id = e.propose_par
       LEFT JOIN users ud ON ud.id = e.decide_par
      WHERE e.tenant_id = :tenantId AND e.rubrique_id = :rubriqueId
      ORDER BY e.version DESC, e.id DESC`, { tenantId, rubriqueId });
};

/**
 * Appelé par la modification d'une rubrique (rubriques.controller) : si la
 * rubrique a déjà un compte VALIDÉ, un changement de code comptable ne
 * s'applique pas directement — il devient une proposition soumise au cabinet.
 * Retourne null si la passerelle n'est pas concernée (aucune version validée,
 * ou migration 037 pas encore jouée).
 */
const interceptionModificationRubrique = async ({ tenantId, userId, rubriqueId, nouveauCode }) => {
  let enVigueur;
  try {
    [enVigueur] = await Q(
      `SELECT e.compte, coalesce(r.code_comptable, '') AS actuel
         FROM equivalences_comptables e JOIN rubriques r ON r.id = e.rubrique_id
        WHERE e.rubrique_id = :rubriqueId AND e.tenant_id = :tenantId AND e.statut = 'valide'`,
      { rubriqueId, tenantId });
  } catch (err) {
    if (err?.original?.code === '42P01') return null; // table absente : migration 037 non jouée
    throw err;
  }
  if (!enVigueur) return null;
  const c = norm(nouveauCode);
  if (c.toLowerCase() === norm(enVigueur.compte).toLowerCase()) return { conserver: enVigueur.compte, message: null };
  if (!c) {
    return { conserver: enVigueur.compte,
      message: `Le compte validé ${enVigueur.compte} est conservé : il ne peut être retiré que par le cabinet (Contrôle comptable → Contrôle de régularité formelle).` };
  }
  const r = await proposer({ tenantId, userId, rubriqueId, compte: c, commentaire: 'Depuis la modification de la rubrique' });
  return { conserver: enVigueur.compte,
    message: `Le compte ${r.compte} est proposé au cabinet ; le compte validé ${enVigueur.compte} reste en vigueur jusqu'à sa validation.` };
};

module.exports = {
  ErreurMetier, etat, enregistrerParametres, enregistrerJournal,
  proposer, proposerLot, decider, historique, interceptionModificationRubrique,
  verifierCompte, SUGGESTIONS_TRESORERIE,
  // Réutilisés par le contrôle (correction du compte d'une opération, 044)
  // et par le registre (compte tiers).
  chercherCompte, coherenceSens, exigerCompteDetail,
};

'use strict';
// Passerelle comptable — simulation d'export (« balance de contrôle »).
// Génère À BLANC les écritures d'un mois, sans rien exporter ni écrire, et
// prouve que le paramétrage produit une comptabilité juste :
//   1. aucune ligne sans compte ;
//   2. total débit = total crédit ;
//   3. compte des virements internes soldé (chaque sortie de caisse vers une
//      autre caisse a son entrée correspondante) ;
//   4. pour chaque compte de trésorerie, le mouvement comptable = le
//      mouvement des caisses dans l'application (entrées − sorties) ;
// puis signale (avertissements) : caisses non arrêtées, pièces non
// contrôlées ou en anomalie, pièces déjà exportées.
const { sequelize } = require('../models');
const { situationJournaux } = require('./journal.service');
const { planClientActif } = require('./plan_client.service');
const { ErreurMetier } = require('./passerelle.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements) => sequelize.query(sql, { replacements, type: T.SELECT });
const norm = (c) => String(c ?? '').trim();
const arr = (n) => Math.round((Number(n) || 0) * 100) / 100;
const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];

const simuler = async (tenantId, mois, annee) => {
  if (!tenantId) throw new ErreurMetier(400, 'Choisissez d\'abord un client.');
  const an = parseInt(annee, 10);
  if (!MOIS.includes(mois) || !Number.isInteger(an)) throw new ErreurMetier(400, 'Mois ou année invalide.');

  const [tenant] = await Q('SELECT coalesce(compte_virements, \'\') AS cv FROM tenants WHERE id = :t', { t: tenantId });
  const compteVir = norm(tenant?.cv);
  const mvts = await Q(
    `SELECT j.id, j.date::text AS date, j.numero, j.journal_id, jo.code AS jcode, jo.nom AS jnom,
            coalesce(jo.compte_tresorerie, '') AS ctreso, coalesce(jo.code_journal_compta, '') AS cjournal,
            j.rubrique_code, r.intitule AS rintitule, coalesce(r.est_virement_interne, false) AS virement,
            v.compte AS cvalide, j.intitule, coalesce(j.entree, 0) AS entree, coalesce(j.sortie, 0) AS sortie,
            coalesce(j.exporte_sage, false) AS exporte, c.statut AS ctl_statut,
            coalesce(cc.compte_corrige, '') AS ccorrige
       FROM journal j
       LEFT JOIN journaux jo ON jo.id = j.journal_id AND jo.tenant_id = j.tenant_id
       LEFT JOIN rubriques r ON r.tenant_id = j.tenant_id AND r.code = j.rubrique_code
       LEFT JOIN equivalences_comptables v ON v.rubrique_id = r.id AND v.statut = 'valide'
       LEFT JOIN controles_pieces c ON c.mouvement_id = j.id
       -- Compte corrigé par le comptable (044) ; une contre-passation suit
       -- l'écriture qu'elle annule.
       LEFT JOIN controles_pieces cc ON cc.mouvement_id = coalesce(j.annulation_de_id, j.id)
      WHERE j.tenant_id = :t AND j.mois = :m AND j.annee = :a
      ORDER BY jo.code NULLS LAST, j.date, j.numero`, { t: tenantId, m: mois, a: an });

  // Écritures : montant signé (+ encaissement / − décaissement). Une
  // contre-passation (montants négatifs) s'inscrit simplement en sens inverse.
  const lignes = [];
  const sansCompte = [];
  const balance = new Map();
  const imputer = (compte, d, c) => {
    const b = balance.get(compte) || { compte, debit: 0, credit: 0 };
    b.debit += d; b.credit += c;
    balance.set(compte, b);
  };
  let nbEcritures = 0;
  const netParJournal = new Map();   // mouvement net des pièces simulées, par caisse
  for (const m of mvts) {
    const net = arr(Number(m.entree) - Number(m.sortie));
    // Seules les pièces que le prochain export contiendra sont simulées.
    if (net === 0 || m.exporte) continue;
    if (m.journal_id) netParJournal.set(Number(m.journal_id), arr((netParJournal.get(Number(m.journal_id)) || 0) + net));
    nbEcritures += 1;
    const ref = `${m.jcode || '—'}-${m.numero ?? '?'}`;
    const contre = m.virement ? compteVir : (norm(m.ccorrige) || norm(m.cvalide));
    const treso = norm(m.ctreso);
    const manque = [];
    if (!treso) manque.push(m.journal_id ? `compte de trésorerie du journal ${m.jcode}` : 'journal non rattaché');
    if (!contre) manque.push(m.virement ? 'compte des virements internes' : `compte validé de la rubrique ${m.rubrique_code}`);
    if (manque.length) {
      sansCompte.push({ ref, date: m.date, rubrique: m.rubrique_code, libelle: m.intitule, montant: Math.abs(net), manque: manque.join(' et ') });
      continue;
    }
    const mt = Math.abs(net);
    // Encaissement : D trésorerie / C contrepartie ; décaissement : l'inverse.
    const [dCompte, cCompte] = net > 0 ? [treso, contre] : [contre, treso];
    imputer(dCompte, mt, 0); imputer(cCompte, 0, mt);
    lignes.push({ ref, date: m.date, journal: m.cjournal || m.jcode, libelle: m.intitule, debit: dCompte, credit: cCompte, montant: mt,
      ...(!m.virement && norm(m.ccorrige) ? { compte_corrige: true } : {}) });
  }

  // Intitulés des comptes de la balance.
  const comptes = [...balance.keys()];
  const intitules = new Map();
  if (comptes.length) {
    const rows = (await planClientActif(tenantId))
      ? await Q('SELECT compte, intitule FROM plan_comptable_client WHERE tenant_id = :t AND compte IN (:c)', { t: tenantId, c: comptes })
      : await Q('SELECT compte, intitule FROM plan_comptable_syscohada WHERE compte IN (:c)', { c: comptes });
    rows.forEach((r) => intitules.set(r.compte, r.intitule));
  }
  const balanceOut = [...balance.values()].sort((a, b) => a.compte.localeCompare(b.compte)).map((b) => ({
    compte: b.compte, intitule: intitules.get(b.compte) || '', debit: arr(b.debit), credit: arr(b.credit), solde: arr(b.debit - b.credit),
  }));
  const totDebit = arr(balanceOut.reduce((t, b) => t + b.debit, 0));
  const totCredit = arr(balanceOut.reduce((t, b) => t + b.credit, 0));

  // Trésorerie : mouvement comptable du compte vs mouvement des caisses.
  const journaux = await Q(
    `SELECT id, code, nom, coalesce(compte_tresorerie, '') AS compte_tresorerie FROM journaux
      WHERE tenant_id = :t AND (actif OR id IN (SELECT DISTINCT journal_id FROM journal WHERE tenant_id = :t AND mois = :m AND annee = :a))
      ORDER BY code`, { t: tenantId, m: mois, a: an });
  const situations = journaux.length ? await situationJournaux(tenantId, mois, an, journaux) : [];
  const arrets = new Set((await Q('SELECT journal_id FROM arrets_caisse WHERE tenant_id = :t AND mois = :m AND annee = :a',
    { t: tenantId, m: mois, a: an })).map((r) => Number(r.journal_id)));
  const parCompte = new Map();
  const caisses = journaux.map((j) => {
    const s = situations.find((x) => Number(x.id) === Number(j.id)) || {};
    const entrees = Number(s.total_entrees) || 0;
    const sorties = Number(s.total_sorties) || 0;
    const netApp = netParJournal.get(Number(j.id)) || 0;   // pièces à exporter de la caisse
    const c = norm(j.compte_tresorerie);
    if (c) parCompte.set(c, arr((parCompte.get(c) || 0) + netApp));
    return {
      id: j.id, code: j.code, nom: j.nom, compte: c, ran: arr(s.ran), entrees: arr(entrees), sorties: arr(sorties),
      solde: arr(s.solde_final), net: netApp, arretee: arrets.has(Number(j.id)),
    };
  });
  const rapprochement = [...parCompte.entries()].map(([compte, netApp]) => {
    const b = balance.get(compte) || { debit: 0, credit: 0 };
    const netCompta = arr(b.debit - b.credit);
    return { compte, intitule: intitules.get(compte) || '', caisses: caisses.filter((x) => x.compte === compte).map((x) => x.code),
      net_caisses: netApp, net_comptable: netCompta, ecart: arr(netCompta - netApp) };
  });

  const vir = compteVir ? balance.get(compteVir) : null;
  const soldeVir = vir ? arr(vir.debit - vir.credit) : 0;
  const virementsMois = mvts.filter((m) => m.virement && arr(Number(m.entree) - Number(m.sortie)) !== 0)
    .map((m) => ({ ref: `${m.jcode || '—'}-${m.numero ?? '?'}`, date: m.date, libelle: m.intitule, montant: arr(Number(m.entree) - Number(m.sortie)) }));

  const pieces = mvts.filter((m) => arr(Number(m.entree) - Number(m.sortie)) !== 0);
  const aExporter = pieces.filter((m) => !m.exporte);
  const nbAnomalies = aExporter.filter((m) => m.ctl_statut === 'anomalie').length;
  const nbNonControlees = aExporter.filter((m) => !m.ctl_statut || m.ctl_statut === 'a_controler' || m.ctl_statut === 'en_cours').length;
  const nbExportees = pieces.length - aExporter.length;
  const nonArretees = caisses.filter((c) => !c.arretee && (c.entrees || c.sorties));

  const controles = [
    { code: 'comptes', titre: 'Toutes les lignes ont un compte', niveau: sansCompte.length ? 'bloquant' : 'ok',
      detail: sansCompte.length ? `${sansCompte.length} écriture(s) sans compte : complétez le paramétrage.` : `${nbEcritures} écriture(s) entièrement imputées.` },
    { code: 'equilibre', titre: 'Total débit = total crédit', niveau: totDebit === totCredit && !sansCompte.length ? 'ok' : 'bloquant',
      detail: `Débit ${totDebit.toLocaleString('fr-FR')} · Crédit ${totCredit.toLocaleString('fr-FR')}${sansCompte.length ? ' (hors écritures sans compte)' : ''}.` },
    { code: 'virements', titre: `Compte des virements internes ${compteVir || '(non défini)'} soldé`, niveau: soldeVir === 0 ? 'ok' : 'bloquant',
      detail: soldeVir === 0 ? (virementsMois.length ? `${virementsMois.length} virement(s), sorties et entrées équilibrées.` : 'Aucun virement interne ce mois.')
        : `Solde de ${soldeVir.toLocaleString('fr-FR')} : un virement n'a pas sa contrepartie dans l'autre caisse (voir la liste).` },
    { code: 'tresorerie', titre: 'Comptes de trésorerie = mouvements des caisses', niveau: rapprochement.every((r) => r.ecart === 0) && !sansCompte.length ? 'ok' : 'bloquant',
      detail: sansCompte.length ? 'Non concluant tant que des écritures sont sans compte : l\'écart affiché vient des écritures non imputées.'
        : rapprochement.some((r) => r.ecart !== 0) ? 'Écart sur au moins un compte : une rubrique est probablement imputée sur un compte de trésorerie.'
          : 'Chaque compte de trésorerie reprend exactement les entrées et sorties de sa caisse.' },
    { code: 'arrets', titre: 'Caisses arrêtées pour le mois', niveau: nonArretees.length ? 'avertissement' : 'ok',
      detail: nonArretees.length ? `Non arrêtée(s) : ${nonArretees.map((c) => c.code).join(', ')}. L'export exigera l'arrêt de toutes les caisses.` : 'Toutes les caisses mouvementées sont arrêtées.' },
    { code: 'controle', titre: 'Contrôle des pièces', niveau: nbAnomalies || nbNonControlees ? 'avertissement' : 'ok',
      detail: nbAnomalies || nbNonControlees ? `${nbAnomalies} pièce(s) en anomalie, ${nbNonControlees} non encore contrôlée(s).` : 'Toutes les pièces du mois sont contrôlées.' },
  ];
  // Information (044) : opérations imputées sur un compte corrigé au contrôle.
  const nbCorriges = lignes.filter((l) => l.compte_corrige).length;
  if (nbCorriges) {
    controles.push({ code: 'corrections', titre: 'Comptes corrigés au contrôle', niveau: 'ok',
      detail: `${nbCorriges} écriture(s) imputée(s) sur le compte corrigé par le comptable (au lieu du compte de la rubrique).` });
  }
  if (nbExportees) {
    controles.push({ code: 'exportees', titre: 'Pièces déjà exportées', niveau: 'avertissement',
      detail: `${nbExportees} pièce(s) du mois figurent déjà dans un export précédent : elles sont exclues de la simulation.` });
  }
  const verdict = controles.some((c) => c.niveau === 'bloquant') ? 'bloquant' : controles.some((c) => c.niveau === 'avertissement') ? 'avertissement' : 'ok';

  return {
    mois, annee: an, verdict, controles,
    totaux: { ecritures: nbEcritures, debit: totDebit, credit: totCredit },
    balance: balanceOut, rapprochement, caisses, sans_compte: sansCompte,
    virements: soldeVir === 0 ? [] : virementsMois, compte_virements: compteVir,
    apercu: lignes.slice(0, 200), nb_lignes: lignes.length,
  };
};

module.exports = { simuler };

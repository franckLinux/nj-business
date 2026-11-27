'use strict';
// NJ FINANCE — Tableau des contrôles et règlements reçus (27/11/2026, accord de Franck).
//
// Tableau des contrôles : tout ce qui attend une décision ou un contrôle, rubrique
// par rubrique, avec le nombre, le montant quand il a un sens, la personne qui
// décide et le lien vers l'écran où l'on décide. Chacun ne voit que les lignes
// qui relèvent de ses droits. Rien n'est calculé à part : on relit les mêmes
// états que les écrans concernés.
//
// Règlements reçus : encaissements des factures clients (entrées de caisse ou de
// banque affectées aux factures, non annulées) et règlements hors caisse ni banque
// validés par le directeur, sur une période, avec les totaux par mode.
const { sequelize } = require('../../models');
const { userHasPermission } = require('../permission.service');
const { estOng } = require('../projets.service');
const achats = require('./achats.service');
const missions = require('./missions.service');

const T = sequelize.QueryTypes;
const Q = (sql, replacements) => sequelize.query(sql, { replacements, type: T.SELECT });
const n = (v) => Number(v || 0);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

class ErreurControles extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const tableau = async (req) => {
  const ctx = { tenantId: req.tenantId, userId: req.user.id, role: req.user.role };
  const codes = ['finance.achats.valider', 'finance.ventes.valider', 'journal.validate', 'journal.create', 'controle.view',
    'justificatifs.valider', 'finance.missions.voir'];
  const droits = Object.fromEntries(await Promise.all(codes.map(async (c) => [c, await userHasPermission(ctx, c)])));
  const directeur = req.user.role === 'directeur';
  const t = req.tenantId;
  const lignes = [];
  const ajouter = (l) => { if (l.nombre > 0 || l.toujours) lignes.push({ montant: null, ...l, toujours: undefined }); };

  if (droits['finance.achats.valider']) {
    const a = (await achats.lister(t, {}, 'fournisseur')).compteurs;
    const [m] = await Q(`SELECT coalesce(sum(total_ttc), 0) AS m FROM fin_factures WHERE tenant_id = :t AND sens = 'fournisseur' AND statut = 'a_valider'`, { t });
    ajouter({ cle: 'achats_a_valider', groupe: 'Achats', libelle: 'Factures fournisseurs à valider', nombre: a.a_valider, montant: n(m.m),
      decide: 'Directeur ou comptable (jamais l\'auteur)', lien: '/finance/achats?filtre=a_valider' });
    ajouter({ cle: 'achats_a_imputer', groupe: 'Achats', libelle: 'Factures NJ COMMERCIAL à imputer', nombre: a.a_imputer,
      decide: 'Directeur ou comptable', lien: '/finance/achats?filtre=a_imputer' });
  }
  if (droits['finance.ventes.valider']) {
    const [v] = await Q(`SELECT count(*)::int AS nb, coalesce(sum(total_ttc), 0) AS m FROM fin_factures
                          WHERE tenant_id = :t AND sens = 'client' AND statut = 'a_valider'`, { t });
    ajouter({ cle: 'ventes_a_valider', groupe: 'Facturation', libelle: 'Factures et avoirs clients à valider', nombre: v.nb, montant: n(v.m),
      decide: 'Directeur ou comptable (jamais l\'auteur)', lien: '/finance/ventes?filtre=a_valider' });
  }
  if (directeur) {
    const hc = await Q(`SELECT h.nature, coalesce(f.sens, 'fournisseur') AS sens, count(*)::int AS nb, coalesce(sum(h.montant), 0) AS m
                          FROM fin_reglements_hors_caisse h LEFT JOIN fin_factures f ON h.facture_type = 'fin' AND f.id = h.facture_id
                         WHERE h.tenant_id = :t AND h.statut = 'propose' GROUP BY 1, 2`, { t });
    const somme = (f) => hc.filter(f).reduce((s, x) => ({ nb: s.nb + x.nb, m: s.m + n(x.m) }), { nb: 0, m: 0 });
    const tp = somme((x) => x.nature === 'tiers_payeur');
    const fo = somme((x) => x.nature !== 'tiers_payeur' && x.sens === 'fournisseur');
    const cl = somme((x) => x.nature !== 'tiers_payeur' && x.sens === 'client');
    ajouter({ cle: 'tiers_payeur', groupe: 'Achats', libelle: 'Règlements par un tiers payeur à décider', nombre: tp.nb, montant: tp.m,
      decide: 'Directeur', lien: '/finance/achats?filtre=a_payer' });
    ajouter({ cle: 'hors_caisse_fournisseurs', groupe: 'Achats', libelle: 'Règlements fournisseurs hors caisse à décider', nombre: fo.nb, montant: fo.m,
      decide: 'Directeur', lien: '/finance/achats?filtre=a_payer' });
    ajouter({ cle: 'hors_caisse_clients', groupe: 'Facturation', libelle: 'Règlements clients hors caisse à décider', nombre: cl.nb, montant: cl.m,
      decide: 'Directeur', lien: '/finance/ventes?filtre=a_payer' });
  }
  if (droits['journal.validate']) {
    const [x] = await Q(`SELECT count(*)::int AS nb, coalesce(sum(sortie), 0) AS m FROM mouvements_attente WHERE tenant_id = :t AND statut = 'en_attente'`, { t });
    ajouter({ cle: 'depenses_attente', groupe: 'Caisse Pro', libelle: 'Dépenses en attente d\'autorisation', nombre: x.nb, montant: n(x.m),
      decide: 'Directeur', lien: '/attente' });
  }
  if (droits['controle.view']) {
    const [ar] = await Q(`SELECT count(*)::int AS nb FROM controles_arrets WHERE tenant_id = :t AND statut = 'a_valider'`, { t });
    ajouter({ cle: 'arrets', groupe: 'Caisse Pro', libelle: 'Arrêts de caisse à valider', nombre: ar.nb, decide: 'Directeur', lien: '/controle/arretes' });
    const [ec] = await Q(`SELECT count(*)::int AS nb, coalesce(sum(abs(montant)), 0) AS m FROM ecarts_caisse WHERE tenant_id = :t AND statut = 'constate'`, { t });
    ajouter({ cle: 'ecarts', groupe: 'Contrôle comptable', libelle: 'Écarts de caisse à affecter', nombre: ec.nb, montant: n(ec.m),
      decide: 'Comptable, puis directeur', lien: '/controle/ecarts' });
    const [pc] = await Q(
      `SELECT count(*)::int AS nb, coalesce(sum(coalesce(j.entree, 0) + coalesce(j.sortie, 0)), 0) AS m
         FROM journal j LEFT JOIN controles_pieces c ON c.mouvement_id = j.id
        WHERE j.tenant_id = :t AND j.date >= date_trunc('year', CURRENT_DATE) AND NOT coalesce(j.annule, false) AND j.annulation_de_id IS NULL
          AND (c.id IS NULL OR c.statut IN ('a_controler', 'en_cours', 'anomalie'))`, { t });
    ajouter({ cle: 'pieces', groupe: 'Contrôle comptable', libelle: 'Mouvements de l\'année aux pièces non contrôlées ou en anomalie',
      nombre: pc.nb, montant: n(pc.m), decide: 'Comptable', lien: '/controle/regularite' });
  }
  if (droits['finance.missions.voir']) {
    const c = await missions.compteurs(req);
    ajouter({ cle: 'missions_a_approuver', groupe: 'Missions', libelle: 'Ordres de mission à approuver', nombre: c.a_approuver, decide: 'Directeur',
      lien: '/finance/missions?vue=a_approuver' });
    ajouter({ cle: 'missions_a_controler', groupe: 'Missions', libelle: 'Justifications de mission à contrôler', nombre: c.a_controler,
      decide: 'Directeur ou comptable (jamais celui qui l\'a présentée)', lien: '/finance/missions?vue=a_controler' });
    ajouter({ cle: 'missions_a_regulariser', groupe: 'Missions', libelle: 'Missions à régulariser (reliquat ou complément)', nombre: c.a_regulariser,
      decide: 'Caisse', lien: '/finance/missions?vue=a_regulariser' });
  }
  if (await estOng(t)) {
    if (directeur) {
      const [d] = await Q(`SELECT count(*)::int AS nb, coalesce(sum(total), 0) AS m FROM projet_demandes_fonds WHERE tenant_id = :t AND statut = 'validee_chef'`, { t });
      ajouter({ cle: 'demandes_fonds', groupe: 'Gestion des activités', libelle: 'Demandes de fonds à approuver', nombre: d.nb, montant: n(d.m),
        decide: 'Directeur', lien: '/projets/demandes?vue=a_valider' });
    }
    if (droits['journal.create']) {
      const [o] = await Q(`SELECT count(*)::int AS nb, coalesce(sum(montant), 0) AS m FROM projet_ordres_decaissement
                            WHERE tenant_id = :t AND statut = 'en_attente' AND initie_par IS DISTINCT FROM :u`, { t, u: req.user.id });
      ajouter({ cle: 'sorties_a_valider', groupe: 'Gestion des activités', libelle: 'Sorties de caisse à valider (ordres du chef de projet)',
        nombre: o.nb, montant: n(o.m), decide: 'Caisse', lien: '/projets/demandes?vue=a_decaisser' });
    }
    if (droits['justificatifs.valider']) {
      const [x] = await Q(`SELECT count(*)::int AS nb, coalesce(sum(montant), 0) AS m FROM projet_depenses
                            WHERE tenant_id = :t AND statut = 'declaree' AND declare_par IS DISTINCT FROM :u`, { t, u: req.user.id });
      ajouter({ cle: 'depenses_projets', groupe: 'Gestion des activités', libelle: 'Dépenses des projets à contrôler', nombre: x.nb, montant: n(x.m),
        decide: 'Comptable', lien: '/projets/depenses' });
    }
  }
  return { lignes, total: lignes.reduce((s, l) => s + l.nombre, 0), calcule_le: new Date().toISOString() };
};

const reglementsRecus = async (req) => {
  const du = ISO.test(String(req.query.du || '')) ? req.query.du : `${new Date().getFullYear()}-01-01`;
  const au = ISO.test(String(req.query.au || '')) ? req.query.au : new Date().toISOString().slice(0, 10);
  if (au < du) throw new ErreurControles(400, 'La date de fin précède la date de début.');
  const tiers = /^\d+$/.test(String(req.query.tiers_id || '')) ? req.query.tiers_id : null;
  const lignes = await Q(
    `SELECT * FROM (
       SELECT 'caisse' AS mode, j.date::text AS date, a.montant, f.id::text AS facture_id, f.numero AS facture, f.type AS type_facture,
              t.id::text AS tiers_id, t.nom AS client, jo.code AS caisse_code, jo.nom AS caisse, jo.type AS caisse_type,
              concat(jo.code, '-', j.numero) AS piece, coalesce(j.objet, '') AS reference, '' AS compte
         FROM fin_reglement_affectations a
         JOIN fin_factures f ON a.facture_type = 'fin' AND f.id = a.facture_id AND f.sens = 'client'
         JOIN journal j ON j.id = a.mouvement_id AND NOT coalesce(j.annule, false)
         LEFT JOIN journaux jo ON jo.id = j.journal_id
         LEFT JOIN registre_tiers t ON t.id = f.tiers_id
        WHERE a.tenant_id = :t AND j.date BETWEEN :du AND :au
       UNION ALL
       SELECT 'hors_caisse', h.date_reglement::text, h.montant, f.id::text, f.numero, f.type, t.id::text, t.nom, NULL, NULL, NULL,
              '', h.motif, h.compte
         FROM fin_reglements_hors_caisse h
         JOIN fin_factures f ON h.facture_type = 'fin' AND f.id = h.facture_id AND f.sens = 'client'
         LEFT JOIN registre_tiers t ON t.id = f.tiers_id
        WHERE h.tenant_id = :t AND h.statut = 'valide' AND h.date_reglement BETWEEN :du AND :au
     ) r WHERE (CAST(:tiers AS TEXT) IS NULL OR r.tiers_id = :tiers) ORDER BY r.date DESC, r.facture DESC`, { t: req.tenantId, du, au, tiers });
  const out = lignes.map((l) => ({ ...l, montant: n(l.montant),
    mode_libelle: l.mode === 'hors_caisse' ? `Hors caisse (compte ${l.compte})` : `${l.caisse_type === 'banque' ? 'Banque' : 'Caisse'} ${l.caisse_code}` }));
  const parMode = {};
  for (const l of out) parMode[l.mode_libelle] = Math.round(((parMode[l.mode_libelle] || 0) + l.montant) * 100) / 100;
  const clients = [...new Map(out.filter((l) => l.tiers_id).map((l) => [l.tiers_id, l.client])).entries()].map(([id, nom]) => ({ id, nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
  return { du, au, lignes: out, total: Math.round(out.reduce((s, l) => s + l.montant, 0) * 100) / 100, par_mode: parMode, clients };
};

module.exports = { tableau, reglementsRecus, ErreurControles };

'use strict';
// NJ COMMERCIAL — tableau de bord, documents justificatifs et historique des achats.
// Tous les chiffres sont calculés en base sur les données enregistrées du client ;
// une période vide donne des zéros, jamais des valeurs d'exemple.
const { sequelize } = require('../../models');

const T = sequelize.QueryTypes;
const Q = (sql, replacements) => sequelize.query(sql, { replacements, type: T.SELECT });

class ErreurTableau extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const periode = ({ du = '', au = '' } = {}) => {
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
  const fin = ok(au) ? au : new Date().toISOString().slice(0, 10);
  const debut = ok(du) ? du : `${new Date(fin).getFullYear()}-01-01`;
  if (debut > fin) throw new ErreurTableau(400, 'La date de début est après la date de fin.');
  return { du: debut, au: fin };
};
const n = (v) => Number(v || 0);

const tableau = async (ctx, query) => {
  if (!ctx.peut('com.tableau_bord.voir')) throw new ErreurTableau(403, 'Permission requise : tableau de bord des achats.');
  const p = periode(query);
  const r = { t: ctx.tenantId, du: p.du, au: p.au };
  const [statuts, bons, attente, aCommander, fournisseurs, mois, demandeurs, delai, pieces] = await Promise.all([
    Q(`SELECT statut, COUNT(*)::int AS n, COALESCE(SUM(montant_estime), 0) AS montant FROM com_demandes
        WHERE tenant_id = :t AND date_demande BETWEEN :du AND :au GROUP BY statut`, r),
    Q(`SELECT statut, COUNT(*)::int AS n, COALESCE(SUM(total_ttc), 0) AS ttc FROM com_bons_commande
        WHERE tenant_id = :t AND COALESCE(emis_le, cree_le)::date BETWEEN :du AND :au GROUP BY statut`, r),
    // En cours, quelle que soit la période : ce qui attend une action aujourd'hui.
    Q(`SELECT statut, COUNT(*)::int AS n, MIN(soumise_le) AS plus_ancienne FROM com_demandes
        WHERE tenant_id = :t AND statut IN ('examen_achats', 'examen_direction', 'a_corriger') GROUP BY statut`, r),
    Q(`SELECT COUNT(*)::int AS n FROM com_demandes d WHERE d.tenant_id = :t AND d.statut = 'approuvee'
          AND EXISTS (SELECT 1 FROM com_demande_lignes l WHERE l.demande_id = d.id AND l.quantite > COALESCE((
                SELECT SUM(bl.quantite) FROM com_bc_lignes bl JOIN com_bons_commande b ON b.id = bl.bc_id
                 WHERE bl.demande_ligne_id = l.id AND b.statut IN ('brouillon', 'emis')), 0))`, r),
    Q(`SELECT f.id, f.nom, COUNT(*)::int AS n, COALESCE(SUM(b.total_ttc), 0) AS ttc FROM com_bons_commande b
         JOIN registre_tiers f ON f.id = b.fournisseur_id
        WHERE b.tenant_id = :t AND b.statut = 'emis' AND b.emis_le::date BETWEEN :du AND :au
        GROUP BY f.id, f.nom ORDER BY ttc DESC LIMIT 10`, r),
    Q(`WITH m AS (SELECT to_char(date_trunc('month', g), 'YYYY-MM') AS mois
                    FROM generate_series(date_trunc('month', CAST(:du AS date)), date_trunc('month', CAST(:au AS date)), interval '1 month') g)
       SELECT m.mois,
              (SELECT COUNT(*)::int FROM com_demandes d WHERE d.tenant_id = :t AND d.nb_soumissions > 0
                 AND to_char(d.date_demande, 'YYYY-MM') = m.mois) AS demandes,
              (SELECT COUNT(*)::int FROM com_bons_commande b WHERE b.tenant_id = :t AND b.statut IN ('emis', 'remplace', 'annule')
                 AND b.emis_le IS NOT NULL AND to_char(b.emis_le, 'YYYY-MM') = m.mois) AS bons,
              (SELECT COALESCE(SUM(b.total_ttc), 0) FROM com_bons_commande b WHERE b.tenant_id = :t AND b.statut = 'emis'
                 AND to_char(b.emis_le, 'YYYY-MM') = m.mois) AS ttc
         FROM m ORDER BY m.mois`, r),
    Q(`SELECT u.username AS demandeur, NULLIF(d.service, '') AS service, COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE d.statut = 'approuvee')::int AS approuvees,
              COUNT(*) FILTER (WHERE d.statut = 'rejetee')::int AS rejetees,
              COALESCE(SUM(d.montant_estime) FILTER (WHERE d.statut = 'approuvee'), 0) AS montant_approuve
         FROM com_demandes d JOIN users u ON u.id = d.demandeur_id
        WHERE d.tenant_id = :t AND d.nb_soumissions > 0 AND d.date_demande BETWEEN :du AND :au
        GROUP BY u.username, NULLIF(d.service, '') ORDER BY n DESC LIMIT 15`, r),
    Q(`SELECT AVG(EXTRACT(EPOCH FROM (decidee_le - soumise_le)) / 86400) AS jours, COUNT(*)::int AS n FROM com_demandes
        WHERE tenant_id = :t AND statut = 'approuvee' AND soumise_le IS NOT NULL AND decidee_le IS NOT NULL
          AND date_demande BETWEEN :du AND :au`, r),
    Q(`SELECT
         (SELECT COUNT(DISTINCT b.id)::int FROM com_bons_commande b JOIN com_documents x ON x.objet_type = 'bon_commande' AND x.objet_id = b.id
            AND x.categorie = 'proforma' AND NOT x.retire
           WHERE b.tenant_id = :t AND COALESCE(b.emis_le, b.cree_le)::date BETWEEN :du AND :au) AS bons_avec_proforma,
         (SELECT COUNT(DISTINCT d.id)::int FROM com_demandes d JOIN com_documents x ON x.objet_type = 'demande' AND x.objet_id = d.id AND NOT x.retire
           WHERE d.tenant_id = :t AND d.date_demande BETWEEN :du AND :au) AS demandes_avec_pieces`, r),
  ]);
  const parStatut = Object.fromEntries(statuts.map((s) => [s.statut, { n: s.n, montant: n(s.montant) }]));
  const parBon = Object.fromEntries(bons.map((s) => [s.statut, { n: s.n, ttc: n(s.ttc) }]));
  const enAttente = Object.fromEntries(attente.map((s) => [s.statut, { n: s.n, plus_ancienne: s.plus_ancienne }]));
  const [dev] = await Q('SELECT devise FROM tenants WHERE id = :t', { t: ctx.tenantId });
  return {
    periode: p, devise: dev?.devise || 'FCFA',
    demandes: { par_statut: parStatut, total: statuts.reduce((s, x) => s + x.n, 0) },
    a_traiter: {
      examen_achats: enAttente.examen_achats?.n || 0, examen_direction: enAttente.examen_direction?.n || 0,
      a_corriger: enAttente.a_corriger?.n || 0, a_commander: aCommander[0]?.n || 0,
      plus_ancienne_en_attente: [enAttente.examen_achats?.plus_ancienne, enAttente.examen_direction?.plus_ancienne].filter(Boolean).sort()[0] || null,
    },
    bons: {
      emis: parBon.emis?.n || 0, montant_emis: parBon.emis?.ttc || 0, annules: parBon.annule?.n || 0,
      remplaces: parBon.remplace?.n || 0, brouillons: parBon.brouillon?.n || 0,
    },
    pieces: pieces[0],
    delai_moyen_autorisation_jours: delai[0]?.n ? Math.round(n(delai[0].jours) * 10) / 10 : null,
    par_fournisseur: fournisseurs.map((f) => ({ id: Number(f.id), nom: f.nom, n: f.n, ttc: n(f.ttc) })),
    par_mois: mois.map((m) => ({ mois: m.mois, demandes: m.demandes, bons: m.bons, ttc: n(m.ttc) })),
    par_demandeur: demandeurs.map((d) => ({ ...d, montant_approuve: n(d.montant_approuve) })),
  };
};

const VOIR_DOCS = ['com.da.voir_tout', 'com.bc.preparer', 'com.bc.emettre', 'com.bc.annuler', 'com.tableau_bord.voir'];
const documents = async (ctx, { q = '', categorie = '', retires = '' } = {}) => {
  if (!VOIR_DOCS.some((c) => ctx.peut(c))) throw new ErreurTableau(403, 'Permission requise : consulter toutes les pièces des achats.');
  const r = { t: ctx.tenantId, q: String(q || '').trim().toLowerCase(), cat: ['justificatif', 'proforma'].includes(categorie) ? categorie : '' };
  r.like = `%${r.q}%`;
  const rows = await Q(
    `SELECT x.id, x.objet_type, x.objet_id, x.categorie, x.nom, x.mime, x.taille, x.sha256, x.ajoute_le, x.retire, x.motif_retrait,
            u.username AS ajoute_par_nom,
            CASE WHEN x.objet_type = 'demande' THEN d.numero ELSE b.numero_complet END AS objet_numero,
            COALESCE(d.statut, b.statut) AS objet_statut, fb.nom AS fournisseur
       FROM com_documents x
       LEFT JOIN users u ON u.id = x.ajoute_par
       LEFT JOIN com_demandes d ON x.objet_type = 'demande' AND d.id = x.objet_id
       LEFT JOIN com_bons_commande b ON x.objet_type = 'bon_commande' AND b.id = x.objet_id
       LEFT JOIN registre_tiers fb ON fb.id = b.fournisseur_id
      WHERE x.tenant_id = :t AND (:cat = '' OR x.categorie = :cat) AND (${retires === '1' ? 'true' : 'NOT x.retire'})
        AND (:q = '' OR lower(x.nom) LIKE :like OR lower(COALESCE(d.numero, b.numero_complet, '')) LIKE :like OR lower(COALESCE(fb.nom, '')) LIKE :like)
      ORDER BY x.ajoute_le DESC LIMIT 500`, r);
  return rows.map((x) => ({ ...x, id: Number(x.id), objet_id: Number(x.objet_id), taille: Number(x.taille) }));
};

const LIBELLES = {
  COM_DA_CREATION: 'Demande créée', COM_DA_MODIFICATION: 'Demande modifiée', COM_DA_SUPPRESSION: 'Brouillon supprimé',
  COM_DA_PIECE_AJOUT: 'Pièce jointe', COM_DA_PIECE_RETRAIT: 'Pièce retirée',
  COM_BC_PREPARATION: 'Bon préparé', COM_BC_MODIFICATION: 'Bon modifié', COM_BC_SUPPRESSION: 'Brouillon de bon supprimé',
  COM_BC_REVALIDATION: 'Revalidation demandée', COM_BC_EMISSION: 'Bon émis', COM_BC_ANNULATION: 'Bon annulé', COM_BC_REVISION: 'Révision préparée',
  COM_BC_REMPLACE: 'Bon remplacé par une révision', COM_BC_PROFORMA_AJOUT: 'Proforma jointe', COM_BC_PROFORMA_RETRAIT: 'Proforma retirée',
};
const DECISIONS = { soumise: 'Soumise', approuvee: 'Approuvée', renvoyee: 'Renvoyée pour correction', rejetee: 'Rejetée', annulee: 'Annulée' };

const historique = async (ctx, query) => {
  if (!ctx.peut('com.da.voir_tout') && !ctx.peut('com.tableau_bord.voir')) throw new ErreurTableau(403, 'Permission requise : consulter l\'historique des achats.');
  const p = periode({ du: query.du || `${new Date().getFullYear()}-01-01`, au: query.au });
  const r = { t: ctx.tenantId, du: p.du, au: p.au, q: String(query.q || '').trim().toLowerCase() };
  r.like = `%${r.q}%`;
  const rows = await Q(
    `SELECT * FROM (
       SELECT c.le, 'decision' AS genre, c.decision AS action, c.etape, c.par_nom, c.commentaire AS detail, d.numero AS objet, 'demande' AS objet_type, d.id AS objet_id
         FROM com_decisions c JOIN com_demandes d ON d.id = c.demande_id
        WHERE c.tenant_id = :t AND c.le::date BETWEEN :du AND :au
       UNION ALL
       SELECT a.created_at, 'operation', a.action, NULL, u.username,
              COALESCE(a.nouvelle_valeur->>'motif', a.nouvelle_valeur->>'nom', a.nouvelle_valeur->>'numero', ''),
              CASE WHEN a.entite_id LIKE 'DA:%' THEN d.numero ELSE b.numero_complet END,
              CASE WHEN a.entite_id LIKE 'DA:%' THEN 'demande' ELSE 'bon_commande' END,
              CAST(split_part(a.entite_id, ':', 2) AS BIGINT)
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN com_demandes d ON a.entite_id LIKE 'DA:%' AND d.id = CAST(split_part(a.entite_id, ':', 2) AS BIGINT)
         LEFT JOIN com_bons_commande b ON a.entite_id LIKE 'BC:%' AND b.id = CAST(split_part(a.entite_id, ':', 2) AS BIGINT)
        WHERE a.tenant_id = :t AND a.entite = 'commercial' AND (a.entite_id LIKE 'DA:%' OR a.entite_id LIKE 'BC:%')
          AND a.created_at::date BETWEEN :du AND :au
     ) h
     WHERE (:q = '' OR lower(COALESCE(h.objet, '')) LIKE :like OR lower(COALESCE(h.par_nom, '')) LIKE :like OR lower(COALESCE(h.detail, '')) LIKE :like)
     ORDER BY h.le DESC LIMIT 500`, r);
  return rows.map((h) => ({
    ...h, objet_id: h.objet_id ? Number(h.objet_id) : null,
    libelle: h.genre === 'decision' ? `${DECISIONS[h.action] || h.action}${h.etape && h.etape !== 'demandeur' ? ` (${h.etape.replace('_', ' et ')})` : ''}` : (LIBELLES[h.action] || h.action),
  }));
};

module.exports = { ErreurTableau, tableau, documents, historique };

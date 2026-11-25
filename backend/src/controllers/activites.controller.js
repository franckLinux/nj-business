// src/controllers/activites.controller.js
// Activités / projets (migration 034) : référentiel du client, et suivi des
// opérations qui y sont rattachées (rattachement FACULTATIF à la saisie).
const { sequelize } = require('../models');
const { MOIS } = require('../services/journal.service');

const SELECT = sequelize.QueryTypes.SELECT;
const q = (sql, replacements) => sequelize.query(sql, { replacements, type: SELECT });
const TYPES = ['activite', 'projet'];

// Contrôle et normalisation d'une saisie (création ou modification).
const lire = (b = {}) => {
  const nom = String(b.nom || '').trim().slice(0, 120);
  if (!nom) return { erreur: 'Le nom est obligatoire.' };
  const type = TYPES.includes(b.type) ? b.type : 'activite';
  const code = String(b.code || '').trim().toUpperCase().slice(0, 20);
  const description = String(b.description || '').trim().slice(0, 500);
  let budget = null;
  if (b.budget !== undefined && b.budget !== null && String(b.budget).trim() !== '') {
    budget = Number(String(b.budget).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(budget) || budget < 0) return { erreur: "L'enveloppe prévue doit être un montant positif." };
  }
  const date = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);
  const date_debut = date(b.date_debut);
  const date_fin = date(b.date_fin);
  if (date_debut && date_fin && date_fin < date_debut) return { erreur: 'La date de fin précède la date de début.' };
  return { val: { nom, type, code, description, budget, date_debut, date_fin } };
};

const doublon = (err) => err?.original?.code === '23505' || /uq_activites_nom/.test(err?.message || '');

// GET /api/activites            → activités actives (liste de saisie)
// GET /api/activites?tous=1     → toutes, avec le nombre d'opérations rattachées
const lister = async (req, res) => {
  try {
    const tous = req.query.tous === '1' || req.query.tous === 'true';
    const rows = await q(
      `SELECT a.id, a.code, a.nom, a.type, a.description, a.budget, a.date_debut, a.date_fin, a.actif,
              (to_jsonb(a)->>'projet_id')::int AS projet_id,
              (SELECT COUNT(*)::int FROM journal j WHERE j.tenant_id = a.tenant_id AND j.activite_id = a.id) AS nb_operations
         FROM activites a
        WHERE a.tenant_id = :t ${tous ? '' : 'AND a.actif'}
        ORDER BY a.actif DESC, a.type, lower(a.nom)`, { t: req.tenantId });
    res.json(rows);
  } catch (err) {
    console.error('[Activites] lister :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// POST /api/activites
const creer = async (req, res) => {
  const { val, erreur } = lire(req.body);
  if (erreur) return res.status(400).json({ error: erreur });
  try {
    // Réservé aux ONG / associations (25/11/2026) ; les fiches existantes d'une
    // PME restent en base, intactes.
    const [{ ong }] = await q('SELECT tenant_est_ong(:t) AS ong', { t: req.tenantId });
    if (!ong) return res.status(400).json({ error: 'Les activités et projets sont réservés aux ONG et associations.' });
    const [row] = await q(
      `INSERT INTO activites (tenant_id, code, nom, type, description, budget, date_debut, date_fin)
       VALUES (:t, :code, :nom, :type, :description, :budget, :date_debut, :date_fin) RETURNING *`,
      { t: req.tenantId, ...val });
    res.status(201).json(row);
  } catch (err) {
    if (doublon(err)) return res.status(409).json({ error: `« ${val.nom} » existe déjà.` });
    console.error('[Activites] creer :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// PUT /api/activites/:id   (actif peut aussi être modifié : réactivation)
const modifier = async (req, res) => {
  const { val, erreur } = lire(req.body);
  if (erreur) return res.status(400).json({ error: erreur });
  const actif = req.body.actif === undefined ? null : Boolean(req.body.actif);
  try {
    const [row] = await q(
      `UPDATE activites SET code = :code, nom = :nom, type = :type, description = :description, budget = :budget,
              date_debut = :date_debut, date_fin = :date_fin, actif = COALESCE(:actif, actif)
        WHERE id = :id AND tenant_id = :t RETURNING *`,
      { id: parseInt(req.params.id, 10), t: req.tenantId, actif, ...val });
    if (!row) return res.status(404).json({ error: 'Activité introuvable.' });
    res.json(row);
  } catch (err) {
    if (doublon(err)) return res.status(409).json({ error: `« ${val.nom} » existe déjà.` });
    console.error('[Activites] modifier :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// DELETE /api/activites/:id
// Déjà utilisée → désactivée (l'historique garde son classement) ; sinon supprimée.
const supprimer = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const [a] = await q('SELECT id, nom FROM activites WHERE id = :id AND tenant_id = :t', { id, t: req.tenantId });
    if (!a) return res.status(404).json({ error: 'Activité introuvable.' });
    const [{ n }] = await q(
      `SELECT (SELECT COUNT(*) FROM journal WHERE activite_id = :id)
            + (SELECT COUNT(*) FROM mouvements_attente WHERE activite_id = :id) AS n`, { id });
    // 069 : un projet qui a des activités, ou une activité inscrite dans un
    // budget de projet, n'est jamais supprimé (seulement désactivé).
    let lie = 0;
    if (await require('../services/projets.service').estInstalle()) {
      [{ lie }] = await q(
        `SELECT (SELECT COUNT(*) FROM activites WHERE projet_id = :id)
              + (SELECT COUNT(*) FROM projet_budget_lignes WHERE activite_id = :id)
              + (SELECT COUNT(*) FROM projet_budgets WHERE projet_id = :id)
              + (SELECT COUNT(*) FROM journal_imputations_projet WHERE projet_id = :id) AS lie`, { id });
    }
    if (Number(lie) > 0 && Number(n) === 0) {
      await q('UPDATE activites SET actif = false WHERE id = :id RETURNING id', { id });
      return res.json({ desactivee: true, message: `« ${a.nom} » est liée à un projet ou à un budget de projet : elle a été désactivée (historique conservé).` });
    }
    if (Number(n) > 0) {
      await q('UPDATE activites SET actif = false WHERE id = :id RETURNING id', { id });
      return res.json({ desactivee: true, message: `« ${a.nom} » est utilisée par ${n} opération(s) : elle a été désactivée (plus proposée à la saisie, historique conservé).` });
    }
    await q('DELETE FROM activites WHERE id = :id RETURNING id', { id });
    res.json({ supprimee: true, message: `« ${a.nom} » supprimée.` });
  } catch (err) {
    console.error('[Activites] supprimer :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// GET /api/activites/suivi?mois=Octobre&annee=2026&periode=mois|annee
// Totaux par activité (et « Non classé ») sur la période, détail par rubrique,
// et cumul des dépenses depuis le début pour comparer à l'enveloppe prévue.
// Exclus : écritures annulées et leurs contre-passations, virements internes.
const suivi = async (req, res) => {
  const annee = parseInt(req.query.annee, 10);
  const periode = req.query.periode === 'annee' ? 'annee' : 'mois';
  const mois = req.query.mois;
  if (!annee || (periode === 'mois' && !MOIS.includes(mois))) {
    return res.status(400).json({ error: 'Période invalide.' });
  }
  const filtreReel = `NOT COALESCE(j.annule, false) AND j.annulation_de_id IS NULL
                      AND NOT COALESCE(r.est_virement_interne, false)`;
  try {
    const [activites, lignes, cumuls] = await Promise.all([
      q(`SELECT id, code, nom, type, budget, date_debut, date_fin, actif FROM activites WHERE tenant_id = :t`, { t: req.tenantId }),
      q(`SELECT j.activite_id, j.rubrique_code, MAX(r.intitule) AS rubrique_libelle,
                SUM(COALESCE(j.entree, 0))::float AS entrees, SUM(COALESCE(j.sortie, 0))::float AS sorties,
                COUNT(*)::int AS nb
           FROM journal j
           LEFT JOIN rubriques r ON r.tenant_id = j.tenant_id AND r.code = j.rubrique_code
          WHERE j.tenant_id = :t AND j.annee = :a ${periode === 'mois' ? 'AND j.mois = :m' : ''} AND ${filtreReel}
          GROUP BY j.activite_id, j.rubrique_code`, { t: req.tenantId, a: annee, m: mois }),
      q(`SELECT j.activite_id, SUM(COALESCE(j.sortie, 0))::float AS sorties
           FROM journal j
           LEFT JOIN rubriques r ON r.tenant_id = j.tenant_id AND r.code = j.rubrique_code
          WHERE j.tenant_id = :t AND j.activite_id IS NOT NULL AND ${filtreReel}
          GROUP BY j.activite_id`, { t: req.tenantId }),
    ]);

    const cumulPar = new Map(cumuls.map((c) => [c.activite_id, c.sorties]));
    const groupes = new Map();
    const groupe = (id) => {
      if (!groupes.has(id)) groupes.set(id, { entrees: 0, sorties: 0, nb: 0, rubriques: [] });
      return groupes.get(id);
    };
    for (const l of lignes) {
      const g = groupe(l.activite_id ?? null);
      g.entrees += l.entrees; g.sorties += l.sorties; g.nb += l.nb;
      g.rubriques.push({ code: l.rubrique_code, libelle: l.rubrique_libelle || l.rubrique_code, entrees: l.entrees, sorties: l.sorties, nb: l.nb });
    }
    const totalSorties = lignes.reduce((s, l) => s + l.sorties, 0);
    const totalEntrees = lignes.reduce((s, l) => s + l.entrees, 0);

    const resultat = activites
      .filter((a) => a.actif || groupes.has(a.id))
      .map((a) => {
        const g = groupes.get(a.id) || { entrees: 0, sorties: 0, nb: 0, rubriques: [] };
        const budget = a.budget === null ? null : Number(a.budget);
        const cumul = cumulPar.get(a.id) || 0;
        return {
          id: a.id, code: a.code, nom: a.nom, type: a.type, actif: a.actif,
          date_debut: a.date_debut, date_fin: a.date_fin,
          entrees: g.entrees, sorties: g.sorties, nb: g.nb,
          part: totalSorties > 0 ? Math.round((g.sorties / totalSorties) * 1000) / 10 : 0,
          budget, cumul_sorties: cumul,
          taux_budget: budget ? Math.round((cumul / budget) * 1000) / 10 : null,
          rubriques: g.rubriques.sort((x, y) => y.sorties - x.sorties || y.entrees - x.entrees),
        };
      })
      .sort((x, y) => y.sorties - x.sorties || x.nom.localeCompare(y.nom));

    const nc = groupes.get(null) || { entrees: 0, sorties: 0, nb: 0, rubriques: [] };
    res.json({
      periode, mois: periode === 'mois' ? mois : null, annee,
      activites: resultat,
      non_classe: {
        entrees: nc.entrees, sorties: nc.sorties, nb: nc.nb,
        part: totalSorties > 0 ? Math.round((nc.sorties / totalSorties) * 1000) / 10 : 0,
        rubriques: nc.rubriques.sort((x, y) => y.sorties - x.sorties),
      },
      total: { entrees: totalEntrees, sorties: totalSorties },
    });
  } catch (err) {
    console.error('[Activites] suivi :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// Contrôle d'un rattachement à la saisie : null si vide, sinon l'id d'une
// activité ACTIVE du client (erreur 400 explicite sinon).
const resoudreActivite = async (tenantId, valeur) => {
  if (valeur === undefined || valeur === null || valeur === '' || valeur === 0 || valeur === '0') return null;
  const id = parseInt(valeur, 10);
  if (!id) { const e = new Error('Activité / projet invalide.'); e.status = 400; throw e; }
  const [a] = await q('SELECT id FROM activites WHERE id = :id AND tenant_id = :t AND actif', { id, t: tenantId });
  if (!a) { const e = new Error('Activité / projet introuvable ou désactivé : choisissez-en un autre ou laissez le champ vide.'); e.status = 400; throw e; }
  return id;
};

module.exports = { lister, creer, modifier, supprimer, suivi, resoudreActivite };

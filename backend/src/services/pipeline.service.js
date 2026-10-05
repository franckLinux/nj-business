// src/services/pipeline.service.js — MyNjBusiness : suivi commercial léger.
//
// Aucune donnée dupliquée : tout est lu sur les tables existantes
//   prospects (+ historique) · users (commerciaux, comptes de démo)
//   tenants (espaces démo / clients) · abonnements · paiements.
// Pipeline (étape calculée depuis le statut existant) :
//   NOUVEAU → CONTACTÉ → INTÉRESSÉ → DÉMO / ESSAI → ADHÉRENT → ACTIF
// Périmètre : un commercial ne voit QUE ses prospects (filtre SQL, côté serveur).
const { sequelize } = require('../models');
const { ErreurMetier } = require('./plateforme.service');
const pr = require('./prospects.service');

const SELECT = sequelize.QueryTypes.SELECT;
const q = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, type: SELECT, ...opts });
const ex = (sql, replacements, opts = {}) => sequelize.query(sql, { replacements, ...opts });

const ETAPES = ['NOUVEAU', 'CONTACTE', 'INTERESSE', 'DEMO', 'ADHERENT', 'ACTIF'];
const SQL_ETAPE = `CASE p.statut
    WHEN 'PROSPECT' THEN 'NOUVEAU' WHEN 'CONTACTE' THEN 'CONTACTE' WHEN 'INTERESSE' THEN 'INTERESSE'
    WHEN 'INVITATION_ENVOYEE' THEN 'DEMO' WHEN 'DEMO_ACTIVE' THEN 'DEMO' WHEN 'DEMO_EXPIREE' THEN 'DEMO'
    WHEN 'PAIEMENT_EN_ATTENTE' THEN 'ADHERENT' WHEN 'CLIENT_ACTIF' THEN 'ACTIF' ELSE 'PERDU' END`;
const ACTIONS = ['Appeler', 'Envoyer WhatsApp', 'Faire démonstration', 'Relancer', 'Envoyer proposition', 'Finaliser adhésion', 'Renouveler abonnement'];
const SOURCES = ['Terrain', 'WhatsApp', 'Site web', 'Recommandation', 'Réseaux sociaux', 'Formulaire web', 'Autre'];

const estDirection = (u) => u.role === 'super_admin' || (u.role === 'comptable_cabinet' && !u.tenantId);

// Base commune : une ligne par prospect, avec son étape, son dernier
// abonnement et l'indicateur « à relancer ». Le périmètre est dans le WHERE.
const BASE = `
  SELECT p.id, p.nom_complet, p.entreprise, p.email, p.telephone, p.secteur, p.ville, p.source,
         p.statut, p.commercial_id, p.dernier_contact_le, p.prochaine_action, p.prochaine_action_le,
         p.demo_fin, p.tenant_id, p.client_tenant_id, p.user_id, p.created_at, p.updated_at,
         NOT p.demande_traitee AS demande_web,
         u.username AS commercial_nom,
         a.forfait_nom, a.date_fin AS abonnement_fin, a.statut AS abonnement_statut,
         ${SQL_ETAPE} AS etape,
         ( (p.prochaine_action_le IS NOT NULL AND p.prochaine_action_le <= CURRENT_DATE
             AND p.statut NOT IN ('DEMO_ANNULEE','PROSPECT_ABANDONNE'))
           OR (p.statut = 'CLIENT_ACTIF' AND a.date_fin IS NOT NULL AND a.date_fin <= CURRENT_DATE + 15)
           OR p.statut = 'DEMO_EXPIREE'
           OR (NOT p.demande_traitee AND p.statut = 'PROSPECT') ) AS a_relancer
    FROM prospects p
    LEFT JOIN users u ON u.id = p.commercial_id
    LEFT JOIN LATERAL (SELECT forfait_nom, date_fin, statut FROM abonnements ab
                        WHERE ab.prospect_id = p.id ORDER BY ab.date_fin DESC LIMIT 1) a ON true
   WHERE (CAST(:perimetre AS uuid) IS NULL OR p.commercial_id = CAST(:perimetre AS uuid))
     AND (CAST(:commercial AS uuid) IS NULL OR p.commercial_id = CAST(:commercial AS uuid))
     AND (:sansCommercial = false OR p.commercial_id IS NULL)
     AND (:r = '' OR p.entreprise ILIKE :like OR p.nom_complet ILIKE :like OR p.email ILIKE :like
          OR regexp_replace(p.telephone, '\\D', '', 'g') LIKE :telLike)`;

const vue = async ({ user, recherche = '', commercial = '', filtre = '' }) => {
  await pr.marquerExpires().catch(() => {});
  const direction = estDirection(user);
  const r = String(recherche || '').trim().slice(0, 80);
  const chiffres = r.replace(/\D/g, '');
  const rep = {
    perimetre: direction ? null : user.id,
    commercial: direction && /^[0-9a-f-]{36}$/i.test(commercial) ? commercial : null,
    sansCommercial: direction && commercial === 'aucun',
    r, like: `%${r.replace(/[%_\\]/g, '\\$&')}%`,
    telLike: chiffres.length >= 3 ? `%${chiffres}%` : '__aucun__',
  };
  const filtreEtape = ETAPES.includes(filtre) || filtre === 'PERDU' ? filtre : null;

  const [kpi] = await q(`WITH b AS (${BASE})
    SELECT COUNT(*) FILTER (WHERE etape <> 'PERDU')::int AS prospects,
           COUNT(*) FILTER (WHERE a_relancer)::int AS a_relancer,
           COUNT(*) FILTER (WHERE etape = 'DEMO')::int AS demos,
           COUNT(*) FILTER (WHERE etape = 'ADHERENT')::int AS adherents,
           COUNT(*) FILTER (WHERE etape = 'ACTIF')::int AS actifs,
           COUNT(*) FILTER (WHERE etape = 'PERDU')::int AS perdus,
           COUNT(*) FILTER (WHERE prochaine_action_le = CURRENT_DATE AND etape <> 'PERDU')::int AS aujourdhui,
           COUNT(*) FILTER (WHERE prochaine_action_le < CURRENT_DATE AND etape <> 'PERDU')::int AS en_retard,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE etape IN ('INTERESSE','DEMO','ADHERENT','ACTIF'))::int AS f_interesses,
           COUNT(*) FILTER (WHERE etape IN ('DEMO','ADHERENT','ACTIF'))::int AS f_demos,
           COUNT(*) FILTER (WHERE etape IN ('ADHERENT','ACTIF'))::int AS f_adherents
      FROM b`, rep);

  // Cartes : 60 au plus par colonne (à relancer d'abord, puis échéance).
  const cartes = await q(`WITH b AS (${BASE}),
    n AS (SELECT b.*, ROW_NUMBER() OVER (PARTITION BY etape
            ORDER BY a_relancer DESC, prochaine_action_le ASC NULLS LAST, updated_at DESC) AS rang,
            COUNT(*) OVER (PARTITION BY etape) AS nb_etape FROM b
           WHERE (:filtreRelance = false OR a_relancer)
             AND (CAST(:filtreEtape AS text) IS NULL OR etape = CAST(:filtreEtape AS text))
             AND (etape <> 'PERDU' OR CAST(:filtreEtape AS text) = 'PERDU'))
    SELECT * FROM n WHERE rang <= 60`, { ...rep, filtreRelance: filtre === 'relance', filtreEtape });

  const colonnes = Object.fromEntries([...ETAPES, 'PERDU'].map((e) => [e, { total: 0, cartes: [] }]));
  for (const c of cartes) {
    colonnes[c.etape].total = Number(c.nb_etape);
    colonnes[c.etape].cartes.push(c);
  }

  const res = {
    direction,
    kpis: { prospects: kpi.prospects, a_relancer: kpi.a_relancer, demos: kpi.demos, adherents: kpi.adherents, actifs: kpi.actifs },
    aujourdhui: kpi.aujourdhui, en_retard: kpi.en_retard, perdus: kpi.perdus,
    colonnes,
    actions: ACTIONS, sources: SOURCES,
  };
  if (direction) {
    res.entonnoir = [
      { etape: 'Prospects', n: kpi.total },
      { etape: 'Intéressés', n: kpi.f_interesses },
      { etape: 'Démos', n: kpi.f_demos },
      { etape: 'Adhérents', n: kpi.f_adherents },
      { etape: 'Actifs', n: kpi.actifs },
    ];
    res.par_commercial = await q(`WITH b AS (${BASE})
      SELECT commercial_id, COALESCE(commercial_nom, 'Non attribué') AS nom, COUNT(*)::int AS prospects,
             COUNT(*) FILTER (WHERE etape IN ('ADHERENT','ACTIF'))::int AS convertis,
             COUNT(*) FILTER (WHERE a_relancer)::int AS a_relancer
        FROM b GROUP BY 1, 2 ORDER BY prospects DESC`, { ...rep, commercial: null, sansCommercial: false });
    res.commerciaux = await q(`SELECT id, username AS nom FROM users
      WHERE role = 'commercial' AND actif AND tenant_id IS NULL ORDER BY username`);
  }
  return res;
};

// ── Fiche (panneau) ─────────────────────────────────────────────────────
const fiche = async ({ user, id }) => {
  await verifierPerimetre(user, id);
  const [c] = await q(`WITH b AS (${BASE} AND p.id = CAST(:id AS uuid)) SELECT * FROM b`,
    { perimetre: null, commercial: null, sansCommercial: false, r: '', like: '%', telLike: '__aucun__', id });
  if (!c) throw new ErreurMetier(404, 'Prospect introuvable.');
  c.historique = await q(
    `SELECT h.id, h.action, h.motif, h.details, h.nouveau_statut, h.created_at, u.username AS auteur
       FROM prospect_historique h LEFT JOIN users u ON u.id = h.user_id
      WHERE h.prospect_id = :id ORDER BY h.created_at DESC, h.id DESC LIMIT 30`, { id });
  if (c.client_tenant_id) {
    [c.client] = await q('SELECT id, nom, actif FROM tenants WHERE id = :t', { t: c.client_tenant_id });
  }
  return c;
};

// Un commercial n'atteint que ses prospects : 404 (pas 403) pour ne pas
// révéler l'existence d'une fiche hors périmètre.
const verifierPerimetre = async (user, id) => {
  if (estDirection(user)) return;
  const [p] = await q('SELECT commercial_id FROM prospects WHERE id = :id', { id });
  if (!p || p.commercial_id !== user.id) throw new ErreurMetier(404, 'Prospect introuvable.');
};

// ── Actions rapides (1 ou 2 clics) ────────────────────────────────────────
const SUIVANT = { PROSPECT: 'CONTACTE', CONTACTE: 'INTERESSE' };
const LIBELLES = { appel: 'APPEL', whatsapp: 'WHATSAPP', note: 'NOTE' };

const agir = async ({ user, id, type, note = '', prochaineAction, prochaineActionLe, commercialId }) => {
  await verifierPerimetre(user, id);
  const texte = String(note || '').trim().slice(0, 1000);
  return sequelize.transaction(async (t) => {
    const p = await pr.charger(id, t, true);
    const hist = (o) => pr.historiser(t, { prospectId: id, ancien: p.statut, nouveau: p.statut, userId: user.id, ...o });

    if (type === 'appel' || type === 'whatsapp' || type === 'note') {
      if (type === 'note' && !texte) throw new ErreurMetier(400, 'Écrivez la note.');
      let nouveau = p.statut;
      // Premier contact réel : le prospect passe automatiquement à « Contacté ».
      if (type !== 'note' && p.statut === 'PROSPECT') nouveau = 'CONTACTE';
      await ex(`UPDATE prospects SET statut = :s, demande_traitee = true, updated_at = NOW()
                  ${type !== 'note' ? ', dernier_contact_le = NOW()' : ''} WHERE id = :id`, { s: nouveau, id }, { transaction: t });
      await hist({ action: LIBELLES[type], motif: texte, nouveau });
    } else if (type === 'relance') {
      const action = String(prochaineAction || '').trim().slice(0, 60);
      const date = prochaineActionLe ? String(prochaineActionLe).slice(0, 10) : null;
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ErreurMetier(400, 'Date de relance invalide.');
      await ex('UPDATE prospects SET prochaine_action = :a, prochaine_action_le = :d, demande_traitee = true, updated_at = NOW() WHERE id = :id',
        { a: action, d: date, id }, { transaction: t });
      await hist({ action: action ? 'RELANCE_PROGRAMMEE' : 'RELANCE_TERMINEE', motif: texte, details: { prochaine_action: action, le: date } });
    } else if (type === 'suivant') {
      const nouveau = SUIVANT[p.statut];
      if (!nouveau) throw new ErreurMetier(409, 'Étape suivante : utilisez l\'action proposée (envoyer la démo, enregistrer le paiement…).');
      await ex('UPDATE prospects SET statut = :s, demande_traitee = true, updated_at = NOW() WHERE id = :id', { s: nouveau, id }, { transaction: t });
      await pr.historiser(t, { prospectId: id, ancien: p.statut, nouveau, action: 'CHANGEMENT_STATUT', motif: texte, userId: user.id });
    } else if (type === 'attribuer') {
      if (!estDirection(user)) throw new ErreurMetier(403, 'Seule la Direction attribue les prospects.');
      if (commercialId) {
        const [c] = await q("SELECT username FROM users WHERE id = :c AND role = 'commercial' AND actif AND tenant_id IS NULL",
          { c: commercialId }, { transaction: t });
        if (!c) throw new ErreurMetier(400, 'Commercial introuvable.');
      }
      await ex('UPDATE prospects SET commercial_id = :c, updated_at = NOW() WHERE id = :id', { c: commercialId || null, id }, { transaction: t });
      await hist({ action: 'ATTRIBUTION', details: { commercial_id: commercialId || null } });
    } else {
      throw new ErreurMetier(400, 'Action inconnue.');
    }
    return { ok: true };
  });
};

module.exports = { vue, fiche, agir, verifierPerimetre, estDirection, ETAPES };

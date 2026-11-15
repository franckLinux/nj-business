// src/controllers/config.controller.js
// M05 — Configuration Entité (étendue OHADA/CEMAC)
// Champs : nom, sigle, forme_juridique, adresse, registre_commerce,
//          boite_postale, nui, activite, dirigeant_nom, devise, exercice_fiscal
const { Tenant, sequelize } = require('../models');
// 060 : la forme juridique décide du référentiel comptable (SYSCOHADA / SYCEBNL).
const planRef = require('../services/plan_referentiel.service');

// ── Formes juridiques OHADA reconnues (référentiel UI) ────────────────────
// Exposé via GET /api/config/referentiel pour alimenter un <select>.
const FORMES_JURIDIQUES = [
  { code: 'SA',          label: 'SA — Société Anonyme' },
  { code: 'SAS',         label: 'SAS — Société par Actions Simplifiée' },
  { code: 'SARL',        label: 'SARL — Société à Responsabilité Limitée' },
  { code: 'SARLU',       label: 'SARLU — SARL Unipersonnelle' },
  { code: 'SNC',         label: 'SNC — Société en Nom Collectif' },
  { code: 'SCS',         label: 'SCS — Société en Commandite Simple' },
  { code: 'GIE',         label: 'GIE — Groupement d\'Intérêt Économique' },
  { code: 'EI',          label: 'EI — Entreprise Individuelle' },
  { code: 'ETS',         label: 'Ets — Établissement' },
  { code: 'COOP',        label: 'Coopérative' },
  { code: 'ASSOC',       label: 'Association' },
  { code: 'ONG',         label: 'ONG' },
  { code: 'AUTRE',       label: 'Autre' },
];

const toConfigPayload = (t) => ({
  id: t.id,
  slug: t.slug,
  nom: t.nom,
  logo_url: t.logo_url || '',
  devise: t.devise || 'FCFA',
  sigle: t.sigle || '',
  forme_juridique: t.forme_juridique || '',
  adresse: t.adresse || '',
  registre_commerce: t.registre_commerce || '',
  boite_postale: t.boite_postale || '',
  nui: t.nui || '',
  activite: t.activite || '',
  dirigeant_nom: t.dirigeant_nom || '',
  telephone: t.telephone || '',
  email: t.email || '',
  site_web: t.site_web || '',
  exercice_debut: t.exercice_debut,
  exercice_fin: t.exercice_fin,
  actif: t.actif,
  // 060 : référentiel en place et référentiel attendu par la forme juridique.
  plan_referentiel: t.plan_referentiel || 'SYSCOHADA',
  plan_referentiel_attendu: planRef.referentielDeForme(t.forme_juridique),
});

// ── GET /api/config ───────────────────────────────────────────────────────
const getConfig = async (req, res) => {
  try {
    const tenant = await Tenant.findByPk(req.tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Configuration introuvable. Vérifiez que le tenant existe.' });
    }
    res.json(toConfigPayload(tenant));
  } catch (err) {
    console.error('[Config] getConfig :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

// ── GET /api/config/referentiel ───────────────────────────────────────────
// Renvoie les listes de référence pour alimenter les <select> côté UI.
const getReferentiel = async (req, res) => {
  res.json({
    // Chaque forme indique le plan comptable qu'elle charge (060).
    formes_juridiques: FORMES_JURIDIQUES.map((f) => ({ ...f, plan_referentiel: planRef.referentielDeForme(f.code) })),
    referentiels: planRef.REFERENTIELS,
  });
};

// ── Référentiel comptable (060) ───────────────────────────────────────────
const repondreRef = (res, err, quoi) => {
  if (err instanceof planRef.ErreurReferentiel) return res.status(err.status).json({ error: err.message });
  console.error(`[Config] ${quoi} :`, err.message);
  return res.status(500).json({ error: `Erreur serveur : ${err.message}` });
};

// GET /api/config/plan-referentiel?forme=ASSOC
// État du client + aperçu de la bascule qu'impliquerait la forme demandée
// (ou la forme actuelle si aucune n'est donnée). Aucune écriture.
const getPlanReferentiel = async (req, res) => {
  try {
    const e = await planRef.etat(req.tenantId);
    const forme = req.query.forme !== undefined ? String(req.query.forme) : e.forme_juridique;
    const cible = planRef.referentielDeForme(forme);
    const change = cible !== e.actuel;
    res.json({
      ...e,
      cible, cible_info: planRef.REFERENTIELS[cible], change,
      apercu: change ? await planRef.apercu(req.tenantId, cible) : null,
    });
  } catch (err) { repondreRef(res, err, 'référentiel du plan'); }
};

// POST /api/config/plan-referentiel/bascule { confirmer: true }
// Aligne le plan sur la forme juridique déjà enregistrée (cas d'une entité
// déclarée Association / ONG avant la migration 060).
const postBasculePlan = async (req, res) => {
  if (req.body?.confirmer !== true) {
    return res.status(400).json({ error: 'Confirmation requise : consultez l\'aperçu puis confirmez la bascule.' });
  }
  try {
    const e = await planRef.etat(req.tenantId);
    if (!e.a_basculer) return res.json({ message: `Le plan comptable applique déjà le ${e.actuel_info.libelle}.`, resultat: null, etat: e });
    const resultat = await planRef.basculer(req.tenantId, e.attendu, req.user.id);
    res.json({
      message: `Plan comptable basculé vers le ${e.attendu_info.libelle} : ${resultat.ajoutes} compte(s) ajouté(s), ${resultat.archives} archivé(s).`,
      resultat, etat: await planRef.etat(req.tenantId),
    });
  } catch (err) { repondreRef(res, err, 'bascule du plan'); }
};

// ── Logo de l'entité ──────────────────────────────────────────────────────
// Stocké en data URL (image redimensionnée par le navigateur). On n'accepte
// que des images matricielles : pas de SVG, qui peut embarquer du script.
const LOGO_MAX_CARACTERES = 400 * 1024;   // ≈ 300 Ko d'image une fois décodée
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const verifierLogo = (logo) => {
  if (logo === undefined) return { garder: true };
  if (logo === null || logo === '') return { valeur: null };
  if (typeof logo !== 'string' || !LOGO_RE.test(logo)) {
    return { erreur: 'Logo invalide : utilisez une image PNG, JPEG ou WebP.' };
  }
  if (logo.length > LOGO_MAX_CARACTERES) {
    return { erreur: 'Logo trop volumineux (300 Ko maximum après redimensionnement).' };
  }
  return { valeur: logo };
};

// ── GET /api/config/entete ────────────────────────────────────────────────
// Ce qu'il faut pour l'en-tête et le pied des documents imprimés.
const getEntete = async (req, res) => {
  try {
    const t = await Tenant.findByPk(req.tenantId);
    if (!t) return res.status(404).json({ error: 'Entité introuvable.' });
    res.json({
      nom: t.nom || '', sigle: t.sigle || '', forme_juridique: t.forme_juridique || '',
      activite: t.activite || '', logo_url: t.logo_url || '',
      adresse: t.adresse || '', boite_postale: t.boite_postale || '',
      telephone: t.telephone || '', email: t.email || '', site_web: t.site_web || '',
      nui: t.nui || '', registre_commerce: t.registre_commerce || '',
      dirigeant_nom: t.dirigeant_nom || '', devise: t.devise || 'FCFA',
    });
  } catch (err) {
    console.error('[Config] getEntete :', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
};

// ── PUT /api/config ───────────────────────────────────────────────────────
const updateConfig = async (req, res) => {
  const {
    nom, sigle, forme_juridique, adresse, registre_commerce,
    boite_postale, nui, activite, dirigeant_nom,
    devise, exercice_debut, exercice_fin,
    telephone, email, site_web, logo_url,
  } = req.body;

  if (!nom || nom.trim() === '') {
    return res.status(400).json({ error: "Le nom de l'entité est obligatoire." });
  }

  // Validation forme juridique (souple : on accepte aussi une saisie libre via code "AUTRE")
  if (forme_juridique && !FORMES_JURIDIQUES.some(f => f.code === forme_juridique)) {
    return res.status(400).json({
      error: `Forme juridique invalide. Codes acceptés : ${FORMES_JURIDIQUES.map(f => f.code).join(', ')}`,
    });
  }

  // Validation NUI (Cameroun : 14 caractères alphanumériques en général — souple)
  if (nui && nui.trim().length > 0 && nui.trim().length > 20) {
    return res.status(400).json({ error: 'NUI trop long (max 20 caractères).' });
  }

  const logo = verifierLogo(logo_url);
  if (logo.erreur) return res.status(400).json({ error: logo.erreur });

  // 060 : la forme juridique décide du plan comptable. Association / ONG →
  // SYCEBNL, autre forme → SYSCOHADA. Le plan bascule automatiquement à
  // l'enregistrement, dans la même transaction (non destructif, réversible) ;
  // l'écran Entité affiche l'aperçu avant l'enregistrement.
  let bascule = null;
  try {
    const e = await planRef.etat(req.tenantId);
    const cible = planRef.referentielDeForme(forme_juridique);
    if (cible !== e.actuel) bascule = cible;
  } catch (err) {
    if (err instanceof planRef.ErreurReferentiel) return res.status(err.status).json({ error: err.message });
    console.error('[Config] contrôle du référentiel :', err.message);
    return res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }

  try {
    const transaction = await sequelize.transaction();
    let count; let rows; let resultatBascule = null;
    try {
    [count, rows] = await Tenant.update(
      {
        nom: nom.trim(),
        sigle: (sigle || '').trim().toUpperCase(),
        forme_juridique: (forme_juridique || '').trim().toUpperCase(),
        adresse: (adresse || '').trim(),
        registre_commerce: (registre_commerce || '').trim(),
        boite_postale: (boite_postale || '').trim(),
        nui: (nui || '').trim().toUpperCase(),
        activite: (activite || '').trim(),
        // Synchroniser directeur_nom pour rétrocompatibilité (rapport, etc.)
        dirigeant_nom: (dirigeant_nom || '').trim(),
        directeur_nom: (dirigeant_nom || '').trim(),
        devise: devise || 'FCFA',
        exercice_debut: exercice_debut || null,
        exercice_fin: exercice_fin || null,
        // Coordonnées (031) : un champ absent de la requête n'est pas effacé.
        ...(telephone !== undefined ? { telephone: String(telephone || '').trim() } : {}),
        ...(email !== undefined ? { email: String(email || '').trim().toLowerCase() } : {}),
        ...(site_web !== undefined ? { site_web: String(site_web || '').trim() } : {}),
        ...(logo.garder ? {} : { logo_url: logo.valeur }),
      },
      { where: { id: req.tenantId }, returning: true, transaction }
    );
    if (count > 0 && bascule) {
      resultatBascule = await planRef.basculer(req.tenantId, bascule, req.user.id, { transaction });
      rows = [await Tenant.findByPk(req.tenantId, { transaction })];
    }
    await transaction.commit();
    } catch (e) { await transaction.rollback().catch(() => {}); throw e; }
    if (count === 0) return res.status(404).json({ error: 'Entité introuvable.' });
    res.json({
      message: resultatBascule
        ? `Configuration enregistrée. Plan comptable basculé vers le ${planRef.REFERENTIELS[bascule].libelle} (${resultatBascule.ajoutes} compte(s) ajouté(s), ${resultatBascule.archives} archivé(s)).`
        : 'Configuration mise à jour avec succès.',
      config: toConfigPayload(rows[0]),
      bascule_plan: resultatBascule,
    });
  } catch (err) {
    console.error('[Config] updateConfig :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

module.exports = { getConfig, getEntete, updateConfig, getReferentiel, getPlanReferentiel, postBasculePlan, FORMES_JURIDIQUES };

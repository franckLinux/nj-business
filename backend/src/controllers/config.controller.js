// src/controllers/config.controller.js
// M05 — Configuration Entité (étendue OHADA/CEMAC)
// Champs : nom, sigle, forme_juridique, adresse, registre_commerce,
//          boite_postale, nui, activite, dirigeant_nom, devise, exercice_fiscal
const { Tenant } = require('../models');

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
  res.json({ formes_juridiques: FORMES_JURIDIQUES });
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

  try {
    const [count, rows] = await Tenant.update(
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
      { where: { id: req.tenantId }, returning: true }
    );
    if (count === 0) return res.status(404).json({ error: 'Entité introuvable.' });
    res.json({ message: 'Configuration mise à jour avec succès.', config: toConfigPayload(rows[0]) });
  } catch (err) {
    console.error('[Config] updateConfig :', err.message);
    res.status(500).json({ error: `Erreur serveur : ${err.message}` });
  }
};

module.exports = { getConfig, getEntete, updateConfig, getReferentiel, FORMES_JURIDIQUES };

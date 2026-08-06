// src/routes/admin-setup.route.js
// ============================================================================
//  Initialisation de la base par requête HTTP — pensée pour un hébergement
//  sans shell (PlanetHoster / Passenger), où `npm run db:setup` n'est pas
//  exécutable au moment du déploiement.
//
//    GET /api/admin/setup?token=…          schéma + migrations + plan + admin
//    GET /api/admin/setup/status?token=…   état de la base, sans rien écrire
//
//  Options (GET /api/admin/setup) :
//    &prune=1        désactive les comptes SYSCOHADA absents du référentiel
//    &reset_admin=1  réinitialise le mot de passe du super admin
//
//  Le token se passe aussi en en-tête `X-Setup-Token`, ce qui est préférable :
//  une query string se retrouve dans les logs d'accès et l'historique du
//  navigateur. Exemple :
//    curl -H "X-Setup-Token: $SETUP_TOKEN" https://exemple.com/api/admin/setup
//
//  Ces routes n'exigent pas de JWT : c'est justement le cas où aucun compte
//  n'existe encore. Le SETUP_TOKEN est leur seule protection — d'où le verrou,
//  le débit limité et le silence complet en cas de token invalide.
// ============================================================================
const router    = require('express').Router();
const rateLimit = require('express-rate-limit');

const { runSetup, getStatus } = require('../../db/lib/setup');
const {
  setupTokenGuard,
  entetesSensibles,
  verifierConfiguration,
} = require('../middleware/setupToken');

// État de l'endpoint annoncé une fois au démarrage, dans les logs Node.
verifierConfiguration();

// Débit volontairement bas : ces routes ne servent qu'au déploiement, et c'est
// la seule barrière contre une recherche exhaustive du token.
const limiteur = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 10,
  message: { error: 'Trop de tentatives. Réessayez dans une heure.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const commun = [limiteur, entetesSensibles, setupTokenGuard];

// ── Initialisation ────────────────────────────────────────────────────────
router.get('/setup', ...commun, async (req, res) => {
  console.log(`[Setup] Initialisation demandée depuis ${req.ip}.`);
  try {
    const rapport = await runSetup({
      prune:      req.query.prune === '1',
      resetAdmin: req.query.reset_admin === '1',
      onProgress: (etape, texte) => console.log(`[Setup] ${etape} : ${texte}`),
    });
    // 500 si une étape a échoué : le corps détaille laquelle, mais le statut
    // HTTP doit rester franc pour un script de déploiement qui le teste.
    res.status(rapport.ok ? 200 : 500).json(rapport);
  } catch (err) {
    if (err.code === 'SETUP_LOCKED') {
      return res.status(409).json({ error: err.message });
    }
    console.error('[Setup] Erreur inattendue :', err);
    res.status(500).json({ error: "Initialisation impossible.", detail: err.message });
  }
});

// ── État (lecture seule) ──────────────────────────────────────────────────
router.get('/setup/status', ...commun, async (req, res) => {
  try {
    res.json(await getStatus());
  } catch (err) {
    console.error('[Setup] Lecture d\'état impossible :', err);
    res.status(500).json({ error: "Lecture de l'état impossible.", detail: err.message });
  }
});

module.exports = router;

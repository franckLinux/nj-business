// src/routes/admin-setup.route.js
// ============================================================================
//  Initialisation de la base par simple URL — pensée pour un hébergement sans
//  shell (PlanetHoster / Passenger), où `npm run db:setup` n'est pas exécutable
//  au moment du déploiement.
//
//    GET /api/admin/setup/status    état de la base, n'écrit rien
//    GET /api/admin/setup           schéma + migrations + plan comptable + admin
//    GET /api/admin/setup/complet   idem + paramétrage du cabinet (db/data/config-*.js)
//
//  Options (sur /setup et /setup/complet) :
//    &prune=1         désactive les comptes SYSCOHADA absents du référentiel
//    &reset_admin=1   réinitialise le mot de passe du super admin
//    &config_force=1  laisse le paramétrage écraser les lignes déjà en base
//                     — sans lui, l'existant n'est jamais modifié
//
//  Le token se passe en en-tête `X-Setup-Token` (préférable — une query string
//  atterrit dans les logs d'accès et l'historique du navigateur) ou, quand on
//  n'a qu'un navigateur sous la main, en `?token=…`.
//
//  ── Pourquoi un GET qui écrit, et comment on le rend sûr ──────────────────
//  C'est une entorse assumée à la sémantique HTTP : sur cet hébergement, une
//  URL est le SEUL déclencheur disponible. Un GET est réputé sans effet, donc
//  susceptible d'être rejoué à notre insu. Quatre garde-fous, du plus général
//  au plus spécifique :
//
//   1. Idempotence réelle — migrations suivies en base, seeds en ON CONFLICT
//      DO NOTHING. Rejouer n'a aucun effet ; c'est la seule protection qui
//      tienne si toutes les autres tombent.
//   2. Verrou consultatif PostgreSQL (db/lib/setup.js) — deux appels
//      simultanés ne peuvent pas s'entrelacer au milieu des migrations.
//   3. Invisibilité — sans token valide, la requête retombe sur le routage
//      normal : un scanner reçoit exactement ce qu'il recevrait pour n'importe
//      quelle URL inexistante. Plus débit limité à 10 tentatives par heure.
//   4. Refus des requêtes non intentionnelles (ci-dessous) — préchargement
//      navigateur et HEAD.
//
//  Ces routes n'exigent pas de JWT : c'est justement le cas où aucun compte
//  n'existe encore.
// ============================================================================
const router    = require('express').Router();
const rateLimit = require('express-rate-limit');

const { runSetup, getStatus } = require('../../db/lib/setup');
const {
  setupTokenGuard,
  entetesSensibles,
  verifierConfiguration,
  etatSetup,
} = require('../middleware/setupToken');
const { rendreRapport, rendreEtat, rendreMessage, veutHtml } = require('./admin-setup.view');

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

/**
 * Refuse les requêtes qu'un humain n'a pas voulues.
 *
 *   • Préchargement : Chrome, Firefox et Safari annoncent leurs requêtes
 *     spéculatives (barre d'adresse, survol d'un lien, balise <link rel=prefetch>).
 *     Elles portent le token si l'URL est dans l'historique — donc sans ce
 *     filtre, une simple frappe dans la barre d'adresse peut relancer un setup.
 *   • HEAD : Express route les HEAD vers les gestionnaires GET. Un HEAD
 *     exécuterait donc l'initialisation, sans que personne n'en voie le
 *     résultat. On répond 405 avec Allow: GET.
 *
 * 412 pour le préchargement : la condition « requête intentionnelle » n'est pas
 * remplie. Le corps explique quoi faire, puisqu'à ce stade le token est valide
 * et qu'on parle donc à l'exploitant.
 */
const refuserRequetesNonIntentionnelles = (req, res, next) => {
  if (req.method === 'HEAD') {
    console.warn(`[Setup] HEAD refusé sur ${req.originalUrl.split('?')[0]} depuis ${req.ip}.`);
    return res.set('Allow', 'GET').status(405).end();
  }

  // Sec-Purpose est la forme normalisée ; les autres subsistent selon les versions.
  const prefetch =
    /prefetch|prerender/i.test(req.get('Sec-Purpose') || '') ||
    /prefetch|preview/i.test(req.get('Purpose') || '') ||
    /prefetch|preview/i.test(req.get('X-Purpose') || '') ||
    /prefetch/i.test(req.get('X-Moz') || '');

  if (prefetch) {
    console.warn(`[Setup] Préchargement refusé sur ${req.originalUrl.split('?')[0]} depuis ${req.ip}.`);
    const texte =
      "Cette requête a été émise par le navigateur en anticipation, pas par une " +
      'action délibérée. L\'initialisation n\'a pas été lancée. Validez l\'URL ' +
      'dans la barre d\'adresse pour l\'exécuter réellement.';
    return veutHtml(req)
      ? res.status(412).type('html').send(rendreMessage('Requête non exécutée', texte))
      : res.status(412).json({ error: texte });
  }

  next();
};

// L'ordre compte : setupTokenGuard AVANT le filtre d'intentionnalité. Sans
// token, la requête doit retomber sur le routage normal — répondre 405 à un
// HEAD non authentifié révélerait l'existence de la route à un scanner et
// ruinerait l'invisibilité. Les 405/412 ne sont donc visibles que par qui
// détient déjà le token, c'est-à-dire l'exploitant.
const commun = [limiteur, entetesSensibles, setupTokenGuard, refuserRequetesNonIntentionnelles];

/** Exécute la chaîne d'initialisation et répond en HTML ou en JSON. */
const executer = (avecConfig) => async (req, res) => {
  console.log(
    `[Setup] Initialisation${avecConfig ? ' complète' : ''} demandée depuis ${req.ip}.`
  );
  try {
    const rapport = await runSetup({
      prune:       req.query.prune === '1',
      resetAdmin:  req.query.reset_admin === '1',
      withConfig:  avecConfig,
      configForce: req.query.config_force === '1',
      onProgress:  (etape, texte) => console.log(`[Setup] ${etape} : ${texte}`),
    });

    // Le statut HTTP doit rester franc pour un script de déploiement qui le
    // teste ; le corps, lui, détaille quelle étape a lâché.
    const code = rapport.ok ? 200 : 500;
    return veutHtml(req)
      ? res.status(code).type('html').send(rendreRapport(rapport, { config: avecConfig }))
      : res.status(code).json(rapport);
  } catch (err) {
    if (err.code === 'SETUP_LOCKED') {
      const texte = err.message;
      return veutHtml(req)
        ? res.status(409).type('html').send(rendreMessage('Initialisation déjà en cours', texte))
        : res.status(409).json({ error: texte });
    }
    console.error('[Setup] Erreur inattendue :', err);
    return veutHtml(req)
      ? res.status(500).type('html').send(rendreMessage('Initialisation impossible', err.message))
      : res.status(500).json({ error: 'Initialisation impossible.', detail: err.message });
  }
};

// ── Diagnostic de déploiement — SANS token ────────────────────────────────
//
//    GET /api/admin/ping
//
//  Répond à la seule question qu'on se pose quand « l'URL de setup ne prend
//  pas » : le code déployé est-il le bon, et le token est-il pris en compte ?
//  Sans cette route, les deux causes produisent exactement la même réponse
//  (la route se rend invisible), et on ne peut pas les distinguer sans accès
//  aux logs — ce qui est précisément ce dont on manque sur un mutualisé.
//
//  Ce qu'elle divulgue : qu'un mécanisme d'initialisation existe, et s'il est
//  armé. Jamais le token, ni sa longueur, ni la moindre information sur la
//  base. Le compromis est délibéré : la protection réelle reste un secret de
//  32 octets aléatoires, que savoir « il y a un setup ici » n'aide pas à
//  deviner. En échange, un déploiement se diagnostique en une requête.
//
//  À laisser en place : elle n'exécute rien. Une fois SETUP_TOKEN vidé, elle
//  répondra `arme: false`, ce qui est l'état souhaité en régime permanent.
router.get('/ping', entetesSensibles, (req, res) => {
  const { arme, raison } = etatSetup();
  res.json({
    route_admin_montee: true,          // si vous lisez ceci, le code est à jour
    version:            require('../../package.json').version,
    setup: {
      arme,
      raison,
      urls: arme
        ? {
            etat:    '/api/admin/setup/status',
            complet: '/api/admin/setup/complet',
            socle:   '/api/admin/setup',
          }
        : null,
    },
    aide: arme
      ? 'Ajoutez ?token=… ou l\'en-tête X-Setup-Token aux URL ci-dessus.'
      : 'Renseignez SETUP_TOKEN (32 caractères minimum) dans le .env du serveur, '
        + 'puis REDÉMARREZ l\'application — Passenger ne relit pas le .env à chaud.',
  });
});

// ── État (lecture seule) ──────────────────────────────────────────────────
// Déclaré avant /setup pour qu'Express ne fasse pas correspondre /setup/status
// à une autre route au passage.
router.get('/setup/status', ...commun, async (req, res) => {
  try {
    const etat = await getStatus();
    return veutHtml(req)
      ? res.type('html').send(rendreEtat(etat))
      : res.json(etat);
  } catch (err) {
    console.error("[Setup] Lecture d'état impossible :", err);
    return veutHtml(req)
      ? res.status(500).type('html').send(rendreMessage("Lecture d'état impossible", err.message))
      : res.status(500).json({ error: "Lecture de l'état impossible.", detail: err.message });
  }
});

// ── Initialisation complète, paramétrage du cabinet compris ───────────────
// Le cas nominal d'un premier déploiement : une seule URL, rien à mémoriser.
// Sans config_force=1, ce chargement ne peut rien écraser de ce qui existe.
router.get('/setup/complet', ...commun, executer(true));

// ── Initialisation du socle technique seul ────────────────────────────────
// Schéma, migrations, plan comptable SYSCOHADA, super admin. Sans le
// paramétrage métier : utile pour provisionner un nouveau client du cabinet,
// dont la configuration n'est pas celle du fichier db/data/config-*.js.
router.get('/setup', ...commun, executer(false));

module.exports = router;

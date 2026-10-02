// src/middleware/setupToken.js
// ============================================================================
//  Garde d'accès aux routes d'initialisation de la base.
//
//  Contexte : l'hébergement (PlanetHoster / Passenger) n'offre pas de shell
//  fiable, donc les migrations et les seeds doivent pouvoir être déclenchées
//  par une requête HTTP. Un GET qui écrit en base est intrinsèquement exposé :
//  un navigateur peut le préfetcher, un antivirus le rejouer, un crawler le
//  suivre. D'où les précautions ci-dessous.
//
//  Principe : sans token valide, la route est INVISIBLE. On ne renvoie ni 401
//  ni 403 — on laisse la requête retomber sur le routage normal, si bien qu'un
//  scanner obtient exactement la même réponse que pour n'importe quelle URL
//  inexistante. Les tentatives sont en revanche journalisées côté serveur :
//  invisible pour l'extérieur, visible pour l'exploitant dans les logs Node.
// ============================================================================
const crypto = require('crypto');

const LONGUEUR_MIN = 32;

/**
 * Comparaison à durée constante. On hache les deux valeurs au préalable :
 * timingSafeEqual exige des buffers de même longueur et lèverait sinon, ce qui
 * transformerait la longueur du token en oracle.
 */
const tokensEgaux = (fourni, attendu) => {
  const a = crypto.createHash('sha256').update(String(fourni)).digest();
  const b = crypto.createHash('sha256').update(String(attendu)).digest();
  return crypto.timingSafeEqual(a, b);
};

/**
 * État de l'endpoint, sans rien journaliser. Évalué à CHAQUE appel et non mis
 * en cache : sur un hébergement où l'on modifie le .env puis où l'on redémarre,
 * une valeur figée au chargement du module mentirait après un rechargement
 * partiel.
 *
 * Ne renvoie jamais le token ni sa longueur exacte — seulement de quoi
 * répondre « est-ce armé, et sinon pourquoi ».
 *
 * @returns {{arme: boolean, raison: string}}
 */
const etatSetup = () => {
  const token = process.env.SETUP_TOKEN;

  if (!token) {
    return { arme: false, raison: 'SETUP_TOKEN absent du .env du serveur' };
  }
  if (token.length < LONGUEUR_MIN) {
    return {
      arme: false,
      raison: `SETUP_TOKEN trop court (${LONGUEUR_MIN} caractères minimum requis)`,
    };
  }
  return { arme: true, raison: 'endpoint armé, token requis' };
};

/**
 * Journalise l'état de l'endpoint au démarrage. Appelée une fois au chargement
 * de la route — c'est cette ligne qu'on cherche dans les logs Passenger quand
 * l'URL de setup « ne prend pas ».
 * @returns {boolean} true si l'endpoint est armé
 */
const verifierConfiguration = () => {
  const { arme, raison } = etatSetup();

  if (arme) {
    console.log('[Setup] /api/admin/setup armé (token requis).');
    return true;
  }

  console.warn(
    `[Setup] ${raison} → /api/admin/setup DÉSACTIVÉ.\n` +
    '        Générez-en un solide :  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
    '        Puis REDÉMARREZ l\'application : Passenger ne relit pas le .env à chaud.'
  );
  return false;
};

/**
 * Middleware de route. Accepte le token via `?token=` ou l'en-tête
 * `X-Setup-Token` (préférable : n'apparaît pas dans les logs d'accès du
 * serveur ni dans l'historique du navigateur).
 */
const setupTokenGuard = (req, res, next) => {
  const attendu = process.env.SETUP_TOKEN;

  // Endpoint non armé : on se comporte comme si la route n'existait pas.
  if (!attendu || attendu.length < LONGUEUR_MIN) return next('route');

  const fourni = req.get('X-Setup-Token') || req.query.token;
  if (!fourni || !tokensEgaux(fourni, attendu)) {
    console.warn(
      `[Setup] Tentative refusée sur ${req.originalUrl.split('?')[0]} ` +
      `depuis ${req.ip} — token ${fourni ? 'invalide' : 'absent'}.`
    );
    return next('route');
  }

  next();
};

/** Empêche toute mise en cache ou indexation des réponses d'initialisation. */
const entetesSensibles = (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  next();
};

module.exports = { setupTokenGuard, entetesSensibles, verifierConfiguration, etatSetup, LONGUEUR_MIN };

// index.js — CaissePro v2 Entry Point
const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const compression= require('compression');
const rateLimit  = require('express-rate-limit');

const app = express();

// ── Sécurité & middlewares ────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP désactivé pour servir le front
// APP_URL accepte une liste séparée par des virgules : en production le front
// peut être servi depuis plusieurs origines légitimes (apex + www, domaine du
// backend qui sert aussi le build React). Une chaîne unique bloquait
// silencieusement https://www.… au premier appel XHR.
const originsAutorisees = (process.env.APP_URL || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? (origin, cb) => {
        // Pas d'en-tête Origin = requête même-origine, curl, app mobile : on laisse passer.
        if (!origin || originsAutorisees.includes(origin)) return cb(null, true);
        console.warn(`[CORS] Origine refusée : ${origin}`);
        return cb(new Error('Origine non autorisée par la politique CORS.'));
      }
    : '*',
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Tenant-Id'],
}));
app.use(require('./src/middleware/responseEnvelope'));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '10mb' })); // upload de pièces en base64
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────────────────────────────────────
// Passenger (PlanetHoster) est un proxy inverse : sans `trust proxy`, req.ip
// vaut l'adresse du proxy pour TOUT le monde, et le quota était donc partagé
// par l'ensemble des utilisateurs du cabinet → 429 en cascade sur toutes les
// pages (notifications/count, journaux, config…) dès quelques personnes connectées.
app.set('trust proxy', 1);

// Quota par PERSONNE connectée (clé = jeton), par IP sinon. Un jeton est
// propre à une session : plusieurs collègues derrière la même box internet
// (même IP publique) ne se consomment plus mutuellement leur quota.
const crypto = require('crypto');
const cleQuota = (req) => {
  const auth = req.get('Authorization') || '';
  if (auth.startsWith('Bearer ') && auth.length > 20) {
    return 'u:' + crypto.createHash('sha256').update(auth).digest('hex').slice(0, 32);
  }
  return 'ip:' + req.ip;
};

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX) || 1500,
  keyGenerator: cleQuota,
  // La sonde de santé ne doit jamais être bloquée (supervision, diagnostic).
  skip: (req) => req.originalUrl.startsWith('/api/health') || req.originalUrl.startsWith('/api/admin/ping'),
  message:  { error: 'Trop de requêtes. Réessayez dans quelques minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_MAX, 10) || 10,   // réglable pour les tests automatiques
  message: { error: 'Trop de tentatives de connexion. Veuillez patienter 15 minutes.' },
});

app.use('/api/', limiter);
app.use('/api/auth/login', loginLimiter);
app.use(['/api/auth/mot-de-passe-oublie', '/api/auth/reinitialisation'], loginLimiter);
// Lien d'activation des démos et tâche planifiée : publics, donc bridés par IP.
// Demande de démo publique : 5 envois par heure et par adresse IP.
app.use('/api/demande-demo', rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  // La validation directe par code a son propre limiteur (routes/index.js).
  skip: (req) => req.path.startsWith('/validation-directe'),
  message: { error: 'Trop de demandes envoyées. Réessayez plus tard ou contactez-nous directement.' },
}));
app.use(['/api/activation', '/api/taches'], rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Trop de tentatives. Veuillez patienter 15 minutes.' },
}));

// ── Pièces jointes stockées sur disque local ──────────────────────────────
const storage = require('./src/services/storage.service');
storage.init()
  .then((dir) => console.log(`[Storage] Dossier des pièces jointes : ${dir}`))
  .catch((err) => console.error('[Storage] Initialisation impossible :', err.message));

app.use(storage.BASE_URL, express.static(storage.STORAGE_DIR, {
  dotfiles: 'deny',
  index: false,
  maxAge: '1h',
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));

// ── Initialisation automatique de la base au démarrage ────────────────────
// Alternative à GET /api/admin/setup pour les hébergements où ce endpoint
// est difficile à atteindre (SETUP_TOKEN pas encore synchronisé, etc.) :
// à chaque démarrage du process, on rejoue schéma+migrations+plan
// comptable+admin. Sans risque à répéter (verrou Postgres + idempotent,
// voir db/lib/setup.js) — ne modifie jamais un admin existant
// (resetAdmin: false) ni une config déjà en base (configForce: false).
// Compte de démonstration NJ COMMERCIAL (DEMO_COMMERCIAL=true) : créé une seule fois,
// APRÈS les migrations ; s'il existe déjà, rien ne se passe (tools/demo-commercial.js).
const demoAuDemarrage = () => {
  // 066 : reprise unique des comptes existants dans les modules (sans effet ensuite).
  require('./src/services/utilisateurs_modules.service').repriseAuDemarrage()
    .catch((err) => console.error('[Modules/utilisateurs] Reprise non faite :', err.message));
  if (process.env.DEMO_COMMERCIAL !== 'true') return;
  require('./tools/demo-commercial').creerDemoAuDemarrage();
};
if (process.env.AUTO_SETUP === 'true') {
  const { runSetup } = require('./db/lib/setup');
  runSetup({ withConfig: process.env.AUTO_SETUP_CONFIG === 'true' })
    .then((rapport) => {
      const statut = rapport.ok ? 'OK' : 'ÉCHEC';
      console.log(`[Setup] Initialisation automatique au démarrage : ${statut} (${rapport.duree_ms} ms)`);
      if (!rapport.ok) console.error('[Setup] Détail :', JSON.stringify(rapport.steps));
      if (rapport.ok) demoAuDemarrage();
    })
    .catch((err) => console.error('[Setup] Initialisation automatique impossible :', err.message));
} else {
  demoAuDemarrage();
}

// ── Frontend React (Vite) — servi à la racine ─────────────────────────────
const reactDist = path.join(__dirname, '..', 'frontend', 'dist');
const reactDistExists = fs.existsSync(path.join(reactDist, 'index.html'));
if (reactDistExists) {
  app.use(express.static(reactDist));
  console.log('[Frontend] Build React servi sur /');
} else {
  console.warn('[Frontend] Build React introuvable. Lancez : cd frontend && npm install && npm run build');
}

// ── API Routes ────────────────────────────────────────────────────────────
const apiRoutes = require('./src/routes/index');
app.use('/api', apiRoutes);

// ── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const { pool } = require('./src/config/database');
    await pool.query('SELECT 1');
    res.json({
      status:    'ok',
      version:   require('./package.json').version,
      timestamp: new Date().toISOString(),
      db:        'connected',
    });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

// ── 404 des routes API ────────────────────────────────────────────────────
//
// IMPÉRATIF : placé AVANT le repli SPA. Sans ce garde, une URL /api inconnue
// tombait dans le repli et recevait la page React — ou, quand le bundle
// manque, le message « Frontend React non construit ». Un appel d'API
// répondait donc du HTML avec un statut 200, ce qui rend un diagnostic de
// déploiement impossible : « route absente du code déployé », « token refusé »
// et « bundle non transféré » produisaient tous exactement la même réponse.
//
// Une API doit répondre en JSON, avec le bon statut. Les routes protégées par
// SETUP_TOKEN atterrissent ici quand le token est absent ou invalide (via
// next('route')) : elles restent donc indiscernables de n'importe quelle autre
// URL /api inexistante, ce qui préserve leur invisibilité.
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'Route API inconnue.',
    methode: req.method,
    chemin: `/api${req.path}`,
  });
});

// ── Repli SPA (toutes les autres routes inconnues → index.html) ───────────
app.get('*', (req, res) => {
  if (reactDistExists) {
    res.sendFile(path.join(reactDist, 'index.html'));
  } else {
    // 503 et non 200 : l'application n'est pas en état de servir le frontend.
    // Ce message ne concerne QUE le frontend — l'API, elle, répond au-dessus.
    res.status(503).type('text/plain; charset=utf-8').send(
      'Le bundle React est introuvable sur ce serveur.\n\n' +
      `Attendu : ${path.join(reactDist, 'index.html')}\n\n` +
      "La racine de l'application Node doit contenir backend/ et frontend/ côte à côte.\n" +
      'Transférez frontend/dist (construit en local par `npm run build` — Passenger\n' +
      "ne lance aucun build), puis redémarrez l'application.\n\n" +
      "L'API n'est pas affectée : /api/health et /api/admin/ping répondent normalement.\n"
    );
  }
});

// ── Gestion globale des erreurs ───────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server] Erreur non gérée :', err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Une erreur interne est survenue.'
      : err.message,
  });
});

// ── Démarrage ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;
// Garde-fou de schéma (colonnes dont dépend le code) avant d'accepter du
// trafic — plafonné à 15 s pour ne jamais bloquer le démarrage.
const { ensureSchema } = require('./src/config/schemaGuard');
Promise.race([
  ensureSchema().catch((err) => console.error('[Schema] Garde-fou indisponible :', err.message)),
  new Promise((r) => setTimeout(r, 15000)),
]).finally(() => app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log(`║  🏦  CaissePro v2 démarré              ║`);
  console.log(`║  → http://localhost:${PORT}               ║`);
  console.log(`║  ENV: ${(process.env.NODE_ENV||'development').padEnd(32)}║`);
  console.log('╚════════════════════════════════════════╝\n');
}));

module.exports = app;

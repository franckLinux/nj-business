// server.js — CaissePro v2 Entry Point
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const compression= require('compression');
const rateLimit  = require('express-rate-limit');

const app = express();

// ── Sécurité & middlewares ────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP désactivé pour servir le front
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.APP_URL
    : '*',
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','X-Tenant-Id'],
}));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '10mb' })); // upload de pièces en base64
app.use(express.urlencoded({ extended: true }));

// ── Rate limiting ─────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX) || 200,
  message:  { error: 'Trop de requêtes. Réessayez dans quelques minutes.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de tentatives de connexion. Veuillez patienter 15 minutes.' },
});

app.use('/api/', limiter);
app.use('/api/auth/login', loginLimiter);

// ── Frontend vanilla (legacy) ─────────────────────────────────────────────
// Servi à la racine tant que la migration React n'est pas terminée. Le service
// worker et le manifest restent donc à la portée « / », la PWA est intacte.
const LEGACY_DIR = path.join(__dirname, '..', 'frontend', 'legacy');
app.use(express.static(LEGACY_DIR));

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

// ── Frontend React (Vite) — migration progressive, monté sur /v2 ──────────
// L'application vanilla reste servie sur / tant que toutes les pages ne sont
// pas portées. Le build React n'est monté que s'il existe.
const fs = require('fs');
const reactDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(path.join(reactDist, 'index.html'))) {
  app.use('/v2', express.static(reactDist));
  app.get('/v2/*', (req, res) => res.sendFile(path.join(reactDist, 'index.html')));
  console.log('[Frontend] Build React servi sur /v2');
} else {
  app.get('/v2*', (req, res) =>
    res.status(503).send(
      "Frontend React non construit. Lancez : cd frontend && npm install && npm run build"
    ));
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

// ── SPA fallback (toutes les routes inconnues → index.html) ───────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(LEGACY_DIR, 'index.html'));
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
app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════╗');
  console.log(`║  🏦  CaissePro v2 démarré              ║`);
  console.log(`║  → http://localhost:${PORT}               ║`);
  console.log(`║  ENV: ${(process.env.NODE_ENV||'development').padEnd(32)}║`);
  console.log('╚════════════════════════════════════════╝\n');
});

module.exports = app;

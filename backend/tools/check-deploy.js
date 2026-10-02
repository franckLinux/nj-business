#!/usr/bin/env node
// backend/tools/check-deploy.js
// ============================================================================
//  Vérifications préalables à un déploiement PlanetHoster (Passenger).
//
//      npm run deploy:check
//
//  Passenger ne lance ni build ni migration : tout ce qui doit exister sur le
//  serveur doit être présent dans le dépôt AVANT le push. Ce script attrape les
//  oublis classiques plutôt que de les découvrir en production.
//
//  backend/ et frontend/ sont deux projets indépendants mais toujours deux
//  dossiers frères sur disque : REPO_ROOT remonte donc de deux niveaux
//  (backend/tools → backend → REPO_ROOT) pour pouvoir vérifier les deux à la
//  fois.
// ============================================================================
const fs   = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const BACKEND    = path.join(__dirname, '..');
const problemes = [];
const alertes   = [];

const p = (...segments) => path.join(REPO_ROOT, ...segments);

// ── 1. Le bundle React doit être construit et correspondre aux sources ────
//
// Le contrôle porte sur une EMPREINTE DE CONTENU (frontend/dist/.buildstamp,
// écrit par le hook postbuild), pas sur les dates de modification.
//
// L'ancienne version comparait les mtime de src/ et dist/ et se trompait dans
// les deux sens : un `git checkout` ou un `touch` rendait src/ plus récent sans
// qu'une ligne ait changé, et une retouche de commentaire — supprimée à la
// minification, donc sans effet sur le bundle — suffisait à déclencher l'alerte.
// Un contrôle qui crie au loup finit par être ignoré le jour où il a raison.
const distIndex = p('frontend', 'dist', 'index.html');
const stampFile = p('frontend', 'dist', '.buildstamp');

if (!fs.existsSync(distIndex)) {
  problemes.push(
    'frontend/dist/index.html est absent — le serveur ne pourra pas servir /.\n' +
    '    Corrigez avec : npm run build'
  );
} else if (!fs.existsSync(stampFile)) {
  alertes.push(
    "frontend/dist/.buildstamp est absent : impossible de vérifier que le bundle\n" +
    '    correspond aux sources. Il date d\'avant l\'ajout du hook postbuild.\n' +
    '    Levez le doute avec : cd frontend && npm run build'
  );
} else {
  try {
    // .cjs : frontend/package.json déclare "type": "module", or check-deploy
    // est en CommonJS et doit pouvoir require() ce module.
    const { empreinteSources } = require(p('frontend', 'scripts', 'stamp-build.cjs'));
    const attendue = JSON.parse(fs.readFileSync(stampFile, 'utf8')).sources_sha256;
    const actuelle = empreinteSources();
    if (attendue !== actuelle) {
      problemes.push(
        'frontend/dist ne correspond plus aux sources — les modifications de\n' +
        '    frontend/src (ou de vite.config.js, package-lock.json, .env.production)\n' +
        '    ne sont pas dans le bundle qui serait déployé.\n' +
        `    empreinte du bundle : ${attendue.slice(0, 16)}…\n` +
        `    empreinte des sources : ${actuelle.slice(0, 16)}…\n` +
        '    Corrigez avec : cd frontend && npm run build'
      );
    }
  } catch (err) {
    alertes.push(`Vérification du bundle impossible : ${err.message}`);
  }
}

// ── 2. Le bundle doit être versionné (Passenger ne builde pas) ────────────
// Il y a DEUX .gitignore susceptibles d'exclure dist/ : celui de la racine et
// celui de frontend/. N'en vérifier qu'un laisse passer le cas le plus courant.
for (const fichier of ['.gitignore', path.join('frontend', '.gitignore')]) {
  if (!fs.existsSync(p(fichier))) continue;
  if (/^\s*(frontend\/)?dist\/?\s*$/m.test(fs.readFileSync(p(fichier), 'utf8'))) {
    problemes.push(
      `${fichier.replace(/\\/g, '/')} exclut frontend/dist : le bundle ne partirait\n` +
      "    pas dans le dépôt, et l'hébergeur ne le reconstruira pas."
    );
  }
}

// ── 3. Passenger exige un module exportant l'app ──────────────────────────
if (!/module\.exports\s*=\s*app/.test(fs.readFileSync(p('backend', 'index.js'), 'utf8'))) {
  problemes.push(
    "backend/index.js n'exporte plus l'app Express (`module.exports = app`) :\n" +
    '    Passenger ne saura pas la démarrer.'
  );
}

// ── 4. Rappels de configuration côté serveur ──────────────────────────────
const exemple = fs.readFileSync(path.join(BACKEND, '.env.example'), 'utf8');
for (const cle of ['DATABASE_URL', 'JWT_SECRET', 'SETUP_TOKEN']) {
  if (!exemple.includes(cle)) alertes.push(`${cle} n'est pas documentée dans .env.example.`);
}
if (fs.existsSync(path.join(BACKEND, '.env'))) {
  alertes.push(
    'Un .env local existe — il est ignoré par git (normal).\n' +
    "    Pensez à créer son équivalent sur le serveur, avec un JWT_SECRET et un\n" +
    '    SETUP_TOKEN différents de ceux de développement.'
  );
}

// ── Rapport ───────────────────────────────────────────────────────────────
console.log('\n[Deploy] Vérifications préalables\n');
if (problemes.length === 0) {
  console.log('  ✓ Le dépôt est prêt à être déployé.\n');
} else {
  problemes.forEach((m) => console.log(`  ✗ ${m}\n`));
}
if (alertes.length > 0) {
  console.log('  Rappels :');
  alertes.forEach((m) => console.log(`  · ${m}`));
  console.log('');
}

process.exit(problemes.length === 0 ? 0 : 1);

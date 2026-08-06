#!/usr/bin/env node
// tools/check-deploy.js
// ============================================================================
//  Vérifications préalables à un déploiement PlanetHoster (Passenger).
//
//      npm run deploy:check
//
//  Passenger ne lance ni build ni migration : tout ce qui doit exister sur le
//  serveur doit être présent dans le dépôt AVANT le push. Ce script attrape les
//  oublis classiques plutôt que de les découvrir en production.
// ============================================================================
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const problemes = [];
const alertes   = [];

const p = (...segments) => path.join(ROOT, ...segments);

/** Date de modification la plus récente d'une arborescence. */
const mtimeMax = (dir) => {
  let max = 0;
  const parcourir = (d) => {
    for (const entree of fs.readdirSync(d, { withFileTypes: true })) {
      const complet = path.join(d, entree.name);
      if (entree.isDirectory()) parcourir(complet);
      else max = Math.max(max, fs.statSync(complet).mtimeMs);
    }
  };
  parcourir(dir);
  return max;
};

// ── 1. Le bundle React doit être construit et à jour ──────────────────────
const distIndex = p('frontend', 'dist', 'index.html');
if (!fs.existsSync(distIndex)) {
  problemes.push(
    'frontend/dist/index.html est absent — le serveur ne pourra pas servir /v2.\n' +
    '    Corrigez avec : npm run build'
  );
} else if (mtimeMax(p('frontend', 'src')) > mtimeMax(p('frontend', 'dist'))) {
  problemes.push(
    'frontend/dist est plus ancien que frontend/src — le bundle déployé ne\n' +
    '    contiendrait pas vos dernières modifications.\n' +
    '    Corrigez avec : npm run build'
  );
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
if (!/module\.exports\s*=\s*app/.test(fs.readFileSync(p('backend', 'server.js'), 'utf8'))) {
  problemes.push(
    "backend/server.js n'exporte plus l'app Express (`module.exports = app`) :\n" +
    '    Passenger ne saura pas la démarrer.'
  );
}

// ── 4. Le front vanilla reste la page servie sur / ────────────────────────
if (!fs.existsSync(p('frontend', 'legacy', 'index.html'))) {
  problemes.push("frontend/legacy/index.html est absent : la racine / ne répondrait plus.");
}

// ── 5. Rappels de configuration côté serveur ──────────────────────────────
const exemple = fs.readFileSync(p('.env.example'), 'utf8');
for (const cle of ['DATABASE_URL', 'JWT_SECRET', 'SETUP_TOKEN']) {
  if (!exemple.includes(cle)) alertes.push(`${cle} n'est pas documentée dans .env.example.`);
}
if (fs.existsSync(p('.env'))) {
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

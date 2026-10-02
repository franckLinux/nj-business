#!/usr/bin/env node
// frontend/scripts/stamp-build.js
// ============================================================================
//  Écrit dist/.buildstamp après chaque `npm run build` (hook postbuild).
//
//  Le fichier contient l'empreinte SHA-256 de TOUT ce qui entre dans le bundle :
//  src/**, index.html, vite.config.js, package-lock.json, .env.production.
//  backend/tools/check-deploy.js la recalcule et la compare, ce qui répond à la
//  seule question qui compte avant un déploiement : « le bundle présent
//  correspond-il aux sources présentes ? »
//
//  Pourquoi pas les dates de modification : elles répondent à une autre
//  question. Un `git checkout`, un `touch`, ou une simple retouche de
//  commentaire — supprimée à la minification, donc sans effet sur le bundle —
//  rendent src/ plus récent que dist/ sans que rien n'ait changé. Le contrôle
//  criait alors au bundle périmé sur un bundle parfaitement à jour ; à force,
//  on passe outre, et le jour où il a raison on passe outre aussi.
// ============================================================================
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const RACINE = path.join(__dirname, '..');
const DIST   = path.join(RACINE, 'dist');

// Tout ce dont le bundle dépend. `.env.production` en fait partie : Vite y
// inline VITE_API_URL au build, changer l'URL du backend change le bundle.
const ENTREES = ['src', 'index.html', 'vite.config.js', 'package-lock.json', '.env.production'];

/** Fichiers d'une entrée (fichier ou dossier), en chemins relatifs triés. */
const fichiersDe = (entree) => {
  const absolu = path.join(RACINE, entree);
  if (!fs.existsSync(absolu)) return [];
  if (!fs.statSync(absolu).isDirectory()) return [entree];

  const acc = [];
  const parcourir = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const complet = path.join(dir, e.name);
      if (e.isDirectory()) parcourir(complet);
      else acc.push(path.relative(RACINE, complet));
    }
  };
  parcourir(absolu);
  return acc;
};

/**
 * Empreinte de l'ensemble des sources. Le chemin est haché avec le contenu :
 * sans cela, renommer un fichier passerait inaperçu. Séparateurs normalisés en
 * « / » pour que Windows et Linux produisent la même empreinte.
 */
const empreinteSources = () => {
  const h = crypto.createHash('sha256');
  for (const entree of ENTREES) {
    for (const fichier of fichiersDe(entree)) {
      h.update(fichier.split(path.sep).join('/'));
      h.update('\0');
      h.update(fs.readFileSync(path.join(RACINE, fichier)));
      h.update('\0');
    }
  }
  return h.digest('hex');
};

if (require.main === module) {
  if (!fs.existsSync(DIST)) {
    console.error('[Stamp] dist/ est absent — lancez `npm run build`.');
    process.exit(1);
  }
  const empreinte = empreinteSources();
  fs.writeFileSync(
    path.join(DIST, '.buildstamp'),
    JSON.stringify({ sources_sha256: empreinte, construit_le: new Date().toISOString() }, null, 2) + '\n'
  );
  console.log(`[Stamp] dist/.buildstamp écrit (${empreinte.slice(0, 12)}…)`);
}

module.exports = { empreinteSources, RACINE, DIST };

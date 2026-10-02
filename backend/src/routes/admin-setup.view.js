// src/routes/admin-setup.view.js
// ============================================================================
//  Rendu HTML des rapports d'initialisation.
//
//  Raison d'être : sur un hébergement sans shell, ces URL sont ouvertes DANS UN
//  NAVIGATEUR. Un JSON brut y est illisible — or c'est précisément le moment où
//  il faut voir d'un coup d'œil quelle étape a lâché et pourquoi. Le JSON reste
//  servi aux clients qui le demandent (curl, script de déploiement) : la
//  négociation se fait sur l'en-tête Accept, pas sur un paramètre d'URL.
//
//  Aucune dépendance, aucun asset externe : la page doit s'afficher même quand
//  la base est morte et que l'application ne sert plus rien d'autre.
// ============================================================================

/** Échappement HTML — ces valeurs viennent de messages d'erreur Postgres. */
const e = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const STYLE = `
  :root { color-scheme: light dark; }
  body { margin:0; padding:2.5rem 1.5rem; font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
         background:#f6f7f9; color:#1a2b4a; }
  main { max-width:52rem; margin:0 auto; background:#fff; border:1px solid #e3e6ec;
         border-radius:10px; padding:2rem 2.25rem; }
  h1 { margin:0 0 .25rem; font-size:1.35rem; letter-spacing:-.01em; }
  .cible { margin:0 0 1.75rem; font-size:.85rem; color:#6b7488; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .verdict { display:inline-block; padding:.3rem .75rem; border-radius:999px; font-size:.8rem;
             font-weight:600; letter-spacing:.02em; margin-bottom:1.5rem; }
  .ok   { background:#e7f6ed; color:#136c34; }
  .ko   { background:#fdecec; color:#a11b1b; }
  table { width:100%; border-collapse:collapse; font-size:.9rem; }
  th { text-align:left; font-weight:600; color:#6b7488; font-size:.78rem; text-transform:uppercase;
       letter-spacing:.04em; padding:0 .6rem .5rem 0; border-bottom:1px solid #e3e6ec; }
  td { padding:.6rem .6rem .6rem 0; border-bottom:1px solid #f0f2f5; vertical-align:top; }
  td.etape { font-weight:600; white-space:nowrap; }
  td.duree { color:#8a93a6; text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  .puce { font-weight:700; }
  .puce.ok { color:#1a9d4e; background:none; }
  .puce.ko { color:#d33; background:none; }
  .detail { color:#6b7488; font-size:.82rem; font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
            word-break:break-word; margin-top:.2rem; }
  .erreur { color:#a11b1b; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.82rem;
            word-break:break-word; margin-top:.2rem; }
  .suite { margin:1.75rem 0 0; padding:1rem 1.25rem; background:#f6f7f9; border-radius:8px;
           font-size:.87rem; color:#4a5468; }
  .suite p { margin:0 0 .5rem; }
  .suite p:last-child { margin:0; }
  code { background:#eceff3; padding:.1rem .35rem; border-radius:4px;
         font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.85em; }
  @media (prefers-color-scheme: dark) {
    body { background:#12151b; color:#e6e9ef; }
    main { background:#1a1e26; border-color:#2b3140; }
    th { border-bottom-color:#2b3140; } td { border-bottom-color:#232833; }
    .suite { background:#12151b; color:#a8b0c0; } code { background:#232833; }
  }
`;

const page = (titre, corps) => `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${e(titre)} — CaissePro</title><style>${STYLE}</style></head>
<body><main>${corps}</main></body></html>`;

/** Rapport d'exécution de runSetup(). */
const rendreRapport = (rapport, { config } = {}) => {
  const lignes = rapport.steps
    .map((s) => {
      const ok = s.statut === 'ok';
      const detail = ok && s.detail
        ? `<div class="detail">${e(JSON.stringify(s.detail))}</div>`
        : '';
      const erreur = !ok ? `<div class="erreur">${e(s.error)}</div>` : '';
      return `<tr>
        <td class="puce ${ok ? 'ok' : 'ko'}">${ok ? '✓' : '✗'}</td>
        <td class="etape">${e(s.etape)}${detail}${erreur}</td>
        <td class="duree">${e(s.duree_ms)} ms</td>
      </tr>`;
    })
    .join('');

  const suite = rapport.ok
    ? `<div class="suite">
         <p><strong>Étapes suivantes</strong></p>
         ${config ? '' : '<p>Charger le paramétrage du cabinet (tenant, journaux, rubriques) : ajouter <code>/complet</code> à cette URL.</p>'}
         <p>Vérifier l'application : <code>/api/health</code> puis connexion avec le compte <code>admin</code>.</p>
         <p><strong>Changer le mot de passe admin</strong>, puis vider <code>SETUP_TOKEN</code> dans le <code>.env</code> du serveur et redémarrer l'application : ces URL redeviendront invisibles.</p>
       </div>`
    : `<div class="suite">
         <p><strong>Une étape a échoué.</strong> Le message ci-dessus vient de PostgreSQL.</p>
         <p>Rien n'est laissé à moitié fait : chaque migration s'exécute dans sa propre transaction. Corrigez la cause, puis rappelez cette URL — les étapes déjà passées ne seront pas rejouées.</p>
       </div>`;

  return page(
    rapport.ok ? 'Initialisation réussie' : 'Initialisation en échec',
    `<h1>Initialisation de la base</h1>
     <p class="cible">${e(rapport.cible)}</p>
     <span class="verdict ${rapport.ok ? 'ok' : 'ko'}">${rapport.ok ? 'Terminé' : 'Échec'} · ${e(rapport.duree_ms)} ms</span>
     <table><thead><tr><th></th><th>Étape</th><th style="text-align:right">Durée</th></tr></thead>
     <tbody>${lignes}</tbody></table>
     ${suite}`
  );
};

/** État de la base, en lecture seule. */
const rendreEtat = (etat) => {
  const m = etat.migrations;
  const lignes = m.migrations
    .map((x) => `<tr>
        <td class="puce ${x.appliquee ? 'ok' : 'ko'}">${x.appliquee ? '✓' : '·'}</td>
        <td class="etape">${e(x.version)}</td>
        <td class="duree">${x.appliquee ? 'appliquée' : 'en attente'}</td>
      </tr>`)
    .join('');

  const aJour = m.deja_appliquees === m.total;
  const bloc = (titre, valeur) =>
    `<tr><td class="puce"></td><td class="etape">${e(titre)}<div class="detail">${e(JSON.stringify(valeur))}</div></td><td class="duree"></td></tr>`;

  return page(
    'État de la base',
    `<h1>État de la base</h1>
     <p class="cible">${e(etat.cible)}</p>
     <span class="verdict ${aJour ? 'ok' : 'ko'}">${m.deja_appliquees}/${m.total} migration(s) appliquée(s)</span>
     <table><thead><tr><th></th><th>Migration</th><th style="text-align:right">État</th></tr></thead>
     <tbody>${lignes}
       ${bloc('plan comptable', etat.plan_comptable)}
       ${bloc('configuration métier', etat.config_metier)}
     </tbody></table>
     <div class="suite"><p>Cette page ne modifie rien. Pour initialiser : retirer <code>/status</code> de l'URL.</p></div>`
  );
};

/** Page d'erreur sobre — sert aussi au refus de préchargement. */
const rendreMessage = (titre, texte) =>
  page(titre, `<h1>${e(titre)}</h1><div class="suite"><p>${e(texte)}</p></div>`);

// Le client préfère-t-il du HTML ?
// L'ordre ['json','html'] est délibéré : curl envoie un Accept générique
// (étoile/étoile) et doit recevoir du JSON, tandis qu'un navigateur classe
// explicitement text/html en tête et reçoit la page. Inverser l'ordre
// renverrait du HTML à curl et casserait les scripts de déploiement.
const veutHtml = (req) => req.accepts(['json', 'html']) === 'html';

module.exports = { rendreRapport, rendreEtat, rendreMessage, veutHtml };

# CaissePro — Déploiement base de données, API et seed (hébergement mutualisé)

Cible : PlanetHoster / cPanel + Passenger, PostgreSQL, Node ≥ 18.
Backend `backendcaisse.nj-business.net` · Front React `nj-business.net`.

---

## 1. Diagnostic — état constaté

### Bloquant corrigé : l'initialisation à distance était injoignable

`backend/src/routes/index.js:12` montait le routeur de setup avec `router.get()`
au lieu de `router.use()` :

```js
router.get('/admin', require('./admin-setup.route'));   // ✗
```

Avec `.get()`, Express exige une correspondance **exacte** sur `/api/admin` et ne
retire pas le préfixe avant de passer au sous-routeur. `/api/admin/setup` et
`/api/admin/setup/status` retombaient donc en **404** — quel que soit le
`SETUP_TOKEN`. Vérifié empiriquement sur Express 4 :

```
router.get('/admin', sub)   →  /api/admin/setup  404
router.use('/admin', sub)   →  /api/admin/setup  200
```

C'est la raison pour laquelle `AUTO_SETUP=true` a dû être activé en production :
le contournement fonctionnait, l'endpoint prévu pour ça non.

**Corrigé** → `router.use('/admin', …)`.

### Second correctif : CORS mono-origine

`origin: process.env.APP_URL` n'acceptait qu'une seule chaîne. Avec
`APP_URL=https://nj-business.net`, tout appel depuis `https://www.nj-business.net`
était rejeté silencieusement côté navigateur. `APP_URL` accepte désormais une
liste séparée par des virgules, et une requête sans en-tête `Origin`
(même-origine, curl, app Ionic) passe.

### Points restants à traiter (non corrigés — décision requise)

| # | Constat | Risque | Action |
|---|---|---|---|
| 1 | `AUTO_SETUP=true` + `AUTO_SETUP_CONFIG=true` en prod | Rejoue schéma + 10 migrations + plan comptable + config à **chaque** démarrage Passenger (qui recycle le process après inactivité) → démarrages à froid lents, verrou consultatif pris à chaque boot | Repasser à `false` une fois la base initialisée |
| 2 | ~~`frontend/dist` périmé~~ — **fausse alerte**, voir ci-dessous | — | Aucune : le bundle était déjà à jour |
| 3 | ~~Deux systèmes de migration coexistent~~ | — | **Corrigé — voir ci-dessous** |
| 4 | `PG_POOL_MAX=20` | Passenger peut lancer plusieurs process ; la limite `max_connections` d'un Postgres mutualisé est vite atteinte → `too many connections` | `PG_POOL_MAX=5` en production |
| 5 | Secrets réels présents dans la base de connaissances du projet (mot de passe Supabase, `JWT_SECRET`, clé Supabase) | Compromis | Rotation — voir §5 |
| 6 | ~30 fichiers modifiés non commités, déploiement par git | Le serveur ne recevra pas le correctif | Commit + push avant déploiement |
| 7 | `backend/backend.zip`, `frontend/dist/dist.zip` | Résidus d'un déploiement manuel | Supprimer |

### Troisième correctif : la dérive de schéma était déjà réelle

Le projet portait deux systèmes de migration parallèles. Seul le runner SQL
maison (`db/migrations/*.sql`, table `schema_migrations`) est exécuté au
déploiement — `runSetup()` ne connaît que lui, en CLI comme en HTTP.
sequelize-cli n'est joué nulle part.

Or `migrations/20260806000001-…js` contenait de **vraies** modifications de
schéma, jamais appliquées : `rubriques.code_comptable` et l'identité légale du
tenant (`sigle`, `nui`, `registre_commerce`, `dirigeant_nom`, `forme_juridique`,
`adresse`, `boite_postale`, `activite`). Les modèles Sequelize, eux, déclarent
ces colonnes. Sur une base déployée par la procédure documentée, vérifié sur
PostgreSQL 14 :

```
Tenant.findAll()    → ERREUR : column "sigle" does not exist
Rubrique.findAll()  → ERREUR : column "code_comptable" does not exist
```

Les écrans Configuration et Rubriques auraient renvoyé 500 dès leur première
ouverture. Et le déploiement n'aurait rien signalé : `seed-config.lib.js` filtre
les clés sur les colonnes réellement présentes en base, si bien que l'étape
`config_metier` rapportait « ok » tout en écartant en silence le NUI, le
registre de commerce, le sigle et les codes comptables des rubriques.

Traité ainsi :

- contenu porté dans `db/migrations/011_identite_tenant_code_comptable.sql`
  (idempotent, sans effet sur une base de dev qui a déjà ces colonnes) ;
- migration Sequelize vidée, devenue un no-op documenté ;
- scripts `sequelize:migrate*` retirés de `package.json` ;
- `migrations/README.md` acte le gel et la règle : **toute évolution de schéma
  s'écrit en SQL dans `db/migrations/`**. Sequelize reste l'ORM
  (`src/models/`, `Op`, `fn`, `col`) — c'est son outil de migration qui est écarté ;
- garde-fou `npm run db:check-drift` : compare les attributs des modèles aux
  colonnes réellement en base et sort en erreur si un modèle en référence une
  qui n'existe pas. C'est le contrôle mécanique qui manquait.

### Quatrième point : le bundle n'était pas périmé, c'est le contrôle qui se trompait

`npm run deploy:check` annonçait `frontend/dist` plus ancien que `frontend/src`.
Rebuild fait à partir du lockfile (`npm ci`, versions exactes) : le bundle produit
est **identique octet pour octet** à celui déjà présent — mêmes empreintes
`index-Co07jhEV.js` et `index-KFdUYfVo.css`, jusqu'au source map. Le bundle était
à jour ; l'alerte était fausse.

En cause, l'heuristique : `check-deploy` comparait les dates de modification.
Un `git checkout`, un `touch`, un clone frais rendent `src/` plus récent que
`dist/` sans qu'une ligne ait changé. Un contrôle qui crie au loup finit par
être ignoré le jour où il a raison.

Remplacé par une empreinte de contenu : `frontend/scripts/stamp-build.cjs`
(hook `postbuild`) écrit dans `dist/.buildstamp` le SHA-256 de tout ce qui entre
dans le bundle — `src/**`, `index.html`, `vite.config.js`, `package-lock.json`,
`.env.production`. `check-deploy` la recompare.

**Portée exacte, pour ne pas en attendre trop** : le contrôle porte sur les
*sources*, pas sur le bundle produit. Une modification de commentaire seule
change donc l'empreinte et déclenche une demande de rebuild, alors que le bundle
minifié serait identique. C'est une sur-alerte assumée : elle ne coûte qu'un
`npm run build`, et le contrôle ne peut jamais laisser passer un bundle
réellement périmé. Ce qui disparaît, c'est le bruit des dates — la cause du faux
positif rencontré ici.

Comportement vérifié :

```
dépôt en l'état                          ✓ prêt à déployer      (sortie 0)
modification de code non rebuildée       ✗ bloque, avec les deux empreintes (sortie 1)
après rebuild                            ✓ prêt à déployer      (sortie 0)
.buildstamp absent (bundle antérieur)    · simple rappel, ne bloque pas
```

### Validation end-to-end

Le tout a été rejoué sur un PostgreSQL 14.23 réel, base détenue par un rôle
`NOSUPERUSER NOCREATEDB NOCREATEROLE` — équivalent d'un compte mutualisé.

```
Base VIERGE, rôle NOSUPERUSER NOCREATEDB NOCREATEROLE :

runSetup()  schema.sql + 001→011 + plan comptable + admin + config    ok
            11 migrations appliquées
db:check-drift                        29 modèles, aucune colonne manquante ✓
Tenant.findAll() / Rubrique.findAll()                              OK / OK ✓
dirigeant_nom persisté = « NGAN Jean »   codes comptables : 1→6015, 2→6181, 3→6053
rejeu à l'identique                            0 migration rejouée → idempotent ✓

GET /api/admin/setup/status  (token valide)    200   ← 404 avant le correctif
GET /api/admin/setup         (rejeu complet)   200
GET /api/health                                200   db: connected
POST /api/auth/login  Origin: https://www.…    200   JWT émis  ← bloqué avant

Route invisible sans token — réponses octet pour octet identiques :
  URL inexistante        200 / 612 o (index.html)
  setup, token absent    200 / 612 o
  setup, token invalide  200 / 612 o
  setup, token valide    200 / 579 o (rapport JSON)
SETUP_TOKEN vidé → endpoint totalement désarmé, même avec l'ancien token ✓
```

---

## 2. Prérequis côté hébergeur

1. **Base PostgreSQL** créée depuis cPanel → *PostgreSQL Databases* :
   base `caissepro`, utilisateur dédié, tous privilèges sur la base.
   Noter le nom réel — cPanel préfixe généralement (`njbusi_caissepro`).
2. **Génération des UUID** — plus aucune contrainte, `schema.sql` n'utilise
   désormais que `gen_random_uuid()`, native depuis PostgreSQL 13.

   *Rectification par rapport à une première analyse trop pessimiste :*
   `CREATE EXTENSION "uuid-ossp"` n'exige **pas** le superutilisateur sur
   PostgreSQL 13+ — c'est une extension *trusted*, que le **propriétaire de la
   base** peut installer. Vérifié sur PostgreSQL 14.23 :

   | Compte | `CREATE EXTENSION "uuid-ossp"` |
   |---|---|
   | propriétaire de la base (cas cPanel standard) | ✓ réussit |
   | simple utilisateur sans privilège `CREATE` sur la base | ✗ `permission denied to create extension` |

   Le code d'origine aurait donc très probablement fonctionné. Le passage à
   `gen_random_uuid()` reste un gain — il supprime la dépendance, donc le cas
   d'échec restant et une transaction entière perdue quand il se produit — mais
   ce n'était pas le blocage annoncé.
3. **Application Node** déclarée dans *Setup Node.js App* :
   - Application root : le dossier du dépôt
   - Application startup file : `backend/index.js`
   - Node : 18 ou 20
   - `npm install` lancé depuis l'interface, dans `backend/`

---

## 3. Séquence de déploiement

### 3.1 En local — avant le push

```bash
cd frontend && npm run build            # obligatoire : Passenger ne build pas
cd ../backend && npm run deploy:check   # empreinte du bundle + export Passenger
npm run db:check-drift                  # modèles ↔ schéma (sur la base de dev)
```

Puis, le commit — à faire depuis votre poste, sur la branche
`reorganisation-monorepo-setup-distant` :

```bash
rm -f backend/backend.zip frontend/dist/dist.zip .git/test-ecriture
git add -A
git commit -m "Rend joignable /api/admin/setup, élargit le CORS et comble la dérive de schéma

- routes/index.js : router.use au lieu de router.get, /api/admin/setup répondait 404
- index.js : APP_URL accepte plusieurs origines
- db/migrations/011 : colonnes d'identité tenant + rubriques.code_comptable,
  qui n'existaient que dans une migration sequelize-cli jamais jouée
- sequelize-cli gelé sur son baseline (voir migrations/README.md)
- tools/check-drift.js : garde-fou modèles <-> schéma
- deploy:check : empreinte de contenu au lieu des dates de modification"
```

Le dépôt n'a **pas de remote configuré** (`git remote -v` est vide) — le
déploiement se fait donc par transfert de fichiers, ce que confirmaient les
`backend.zip` / `dist.zip` traînant dans l'arborescence. Si vous passez par le
gestionnaire de fichiers cPanel, transférez au minimum `backend/src`,
`backend/db`, `backend/index.js`, `backend/package.json` et `frontend/dist`,
puis redémarrez l'application.

`deploy:check` sort en code 1 si le bundle est absent ou périmé — ne pas passer outre.

### 3.2 Sur le serveur — `backend/.env`

```env
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://UTILISATEUR:MOTDEPASSE@localhost:5432/BASE
PG_SSL=false
PG_POOL_MAX=5

JWT_SECRET=<64+ caractères, différent du dev>
APP_URL=https://nj-business.net,https://www.nj-business.net,https://backendcaisse.nj-business.net

SEED_ADMIN_USERNAME=admin
SEED_ADMIN_PASSWORD=<mot de passe fort, à changer à la 1re connexion>

SETUP_TOKEN=<32+ caractères>
AUTO_SETUP=false
AUTO_SETUP_CONFIG=false
```

Génération des secrets :

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # SETUP_TOKEN
```

Puis **redémarrer l'application** depuis cPanel (Passenger ne relit pas `.env` à chaud).

### 3.3 Initialisation et seed — par URL

Trois URL, plus rien d'autre à retenir.

| URL | Effet |
|---|---|
| `/api/admin/setup/status` | État de la base. **N'écrit rien.** |
| `/api/admin/setup/complet` | Schéma + migrations + plan comptable + admin + **paramétrage du cabinet**. C'est le cas nominal d'un premier déploiement. |
| `/api/admin/setup` | Le socle technique seul, sans le paramétrage métier. Pour provisionner un nouveau client dont la config n'est pas celle de `db/data/config-*.js`. |

Depuis un **navigateur** — ouvrir simplement :

```
https://backendcaisse.nj-business.net/api/admin/setup/complet?token=VOTRE_TOKEN
```

La réponse est une page lisible : une ligne par étape, sa durée, son détail, et
en cas d'échec le message PostgreSQL exact. `?token=` est toléré pour ce cas —
mais il atterrit dans les logs d'accès Apache et l'historique du navigateur,
donc à réserver au déploiement initial, avec un token qu'on vide ensuite.

Depuis un **script**, avec l'en-tête (préférable, rien ne fuit dans les logs) :

```bash
curl -H "X-Setup-Token: $SETUP_TOKEN" \
     https://backendcaisse.nj-business.net/api/admin/setup/complet
```

Même URL, même code : le format suit l'en-tête `Accept`. Un navigateur reçoit la
page, `curl` reçoit le JSON — les scripts de déploiement existants ne changent pas.

Codes de retour : **200** tout est passé · **500** une étape a échoué, le corps
dit laquelle · **409** une initialisation est déjà en cours · **405** requête
`HEAD` · **412** requête émise par le préchargement du navigateur, rien n'a été
exécuté.

Un **404 JSON** « Route API inconnue » signifie que `SETUP_TOKEN` est absent,
fait moins de 32 caractères, ou que l'application n'a pas été redémarrée après
modification du `.env` : la route se rend alors indiscernable de n'importe
quelle autre URL `/api` inexistante. Pour savoir laquelle de ces causes
s'applique, voir §3.4.

Options : `&prune=1` (désactive les comptes SYSCOHADA obsolètes),
`&reset_admin=1` (réinitialise le mot de passe admin), `&config_force=1` (laisse
le paramétrage écraser les lignes déjà en base — sans lui, l'existant n'est
jamais modifié).

#### Ce qui rend ce GET sûr

Un GET est réputé sans effet : navigateurs, antivirus et robots se permettent de
le rejouer. Quatre garde-fous, vérifiés sur PostgreSQL 14 :

| Garde-fou | Vérification |
|---|---|
| Idempotence réelle (migrations suivies en base, seeds en `ON CONFLICT DO NOTHING`) | rejeu intégral → 0 migration rejouée, aucune donnée modifiée |
| Verrou consultatif PostgreSQL | deux appels concurrents → le second reçoit 409 |
| Invisibilité sans token | réponse **identique** à n'importe quelle URL `/api` inexistante (404 JSON « Route API inconnue »), `GET` comme `HEAD` |
| Refus des requêtes non intentionnelles | `HEAD` → 405, préchargement (`Sec-Purpose`, `Purpose`, `X-Purpose`, `X-Moz`) → 412 — **base restée vierge après ces trois appels** |

Le filtre d'intentionnalité est placé **après** la vérification du token : sans
token, un `HEAD` doit retomber sur le routage normal, sinon un 405 révélerait
l'existence de la route à un scanner.

### 3.4 Quand « l'URL de setup ne prend pas »

Une seule URL à ouvrir, **sans token** :

```
https://backendcaisse.nj-business.net/api/admin/ping
```

Elle n'exécute rien et répond toujours. Sa réponse tranche entre toutes les
causes possibles :

| Ce que vous voyez | Cause | Correction |
|---|---|---|
| `"arme": true` | Le code est à jour, le token est pris en compte | Rappelez l'URL de setup **avec** `?token=…` ; si elle échoue encore, le corps de la réponse dit pourquoi |
| `"arme": false, "raison": "SETUP_TOKEN absent…"` | Variable absente, ou `.env` non relu | Renseignez-la puis **redémarrez l'application** |
| `"arme": false, "raison": "SETUP_TOKEN trop court…"` | Moins de 32 caractères | Regénérez un token, redémarrez |
| `404 "Route API inconnue"` | Le code déployé est ancien : `src/routes/index.js` fait encore `router.get('/admin', …)`, ou `admin-setup.route.js` / `admin-setup.view.js` manquent | Retransférez `backend/src`, relancez *NPM Install*, redémarrez |
| Une page HTML, ou « Le bundle React est introuvable » | Vous n'avez pas atteint l'API du tout | Vérifiez le *startup file* : `backend/index.js` |

Le log de démarrage de l'application dit la même chose en une ligne :

```
[Setup] /api/admin/setup armé (token requis).                    → prêt
[Setup] SETUP_TOKEN absent du .env du serveur → … DÉSACTIVÉ.     → cause identifiée
```

**Pourquoi ce diagnostic n'existait pas avant.** Toute URL inconnue — `/api`
comprise — tombait dans le repli SPA et recevait la page React, ou le message
« Frontend React non construit » quand le bundle manquait. Un appel d'API
répondait donc du HTML : « route absente du code déployé », « token refusé » et
« bundle non transféré » donnaient tous exactement la même réponse. Les routes
`/api` renvoient désormais du JSON avec le bon statut, et le repli SPA ne
s'applique plus qu'aux URL du frontend.

### 3.5 Vérification

```bash
curl https://backendcaisse.nj-business.net/api/health
# → {"status":"ok","version":"2.0.0","db":"connected", ...}

curl -X POST https://backendcaisse.nj-business.net/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"<SEED_ADMIN_PASSWORD>"}'
```

Puis se connecter à `https://nj-business.net` et **changer immédiatement le mot
de passe admin**.

### 3.6 Verrouillage post-déploiement

Une fois la base confirmée initialisée :

```env
SETUP_TOKEN=
AUTO_SETUP=false
AUTO_SETUP_CONFIG=false
```

Vider `SETUP_TOKEN` désactive complètement l'endpoint (il redevient 404).
Redémarrer l'application.

---

## 4. Repli sans HTTP

Si l'endpoint reste inaccessible (module cPanel capricieux, `.env` non relu) :

- **Shell SSH disponible** : `cd backend && npm run db:setup`
  (variantes : `db:setup:status`, `db:migrate`, `db:seed`, `db:plan`, `db:config`)
- **Ni shell ni HTTP** : `AUTO_SETUP=true` + `AUTO_SETUP_CONFIG=true`, redémarrer
  l'app, consulter les logs Passenger, puis **repasser les deux à `false`**.
- **Rien ne fonctionne** : exporter le SQL en local
  (`db/schema.sql` puis `db/migrations/001` → `010` dans l'ordre) et l'exécuter
  via phpPgAdmin. Penser à alimenter la table `schema_migrations` avec les
  versions jouées, sinon le runner les rejouera.

---

## 5. Rotation des secrets

Le fichier `.env` complet — mot de passe Supabase, `JWT_SECRET`,
clé Supabase — se trouve en clair dans les documents attachés au projet Claude
(`docs/.env.md`). À traiter comme compromis :

1. Changer le mot de passe de la base (Supabase et/ou nouvelle base PostgreSQL).
2. Régénérer `JWT_SECRET` — invalide toutes les sessions en cours, c'est voulu.
3. Régénérer les clés Supabase si le projet reste utilisé.
4. Changer `SEED_ADMIN_PASSWORD` et le mot de passe admin en base.
5. Retirer ce document de la base de connaissances du projet.

Vérifier au passage que `.env` n'a jamais été commité :

```bash
git log --all --oneline -- backend/.env .env
```

---

## 6. Ordre d'exécution résumé

```
1. Vérifier uuid-ossp / basculer sur gen_random_uuid()
2. Créer la base + l'utilisateur PostgreSQL dans cPanel
3. npm run build (frontend)  →  npm run deploy:check  →  commit  →  push
4. Renseigner backend/.env sur le serveur  →  npm install  →  redémarrer l'app
5. GET /api/admin/setup/status              (lecture seule)
6. GET /api/admin/setup/complet             (tout : schéma, migrations, plan,
                                             admin, paramétrage du cabinet)
7. GET /api/admin/setup/status              (contrôle après coup)
8. GET /api/health + login admin            (vérification)
9. Changer le mot de passe admin
10. Vider SETUP_TOKEN, AUTO_SETUP=false, redémarrer
```

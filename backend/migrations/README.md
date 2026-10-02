# `migrations/` — gelé

Ce dossier est celui de **sequelize-cli**. Il est **gelé sur son baseline** :
les deux migrations qu'il contient sont des no-op, et aucune nouvelle ne doit y
être ajoutée.

## Pourquoi

Le projet a hérité de deux systèmes de migration parallèles :

| | `db/migrations/*.sql` | `migrations/*.js` (ce dossier) |
|---|---|---|
| Runner | `db/lib/migrate.lib.js` (maison) | sequelize-cli |
| Table de suivi | `schema_migrations` | `SequelizeMeta` |
| Joué par `npm run db:setup` | **oui** | non |
| Joué par `GET /api/admin/setup` | **oui** | non |
| Joignable sans shell (mutualisé) | **oui** | non |

Seul le premier est exécuté au déploiement. Une migration écrite ici ne part
donc jamais en production.

## Ce que ça a déjà coûté

`20260806000001-formalise-colonnes-rubriques-tenants.js` ajoutait
`rubriques.code_comptable` et l'identité légale du tenant (`sigle`, `nui`,
`registre_commerce`, `dirigeant_nom`, …). Jamais jouée. Sur une base
fraîchement déployée, vérifié sur PostgreSQL 14 :

```
Tenant.findAll()    → column "sigle" does not exist
Rubrique.findAll()  → column "code_comptable" does not exist
```

— soit les écrans Configuration et Rubriques en erreur 500 dès l'ouverture. Et
sans le moindre signal au déploiement : `seed-config.lib.js` filtre les clés sur
les colonnes réellement présentes, l'étape `config_metier` rapportait donc « ok »
tout en écartant le NUI, le registre de commerce et les codes comptables.

Le contenu a été porté dans `db/migrations/011_identite_tenant_code_comptable.sql`.

## La règle

**Toute évolution de schéma s'écrit en SQL dans `db/migrations/`**, numérotée à
la suite (`012_…sql`), idempotente autant que possible (`IF NOT EXISTS`), et
sera appliquée par `npm run db:setup` ou `GET /api/admin/setup`.

Sequelize reste utilisé comme **ORM** (`src/models/`, `Op`, `fn`, `col` dans les
contrôleurs) — c'est uniquement son outil de migration qui est écarté. Les
scripts npm `sequelize:migrate*` ont été retirés de `package.json` pour rendre
l'erreur difficile à commettre.

## Garde-fou

`npm run db:check-drift` compare les attributs déclarés dans `src/models/` aux
colonnes réellement présentes en base, et sort en erreur si un modèle référence
une colonne absente. À lancer après toute modification de modèle, et avant de
déployer.

# NJ CAISSE PRO — Projets des ONG et associations — Lot P1
## Financement reçu depuis le journal, remise de fonds contrôlée par le budget du projet

*19/11/2026 — migration 069, Service Worker v71 — branche `module/commercial`.*
*Conception : `NJ_BUSINESS_PROJETS_FINANCEMENTS_CONCEPTION.md` (version 2, décisions D1 à D5).*

---

## 1. Ce que livre le lot

| Élément | Résultat |
|---|---|
| **Réservé aux ONG / associations** | Tout dépend de `tenants.forme_juridique` = `ONG` ou `ASSOC` (fonction SQL `tenant_est_ong`). Pour une PME, rien ne change : pas de nature de recette, pas de projet à la saisie, contrôle budgétaire d'avant. |
| **Nature de la recette** | Nouveau champ des rubriques d'entrée (Configuration → Rubriques). Cinq natures « affectées » (financement de projet, subvention, don affecté, contribution d'un partenaire, financement complémentaire) et trois non affectées (fonctionnement, cotisations, autres). Fixée par qui gère les rubriques (`rubriques.edit`). |
| **Financement reçu** | Entrée de journal sur une rubrique affectée → **projet bénéficiaire obligatoire** (refus serveur sinon), référence du financement facultative. Le bailleur est le bénéficiaire / tiers de l'écriture. Écriture et lien enregistrés dans **une seule transaction**. |
| **Lien sans montant** | `journal_imputations_projet` : `journal_id` unique, projet, nature, référence, saisi par/le. Le montant reste dans le journal. Lien figé en base (`IMPUTATION_INTANGIBLE`) : une erreur se corrige par contre-passation puis nouvelle saisie. |
| **Remise de fonds à une activité** | Sortie de journal rattachée à une activité de projet → contrôlée par la ligne de l'activité dans le **budget validé** du projet. Refus net (pas de mise en attente) si le budget n'est pas validé, si l'activité n'y figure pas ou si le reste est insuffisant. Verrou par activité : deux saisies simultanées ne peuvent pas dépasser ensemble. |
| **Budget de fonctionnement étanche** | Les remises aux activités de projet sortent des sommes du budget de fonctionnement : contrôle par rubrique, plafond de caisse, budget hebdomadaire, « reste disponible » affiché et contexte du pré-contrôle hors ligne. Une sortie de fonctionnement d'une ONG reste contrôlée comme avant. |
| **Budget du projet (tables)** | `projet_budgets` (brouillon → soumis → validé / rejeté ; validé → remplacé) et `projet_budget_lignes` (montant par activité). Un seul budget en vigueur par projet. Soumis ou validé : figé en base (`BUDGET_FIGE`). Les écrans viennent au lot P2. |
| **Projets et activités** | Le référentiel `activites` existant est étendu : `projet_id` (activité d'un projet), `chef_projet_id`, `responsable_id`. Deux niveaux, cohérence vérifiée en base. Les lignes existantes ne changent pas. |
| **Corrections** | Le rattachement d'une écriture à une activité de projet ne se corrige pas en place (409, annulation requise). La contre-passation rend le budget de l'activité. |
| **Permissions** | `projets.voir`, `projets.gerer`, `budgets_projet.valider`, `justificatifs.valider`, `justificatifs.annuler` (directeur : tout sauf la validation des justificatifs ; comptable et comptable cabinet : consultation et validation des justificatifs). |

### Précision par rapport au dossier de conception

- Un **financement peut être reçu avant la validation du budget** : il suffit que le projet existe et soit actif. Seule la **remise de fonds** exige un budget validé.
- Le montant d'une activité est porté par les **lignes du budget** (`projet_budget_lignes`) et non par une colonne de l'activité : chaque version du budget garde ses montants, archivés.

## 2. Écran de saisie du journal

- **Entrée sur une rubrique affectée** : bloc vert « Financement affecté » avec la nature, le projet bénéficiaire (obligatoire) et la référence.
- **Sortie** : les activités des projets sont groupées par projet (« Projet — nom »), avec le responsable. En choisissant une activité de projet, le bandeau du budget de fonctionnement est remplacé par celui du **budget du projet** : budget validé, déjà remis, reste, reste après la sortie, mention « Hors budget de fonctionnement ».
- Un projet organisé en activités ne se choisit plus directement pour une sortie.

## 3. Fichiers

| Fichier | Rôle |
|---|---|
| `backend/db/migrations/069_projets_ong.sql` | Migration (additive, idempotente) |
| `backend/db/migrations-retour-arriere/069_retour_arriere.sql` | Retour arrière (les écritures du journal ne sont pas touchées) |
| `backend/src/services/projets.service.js` | Règles : ONG, nature, imputation, budget du projet |
| `backend/src/controllers/projets.controller.js` | `GET /api/projets/saisie` (contexte de l'écran de saisie) |
| `backend/src/controllers/journal.controller.js` | Saisie, correction, contexte hors ligne |
| `backend/src/services/journal.service.js` | Exclusion des projets du budget de fonctionnement |
| `backend/src/controllers/rubriques.controller.js` | Nature de la recette |
| `backend/src/controllers/mouvements_attente.controller.js` | Budget du projet appliqué à l'approbation |
| `backend/src/controllers/activites.controller.js` | Projet / activité liés : désactivés, jamais supprimés |
| `backend/src/services/plateforme.service.js` | Un client avec projets ne se supprime pas |
| `frontend/src/lib/projets.js`, `frontend/src/styles/projets.css` | Contexte et styles |
| `frontend/src/components/MouvementModal.jsx`, `frontend/src/components/config/RubriquesTab.jsx` | Écrans |
| `backend/tests/projets-p1.test.js` | 20 scénarios (`npm run test:projets`) |

## 4. Vérifications

- `projets-p1` : **20 / 20** (PME inchangée, nature, projet obligatoire, lien figé, budget non validé, dépassement, étanchéité fonctionnement / projet, contre-passation, correction refusée, ONG devenue PME).
- Suite complète : **246 / 246** (226 précédents + 20).
- Migration rejouée deux fois sans erreur ; retour arrière puis nouvelle application sans erreur.
- Parcours dans le navigateur (base de test, interface v71) : financement refusé sans projet puis enregistré avec projet et référence ; remise de 1 200 000 FCFA à l'activité « Forages » acceptée sans budget de fonctionnement validé, bandeau du budget du projet affiché ; colonne « Nature » et champ « Nature de la recette » dans Configuration → Rubriques.

## 5. Déploiement

1. Sauvegarde de la base (`pg_dump`).
2. Envoyer le code (backend + `frontend/dist`).
3. `node db/migrate.js` (applique la 069).
4. Redémarrer le serveur, puis vider le cache du navigateur (Ctrl+Maj+R).
5. Pour un client ONG / association : vérifier sa forme juridique (`ONG` ou `ASSOC`), puis fixer la nature des rubriques d'entrée dans Configuration → Rubriques.

## 6. Suite

- **P2** : menu « Projets » dans NJ CAISSE PRO (ONG seulement) — projets, activités, désignation du chef de projet et des responsables, chargement et soumission du budget, validation par le directeur, tableau de bord.
- **P3** : justificatifs (dépôt, validation par le chef de projet ou le comptable, annulation par le directeur), archives, bilan « activités validées / en attente de justification ».

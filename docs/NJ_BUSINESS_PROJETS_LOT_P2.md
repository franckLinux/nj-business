# NJ CAISSE PRO — Projets des ONG et associations — Lot P2
## Menu « Projets » : projets, activités, responsables, budget validé par le directeur

*20/11/2026 — pas de migration (tout repose sur la 069), Service Worker v72 — branche `module/commercial`.*
*Lot précédent : `NJ_BUSINESS_PROJETS_LOT_P1.md`.*

---

## 1. Ce que livre le lot

| Élément | Résultat |
|---|---|
| **Menu « Projets »** | Dans NJ CAISSE PRO, entre « Saisies » et « Reporting ». Affiché seulement pour un client ONG / ASSOC, et seulement à la direction, au comptable et aux personnes désignées (chef de projet, responsable d'activité). Pastille orange : nombre de budgets à valider (directeur). |
| **Tableau de bord** | Cinq cartes : budget validé, financement reçu, alloué aux responsables, disponible (reçu − alloué), reste à recevoir. Liste « Budgets à valider » pour le directeur. Liste des projets avec recherche, filtres (budget validé / à valider / sans budget / clôturés) et barres budget · reçu · alloué. |
| **Fiche projet** | Chiffres en cascade avec la même couleur partout (budget bleu, reçu vert, alloué orange, disponible turquoise). Onglets : Activités · Budget · Financements reçus · Fonds remis. |
| **Projets** | Création et modification par la direction (`projets.gerer`) : nom, code, description, période, **chef de projet**, clôture. |
| **Activités** | Créées et modifiées par la direction ou le chef du projet : nom, code, **responsable d'activité**, activation. Tableau : budget validé, alloué, reste, jauge de consommation. |
| **Budget** | Le chef de projet prépare le budget (montant par activité, commentaire) puis le **soumet**. Le directeur le **valide** ou le **rejette avec un motif** (notifications dans la cloche, dans les deux sens). Un budget rejeté se corrige et se soumet à nouveau. Une révision repart du budget en vigueur ; à la validation, l'ancien devient « Remplacé ». Un budget ne peut jamais descendre sous les fonds déjà remis à une activité. Toutes les versions restent dans l'historique. |
| **Financements reçus** | Les entrées du journal imputées au projet (P1), avec journal, n° de pièce, rubrique, nature, **compte comptable**, bailleur, référence, saisi par. Chaque ligne s'ouvre en lecture seule ; une écriture annulée apparaît barrée et n'est pas comptée. |
| **Fonds remis** | Les sorties du journal vers les activités du projet, même présentation. |

## 2. Qui voit et fait quoi (contrôlé par le serveur)

| | Directeur | Comptable | Chef de projet | Responsable d'activité | Autre utilisateur |
|---|:-:|:-:|:-:|:-:|:-:|
| Voir le menu | ✅ | ✅ | ✅ ses projets | ✅ ses activités | ❌ |
| Voir les financements reçus | ✅ | ✅ | ✅ | ❌ | ❌ |
| Créer / modifier un projet, désigner le chef | ✅ | ❌ | ❌ | ❌ | ❌ |
| Activités et responsables | ✅ | ❌ | ✅ ses projets | ❌ | ❌ |
| Préparer et soumettre le budget | ✅ | ❌ | ✅ ses projets | ❌ | ❌ |
| Valider / rejeter le budget | ✅ | ❌ | ❌ | ❌ | ❌ |

Le chef de projet et le responsable d'activité n'ont pas besoin d'un rôle particulier : un caissier, un profil métier ou tout autre utilisateur de l'entreprise peut être désigné. Hors de son périmètre, un projet répond « introuvable ».

## 3. Fichiers

| Fichier | Rôle |
|---|---|
| `backend/src/services/projets_gestion.service.js` | Périmètre, projets, activités, budget, chiffres |
| `backend/src/controllers/projets.controller.js`, `backend/src/routes/index.js` | 15 routes `/api/projets…` |
| `frontend/src/pages/ProjetsPage.jsx` | Tableau de bord, liste, création |
| `frontend/src/pages/ProjetPage.jsx` | Fiche, activités, budget, financements, fonds remis |
| `frontend/src/lib/projets.js`, `frontend/src/styles/projets.css` | Accès au menu, statuts, styles |
| `frontend/src/components/Sidebar.jsx`, `Layout.jsx`, `NotifBell.jsx`, `App.jsx` | Menu, titre, notifications, routes |
| `backend/tests/projets-p2.test.js` | 10 scénarios (`npm run test:projets` lance P1 + P2) |

## 4. Vérifications

- `projets-p1` + `projets-p2` : **30 / 30**. Suite complète : **256 / 256**.
- Parcours dans le navigateur (base de test, v72) : directeur — tableau de bord et fiche ; chef de projet (profil caissier) — révision préparée, montant inférieur au déjà remis signalé en rouge, soumission ; directeur — pastille « 1 », budget validé, v1 « Remplacé » ; rejet avec motif puis affichage du motif chez le chef de projet ; responsable d'activité sur téléphone — uniquement son activité, sans les financements.

## 5. Déploiement

Aucune migration nouvelle (la 069 doit être jouée). Envoyer le code (backend + `frontend/dist`), redémarrer le serveur, vider le cache du navigateur (Ctrl+Maj+R).

## 6. Suite — lot P3

Justificatifs déposés par les responsables d'activité, validés par le chef de projet ou le comptable (jamais par la personne qui les dépose), annulation par le directeur ; archives par projet et activité ; bilan « activités validées / activités en attente de justification ».

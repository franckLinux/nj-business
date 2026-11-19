# NJ BUSINESS — Lot E : parcours de connexion et validation de la restructuration

**Date :** 19/11/2026 · **Migration :** aucune · **Service Worker :** v69 · **Branche :** `module/commercial`
**Référence :** `docs/AUDIT_AUTH_ENTREPRISE_UTILISATEURS.md`, lot E et décision n° 4. C'est le **dernier lot** de la restructuration NJ BUSINESS (lots A à E).

## 1. Ce qui change pour l'utilisateur

**Après la connexion, tout le monde arrive sur l'accueil NJ BUSINESS** (décision n° 4). Cela vaut même pour une personne qui n'a qu'un seul module, comme un caissier. Avant ce lot, elle entrait directement dans son module. Les comptes du cabinet (super_admin, comptables du cabinet, commerciaux) ne changent pas.

**L'accueil ne montre que ce qui concerne la personne :**
- **« Vos modules » :** les modules auxquels elle est rattachée, avec « Accéder au module ». Le décompte affiche « 1 module à votre disposition ».
- **« Autres modules » :** les modules activés pour l'entreprise mais fermés pour elle, chacun avec sa raison.
  - **Non rattaché(e) :** « Vous n'êtes pas rattaché(e) à ce module. Demandez à votre directeur de vous y ajouter. » Un directeur est invité à contacter le cabinet.
  - **Aucun droit :** le module est activé, mais aucun profil n'est attribué à la personne.
  - **Non activé pour l'entreprise :** lien « Demander l'activation ».
- **Configuration de l'entreprise :** proposée seulement à qui a le droit de la consulter.

**Un message propre à chaque situation :**

| Situation | Message |
|---|---|
| L'entreprise n'a aucun module activé | « Aucun module n'est encore activé pour votre espace. Contactez le cabinet. » |
| Des modules sont activés, aucun n'est attribué à la personne | « Aucun module ne vous est encore attribué. Demandez à votre directeur de vous rattacher au module où vous travaillez. » |
| Accès retiré pendant le travail (`MODULE_NON_AUTORISE`) | Retour immédiat à l'accueil : « Votre accès à NJ CAISSE PRO a été retiré… » |
| Module désactivé pendant le travail (`MODULE_INACTIF`) | Retour immédiat à l'accueil : « NJ COMMERCIAL a été désactivé pour votre espace… » |

Dans les deux derniers cas, les droits sont relus aussitôt, pour que l'accueil corresponde à la nouvelle situation.

**Navigation entre les modules :**
- **Retour à l'accueil :** depuis chaque module, le lien « ‹ Accueil NJ BUSINESS » est en tête du menu ; sur téléphone, il est dans le menu ☰.
- **Caisse pas encore préparée par le directeur :** l'écran « Compte en cours de préparation » propose maintenant **« ‹ Accueil NJ BUSINESS »**, et pas seulement la déconnexion. La personne peut donc aller travailler dans un autre module en attendant.
- **Même session :** passer d'un module à l'autre ne demande pas de se reconnecter et ne crée pas de nouvelle session (lot D).
- **Adresse d'un module fermé :** taper l'adresse d'un module auquel on n'a pas accès ramène à l'accueil. Le serveur refuse de toute façon.

## 2. Fichiers

**Frontend, fichiers modifiés :**
- `src/lib/modules.js` : l'accueil systématique après la connexion.
- `src/pages/AccueilPage.jsx` : messages par situation, caisse non rattachée, décompte.
- `src/App.jsx` : distinction entre accès retiré et module désactivé.
- `src/context/AppContext.jsx` : droits relus quand un module se ferme.
- `src/lib/api.js`
- `src/components/InitialisationCompte.jsx` et `src/components/Layout.jsx` : retour à l'accueil.
- `public/sw.js` (v69)
- `dist/`

**Backend, nouveau fichier :** `tests/parcours-nj-business.test.js`, la validation de bout en bout. Aucune migration, aucun changement du code serveur.

## 3. Rapport de validation des 8 scénarios

Base PostgreSQL 16 jetable, jamais la production. Les vraies connexions sont faites avec le contrôle des sessions et le contrôle par module **appliqués**.

**Tests automatiques : 27 suites, 226 tests, tous passent.** La nouvelle suite `parcours-nj-business` rejoue les 8 scénarios dans l'ordre où une entreprise les vit.

| # | Scénario | Ce qui est vérifié | Résultat |
|---|---|---|---|
| 1 | Client créé sans module | Création par le cabinet avec `modules: []` : ni journaux ni rubriques. Le directeur se connecte : aucun module actif. La configuration de l'entreprise est ouverte ; la caisse est refusée (`MODULE_INACTIF`). | ✅ |
| 2 | Paramètres de la caisse | À l'activation : journaux et rubriques créés. Les paramètres de la caisse sont lisibles et modifiables (signataires), et les signataires n'apparaissent pas dans l'identité de l'entreprise. | ✅ |
| 3 | Comptes du commercial sans caisse | Le directeur crée un vendeur dans le commercial. Dès la connexion : caisse `membre: false`, commercial `membre: true`. Les routes de la caisse sont refusées (`MODULE_NON_AUTORISE`) et le commercial est ouvert. Le vendeur figure dans la liste du commercial, pas dans celle de la caisse. | ✅ |
| 4 | Reprise d'un compte existant | Un caissier sans rattachement est repris dans la caisse seulement, d'après ses droits. Connexion : il est membre de la caisse et ses journaux s'ouvrent. | ✅ |
| 5 | Deuxième appareil | Ordinateur et téléphone sont connectés ensemble. Un deuxième ordinateur est refusé avec le message demandé. Le remplacement déconnecte l'ancien ordinateur (`SESSION_REMPLACEE`) et laisse exactement une session ordinateur et une session téléphone. | ✅ |
| 6 | Changement de module | Le directeur passe par la caisse, les journaux, le commercial, l'entreprise et les utilisateurs du module, avec le même jeton : aucune nouvelle session. | ✅ |
| 7 | Désactivation puis réactivation | Le commercial est désactivé : le vendeur reçoit `MODULE_INACTIF`, sa session reste ouverte et le module est marqué inactif. Après réactivation, l'accès revient et rattachements et profils sont strictement identiques. | ✅ |
| 8 | Isolation entre deux entreprises | Le directeur de B ne voit ni les comptes, ni les membres de module, ni les sessions de A. Fermer une session de A ou rattacher un compte de A lui renvoie 404. Un en-tête `X-Tenant-Id` forgé vers A est sans effet. Le commercial, absent chez B, lui est refusé. | ✅ |

Les suites des lots précédents restent en place et couvrent le détail de chaque scénario :
- `caisse-parametres` : scénarios 1, 2 et 7 ;
- `utilisateurs-modules` : 3, 4 et 8 ;
- `sessions` : 5, 6 et 8 ;
- `entreprise` : lot A.

**Note sur une exécution :** une exécution complète a montré des échecs passagers dans deux suites anciennes (`controle`, `validation-directe`), lancée juste après l'arrêt d'un serveur de test local. Ces deux suites passent seules, puis l'exécution complète suivante a donné 226 sur 226.

**Parcours dans le navigateur** (interface v69 construite, base de test locale, contrôle par module appliqué) : 11 vérifications sur 11 conformes.

| Parcours | Résultat |
|---|---|
| Caissier, un seul module : arrive sur l'accueil (« 1 module à votre disposition »), pas dans la caisse | ✅ |
| Caisse pas encore préparée : « Compte en cours de préparation » propose « ‹ Accueil NJ BUSINESS » | ✅ |
| Retour à l'accueil depuis cet écran | ✅ |
| Entrée dans la caisse une fois préparée | ✅ |
| Retour à l'accueil par le menu | ✅ |
| Vendeur sur téléphone : commercial seul ; caisse dans « Autres modules », avec « pas rattaché(e) » | ✅ |
| Vendeur qui tape l'adresse de la caisse : ramené à l'accueil | ✅ |
| Compte sans aucun module : « Aucun module ne vous est encore attribué… » | ✅ |
| Accès retiré pendant que le caissier travaille : retour à l'accueil, « … a été retiré » | ✅ |
| Directeur : « 2 modules à votre disposition » et configuration de l'entreprise | ✅ |
| Module désactivé pendant que le directeur y travaille : retour à l'accueil, « … a été désactivé » | ✅ |

## 4. Déploiement

1. Il n'y a pas de migration : une sauvegarde de la base n'est pas indispensable pour ce lot, mais elle reste la règle.
2. Mettre à jour `frontend/dist/`. Le backend ne change pas ; seul un fichier de test est ajouté.
3. Ctrl+Maj+R sur l'ordinateur ; sur téléphone, fermer et rouvrir le site (cache v69).
4. **Vérifier :** se connecter avec un compte de caissier. L'accueil doit s'afficher, puis « Accéder au module ».
5. **Si ce n'est pas déjà fait (lot C) :** vérifier les écarts dans Administration plateforme → « Utilisateurs par module », puis cliquer sur « Appliquer le contrôle ». Tant que le contrôle reste en observation, l'accueil montre les modules d'après les droits, comme avant le lot C.

## 5. Fin de la restructuration

| Lot | Contenu | Migration | Cache |
|---|---|---|---|
| A | Configuration centrale de l'entreprise | 064 | v62-v63 |
| B | Client sans module, paramètres propres à la caisse, assistant « Nouveau client » | 065 | v64 |
| C | Utilisateurs par module, reprise des comptes, contrôle par module | 066 | v65 |
| D | Sessions : une par compte et par type d'appareil, remplacement, expiration, révocation | 067, 068 | v66-v68 |
| E | Parcours de connexion, accueil pour tous, validation des 8 scénarios | — | v69 |

**Ce qui reste hors du périmètre :**
- **Jeton dans le navigateur :** il reste dans le stockage local. Le passer en cookie `HttpOnly` serait un chantier à part, à cause du domaine séparé de l'API.
- **Reconnaissance du type d'appareil :** elle repose sur ce que déclare le navigateur (lot D, limite acceptée).

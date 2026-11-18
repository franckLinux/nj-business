# NJ BUSINESS — Lot D : sessions

**Date :** 18/11/2026 · **Migration :** 067 · **Service Worker :** v66 · **Branche :** `module/commercial`
**Référence :** `docs/AUDIT_AUTH_ENTREPRISE_UTILISATEURS.md`, lot D, et la décision n° 3 : bloquer, puis proposer « Fermer l'autre session et me connecter ici », avec une alerte par e-mail.

## 1. Ce qui change pour l'utilisateur

**Connexion depuis un deuxième appareil.** Le compte est déjà ouvert ailleurs, par exemple au bureau.
1. L'écran « Compte déjà connecté » apparaît. Il affiche le message prévu : « Ce compte est déjà connecté sur un autre appareil. Veuillez fermer la session existante avant de vous connecter à nouveau. »
2. Il précise l'appareil, l'heure de connexion et la dernière activité.
3. Deux boutons sont proposés :
   - **« Fermer l'autre session et me connecter ici »**. L'identifiant et le mot de passe déjà saisis sont vérifiés à nouveau par le serveur. L'autre appareil est déconnecté **immédiatement**, et le titulaire reçoit un e-mail : « nouvelle connexion à votre compte… si ce n'est pas vous, changez votre mot de passe ».
   - **Annuler** : rien ne change.

**Sur l'appareil remplacé.** À sa prochaine action, la personne revient à l'écran de connexion avec ce message : « Votre compte a été connecté sur un autre appareil : cette session a été fermée… ». Une saisie hors ligne encore en attente **n'est pas perdue** : elle repart à la reconnexion du même compte.

**Fin de session.** Elle est expliquée chaque fois sur l'écran de connexion :
- inactivité prolongée (60 min par défaut) ;
- durée maximale atteinte (12 h par défaut) ;
- fermeture par un administrateur ;
- mot de passe réinitialisé ;
- déconnexion.

**« Se déconnecter »** ferme vraiment la session sur le serveur. On peut donc se reconnecter tout de suite sur un autre appareil.

**Mon compte.**
- Affiche l'appareil en cours et les dernières sessions.
- Propose un bouton **« Déconnecter tous mes appareils »**.
- Changer son mot de passe ferme les autres sessions éventuelles.

**Directeur, dans les écrans Utilisateurs de NJ CAISSE PRO et de NJ COMMERCIAL.** Une section **« Connectés maintenant »** liste les personnes connectées : appareil, adresse IP, heure de connexion, dernière activité. Le bouton **Fermer** déconnecte une personne, avec un motif facultatif.

**Administration plateforme (super_admin) → Sessions.**
- Réglage du **délai d'inactivité** et de la **durée maximale**.
- Liste des connectés sur toute la plateforme, avec le client de chacun.

## 2. Règles de gestion

1. **Une seule session active par compte.** La base le garantit par un index unique partiel. Le serveur l'assure aussi par un verrou par compte. Six connexions simultanées au même compte : **une seule** est acceptée (testé).
2. **Le jeton porte l'identifiant de sa session** (`sid`), et le serveur contrôle la session **à chaque requête**. Une session fermée, remplacée, révoquée ou expirée rend son jeton inutilisable immédiatement, sans attendre son expiration.
3. **Remplacer exige le mot de passe.** Le refus (`SESSION_ACTIVE`) ne délivre aucun jeton. Le remplacement est une nouvelle connexion complète avec `remplacer: true`. Un mauvais mot de passe ne ferme rien.
4. **Expiration.** Elle intervient après une inactivité de 60 min ou une durée de 12 h, toutes deux réglables :
   - 5 min à 24 h pour l'inactivité ;
   - 30 min à 7 jours pour la durée maximale.

   Le jeton ne vit pas plus longtemps que la session. Une session périmée ne bloque jamais une nouvelle connexion.
5. **Changer de module** (caisse, commercial, configuration de l'entreprise) **ne crée pas de session.** Un super_admin qui change de client n'en crée pas non plus.
6. **Sessions fermées d'office :**
   - mot de passe changé : les autres sessions sont fermées, la session en cours reste ouverte ;
   - mot de passe réinitialisé, par l'administrateur ou par le lien « mot de passe oublié » : toutes les sessions sont fermées ;
   - compte désactivé : toutes les sessions sont fermées.
7. **Isolation.**
   - Un directeur ne voit et ne ferme que les sessions de **son** entreprise ; une autre session donne 404.
   - Il ne peut pas fermer sa propre session depuis cette liste : il passe par « Se déconnecter ».
   - La liste exige le droit `users.edit`, parce qu'elle montre des adresses IP.
   - Un caissier ne la voit pas.
8. **Un jeton ne peut pas emprunter la session d'un autre compte.** La session doit appartenir au compte du jeton.
9. **Traçabilité** dans le journal d'audit, entité `session` :
   - `SESSION_OUVERTURE`, `SESSION_REFUSEE` (deuxième appareil), `SESSION_REMPLACEMENT`, `SESSION_FERMETURE`, `SESSION_REVOCATION` (avec son auteur et son motif), `SESSIONS_REGLAGES` ;
   - l'historique des sessions est conservé dans la table : une session n'est jamais supprimée, seulement terminée.
10. **File hors ligne (PWA) :**
    - une saisie est rejouée avec le jeton **actuel**, et non plus avec celui enregistré au moment de la saisie ;
    - elle n'est rejouée que pour le compte qui l'a faite ;
    - un refus 401 la laisse en file, au lieu de la marquer en erreur ;
    - elle repart après la reconnexion.

**Pourquoi pas de jeton de rafraîchissement** (refresh token tournant) ? Le contrôle de la session côté serveur à chaque requête donne déjà ce que la rotation apporte : une révocation immédiate et une détection du remplacement. La dernière activité est notée au plus une fois par minute, ce qui coûte une lecture indexée par requête. Le jeton reste dans le navigateur comme avant (stockage local) ; un passage en cookie `HttpOnly` serait un chantier à part, qui touche le CORS du domaine séparé de l'API.

## 3. Base de données (migration 067)

- **`sessions`** :
  - colonnes : `id` (uuid), `user_id`, `tenant_id`, `statut` (`active`, `fermee`, `expiree`, `remplacee`, `revoquee`), `cree_le`, `derniere_activite`, `expire_le`, `ip`, `appareil`, `navigateur`, `terminee_le`, `terminee_par`, `motif_fin` ;
  - contrainte : une session active n'a pas de date de fin, et une session terminée en a une ;
  - **index unique** `uq_sessions_une_active (user_id) WHERE statut = 'active'`.
- **`plateforme_reglages`** contient `sessions` = `{"inactivite_min": 60, "duree_max_min": 720}`.
- La migration est additive et idempotente.
- Retour arrière : `db/migrations-retour-arriere/067_retour_arriere.sql`.

## 4. API

| Route | Droit | Rôle |
|---|---|---|
| `POST /api/auth/login` `{ username, password, remplacer? }` | — | 409 `SESSION_ACTIVE` `{ session: { appareil, depuis, derniere_activite } }` ; avec `remplacer: true`, ferme l'autre session |
| `POST /api/auth/deconnexion` | connecté | ferme la session du jeton |
| `POST /api/auth/deconnexion-globale` | connecté | ferme toutes ses sessions |
| `GET /api/auth/sessions` | connecté | ses sessions récentes, avec la session courante signalée |
| `GET /api/sessions` | `users.edit` | sessions actives de l'entreprise ; super_admin sans client choisi : toute la plateforme |
| `DELETE /api/sessions/:id` `{ motif? }` | `users.edit` | fermer la session d'une personne |
| `GET`/`PUT /api/plateforme/sessions` | super_admin | délai d'inactivité et durée maximale |

**Refus 401 avec un code :** `SESSION_REMPLACEE`, `SESSION_REVOQUEE`, `SESSION_EXPIREE`, `SESSION_FERMEE`, `SESSION_INVALIDE` (jeton sans session ou d'un autre compte). L'interface affiche le message sur l'écran de connexion.

**Variables d'environnement :**
- `SESSIONS_CONTROLE` : `appliquer` par défaut. `observer` ne refuse rien ; il sert de retour arrière rapide, sans toucher à la base.
- `LOGIN_RATE_MAX` : nombre de tentatives de connexion par IP et par 15 min, 10 par défaut.

## 5. Fichiers

**Backend, nouveaux fichiers :**
- `db/migrations/067_sessions.sql`
- `db/migrations-retour-arriere/067_retour_arriere.sql`
- `src/services/sessions.service.js`
- `src/controllers/sessions.controller.js`
- `tests/sessions.test.js`

**Backend, fichiers modifiés :**
- `src/controllers/auth.controller.js` (connexion, mot de passe, déconnexion)
- `src/middleware/auth.js` (contrôle de la session)
- `src/controllers/users.controller.js` (désactivation, réinitialisation)
- `src/validators/auth.validator.js`
- `src/routes/index.js`
- `index.js` (`LOGIN_RATE_MAX`)
- `.env.example`

**Frontend, nouveau fichier :** `src/components/SessionsOuvertes.jsx`.

**Frontend, fichiers modifiés :**
- `src/pages/LoginPage.jsx`
- `src/context/AppContext.jsx`
- `src/lib/api.js`
- `src/lib/syncManager.js`
- `src/components/MouvementModal.jsx`
- `src/components/MonCompteModal.jsx`
- `src/components/config/UsersTab.jsx`
- `src/pages/commercial/UtilisateursPage.jsx`
- `src/pages/PlateformePage.jsx`
- `src/styles/nj-business.css`
- `src/styles/utilisateurs-module.css`
- `public/sw.js` (v66)
- `dist/`

## 6. Tests

**Backend : 26 suites, 217 tests, tous passent**, sur une base PostgreSQL 16 jetable (jamais la production).

La nouvelle suite `sessions` (9 tests) couvre :
- le **scénario 5** :
  - deuxième appareil refusé avec son message, sans jeton, la session existante restant intacte ;
  - remplacement refusé avec un mauvais mot de passe ;
  - remplacement accepté avec le bon : l'ancien jeton est refusé aussitôt (`SESSION_REMPLACEE`) ;
  - le journal d'audit est complet ;
- les connexions simultanées : six en parallèle, une seule acceptée ;
- le changement de module, caisse, commercial et entreprise, sans nouvelle session ;
- l'expiration par inactivité et par durée maximale, sans blocage d'une nouvelle connexion ;
- la déconnexion, tous les appareils, le jeton sans session, le jeton portant la session d'un autre compte ;
- mes sessions, la liste du directeur, la révocation avec son auteur, l'isolation entre entreprises (404), un caissier sans accès, la vue du super_admin ;
- le mot de passe réinitialisé ou changé, le compte désactivé puis réactivé ;
- les réglages, avec leurs bornes et la durée du jeton égale à la durée maximale ;
- la migration rejouable, et le refus par la base d'une deuxième session active.

Les autres suites tournent en mode `observer`, le défaut quand `NODE_ENV=test` : leurs jetons de test sans session restent acceptés.

**Navigateur :**
- connexion sur un PC, puis sur un téléphone : l'écran « Compte déjà connecté » s'affiche ;
- on choisit « Fermer l'autre session et me connecter ici » : le téléphone est connecté ;
- le PC revient à l'écran de connexion, avec le message de remplacement.

## 7. Déploiement

1. **Sauvegarder la base.**
2. Mettre le code à jour, puis redémarrer : la 067 est jouée.
3. **Tout le monde doit se reconnecter une fois.** Les jetons émis avant la mise à jour ne portent pas de session ; ils sont refusés avec le message « Votre session n'est plus valable (mise à jour de sécurité). Reconnectez-vous. » À faire de préférence en dehors des heures de caisse.
4. Ctrl+Maj+R (cache v66).
5. **Vérifier :** se connecter sur deux navigateurs avec le même compte, puis contrôler la section « Connectés maintenant ».
6. **Retour arrière rapide** en cas de souci : `SESSIONS_CONTROLE=observer` dans le `.env`, puis redémarrer. Plus rien n'est refusé.
7. **Envoi des alertes de remplacement :** le SMTP du `.env` doit être configuré, comme pour « mot de passe oublié ».

## 8. Points restant à traiter

- **Lot E : parcours de connexion**, l'accueil pour tous (décision n° 4) et la vérification de l'ensemble des scénarios.
- Lot des périodicités du budget : mensuel, trimestriel, semestriel, annuel, en plus de l'hebdomadaire.

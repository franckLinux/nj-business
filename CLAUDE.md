# Instructions pour Claude — dépôt NJ BUSINESS

NJ BUSINESS est un ERP multi-clients et multi-modules (NJ CAISSE PRO, NJ COMMERCIAL, puis NJ CG, NJ DSF, NJ REVIS, NJ RH). Le code est publié sur GitHub : **https://github.com/franckLinux/nj-business** (remote `origin`). La branche de travail est `module/commercial`. Langue de travail : français.

## Règle permanente : chaque version validée part sur GitHub

Dès qu'une livraison est terminée et vérifiée, Claude enregistre **et publie** les changements, sans attendre qu'on le lui redemande :

1. **Vérifier avant d'enregistrer.**
   - Faire passer les tests concernés (`backend/tests`, sur une base de test, **jamais** la production).
   - Vérifier les fichiers modifiés avec `node --check`.
   - Si le frontend a changé : incrémenter le cache du Service Worker (`frontend/public/sw.js`) puis lancer `npm run build`. Le dossier `frontend/dist` est versionné, car l'hébergeur ne compile rien.
2. **Contrôler ce qui part.** Le dépôt est **public**. Ne jamais commiter :
   - `.env` ou tout autre secret (mots de passe, jetons, clés) ;
   - `sauvegardes/`, `backend/uploads/`, `backend/prive/` ;
   - des archives `.zip`, ou des données réelles de clients.
   Le `.gitignore` les exclut déjà : ne pas le contourner (`git add -f` interdit).
3. **Commiter** sur la branche courante, avec un message en français qui dit ce qui change (module, lot, numéro de migration et version du Service Worker le cas échéant). Exemple : `NJ COMMERCIAL lot 9 : factures clients — migration 064, v62`.
4. **Publier** : `git push origin HEAD`. Pour une nouvelle branche : `git push -u origin <branche>`.
5. **Dire à Franck** ce qui a été publié (commits, branche). Si l'envoi échoue (réseau, authentification), le lui signaler clairement, sans réessayer en boucle : le commit reste en local et partira au prochain envoi.

Ne jamais faire `git push --force` ni réécrire l'historique publié sans l'accord explicite de Franck.

### Selon l'endroit où Claude travaille

- **Claude Code sur le PC de Franck** : `git push` utilise ses identifiants GitHub (Git Credential Manager). L'envoi se fait directement.
- **Session claude.ai reliée au dossier** : commiter dans le dossier. Si l'envoi n'est pas possible depuis la session, laisser le commit prêt : le crochet `post-commit` du PC (ci-dessous) ou un simple `git push` de Franck l'enverra.

### Envoi automatique à chaque commit

Le crochet versionné `.githooks/post-commit` envoie chaque nouveau commit vers GitHub, quel qu'en soit l'auteur (Claude ou Franck).
- Il est actif grâce à `git config core.hooksPath .githooks`, déjà réglé sur ce dossier. Sur un nouveau PC ou un nouveau clone, relancer cette commande.
- Le désactiver : `git config --unset core.hooksPath`.
- En cas d'échec (pas de réseau, pas de connexion GitHub), le commit reste en local : il partira au prochain `git push` ou au prochain commit.

## Rappels techniques

- Migrations : additives, idempotentes, avec script de retour arrière dans `backend/db/migrations-retour-arriere/`. Ne jamais toucher aux données de caisse.
- Les `tenant_id` viennent toujours du jeton, jamais des paramètres du client.
- Erreurs : jamais de `catch` silencieux ; échouer franchement.
- Après un déploiement : redémarrer le serveur, puis vider le cache du navigateur (Ctrl+Maj+R).

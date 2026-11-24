# Audit sécurité — étape 1 : fermer les failles (24/11/2026)

Suite du rapport d'audit du 20/11/2026 (sécurité, charge, dimensionnement 10 000 utilisateurs).
Migration **073**, Service Worker **v79**. Aucune donnée de caisse touchée.

## Ce qui change

| Constat | Avant | Après |
| --- | --- | --- |
| S36 — pièces justificatives publiques | Servies en statique sur `/uploads/<client>/<écriture>/<fichier>` : un lien suffisait, sans connexion | Dossier privé. Une pièce ne sort que par `GET /api/pieces/fichier/:id` : jeton valide, même client, permission `pieces.view`. L'ancien lien `/uploads/…` répond 404 |
| S35 — type de fichier non vérifié | Le type MIME annoncé par le navigateur faisait foi | Le type est lu dans le contenu (signature PDF, JPG, PNG, WEBP) ; un faux PDF est refusé. Nom de fichier nettoyé |
| R1 — bibliothèques vulnérables | 9 alertes serveur dont 1 critique | `express` 4.22.3, `qs` 6.16.2, `nodemailer` 10.6.1 (testé contre un serveur SMTP local) ; plus aucune alerte critique ni haute côté serveur |
| R2 — sauvegardes | Copies en clair sur le PC, pas de sauvegarde automatique | `backend/tools/sauvegarde.sh` : dump quotidien compressé et chiffré (AES-256), relu après écriture, 30 jours gardés |
| Message d'erreur d'envoi | Le message technique était renvoyé à l'utilisateur | Message générique ; le détail reste dans les journaux du serveur |

Alertes restantes, volontairement non traitées ici : `uuid` (via Sequelize, fonction non utilisée), et côté interface `vite`/`esbuild` (outil de construction, jamais livré aux utilisateurs) et `react-router` (aucune navigation vers une adresse saisie par l'utilisateur). Montées de version majeures prévues à l'étape 3.

## Fichiers

- `backend/index.js` : le dossier des pièces n'est plus servi ; `/uploads/*` → 404 JSON.
- `backend/src/services/storage.service.js` : `urlFichier`, `cheminComplet`, `typeReel`.
- `backend/src/controllers/pieces.controller.js` : envoi contrôlé sur le contenu, nouvelle lecture `fichier`.
- `backend/src/routes/index.js` : `GET /pieces/fichier/:pieceId`.
- `backend/db/migrations/073_pieces_privees.sql` + retour arrière : les adresses enregistrées deviennent `/api/pieces/fichier/<id>`. Les fichiers ne bougent pas sur le disque.
- `frontend/src/components/PiecesModal.jsx` : la pièce s'ouvre par l'API avec le jeton.
- `backend/tools/sauvegarde.sh`, `backend/.env.example` (`SAUVEGARDE_CLE`, `SAUVEGARDE_DIR`, `SAUVEGARDE_JOURS`).
- `backend/tests/pieces-privees.test.js` (`npm run test:pieces-privees`).

## Mise en ligne (PlanetHoster, sans terminal)

1. Transférer `backend/` (dont `package.json` et `package-lock.json`) et `frontend/dist/`.
2. Dans le gestionnaire d'application Node.js du panneau : **installer les modules** (nodemailer passe en version 10, Node 20 minimum requis).
3. Redémarrer l'application : la migration 073 est jouée au démarrage si `AUTO_SETUP=true`, sinon par `GET /api/admin/setup` avec le `SETUP_TOKEN`. Repasser ensuite `AUTO_SETUP=false`.
4. Ctrl+Maj+R dans le navigateur.
5. Vérifier : ouvrir une pièce depuis l'application (elle s'affiche), puis ouvrir son ancien lien `/uploads/…` dans une fenêtre privée (404).

## Sauvegarde quotidienne

1. Ajouter `SAUVEGARDE_CLE` (24 caractères au moins) dans le `.env` de production, et la ranger aussi dans un gestionnaire de mots de passe : sans elle, les sauvegardes sont illisibles.
2. Panneau PlanetHoster → Tâches cron → tous les jours à 2 h 15 :
   `bash /home/<compte>/<dossier-app>/backend/tools/sauvegarde.sh >> /home/<compte>/sauvegarde.log 2>&1`
3. Le lendemain, vérifier la ligne `[Sauvegarde] OK` dans `sauvegarde.log`. Le script échoue franchement si `pg_dump` est absent ou si le fichier ne se relit pas.
4. Restauration (sur une base vide) : voir l'en-tête du script.

## Copies de la base sur le PC

Les dumps de `caisse-pro/sauvegardes/` sont en clair. Les chiffrer avec la même phrase secrète depuis Git Bash, puis supprimer les originaux :

```bash
cd sauvegardes
read -s -p "Phrase secrète : " SAUVEGARDE_CLE; export SAUVEGARDE_CLE; echo
for f in *.sql *.sql.gz; do
  openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass env:SAUVEGARDE_CLE -in "$f" -out "$f.enc" && echo "chiffré : $f.enc"
done
```

## Vérification

- 283 tests sur base de test, tous réussis : les 279 existants et les 4 nouveaux (`pieces-privees`). `commercial-ventes` demande un rôle PostgreSQL superutilisateur (`session_replication_role`).
- Migration 073 jouée, rejouée (idempotente), retour arrière testé.
- `node --check` sur les fichiers modifiés ; build de l'interface.

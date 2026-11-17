# NJ BUSINESS

**ERP de gestion d'entreprises pour la zone CEMAC / OHADA**, conçu par le Cabinet NGAN JEAN (expertise comptable, Yaoundé).

NJ BUSINESS est une plateforme **multi-clients** (multi-tenant), avec une connexion unique et une page d'accueil qui présente un module par carte. L'identité de chaque entreprise (raison sociale, logo, références légales, représentant légal) se configure une seule fois, dans le socle, indépendamment des modules activés. Le cabinet active pour chaque client entreprise les modules dont il a besoin, et le serveur contrôle les droits de chaque utilisateur, module par module.

En production : [nj-business.net](https://nj-business.net)

---

## Modules

| Module | Rôle | État |
|---|---|---|
| **NJ CAISSE PRO** | Trésorerie : journaux de caisse, de banque et de Mobile Money, budgets mensuels ou hebdomadaires, appels de fonds, validation des dépassements, arrêtés et inventaires de caisse, contrôle comptable, passerelle vers SAGE (SYSCOHADA / SYCEBNL) | En production |
| **NJ COMMERCIAL** | Achats, stock et ventes (détail ci-dessous) | En développement avancé |
| **NJ CG** | Contrôle de gestion : budgets, tableaux de bord, indicateurs, analyse des écarts | Prévu |
| **NJ DSF** | Déclaration statistique et fiscale : liasse SYSCOHADA, annexes, contrôles de cohérence | Prévu |
| **NJ REVIS** | Révision des comptes : dossier de travail, cycles, feuilles maîtresses | Prévu |
| **NJ RH** | Dossiers salariés et paie | Prévu |

### NJ COMMERCIAL en détail

- **Organisation** : la société se divise en agences, et chaque agence en magasins. On y retrouve aussi les familles et articles, les unités de mesure et leurs conversions, et les taxes. Chaque utilisateur reçoit un ou plusieurs types de gestion (achats, ventes, stock), distincts de son rôle hiérarchique.
- **Achats**, de bout en bout :
  - demande d'achat, avec stock disponible et stock de sécurité ;
  - validation par le responsable des achats ;
  - consultation de plusieurs fournisseurs, qui répondent en ligne par lien personnel, sans compte ;
  - comparaison des offres article par article ;
  - un ou plusieurs bons de commande par demande, avec PDF et QR code de vérification ;
  - réception avec bon de livraison scanné ;
  - frais d'achat (transport, douane…) intégrés au coût réel ;
  - facture fournisseur saisie par le comptable, rapprochée de la commande et de la réception.
- **Stock** :
  - valorisation au CMUP ou en FIFO, par rejeu déterministe des mouvements ;
  - entrées, sorties, transferts et inventaires ;
  - le stock ne bouge qu'à la validation des documents, et jamais par leur auteur.
- **Ventes** :
  - devis validés par le responsable commercial, puis par la direction au-delà d'un seuil ;
  - commandes clients ;
  - préparations, puis livraisons qui sortent le stock.

---

## Architecture

| Couche | Technologies |
|---|---|
| Backend | Node.js, Express 4, Sequelize (requêtes SQL explicites), JWT, bcrypt, Helmet, rate limiting, PDFKit, Nodemailer |
| Base de données | PostgreSQL 14+, migrations SQL idempotentes avec scripts de retour arrière |
| Frontend | React 18, Vite 5, React Router, Chart.js, PWA (Service Worker) |
| Mobile | Ionic + Vue (application Android pour les tableaux de bord) |

```
backend/     API Express : src/ (routes, contrôleurs, services, middleware), db/ (migrations, retours arrière, plans comptables), tests/, tools/
frontend/    Application React (src/), build de production versionné dans dist/
docs/        Notes de livraison de chaque lot
DEPLOIEMENT.md  Déploiement sur l'hébergement (cPanel / Passenger)
```

**Principes :**
- **Isolation des clients** : le client est toujours lu dans le jeton, jamais dans la requête. En base, des déclencheurs refusent tout lien entre deux clients.
- **Une seule source d'autorisation** : les permissions sont en base. Rôle, profil métier, types de gestion, exceptions individuelles et plafond par client sont résolus côté serveur ; l'interface affiche les mêmes droits.
- **Traçabilité** : chaque décision et chaque modification sensible va dans un journal d'audit qu'on ne peut ni modifier ni effacer.
- **Migrations prudentes** : elles sont additives, rejouables sans effet, accompagnées d'un script de retour arrière, et ne touchent jamais aux données de caisse.

---

## Installation (développement)

Prérequis : Node.js 18 ou plus, PostgreSQL 14 ou plus.

```bash
# Backend
cd backend
npm install
cp .env.example .env          # puis renseigner DATABASE_URL, JWT_SECRET…
npm run db:schema             # schéma + toutes les migrations
npm run db:plan               # plans comptables SYSCOHADA / SYCEBNL
npm run db:seed               # compte administrateur
npm run dev                   # http://localhost:3000

# Frontend (dans un autre terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173 (les appels /api vont au backend)
```

Mettre `DEMO_COMMERCIAL=true` dans le `.env` crée au démarrage un client de démonstration NJ COMMERCIAL, avec des données fictives.

Détails : [`backend/README.md`](backend/README.md), [`frontend/README.md`](frontend/README.md), [`DEPLOIEMENT.md`](DEPLOIEMENT.md).

## Tests

Les tests d'intégration lancent un vrai serveur sur une **base de test dédiée**. Ne les lancez jamais sur la base de production.

```bash
cd backend
TEST_DATABASE_URL=postgres://…/base_de_test node --test tests/
```

Il y a 23 suites et 193 tests, qui couvrent la caisse, la passerelle comptable, le contrôle, les budgets, les permissions, la configuration de l'entreprise et tout NJ COMMERCIAL.

## Déploiement

1. Construire le frontend en local (`cd frontend && npm run build`) et commiter `frontend/dist` : l'hébergeur ne compile rien.
2. Déployer, puis redémarrer le backend. Les migrations en attente sont jouées au démarrage.
3. À chaque version du frontend, le cache du Service Worker change de nom. Les utilisateurs rechargent avec Ctrl+Maj+R.

---

## Licence

© Cabinet NGAN JEAN — tous droits réservés. Ce code est consultable publiquement, mais il n'est pas distribué sous licence libre : toute réutilisation demande l'accord du Cabinet.

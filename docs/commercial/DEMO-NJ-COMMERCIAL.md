# Compte de démonstration NJ COMMERCIAL

Script : `backend/tools/demo-commercial.js`.

## Lancer sans terminal (cPanel / Passenger)

1. Déployer le backend et le dist, comme d'habitude.
2. Dans le `.env` du serveur :
   ```
   DEMO_COMMERCIAL=true
   DEMO_MOT_DE_PASSE=Nkolo-Demo-2026!
   ```
   (garder `AUTO_SETUP=true` si c'est par lui que les migrations sont jouées : la démo est alors créée juste après elles).
3. Redémarrer l'application (« Restart » dans Setup Node.js App).
4. Se connecter avec `demo.directeur` et ce mot de passe. Le journal de l'application affiche `[Démo] ✅ Démonstration prête` (jamais le mot de passe).
5. Remettre `DEMO_COMMERCIAL=false`, vider `DEMO_MOT_DE_PASSE`, redémarrer.

Aux démarrages suivants, si la démo existe déjà, rien ne se passe.

## Lancer avec un terminal (dans le dossier backend)

```
DEMO_MOT_DE_PASSE='…' node tools/demo-commercial.js
```

Sans `DEMO_MOT_DE_PASSE`, un mot de passe est tiré au hasard et affiché une seule fois. Prérequis : migrations jusqu'à 059 jouées, `APP_URL` présent dans `.env`.

## Ce qui est créé

- Un client **fictif** séparé : « DÉMO — Ets Nkolo Distribution (fictif) », identifiant `demo-nj-commercial`, NJ COMMERCIAL activé (NJ CAISSE PRO reste actif, comme pour tout client : le directeur passe par l'accueil NJ BUSINESS ; les autres comptes entrent directement dans NJ COMMERCIAL).
- Huit comptes, même mot de passe, notifications « plateforme » seulement (aucun e-mail) :
  `demo.directeur`, `demo.demandeur`, `demo.achats`, `demo.respachats`, `demo.magasinier`, `demo.stock`, `demo.commercial`, `demo.respcommercial`.
- Paramétrage : 2 agences, 2 magasins (Yaoundé, Douala), 6 unités, TVA 19,25 %, 3 fournisseurs, 4 clients, 4 familles (dont une en FIFO et une de prestations), 10 articles.
- Stock d'ouverture, dont une ligne sans coût (« à valoriser ») et des articles sous le seuil d'alerte.
- Achats : demandes à tous les stades (approuvées, à autoriser par la direction, à examiner, brouillon), 2 bons émis, une réception validée et une à valider, une facture fournisseur validée.
- Stock : transfert, entrée, sortie et inventaire validés ; une sortie à valider.
- Ventes : 8 devis (brouillon, à valider, direction, validé, accepté, refusé), 3 commandes (livrée, livrée en partie, à livrer), une livraison préparée qui attend sa validation.

Tout passe par les services de l'application (mêmes contrôles et séparations des tâches) ; aucune donnée n'est écrite directement en base hors création du client et des comptes.

## Sécurité

Le script ne touche à aucun autre client. Il s'arrête sans rien modifier si le client `demo-nj-commercial` ou l'un des comptes `demo.*` existe déjà. Pour fermer la démo : Plateforme › client › Suspendre (un client qui a des mouvements de stock se suspend, il ne se supprime pas).

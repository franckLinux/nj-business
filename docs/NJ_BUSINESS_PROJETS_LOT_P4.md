# NJ CAISSE PRO — Projets des ONG et associations — Lot P4
## Remise globale, lignes budgétaires à justifier, utilisation lisible

*20/11/2026 — migration 071, Service Worker v75 — branche `module/commercial`.*
*Suite aux remarques de Franck sur le lot P3 (écran Activités).*

---

## 1. Les trois remarques et les décisions

| Remarque | Décision (20/11/2026) | Réponse |
|---|---|---|
| « 50 000 alloués, 45 000 utilisés, l'application affiche 100 % de consommation » | — | La colonne mesurait *remis ÷ budget*. Elle est remplacée par **Remis · Utilisé (justifié) · Utilisation · Reste à justifier**. Exemple : remis 50 000, utilisé 45 000 → « 90 % du remis utilisé », reste à justifier 5 000. |
| « La sortie de caisse ne permet pas d'allouer un budget global à un projet et/ou une activité » | Projet **ou** activité | Dans le journal, chaque projet propose « ◆ Remise globale au projet » en plus de ses activités. |
| « Pouvoir mettre, dans le budget, les lignes budgétaires de l'activité à justifier » | Lignes **facultatives** ; dépassement **bloqué** | Dans le budget, « ＋ ligne » sous une activité (pause café, déjeuner, transport…). Le justificatif choisit sa ligne ; au-delà du budget de la ligne, le dépôt est refusé. |

## 2. Remise de fonds globale ou par activité

- **Au projet** (remise globale) : plafonnée par le budget total validé − tout ce qui a déjà été remis sur le projet.
- **À une activité** : plafonnée par le budget de l'activité − déjà remis à l'activité, **et** par le reste du projet.
- Les deux sont hors budget de fonctionnement (contrôle par rubrique, plafond de caisse, budget hebdomadaire, disponible, contrôle hors ligne).
- Un budget révisé ne peut descendre ni sous ce qui a été remis à une activité, ni (au total) sous tout ce qui a été remis sur le projet.

**Justification d'une remise globale.** Les dépenses sont toujours justifiées par activité (et par ligne). Une activité couvre d'abord les fonds qui lui ont été remis en direct ; ce qu'elle justifie au-delà vient en déduction de la remise globale. La fiche projet montre la remise globale à part (remis, justifié via les activités, reste à justifier) ; le bilan lui donne une ligne, au nom du chef de projet. Une activité financée uniquement par la remise globale apparaît « Justifiée (remise globale) ».

## 3. Lignes budgétaires

- Dans le budget, une activité peut se détailler en lignes (libellé + montant) ; son montant devient la **somme de ses lignes**.
- Chaque ligne a une **clé stable**, recopiée d'une version du budget à la suivante : une révision garde les justificatifs sur leur ligne.
- Une ligne ne peut pas descendre sous ce qui y est justifié ou déposé ; une ligne qui porte des justificatifs ne peut pas être retirée.
- Fiche projet, onglet Activités : sous chaque activité, ses lignes avec budget, utilisé, à contrôler et reste.

## 4. Dépôt d'un justificatif

- Activité avec lignes : la ligne est **obligatoire** ; le reste de la ligne est affiché ; au-delà, **dépôt refusé** (écran et serveur, `DEPASSEMENT_LIGNE`).
- Activité sans lignes : même plafond, sur le budget de l'activité.
- Les pièces déposées (à contrôler) et validées comptent dans le plafond ; les rejetées et annulées non. Verrou par activité contre deux dépôts simultanés.

## 5. Fichiers

| Fichier | Rôle |
|---|---|
| `backend/db/migrations/071_projets_lignes_budgetaires.sql` (+ retour arrière) | Table `projet_budget_postes`, `poste_cle` / `poste_libelle` sur les justificatifs |
| `backend/src/services/projets.service.js` | Remise globale, plafonds projet / activité, exclusion du fonctionnement |
| `backend/src/services/projets_gestion.service.js` | Situation des projets (remise globale, lignes), budget avec lignes |
| `backend/src/services/projets_justificatifs.service.js` | Ligne obligatoire, blocage du dépassement, bilan avec remise globale |
| `frontend/src/pages/ProjetPage.jsx` | Budget avec lignes, activités (Remis · Utilisé · Reste à justifier), remise globale |
| `frontend/src/components/MouvementModal.jsx` | « ◆ Remise globale au projet » dans le journal |
| `frontend/src/components/projets/Justificatifs.jsx`, `pages/ProjetsBilanPage.jsx` | Ligne justifiée, plafond, bilan |
| `backend/tests/projets-p4.test.js` | 7 scénarios ; `projets-p1` adapté (la remise globale est désormais permise) |

## 6. Vérifications

- Projets P1 à P4 : **46 / 46**. Suite complète : **272 / 272**.
- Migration rejouée, retour arrière puis nouvelle application : sans erreur.
- Parcours dans le navigateur (v75), sur le cas signalé : budget « Atelier » détaillé en 4 lignes (dont « Logistique pour participant » 50 000) ; remise globale de 300 000 et remise de 50 000 à l'activité dans le journal ; dépôt de 60 000 sur la ligne refusé, 45 000 accepté puis validé → Atelier : remis 50 000, utilisé 45 000, « 90 % du remis utilisé », reste à justifier 5 000.

## 7. Déploiement

Sauvegarde, envoi du code (backend + `frontend/dist`), `node db/migrate.js` (applique la 071), redémarrage, Ctrl+Maj+R.

**Données existantes.** Les activités créées pour contourner l'absence de lignes (ex. « Pause café », « Pause déjeuner », « Transport » comme activités séparées) restent valables. Pour passer au nouveau modèle : créer l'activité mère, préparer une révision du budget avec ses lignes, puis désactiver les anciennes activités une fois leurs fonds justifiés.

## 8. Complément — suppression d'un projet ou d'une activité (20/11/2026)

Remarque de Franck : « on ne peut pas supprimer les projets créés ».

| Action | Qui | Possible si | Sinon |
|---|---|---|---|
| **Supprimer un projet** (fiche → « 🗑 Supprimer ») | Direction (`projets.gerer`) | Aucun financement reçu, aucune écriture du journal (même annulée) sur le projet ou ses activités, aucune sortie en attente, aucun justificatif. Les activités et **tous** les budgets du projet (même validés) partent avec lui. | Message clair : « … ne peut pas être supprimé : 1 financement reçu, 1 écriture du journal… Clôturez-le ». |
| **Supprimer une activité** (fenêtre de l'activité → « 🗑 Supprimer ») | Direction ou chef du projet | Mêmes conditions, et l'activité n'est dans aucun budget soumis ou validé (un brouillon suffit à la retirer). | « … Désactivez-la ». |

Chaque suppression est tracée dans `audit_log` (`DELETE_PROJET`, `DELETE_ACTIVITE_PROJET`, avec le nom, les activités et les budgets supprimés). Les garde-fous en base des budgets restent actifs : seule la transaction de suppression d'un projet sans mouvement les lève.

Tests : 2 scénarios ajoutés à `projets-p4` (11 au total) ; suite complète **274 / 274**. Service Worker v76. Pas de migration.

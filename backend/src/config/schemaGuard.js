// src/config/schemaGuard.js
// ─────────────────────────────────────────────────────────────────────────
// Garde-fou de schéma joué à CHAQUE démarrage, avant l'ouverture du port.
//
// Pourquoi : les modèles Sequelize listent explicitement leurs colonnes.
// Si le code est déployé AVANT la migration correspondante (cas vécu avec
// la colonne `nui` de la migration 030 : « column "nui" does not exist »),
// toute lecture/écriture du journal tombe en erreur 500.
//
// Ce garde-fou rejoue uniquement les ajouts de colonnes/tables dont le code
// dépend, en SQL idempotent (IF NOT EXISTS). Il ne remplace pas
// `node db/migrate.js` : la migration reste la source de vérité et peut être
// jouée ensuite sans conflit.
// ─────────────────────────────────────────────────────────────────────────
const { pool } = require('./database');

const STATEMENTS = [
  // 030 — C18 : NUI du tiers sur les écritures
  `ALTER TABLE journal            ADD COLUMN IF NOT EXISTS nui TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE mouvements_attente ADD COLUMN IF NOT EXISTS nui TEXT NOT NULL DEFAULT ''`,
  // 030 — C9 : réinitialisation du mot de passe
  `CREATE TABLE IF NOT EXISTS password_resets (
     id          BIGSERIAL PRIMARY KEY,
     user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     token_hash  TEXT NOT NULL UNIQUE,
     expire_le   TIMESTAMPTZ NOT NULL,
     utilise_le  TIMESTAMPTZ,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id)`,
  // 031 — coordonnées de l'entité imprimées sur les documents
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telephone TEXT DEFAULT ''`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email     TEXT DEFAULT ''`,
  `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS site_web  TEXT DEFAULT ''`,
  // 032 — jour d'ouverture des caisses
  `ALTER TABLE journaux ADD COLUMN IF NOT EXISTS date_ouverture DATE`,
  // 033 — écritures de rattrapage (antidatées)
  `ALTER TABLE journal ADD COLUMN IF NOT EXISTS rattrapage BOOLEAN NOT NULL DEFAULT false`,
  // 034 — activités / projets (les permissions sont posées par la migration)
  `CREATE TABLE IF NOT EXISTS activites (
     id SERIAL PRIMARY KEY,
     tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     code VARCHAR(20) NOT NULL DEFAULT '',
     nom VARCHAR(120) NOT NULL,
     type VARCHAR(10) NOT NULL DEFAULT 'activite' CHECK (type IN ('activite', 'projet')),
     description TEXT NOT NULL DEFAULT '',
     budget NUMERIC(15,2), date_debut DATE, date_fin DATE,
     actif BOOLEAN NOT NULL DEFAULT true,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_activites_nom ON activites (tenant_id, lower(nom))`,
  `ALTER TABLE journal            ADD COLUMN IF NOT EXISTS activite_id INTEGER REFERENCES activites(id) ON DELETE SET NULL`,
  `ALTER TABLE mouvements_attente ADD COLUMN IF NOT EXISTS activite_id INTEGER REFERENCES activites(id) ON DELETE SET NULL`,
  // 035 — demande de validation des démos (lue par les listes de prospects)
  `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS demo_validation_demandee_le  TIMESTAMPTZ`,
  `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS demo_validation_demandee_par UUID REFERENCES users(id) ON DELETE SET NULL`,
  // 036 — libellé du prospect dans le journal des validations (si 035 est passée)
  `DO $$ BEGIN
     IF to_regclass('public.prospect_validations') IS NOT NULL THEN
       ALTER TABLE prospect_validations ADD COLUMN IF NOT EXISTS prospect_libelle TEXT NOT NULL DEFAULT '';
     END IF;
   END $$`,
  // 040 — budget hebdomadaire : colonne semaine lue par les modèles du budget
  `ALTER TABLE budget             ADD COLUMN IF NOT EXISTS semaine SMALLINT`,
  `ALTER TABLE budget_validation  ADD COLUMN IF NOT EXISTS semaine SMALLINT`,
  `ALTER TABLE budget_caisse      ADD COLUMN IF NOT EXISTS semaine SMALLINT`,
  `ALTER TABLE depenses_attente   ADD COLUMN IF NOT EXISTS semaine SMALLINT`,
  `ALTER TABLE ressources_attente ADD COLUMN IF NOT EXISTS semaine SMALLINT`,
  // 044 — tiers du registre sur l'écriture (colonne lue par le modèle Mouvement).
  // Le rattachement automatique (trigger) et les permissions restent dans la migration.
  `DO $$ BEGIN
     IF to_regclass('public.registre_tiers') IS NOT NULL THEN
       ALTER TABLE journal ADD COLUMN IF NOT EXISTS tiers_id BIGINT REFERENCES registre_tiers(id) ON DELETE SET NULL;
     ELSE
       ALTER TABLE journal ADD COLUMN IF NOT EXISTS tiers_id BIGINT;
     END IF;
   END $$`,
  // 046 — validation des arrêtés : la table est lue par l'arrêt / la réouverture
  // de caisse. Le trigger de protection et les inventaires restent dans la migration.
  `CREATE TABLE IF NOT EXISTS controles_arrets (
     id BIGSERIAL PRIMARY KEY,
     tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
     journal_id INTEGER NOT NULL REFERENCES journaux(id) ON DELETE CASCADE,
     mois TEXT NOT NULL, annee INTEGER NOT NULL,
     arret_id INTEGER REFERENCES arrets_caisse(id) ON DELETE SET NULL,
     solde_arrete NUMERIC(15,2), solde_constate NUMERIC(15,2),
     observation TEXT NOT NULL DEFAULT '' CHECK (length(observation) <= 2000),
     statut TEXT NOT NULL DEFAULT 'a_valider' CHECK (statut IN ('a_valider', 'validee')),
     pv_nom TEXT, pv_path TEXT, pv_mime TEXT, pv_taille BIGINT, pv_sha256 TEXT,
     pv_depose_par UUID REFERENCES users(id) ON DELETE SET NULL, pv_depose_le TIMESTAMPTZ,
     cree_par UUID REFERENCES users(id) ON DELETE SET NULL, cree_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     modifie_par UUID REFERENCES users(id) ON DELETE SET NULL, modifie_le TIMESTAMPTZ,
     valide_par UUID REFERENCES users(id) ON DELETE SET NULL, valide_le TIMESTAMPTZ,
     annule_par UUID REFERENCES users(id) ON DELETE SET NULL, annule_le TIMESTAMPTZ,
     motif_annulation TEXT NOT NULL DEFAULT '',
     UNIQUE (tenant_id, journal_id, mois, annee)
   )`,
];

async function ensureSchema() {
  let ok = 0;
  for (const sql of STATEMENTS) {
    try {
      await pool.query(sql);
      ok += 1;
    } catch (err) {
      // On n'arrête jamais le démarrage : on signale clairement quoi faire.
      console.error(`[Schema] Échec : ${sql.split('\n')[0].trim()} → ${err.message}`);
      console.error('[Schema] Lancez « node db/migrate.js » avec un utilisateur propriétaire des tables.');
    }
  }
  console.log(`[Schema] Garde-fou : ${ok}/${STATEMENTS.length} instruction(s) vérifiée(s).`);
}

module.exports = { ensureSchema };

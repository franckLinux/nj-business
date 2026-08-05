-- db/setup-database.sql
-- Création du rôle et de la base CaissePro.
-- À exécuter en tant que superutilisateur PostgreSQL (postgres).
-- Idempotent : peut être relancé sans risque.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'caissepro') THEN
    CREATE ROLE caissepro WITH LOGIN PASSWORD 'Pass1234';
    RAISE NOTICE 'Rôle caissepro créé.';
  ELSE
    ALTER ROLE caissepro WITH LOGIN PASSWORD 'Pass1234';
    RAISE NOTICE 'Rôle caissepro existant : mot de passe mis à jour.';
  END IF;
END $$;

-- CREATE DATABASE ne peut pas vivre dans un bloc DO : on le génère via \gexec.
SELECT 'CREATE DATABASE caissepro OWNER caissepro ENCODING ''UTF8'''
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'caissepro')
\gexec

\connect caissepro

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

GRANT ALL PRIVILEGES ON DATABASE caissepro TO caissepro;
GRANT ALL ON SCHEMA public TO caissepro;
ALTER SCHEMA public OWNER TO caissepro;

\echo ''
\echo '=== Base caissepro prête ==='

#!/usr/bin/env bash
# ============================================================================
# tools/sauvegarde.sh — Sauvegarde quotidienne CHIFFRÉE de la base NJ BUSINESS
# (audit sécurité du 20/11/2026, constat R2).
#
# Produit  : $SAUVEGARDE_DIR/nj-business-AAAA-MM-JJ_HHMM.sql.gz.enc
#            (pg_dump → gzip → AES-256, clé dérivée de SAUVEGARDE_CLE par PBKDF2)
# Garde    : les SAUVEGARDE_JOURS derniers jours (30 par défaut), supprime les plus anciennes.
# Lit      : DATABASE_URL et SAUVEGARDE_CLE dans backend/.env (jamais en argument :
#            un argument est visible dans la liste des process).
#
# PlanetHoster : panneau → Tâches cron → chaque jour à 2 h 15 :
#     bash /home/<compte>/<dossier-app>/backend/tools/sauvegarde.sh >> /home/<compte>/sauvegarde.log 2>&1
#
# Restaurer (sur une base VIDE, jamais sur la production en service) :
#     openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in FICHIER.sql.gz.enc -pass env:SAUVEGARDE_CLE \
#       | gunzip | psql "$DATABASE_URL_DE_LA_BASE_VIDE"
#
# Échoue franchement (code de sortie non nul) à la moindre erreur : un cron
# muet qui « réussit » sans rien sauvegarder est le pire cas.
# ============================================================================
set -euo pipefail
umask 077

ICI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FICHIER="${ENV_FICHIER:-$ICI/../.env}"
[ -f "$ENV_FICHIER" ] || { echo "[Sauvegarde] ÉCHEC : $ENV_FICHIER introuvable." >&2; exit 1; }

lire() { { grep -E "^$1=" "$ENV_FICHIER" || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"; }
DATABASE_URL="${DATABASE_URL:-$(lire DATABASE_URL)}"
SAUVEGARDE_CLE="${SAUVEGARDE_CLE:-$(lire SAUVEGARDE_CLE)}"
SAUVEGARDE_DIR="${SAUVEGARDE_DIR:-$(lire SAUVEGARDE_DIR)}"
SAUVEGARDE_DIR="${SAUVEGARDE_DIR:-$HOME/sauvegardes-nj-business}"
SAUVEGARDE_JOURS="${SAUVEGARDE_JOURS:-$(lire SAUVEGARDE_JOURS)}"
SAUVEGARDE_JOURS="${SAUVEGARDE_JOURS:-30}"

[ -n "$DATABASE_URL" ] || { echo "[Sauvegarde] ÉCHEC : DATABASE_URL absente." >&2; exit 1; }
[ "${#SAUVEGARDE_CLE}" -ge 24 ] || { echo "[Sauvegarde] ÉCHEC : SAUVEGARDE_CLE absente ou trop courte (24 caractères minimum)." >&2; exit 1; }
for outil in pg_dump gzip openssl; do
  command -v "$outil" >/dev/null || { echo "[Sauvegarde] ÉCHEC : $outil introuvable sur ce serveur." >&2; exit 1; }
done

mkdir -p "$SAUVEGARDE_DIR"
case "$SAUVEGARDE_DIR" in */public_html*|*/www*) echo "[Sauvegarde] ÉCHEC : le dossier ne doit pas être servi par le web ($SAUVEGARDE_DIR)." >&2; exit 1;; esac

HORO="$(date +%Y-%m-%d_%H%M)"
CIBLE="$SAUVEGARDE_DIR/nj-business-$HORO.sql.gz.enc"
TEMP="$CIBLE.partiel"
trap 'rm -f "$TEMP"' EXIT

export SAUVEGARDE_CLE
pg_dump --no-owner --no-privileges "$DATABASE_URL" \
  | gzip -9 \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass env:SAUVEGARDE_CLE -out "$TEMP"

# Contrôle : le fichier se déchiffre et contient la fin d'un dump complet.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:SAUVEGARDE_CLE -in "$TEMP" | gunzip | tail -c 2000 \
  | grep -q "PostgreSQL database dump complete" \
  || { echo "[Sauvegarde] ÉCHEC : le fichier produit ne se relit pas correctement." >&2; exit 1; }

mv "$TEMP" "$CIBLE"
trap - EXIT
TAILLE="$(du -h "$CIBLE" | cut -f1)"
find "$SAUVEGARDE_DIR" -maxdepth 1 -name 'nj-business-*.sql.gz.enc' -type f -mtime +"$SAUVEGARDE_JOURS" -print -delete \
  | sed 's/^/[Sauvegarde] supprimée (plus de '"$SAUVEGARDE_JOURS"' jours) : /'
echo "[Sauvegarde] OK $(date '+%Y-%m-%d %H:%M') — $CIBLE ($TAILLE)"

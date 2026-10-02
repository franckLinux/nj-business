<#
  Ce script a été retiré : il faisait doublon avec les commandes documentées
  dans backend/README.md (section « Installation rapide »), sans être aligné
  sur le chemin de code utilisé en production (GET /api/admin/setup), ce qui
  créait un risque de dérive entre poste local et déploiement.

  Remplacement — deux commandes, valables sur toute plateforme :

      psql -U postgres -h localhost -f db/setup-database.sql   # rôle + base
      npm run db:setup                                          # schéma + migrations + plan comptable + super admin

  Voir backend/README.md, section « Installation rapide », étapes 2 et 4.
  Pour un mot de passe postgres perdu (Windows) : backend/tools/reset-pg-password.ps1.
#>

Write-Host "Ce script a ete retire. Utilisez :"
Write-Host "  psql -U postgres -h localhost -f db\setup-database.sql"
Write-Host "  npm run db:setup"
Write-Host "Details : backend\README.md, section Installation rapide."
exit 1

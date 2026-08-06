<#
  setup-db.ps1 — Initialisation complète de la base CaissePro (Windows)

  Utilisation (PowerShell) :
      .\tools\setup-db.ps1

  Le script :
    1. localise psql.exe (PATH ou installations standard PostgreSQL)
    2. crée le rôle « caissepro » et la base « caissepro »
    3. applique schema.sql + toutes les migrations
    4. crée le compte super admin

  Le mot de passe du superutilisateur « postgres » vous sera demandé.
#>

$ErrorActionPreference = 'Stop'

# Le script vit dans tools/ mais pilote le projet : on se place à la racine du
# dépôt et on référence les fichiers absolument, pour qu'il fonctionne quel que
# soit le répertoire depuis lequel il est appelé.
$root   = Split-Path -Parent $PSScriptRoot
$sqlDir = Join-Path $root 'backend\db'
Set-Location $root

function Find-Psql {
    $cmd = Get-Command psql.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = Get-ChildItem 'C:\Program Files\PostgreSQL','C:\Program Files (x86)\PostgreSQL' `
                    -ErrorAction SilentlyContinue |
                  Sort-Object Name -Descending |
                  ForEach-Object { Join-Path $_.FullName 'bin\psql.exe' } |
                  Where-Object { Test-Path $_ }

    if ($candidates) { return $candidates[0] }
    return $null
}

Write-Host "`n=== CaissePro - initialisation de la base ===" -ForegroundColor Cyan

$psql = Find-Psql
if (-not $psql) {
    Write-Host "`npsql.exe est introuvable." -ForegroundColor Red
    Write-Host "PostgreSQL n'est probablement pas installe sur cette machine."
    Write-Host "Telechargez-le ici : https://www.postgresql.org/download/windows/"
    Write-Host "Puis relancez ce script."
    exit 1
}
Write-Host "psql trouve : $psql" -ForegroundColor Green

# --- 1. Role + base -------------------------------------------------------
$superuser = Read-Host "Utilisateur superadmin PostgreSQL [postgres]"
if ([string]::IsNullOrWhiteSpace($superuser)) { $superuser = 'postgres' }

$securePwd = Read-Host "Mot de passe de '$superuser'" -AsSecureString
$plainPwd  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePwd))
$env:PGPASSWORD = $plainPwd

Write-Host "`n[1/3] Creation du role et de la base..." -ForegroundColor Cyan
& $psql -U $superuser -h localhost -p 5432 -d postgres -v ON_ERROR_STOP=1 -f (Join-Path $sqlDir 'setup-database.sql')
if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    Write-Host "Echec de la creation de la base. Verifiez que le service PostgreSQL est demarre." -ForegroundColor Red
    exit 1
}
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

# --- 2. Schema + migrations ----------------------------------------------
Write-Host "`n[2/3] Application du schema et des migrations..." -ForegroundColor Cyan
npm run db:schema
if ($LASTEXITCODE -ne 0) { Write-Host "Echec des migrations." -ForegroundColor Red; exit 1 }

# --- 3. Super admin -------------------------------------------------------
Write-Host "`n[3/3] Creation du compte super admin..." -ForegroundColor Cyan
npm run db:seed
if ($LASTEXITCODE -ne 0) { Write-Host "Echec du seed." -ForegroundColor Red; exit 1 }

Write-Host "`n=== Termine ===" -ForegroundColor Green
Write-Host "Base       : caissepro (utilisateur caissepro)"
Write-Host "Connexion  : admin / Admin2026!  -> a changer des la premiere connexion"
Write-Host "`nDemarrer l'application :  npm run dev`n"

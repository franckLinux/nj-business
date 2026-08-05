<#
  reset-pg-password.ps1 — Réinitialise le mot de passe du superutilisateur
  PostgreSQL lorsqu'il a été perdu.

  À LANCER DANS UNE POWERSHELL "EXECUTER EN TANT QU'ADMINISTRATEUR" :
      .\reset-pg-password.ps1

  Principe (technique officielle PostgreSQL) :
    1. sauvegarde de pg_hba.conf
    2. passage temporaire des connexions locales en mode "trust"
    3. redemarrage du service, connexion sans mot de passe, ALTER USER
    4. RESTAURATION de pg_hba.conf et redemarrage  <-- toujours execute

  Le fichier pg_hba.conf est systematiquement restaure, meme en cas d'erreur.
#>

param(
    [string]$NewPassword = 'Pass1234',
    [string]$Superuser   = 'postgres'
)

$ErrorActionPreference = 'Stop'

function Fail($msg) { Write-Host "`n[ECHEC] $msg" -ForegroundColor Red; exit 1 }

Write-Host "`n=== Reinitialisation du mot de passe PostgreSQL ===" -ForegroundColor Cyan

# --- 0. Droits administrateur --------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] `
            [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Fail "Ce script doit etre lance dans une PowerShell ouverte en tant qu'Administrateur.`n        (clic droit sur PowerShell > Executer en tant qu'administrateur)"
}

# --- 1. Service PostgreSQL ------------------------------------------------
$svc = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $svc) { Fail "Aucun service PostgreSQL trouve. PostgreSQL est-il installe ?" }
Write-Host "Service    : $($svc.Name) [$($svc.Status)]" -ForegroundColor Green

# --- 2. Dossier de donnees (extrait de la ligne de commande du service) ---
$imagePath = (Get-CimInstance Win32_Service -Filter "Name='$($svc.Name)'").PathName
$dataDir = $null
if ($imagePath -match '-D\s+"([^"]+)"') { $dataDir = $Matches[1] }
elseif ($imagePath -match '-D\s+(\S+)') { $dataDir = $Matches[1] }

if (-not $dataDir -or -not (Test-Path $dataDir)) {
    $guess = Get-ChildItem 'C:\Program Files\PostgreSQL' -ErrorAction SilentlyContinue |
             Sort-Object Name -Descending |
             ForEach-Object { Join-Path $_.FullName 'data' } |
             Where-Object { Test-Path (Join-Path $_ 'pg_hba.conf') } |
             Select-Object -First 1
    $dataDir = $guess
}
if (-not $dataDir) { Fail "Dossier de donnees PostgreSQL introuvable." }

$hba = Join-Path $dataDir 'pg_hba.conf'
if (-not (Test-Path $hba)) { Fail "pg_hba.conf introuvable dans $dataDir" }
Write-Host "Donnees    : $dataDir" -ForegroundColor Green

# --- 3. psql.exe ----------------------------------------------------------
$psql = (Get-Command psql.exe -ErrorAction SilentlyContinue).Source
if (-not $psql) {
    $psql = Get-ChildItem 'C:\Program Files\PostgreSQL' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'bin\psql.exe' } |
            Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $psql) { Fail "psql.exe introuvable." }
Write-Host "psql       : $psql" -ForegroundColor Green

# --- 4. Sauvegarde --------------------------------------------------------
$backup = "$hba.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $hba $backup -Force
Write-Host "Sauvegarde : $backup" -ForegroundColor Green

$restored = $false
try {
    # --- 5. Passage en mode trust ----------------------------------------
    Write-Host "`n[1/3] Passage temporaire en authentification 'trust'..." -ForegroundColor Cyan
    $lines = Get-Content $hba
    $patched = $lines | ForEach-Object {
        if ($_ -match '^\s*(local|host|hostssl|hostnossl)\s') {
            $_ -replace '(scram-sha-256|md5|password|peer|ident|sspi|gss)\s*$', 'trust'
        } else { $_ }
    }
    Set-Content -Path $hba -Value $patched -Encoding ASCII

    Restart-Service -Name $svc.Name -Force
    Start-Sleep -Seconds 5

    # --- 6. Changement du mot de passe -----------------------------------
    Write-Host "[2/3] Definition du nouveau mot de passe..." -ForegroundColor Cyan
    $escaped = $NewPassword -replace "'", "''"
    & $psql -U $Superuser -h localhost -d postgres -v ON_ERROR_STOP=1 `
            -c "ALTER USER `"$Superuser`" WITH PASSWORD '$escaped';"
    if ($LASTEXITCODE -ne 0) { throw "ALTER USER a echoue." }
}
finally {
    # --- 7. Restauration systematique ------------------------------------
    Write-Host "[3/3] Restauration de pg_hba.conf..." -ForegroundColor Cyan
    Copy-Item $backup $hba -Force
    Restart-Service -Name $svc.Name -Force
    Start-Sleep -Seconds 5
    $restored = $true
    Write-Host "pg_hba.conf restaure, service redemarre." -ForegroundColor Green
}

# --- 8. Verification ------------------------------------------------------
$env:PGPASSWORD = $NewPassword
& $psql -U $Superuser -h localhost -d postgres -tAc "SELECT 'ok';" | Out-Null
$ok = ($LASTEXITCODE -eq 0)
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

if ($ok) {
    Write-Host "`n=== Termine ===" -ForegroundColor Green
    Write-Host "Utilisateur : $Superuser"
    Write-Host "Mot de passe: $NewPassword"
    Write-Host "`nEnchainez avec :  .\setup-db.ps1`n"
} else {
    Fail "Le nouveau mot de passe n'est pas accepte. Sauvegarde conservee : $backup"
}

Write-Host "Running PostgreSQL migrations..." -ForegroundColor Cyan
node .\scripts\run_migrations.js

if ($LASTEXITCODE -ne 0) {
  Write-Host "Migration run failed." -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host "Migrations complete." -ForegroundColor Green

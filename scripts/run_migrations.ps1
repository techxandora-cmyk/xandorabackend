# run_migrations.ps1
# Applies SQL files from ./migrations into the running MySQL Docker container.
# Keeps a simple schema_migrations table to avoid re-applying files.

Write-Host "🚀 Migration runner starting..." -ForegroundColor Cyan

# Find MySQL container id (computed at runtime)
$CID = (docker ps --filter "ancestor=mysql:8.0" -q)
if (-not $CID) {
  Write-Host "❌ MySQL container not running! Start Docker / containers and try again." -ForegroundColor Red
  exit 1
}

# Ensure database exists (guard)
docker exec -i $CID mysql -uroot -prootpass -e "CREATE DATABASE IF NOT EXISTS middleware_db;"

# Ensure schema_migrations table for tracking
docker exec -i $CID mysql -uroot -prootpass -D middleware_db -e "
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(255) NOT NULL UNIQUE,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"

# Apply each .sql that hasn't been applied yet
$files = Get-ChildItem -Path .\migrations -Filter "*.sql" -ErrorAction SilentlyContinue | Sort-Object Name
if (-not $files) {
  Write-Host "No migrations found in ./migrations" -ForegroundColor Yellow
  exit 0
}

foreach ($f in $files) {
  $name = $f.Name
  # check if already applied
  $check = docker exec -i $CID mysql -uroot -prootpass -D middleware_db -se "SELECT filename FROM schema_migrations WHERE filename = '${name}' LIMIT 1;"
  if ($check -and $check.Trim() -ne "") {
    Write-Host "⏭ Skipping ${name} (already applied)" -ForegroundColor DarkYellow
    continue
  }

  Write-Host "Applying ${name} ..." -ForegroundColor Yellow
  # stream file into mysql inside container
  Get-Content $f.FullName -Raw | docker exec -i $CID mysql -uroot -prootpass -D middleware_db
  if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error applying ${name}. Check Docker / MySQL logs and the SQL file." -ForegroundColor Red
    exit 2
  }

  # record as applied
  docker exec -i $CID mysql -uroot -prootpass -D middleware_db -se "INSERT INTO schema_migrations (filename) VALUES ('${name}');"
  Write-Host "✅ Applied ${name}" -ForegroundColor Green
}

Write-Host "🎉 All migrations processed." -ForegroundColor Cyan

param(
  [Parameter(Mandatory = $true)]
  [string]$ProductsFile,
  [Parameter(Mandatory = $true)]
  [string]$EpcMapFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-File {
  param([string]$PathValue)
  if (-not (Test-Path -LiteralPath $PathValue)) {
    throw "File not found: $PathValue"
  }
}

function Assert-Array {
  param(
    [object]$Value,
    [string]$Name
  )
  if ($null -eq $Value -or -not ($Value -is [System.Collections.IEnumerable])) {
    throw "$Name must be a JSON array."
  }
}

Assert-File $ProductsFile
Assert-File $EpcMapFile

$repoRoot = Split-Path -Parent $PSScriptRoot
$targetProducts = Join-Path $repoRoot "backend\data\products.json"
$targetEpcMap = Join-Path $repoRoot "backend\data\epc_map.json"

$productsRaw = Get-Content -LiteralPath $ProductsFile -Raw
$epcMapRaw = Get-Content -LiteralPath $EpcMapFile -Raw

$products = $productsRaw | ConvertFrom-Json
$epcMap = $epcMapRaw | ConvertFrom-Json

Assert-Array -Value $products -Name "products"
Assert-Array -Value $epcMap -Name "epc_map"

foreach ($p in $products) {
  if (-not $p.sku -or -not $p.name) {
    throw "Each product requires at least: sku, name"
  }
}

foreach ($m in $epcMap) {
  if (-not $m.epc -or -not $m.sku) {
    throw "Each epc_map row requires: epc, sku"
  }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($targetProducts, $productsRaw, $utf8NoBom)
[System.IO.File]::WriteAllText($targetEpcMap, $epcMapRaw, $utf8NoBom)

Write-Host "Updated demo data files:" -ForegroundColor Green
Write-Host " - $targetProducts"
Write-Host " - $targetEpcMap"
Write-Host ""
Write-Host "Restart demo to load new data." -ForegroundColor Cyan

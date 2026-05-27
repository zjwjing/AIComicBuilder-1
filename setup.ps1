# AI Comic Builder — Windows Environment Setup
# Run: powershell -ExecutionPolicy Bypass -File setup.ps1

Write-Host "=== AI Comic Builder Environment Setup ===" -ForegroundColor Cyan

# Node.js version check
$nodeVer = node --version 2>$null
if (-not $nodeVer) {
    Write-Host "ERROR: Node.js not found. Install Node.js 20+ from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "Node.js: $nodeVer" -ForegroundColor Green

# pnpm check
$pnpmVer = pnpm --version 2>$null
if (-not $pnpmVer) {
    Write-Host "Installing pnpm globally..." -ForegroundColor Yellow
    npm install -g pnpm
    if (-not $?) { exit 1 }
    $pnpmVer = pnpm --version
}
Write-Host "pnpm: $pnpmVer" -ForegroundColor Green

# Install dependencies with frozen lockfile (once lockfile exists)
if (Test-Path "pnpm-lock.yaml") {
    Write-Host "Installing dependencies (frozen lockfile)..." -ForegroundColor Yellow
    pnpm install --frozen-lockfile
} else {
    Write-Host "No lockfile found. Generating pnpm-lock.yaml..." -ForegroundColor Yellow
    pnpm install
}
if (-not $?) { exit 1 }

# Generate Drizzle client
if (Test-Path "drizzle.config.ts") {
    Write-Host "Generating Drizzle client..." -ForegroundColor Yellow
    npx drizzle-kit generate 2>$null
}

Write-Host "=== Setup complete ===" -ForegroundColor Cyan
Write-Host "Run 'pnpm run dev' to start the dev server." -ForegroundColor Green

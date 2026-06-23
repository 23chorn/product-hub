# First-run setup for Product Automation Pipeline
# Usage: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ROOT

Write-Host "========================================"
Write-Host "  Product Automation Pipeline - Setup"
Write-Host "========================================"
Write-Host ""

# ---- 1. Environment file ----
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "[OK] Created .env from .env.example"
    Write-Host "     Edit .env to configure your AI provider and API keys."
} else {
    Write-Host "[SKIP] .env already exists"
}

# ---- 2. Install dependencies ----
Write-Host ""
Write-Host "Installing npm dependencies..."
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
Write-Host "[OK] Dependencies installed"

# ---- 3. Build shared types ----
Write-Host ""
Write-Host "Building shared types..."
Push-Location "app/shared"
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "shared build failed" }
Pop-Location
Write-Host "[OK] Shared types built"

# ---- 4. Initialize SQLite database ----
Write-Host ""
$sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
if ($sqlite) {
    if (-not (Test-Path "db")) { New-Item -ItemType Directory -Path "db" | Out-Null }
    sqlite3 db/product-ops.db ".read db/schema.sql"
    Write-Host "[OK] Database initialized from db/schema.sql"
} else {
    Write-Host "[WARN] sqlite3 CLI not found - skipping database init."
    Write-Host "       The app will create the database on first run, but you can also"
    Write-Host "       install sqlite3 and re-run this script."
}

# ---- 5. Seed context files ----
Write-Host ""
Get-ChildItem "context/*.example.md" -ErrorAction SilentlyContinue | ForEach-Object {
    $target = "context/" + ($_.Name -replace '\.example\.md$', '.md')
    if (-not (Test-Path $target)) {
        Copy-Item $_.FullName $target
        Write-Host "[OK] Created $target from $($_.Name)"
    } else {
        Write-Host "[SKIP] $target already exists"
    }
}

# ---- 6. Check for Ollama ----
Write-Host ""
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollama) {
    $ver = & ollama --version 2>&1
    Write-Host "[OK] Ollama found: $ver"
    Write-Host "     Pull a model if you haven't: ollama pull llama3.2:1b"
} else {
    Write-Host "[INFO] Ollama not found."
    Write-Host "       Install from https://ollama.com if you want to use the free local provider."
    Write-Host "       Otherwise set AI_PROVIDER=anthropic in .env and add your API key."
}

# ---- Done ----
Write-Host ""
Write-Host "========================================"
Write-Host "  Setup complete!"
Write-Host ""
Write-Host "  Next steps:"
Write-Host "    1. Edit .env with your preferred AI provider"
Write-Host "    2. Edit context/company.md and context/strategy.md"
Write-Host "       with your product details (see CUSTOMIZING.md)"
Write-Host "    3. Run: npm run dev"
Write-Host "========================================"

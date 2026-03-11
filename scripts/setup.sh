#!/usr/bin/env bash
# First-run setup for Product Automation Pipeline
# Usage: ./scripts/setup.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "========================================"
echo "  Product Automation Pipeline — Setup"
echo "========================================"
echo ""

# ---- 1. Environment file ----
if [ ! -f .env ]; then
  cp .env.example .env
  echo "[OK] Created .env from .env.example"
  echo "     Edit .env to configure your AI provider and API keys."
else
  echo "[SKIP] .env already exists"
fi

# ---- 2. Install dependencies ----
echo ""
echo "Installing npm dependencies..."
npm install
echo "[OK] Dependencies installed"

# ---- 3. Build shared types ----
echo ""
echo "Building shared types..."
cd app/shared && npm run build && cd "$ROOT"
echo "[OK] Shared types built"

# ---- 4. Initialize SQLite database ----
echo ""
if command -v sqlite3 &>/dev/null; then
  mkdir -p db
  sqlite3 db/product-ops.db < db/schema.sql
  echo "[OK] Database initialized from db/schema.sql"
else
  echo "[WARN] sqlite3 CLI not found — skipping database init."
  echo "       The app will create the database on first run, but you can also"
  echo "       install sqlite3 and re-run this script."
fi

# ---- 5. Seed agent config ----
echo ""
if [ ! -f agents/config.yaml ]; then
  cp agents/config.example.yaml agents/config.yaml
  echo "[OK] Created agents/config.yaml from config.example.yaml"
  echo "     Edit it to set your name, project, and preferences."
else
  echo "[SKIP] agents/config.yaml already exists"
fi

# ---- 7. Seed context files ----
echo ""
for example_file in context/*.example.md; do
  [ -f "$example_file" ] || continue
  target="context/$(basename "$example_file" .example.md).md"
  if [ ! -f "$target" ]; then
    cp "$example_file" "$target"
    echo "[OK] Created $target from $(basename "$example_file")"
  else
    echo "[SKIP] $target already exists"
  fi
done

# ---- 8. Check for Ollama ----
echo ""
if command -v ollama &>/dev/null; then
  OLLAMA_VERSION=$(ollama --version 2>&1 || true)
  echo "[OK] Ollama found: $OLLAMA_VERSION"
  echo "     Pull a model if you haven't: ollama pull llama3.2:1b"
else
  echo "[INFO] Ollama not found."
  echo "       Install from https://ollama.com if you want to use the free local provider."
  echo "       Otherwise set AI_PROVIDER=anthropic in .env and add your API key."
fi

# ---- Done ----
echo ""
echo "========================================"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "    1. Edit .env with your preferred AI provider"
echo "    2. Edit context/company.md and context/strategy.md"
echo "       with your product details (see CUSTOMIZING.md)"
echo "    3. Run: npm run dev"
echo "========================================"

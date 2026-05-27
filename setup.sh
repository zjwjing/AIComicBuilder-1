#!/usr/bin/env bash
# AI Comic Builder — Unix Environment Setup
# Run: bash setup.sh
set -euo pipefail

echo "=== AI Comic Builder Environment Setup ==="

# Node.js version check
if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js not found. Install Node.js 20+ from https://nodejs.org"
    exit 1
fi
echo "Node.js: $(node --version)"

# pnpm check
if ! command -v pnpm &>/dev/null; then
    echo "Installing pnpm globally..."
    npm install -g pnpm
fi
echo "pnpm: $(pnpm --version)"

# Install dependencies with frozen lockfile
if [ -f "pnpm-lock.yaml" ]; then
    echo "Installing dependencies (frozen lockfile)..."
    pnpm install --frozen-lockfile
else
    echo "No lockfile found. Generating pnpm-lock.yaml..."
    pnpm install
fi

# Generate Drizzle client if config exists
if [ -f "drizzle.config.ts" ]; then
    echo "Generating Drizzle client..."
    npx drizzle-kit generate 2>/dev/null || true
fi

echo "=== Setup complete ==="
echo "Run 'pnpm run dev' to start the dev server."

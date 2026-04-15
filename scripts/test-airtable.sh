#!/usr/bin/env bash
# Quick local test for the Airtable fetch script.
# Loads .env and runs fetch-airtable.js

set -euo pipefail

ENV_FILE="$(dirname "$0")/../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Missing .env file. Copy the template and fill in your credentials:"
  echo "   cp .env.example .env"
  exit 1
fi

# Export vars from .env (skip comments and blank lines)
set -a
grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$' | while IFS= read -r line; do
  export "$line"
done
set +a

# Source it properly so vars are available
export $(grep -v '^\s*#' "$ENV_FILE" | grep -v '^\s*$' | xargs)

echo "🔄 Running Airtable fetch..."
node "$(dirname "$0")/fetch-airtable.js"

echo ""
echo "✅ Done! Check data/extraescolares.json"

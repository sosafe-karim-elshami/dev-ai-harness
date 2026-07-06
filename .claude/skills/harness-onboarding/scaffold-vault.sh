#!/usr/bin/env bash
# Scaffold a per-dev Harness knowledge vault from the shared templates.
# Usage: scaffold-vault.sh <vault-dir>
#   <vault-dir> is the target "Harness" folder (e.g. inside the dev's Obsidian vault).
# Idempotent: creates missing folders/files, never overwrites existing notes.
# Records nothing itself — the caller writes vaultPath into config.json.
set -euo pipefail

VAULT="${1:-}"
if [[ -z "$VAULT" ]]; then
  echo "usage: scaffold-vault.sh <vault-dir>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TPL="$REPO_ROOT/definitions/vault-templates"
DATE="$(date +%F)"

if [[ ! -d "$TPL" ]]; then
  echo "template dir not found: $TPL" >&2
  exit 1
fi

mkdir -p "$VAULT"/{memory,meetings,digests,monitoring,knowledge}

# render <template> <dest> — copy with {{DATE}} substituted, skip if dest exists
render() {
  local src="$1" dest="$2"
  if [[ -e "$dest" ]]; then
    echo "skip (exists): ${dest#$VAULT/}"
    return
  fi
  sed "s/{{DATE}}/$DATE/g" "$src" > "$dest"
  echo "created: ${dest#$VAULT/}"
}

render "$TPL/index.md"          "$VAULT/index.md"
render "$TPL/how-this-works.md" "$VAULT/How this works.md"
render "$TPL/memory-index.md"   "$VAULT/memory/index.md"

echo
echo "Vault scaffolded at: $VAULT"
echo "Next: record it in config.json →"
echo "  jq --arg p \"$VAULT\" '.vaultPath=\$p' ~/.claude/sosafe-harness/config.json > /tmp/c.json && mv /tmp/c.json ~/.claude/sosafe-harness/config.json"

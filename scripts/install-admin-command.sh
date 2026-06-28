#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$SCRIPT_DIR/cloudflare-access-email.sh"
TARGET_DIR="${DIFY_RAG_ADMIN_BIN_DIR:-/usr/local/bin}"
TARGET="$TARGET_DIR/rag-access-email"

if [[ ! -f "$SOURCE" ]]; then
  echo "Error: $SOURCE not found." >&2
  exit 1
fi

if [[ ! -d "$TARGET_DIR" ]]; then
  mkdir -p "$TARGET_DIR"
fi

if [[ ! -w "$TARGET_DIR" ]]; then
  echo "$TARGET_DIR is not writable. Trying sudo..."
  sudo ln -sf "$SOURCE" "$TARGET"
else
  ln -sf "$SOURCE" "$TARGET"
fi

echo "Installed: $TARGET"
echo
echo "Usage:"
echo "  rag-access-email list"
echo "  rag-access-email add user@example.com"
echo "  rag-access-email remove user@example.com"

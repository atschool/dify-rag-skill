#!/usr/bin/env bash
#
# dify-rag-skill installer
#
# 実行すると以下を行います:
#   1. ~/.claude/skills/ に投入skillと検索skillを配置
#   2. pdftoppm (poppler) の有無をチェック
#   3. Dify設定を対話式に config へ書き込む
#
# 使い方:  ./install.sh
#
set -euo pipefail

INJECT_SKILL_DIR="$HOME/.claude/skills/dify-rag-inject"
SEARCH_SKILL_DIR="$HOME/.claude/skills/dify-rag-search"
CONFIG_DIR="$HOME/.dify-rag"
CONFIG_FILE="$CONFIG_DIR/config"
MCP_SERVER_DIR="$CONFIG_DIR/mcp-server"
GATEWAY_DIR="$CONFIG_DIR/gateway"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

get_config_value() {
    local key="$1"
    local file="$2"

    if [ ! -f "$file" ]; then
        return 0
    fi

    grep "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true
}

set_config_value() {
    local key="$1"
    local value="$2"
    local file="$3"
    local tmp
    local found=0

    tmp="$(mktemp)"
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            "${key}="*)
                printf '%s=%s\n' "$key" "$value" >> "$tmp"
                found=1
                ;;
            *)
                printf '%s\n' "$line" >> "$tmp"
                ;;
        esac
    done < "$file"

    if [ "$found" -eq 0 ]; then
        printf '%s=%s\n' "$key" "$value" >> "$tmp"
    fi

    mv "$tmp" "$file"
}

ensure_config_key() {
    local key="$1"
    local file="$2"

    if ! grep -q "^${key}=" "$file"; then
        printf '%s=\n' "$key" >> "$file"
    fi
}

read_secret() {
    local __var_name="$1"
    local __value=""

    if [ -t 0 ]; then
        read -r -s __value
        echo ""
    else
        read -r __value || true
    fi

    printf -v "$__var_name" '%s' "$__value"
}

echo ""
echo "========================================"
echo " dify-rag-skill install"
echo "========================================"
echo ""

# 1. skills フォルダへ配置
mkdir -p "$INJECT_SKILL_DIR" "$SEARCH_SKILL_DIR" "$CONFIG_DIR" "$MCP_SERVER_DIR" "$GATEWAY_DIR"
cp "$SRC_DIR/SKILL.md" "$INJECT_SKILL_DIR/SKILL.md"
cp "$SRC_DIR/dify_inject.py" "$INJECT_SKILL_DIR/dify_inject.py"
cp "$SRC_DIR/search/SKILL.md" "$SEARCH_SKILL_DIR/SKILL.md"
cp "$SRC_DIR/dify_search.py" "$SEARCH_SKILL_DIR/dify_search.py"
cp "$SRC_DIR/dify_inject.py" "$MCP_SERVER_DIR/dify_inject.py"
cp "$SRC_DIR/dify_search.py" "$MCP_SERVER_DIR/dify_search.py"
cp "$SRC_DIR/mcp-server/server.mjs" "$MCP_SERVER_DIR/server.mjs"
cp "$SRC_DIR/mcp-server/package.json" "$MCP_SERVER_DIR/package.json"
cp "$SRC_DIR/mcp-server/package-lock.json" "$MCP_SERVER_DIR/package-lock.json"
cp "$SRC_DIR/dify_inject.py" "$GATEWAY_DIR/dify_inject.py"
cp "$SRC_DIR/dify_search.py" "$GATEWAY_DIR/dify_search.py"
cp "$SRC_DIR/gateway/server.mjs" "$GATEWAY_DIR/server.mjs"
cp "$SRC_DIR/gateway/package.json" "$GATEWAY_DIR/package.json"
chmod +x "$INJECT_SKILL_DIR/dify_inject.py" "$SEARCH_SKILL_DIR/dify_search.py"
chmod +x "$MCP_SERVER_DIR/server.mjs" "$MCP_SERVER_DIR/dify_inject.py" "$MCP_SERVER_DIR/dify_search.py"
chmod +x "$GATEWAY_DIR/server.mjs" "$GATEWAY_DIR/dify_inject.py" "$GATEWAY_DIR/dify_search.py"
echo "[1/3] Installed ingest skill: $INJECT_SKILL_DIR"
echo "      Installed search skill: $SEARCH_SKILL_DIR"
echo "      Installed MCP server: $MCP_SERVER_DIR"
echo "      Installed gateway server: $GATEWAY_DIR"

# 2. poppler (pdftoppm) チェック
if command -v pdftoppm >/dev/null 2>&1; then
    echo "[2/3] poppler: OK ($(command -v pdftoppm))"
else
    echo "[2/3] poppler: not found. It is needed for image-heavy PDF ingestion."
    if command -v brew >/dev/null 2>&1; then
        echo "      Run later:  brew install poppler"
    else
        echo "      Install Homebrew, then run:  brew install poppler"
    fi
fi

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    echo "      node: OK ($(command -v node))"
    echo "      npm: OK ($(command -v npm))"
    (
        cd "$MCP_SERVER_DIR"
        npm install --omit=dev --silent
    )
    echo "      MCP server dependencies: OK"
else
    echo "      node/npm: not found. MCP server dependencies were not installed."
    echo "      Install Node.js, then run ./install.sh again to enable Claude.app MCP use."
fi

# 3. config 生成と対話式設定
if [ -f "$CONFIG_FILE" ]; then
    echo "[3/3] config: using existing file ($CONFIG_FILE)"
elif [ -f "$INJECT_SKILL_DIR/config" ] && [ ! -L "$INJECT_SKILL_DIR/config" ]; then
    cp "$INJECT_SKILL_DIR/config" "$CONFIG_FILE"
    chmod 600 "$CONFIG_FILE"
    echo "[3/3] config: migrated existing ingest config to $CONFIG_FILE"
else
    cp "$SRC_DIR/config.example" "$CONFIG_FILE"
    chmod 600 "$CONFIG_FILE"
    echo "[3/3] config: created template ($CONFIG_FILE)"
fi

ensure_config_key "DIFY_BASE_URL" "$CONFIG_FILE"
ensure_config_key "DIFY_APP_KEY" "$CONFIG_FILE"
ensure_config_key "DIFY_DATASET_API_KEY" "$CONFIG_FILE"
ensure_config_key "DIFY_DATASET_IDS" "$CONFIG_FILE"
ensure_config_key "DIFY_RAG_GATEWAY_URL" "$CONFIG_FILE"
ensure_config_key "DIFY_RAG_SHARED_SECRET" "$CONFIG_FILE"
ensure_config_key "DIFY_RAG_CLOUDFLARE_ACCESS" "$CONFIG_FILE"
ensure_config_key "DIFY_RAG_CLOUDFLARED_BIN" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"

CURRENT_GATEWAY_URL="$(get_config_value "DIFY_RAG_GATEWAY_URL" "$CONFIG_FILE")"
if [ -z "$CURRENT_GATEWAY_URL" ]; then
    echo ""
    echo "Hosted gateway URL is optional."
    echo "Use it for employee installs that should not store Dify API keys locally."
    echo "Example: https://rag-api.example.com"
    printf "Hosted gateway URL (leave empty for direct Dify setup): "
    GATEWAY_URL=""
    read -r GATEWAY_URL || true
    if [ -n "$GATEWAY_URL" ]; then
        set_config_value "DIFY_RAG_GATEWAY_URL" "$GATEWAY_URL" "$CONFIG_FILE"
        chmod 600 "$CONFIG_FILE"
        CURRENT_GATEWAY_URL="$GATEWAY_URL"
        echo "Gateway URL saved. Direct Dify API keys are not needed on this machine."
    fi
else
    echo ""
    echo "Hosted gateway URL is already set. Direct Dify API keys are not needed on this machine."
fi

if [ -n "$CURRENT_GATEWAY_URL" ]; then
    ln -sf "$CONFIG_FILE" "$INJECT_SKILL_DIR/config"
    ln -sf "$CONFIG_FILE" "$SEARCH_SKILL_DIR/config"

    if ! command -v cloudflared >/dev/null 2>&1; then
        echo ""
        echo "Cloudflare Access note:"
        echo "  If this gateway is protected by Cloudflare Access, install cloudflared:"
        echo "    brew install cloudflared"
        echo "  Then authenticate once:"
        echo "    cloudflared access login $CURRENT_GATEWAY_URL"
    else
        echo ""
        echo "Cloudflare Access note:"
        echo "  If this gateway is protected by Cloudflare Access, authenticate once:"
        echo "    cloudflared access login $CURRENT_GATEWAY_URL"
    fi

    echo ""
    echo "Done."
    echo "Installed:"
    echo "  - dify-rag-inject: add Drive documents to Dify"
    echo "  - dify-rag-search: retrieve Dify chunks for Claude to answer from"
    echo "  - dify-rag MCP server: expose Dify search and ingestion to Claude.app"
    echo ""
    echo "Claude.app MCP server command:"
    echo "  node $MCP_SERVER_DIR/server.mjs"
    exit 0
fi

CURRENT_KEY="$(get_config_value "DIFY_APP_KEY" "$CONFIG_FILE")"
SHOULD_ASK_KEY=1

if [ -n "$CURRENT_KEY" ]; then
    echo ""
    echo "Dify Workflow API key for ingestion is already set."
    printf "Replace it? [y/N]: "
    ANSWER=""
    read -r ANSWER || true
    case "$ANSWER" in
        y|Y) SHOULD_ASK_KEY=1 ;;
        *) SHOULD_ASK_KEY=0 ;;
    esac
fi

if [ "$SHOULD_ASK_KEY" -eq 1 ]; then
    echo ""
    echo "Paste your Dify Workflow API key for ingestion and press Enter."
    echo "Leave empty to keep it unset."
    printf "Workflow API key: "
    read_secret APP_KEY

    if [ -z "$APP_KEY" ]; then
        echo ""
        echo "Workflow API key left unset. Rerun ./install.sh when ready."
    else
        case "$APP_KEY" in
            app-*) ;;
            *)
                echo "Note: Dify Workflow API keys often start with app-. Saving this value as entered."
                ;;
        esac
        set_config_value "DIFY_APP_KEY" "$APP_KEY" "$CONFIG_FILE"
        chmod 600 "$CONFIG_FILE"
        echo "Workflow API key saved."
    fi
else
    echo "Keeping existing Workflow API key."
fi

CURRENT_DATASET_KEY="$(get_config_value "DIFY_DATASET_API_KEY" "$CONFIG_FILE")"
SHOULD_ASK_DATASET_KEY=1

if [ -n "$CURRENT_DATASET_KEY" ]; then
    echo ""
    echo "Dify Knowledge Base API key for search is already set."
    printf "Replace it? [y/N]: "
    ANSWER=""
    read -r ANSWER || true
    case "$ANSWER" in
        y|Y) SHOULD_ASK_DATASET_KEY=1 ;;
        *) SHOULD_ASK_DATASET_KEY=0 ;;
    esac
fi

if [ "$SHOULD_ASK_DATASET_KEY" -eq 1 ]; then
    echo ""
    echo "Paste your Dify Knowledge Base API key for search and press Enter."
    echo "Leave empty to keep it unset."
    printf "Knowledge Base API key: "
    read_secret DATASET_API_KEY

    if [ -z "$DATASET_API_KEY" ]; then
        echo "Knowledge Base API key left unset. Rerun ./install.sh when ready."
    else
        set_config_value "DIFY_DATASET_API_KEY" "$DATASET_API_KEY" "$CONFIG_FILE"
        chmod 600 "$CONFIG_FILE"
        echo "Knowledge Base API key saved."
    fi
else
    echo "Keeping existing Knowledge Base API key."
fi

CURRENT_BASE="$(get_config_value "DIFY_BASE_URL" "$CONFIG_FILE")"
if [ -z "$CURRENT_BASE" ]; then
    echo ""
    echo "Dify API base URL is not set."
    echo "Example: https://your-dify.example.com/v1"
    printf "Dify API base URL: "
    BASE_URL=""
    read -r BASE_URL || true
    if [ -n "$BASE_URL" ]; then
        set_config_value "DIFY_BASE_URL" "$BASE_URL" "$CONFIG_FILE"
        chmod 600 "$CONFIG_FILE"
        echo "Base URL saved."
    else
        echo "Base URL left unset. Rerun ./install.sh when ready."
    fi
fi

# Compatibility for older installed scripts that look inside each skill dir.
ln -sf "$CONFIG_FILE" "$INJECT_SKILL_DIR/config"
ln -sf "$CONFIG_FILE" "$SEARCH_SKILL_DIR/config"

echo ""
echo "Done."
echo "Installed:"
echo "  - dify-rag-inject: add Drive documents to Dify"
echo "  - dify-rag-search: retrieve Dify chunks for Claude to answer from"
echo "  - dify-rag MCP server: expose Dify search and ingestion to Claude.app"
echo ""
echo "Claude.app MCP server command:"
echo "  node $MCP_SERVER_DIR/server.mjs"
echo ""
echo "Gateway server command for the Dify host:"
echo "  node $GATEWAY_DIR/server.mjs"

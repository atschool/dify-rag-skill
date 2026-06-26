#!/usr/bin/env bash
#
# dify-rag-skill インストーラ
#
# 実行すると以下を行います:
#   1. ~/.claude/skills/dify-rag-inject/ に SKILL.md と dify_inject.py を配置
#   2. pdftoppm (poppler) の有無をチェック
#   3. APIキーをその場で聞いて config に書き込む
#
# 使い方:  ./install.sh
#
set -euo pipefail

SKILL_DIR="$HOME/.claude/skills/dify-rag-inject"
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
echo " dify-rag-skill インストール"
echo "========================================"
echo ""

# 1. skills フォルダへ配置
mkdir -p "$SKILL_DIR"
cp "$SRC_DIR/SKILL.md"        "$SKILL_DIR/SKILL.md"
cp "$SRC_DIR/dify_inject.py"  "$SKILL_DIR/dify_inject.py"
chmod +x "$SKILL_DIR/dify_inject.py"
echo "[1/3] ファイルを配置しました: $SKILL_DIR"

# 2. poppler (pdftoppm) チェック
if command -v pdftoppm >/dev/null 2>&1; then
    echo "[2/3] poppler: OK ($(command -v pdftoppm))"
else
    echo "[2/3] poppler: 見つかりません。画像主体PDFの処理に必要です。"
    if command -v brew >/dev/null 2>&1; then
        echo "      あとで次を実行してください:  brew install poppler"
    else
        echo "      Homebrew導入後に次を実行してください:  brew install poppler"
    fi
fi

# 3. config 生成と対話式設定
if [ -f "$SKILL_DIR/config" ]; then
    echo "[3/3] config: 既存のものを使用します ($SKILL_DIR/config)"
else
    cp "$SRC_DIR/config.example" "$SKILL_DIR/config"
    chmod 600 "$SKILL_DIR/config"
    echo "[3/3] config: 雛形を作成しました ($SKILL_DIR/config)"
fi

CURRENT_KEY="$(get_config_value "DIFY_APP_KEY" "$SKILL_DIR/config")"
SHOULD_ASK_KEY=1

if [ -n "$CURRENT_KEY" ]; then
    echo ""
    echo "DifyのAPIキーはすでに設定されています。"
    printf "入れ直しますか？ [y/N]: "
    ANSWER=""
    read -r ANSWER || true
    case "$ANSWER" in
        y|Y) SHOULD_ASK_KEY=1 ;;
        *) SHOULD_ASK_KEY=0 ;;
    esac
fi

if [ "$SHOULD_ASK_KEY" -eq 1 ]; then
    echo ""
    echo "DifyのワークフローAPIキーを貼り付けて Enter を押してください。"
    echo "未入力のまま Enter すると、キーは未設定のまま残ります。"
    printf "APIキー: "
    read_secret APP_KEY

    if [ -z "$APP_KEY" ]; then
        echo ""
        echo "APIキーは未設定のままです。あとでもう一度 ./install.sh を実行すれば設定できます。"
    else
        case "$APP_KEY" in
            app-*) ;;
            *)
                echo "注意: DifyのワークフローAPIキーは通常 app- で始まります。このまま設定します。"
                ;;
        esac
        set_config_value "DIFY_APP_KEY" "$APP_KEY" "$SKILL_DIR/config"
        chmod 600 "$SKILL_DIR/config"
        echo "APIキーを設定しました。"
    fi
else
    echo "APIキーは既存の設定を保持しました。"
fi

CURRENT_BASE="$(get_config_value "DIFY_BASE_URL" "$SKILL_DIR/config")"
if [ -z "$CURRENT_BASE" ]; then
    echo ""
    echo "DifyのAPIベースURLが未設定です。"
    echo "分かる場合は入力してください。未入力ならあとで再実行して設定できます。"
    printf "Dify APIベースURL: "
    BASE_URL=""
    read -r BASE_URL || true
    if [ -n "$BASE_URL" ]; then
        set_config_value "DIFY_BASE_URL" "$BASE_URL" "$SKILL_DIR/config"
        chmod 600 "$SKILL_DIR/config"
        echo "DifyのAPIベースURLを設定しました。"
    else
        echo "DifyのAPIベースURLは未設定のままです。"
    fi
fi

echo ""
echo "完了しました。"
echo "Claude Code で「Driveの資料をDifyに投入して」と依頼すると発火します。"

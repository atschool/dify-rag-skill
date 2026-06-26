#!/usr/bin/env bash
#
# dify-rag-skill インストーラ
#
# 実行すると以下を行います:
#   1. ~/.claude/skills/dify-rag-inject/ に SKILL.md と dify_inject.py を配置
#   2. pdftoppm (poppler) の有無をチェック
#   3. config が無ければ config.example からコピーして生成
#
# 使い方:  ./install.sh
#
set -euo pipefail

SKILL_DIR="$HOME/.claude/skills/dify-rag-inject"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> dify-rag-skill をインストールします"

# 1. skills フォルダへ配置
mkdir -p "$SKILL_DIR"
cp "$SRC_DIR/SKILL.md"        "$SKILL_DIR/SKILL.md"
cp "$SRC_DIR/dify_inject.py"  "$SKILL_DIR/dify_inject.py"
chmod +x "$SKILL_DIR/dify_inject.py"
echo "    配置先: $SKILL_DIR"

# 2. poppler (pdftoppm) チェック
if command -v pdftoppm >/dev/null 2>&1; then
    echo "    poppler: OK ($(command -v pdftoppm))"
else
    echo "    poppler: 見つかりません。画像主体PDFの処理に必要です。"
    if command -v brew >/dev/null 2>&1; then
        echo "      → 次を実行してください:  brew install poppler"
    else
        echo "      → Homebrew導入後に:  brew install poppler"
    fi
fi

# 3. config 生成
if [ -f "$SKILL_DIR/config" ]; then
    echo "    config: 既存のものを保持しました ($SKILL_DIR/config)"
else
    cp "$SRC_DIR/config.example" "$SKILL_DIR/config"
    echo "    config: 雛形を作成しました ($SKILL_DIR/config)"
    echo ""
    echo "  ★ 次の操作が必要です:"
    echo "    $SKILL_DIR/config を開き、DIFY_APP_KEY= の後ろに"
    echo "    DifyのワークフローAPIキーを入力してください。"
fi

echo ""
echo "==> 完了。Claude Code で「Driveの〇〇をDifyに投入して」と依頼すると発火します。"

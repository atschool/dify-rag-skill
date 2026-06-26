#!/usr/bin/env python3
"""
Dify ナレッジ投入スクリプト

整形済み Markdown ファイルを読み込み、Dify の「ナレッジ投入パイプライン」
ワークフローAPIに category / doc_name / doc_text を渡して投入する。

設定の優先順位（上が優先）:
  1. コマンドライン引数 --base
  2. 環境変数 DIFY_BASE_URL / DIFY_APP_KEY
  3. 設定ファイル（既定: ~/.claude/skills/dify-rag-inject/config）

使い方:
    python3 dify_inject.py \
        --category '<カテゴリ名>' \
        --doc-name '<資料名>' \
        --file './<資料名>_整形版.md'

オプション:
    --base      Dify のベースURL（省略時は config / 環境変数）
    --config    設定ファイルのパス（省略時は既定パスを探す）
    --user      実行ユーザー識別子（デフォルト dify-rag-skill）
    --dry-run   送信せず、送る内容のサマリだけ表示
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error

DEFAULT_CONFIG_PATHS = [
    os.path.expanduser("~/.claude/skills/dify-rag-inject/config"),
    os.path.expanduser("~/.dify-rag/config"),
    "./config",
]


def load_config(path=None):
    """簡易 KEY=VALUE 形式の設定ファイルを読む。"""
    conf = {}
    candidates = [path] if path else DEFAULT_CONFIG_PATHS
    for p in candidates:
        if p and os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, _, v = line.partition("=")
                    conf[k.strip()] = v.strip()
            conf["_loaded_from"] = p
            break
    return conf


def main():
    p = argparse.ArgumentParser(description="Dify ナレッジ投入")
    p.add_argument("--category", required=True, help="ナレッジ（器）名になるカテゴリ")
    p.add_argument("--doc-name", required=True, help="投入するドキュメント名")
    p.add_argument("--file", required=True, help="整形済み Markdown ファイルのパス")
    p.add_argument("--base", default=None, help="Dify ベースURL（省略時は config/環境変数）")
    p.add_argument("--config", default=None, help="設定ファイルのパス")
    p.add_argument("--user", default="dify-rag-skill", help="実行ユーザー識別子")
    p.add_argument("--dry-run", action="store_true", help="送信せず内容だけ確認")
    args = p.parse_args()

    conf = load_config(args.config)

    # base URL: 引数 > 環境変数 > config
    base = (args.base
            or os.environ.get("DIFY_BASE_URL", "").strip()
            or conf.get("DIFY_BASE_URL", "").strip())
    if not base:
        sys.exit("ERROR: Dify のベースURLが未設定です。config の DIFY_BASE_URL を埋めるか --base で指定してください。")
    base = base.rstrip("/")

    # APIキー: 環境変数 > config
    app_key = (os.environ.get("DIFY_APP_KEY", "").strip()
               or conf.get("DIFY_APP_KEY", "").strip())
    if not args.dry_run and not app_key:
        sys.exit("ERROR: APIキーが未設定です。config の DIFY_APP_KEY を埋めるか、環境変数 DIFY_APP_KEY を設定してください。")

    # 本文読み込み
    try:
        with open(args.file, encoding="utf-8") as f:
            doc_text = f.read()
    except FileNotFoundError:
        sys.exit(f"ERROR: ファイルが見つかりません: {args.file}")
    if not doc_text.strip():
        sys.exit("ERROR: ファイルが空です。")

    payload = {
        "inputs": {
            "category": args.category,
            "doc_name": args.doc_name,
            "doc_text": doc_text,
        },
        "response_mode": "blocking",
        "user": args.user,
    }

    print("=== 投入内容 ===")
    print(f"  endpoint : {base}/workflows/run")
    if conf.get("_loaded_from"):
        print(f"  config   : {conf['_loaded_from']}")
    print(f"  category : {args.category}")
    print(f"  doc_name : {args.doc_name}")
    print(f"  file     : {args.file}  ({len(doc_text)} 文字)")
    print(f"  user     : {args.user}")
    print("================")

    if args.dry_run:
        print("[dry-run] 送信しませんでした。")
        return

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base}/workflows/run",
        data=data,
        headers={
            "Authorization": f"Bearer {app_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} エラー:\n{err_body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        sys.exit(f"接続エラー: {e.reason}\n(Dify のURLに到達できるか、Dify が起動しているか確認)")

    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        print("レスポンス（生）:", body)
        return

    d = result.get("data", {})
    status = d.get("status", "?")
    print("=== 結果 ===")
    print(f"  status      : {status}")
    print(f"  total_steps : {d.get('total_steps', '?')}")
    print(f"  elapsed     : {d.get('elapsed_time', '?')}")
    if d.get("outputs"):
        print(f"  outputs     : {json.dumps(d['outputs'], ensure_ascii=False)}")
    if status != "succeeded":
        print("  ⚠️ succeeded 以外。error:", d.get("error"))
        sys.exit(2)
    print("✅ 投入成功")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Read a prepared Markdown file and send it to a Dify ingestion Workflow.

Configuration priority:
  1. Command-line arguments such as --base
  2. Environment variables DIFY_BASE_URL / DIFY_APP_KEY
  3. Local config files

Usage:
    python3 dify_inject.py \
        --category '<category>' \
        --doc-name '<document-name>' \
        --file './document_prepared.md'

Options:
    --base      Dify base URL
    --config    Config file path
    --user      Workflow user identifier
    --dry-run   Print the request summary without sending it
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error

DEFAULT_CONFIG_PATHS = [
    os.path.expanduser("~/.dify-rag/config"),
    os.path.expanduser("~/.claude/skills/dify-rag-inject/config"),
    "./config",
]


def load_config(path=None):
    """Read a simple KEY=VALUE config file."""
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
    p = argparse.ArgumentParser(description="Send prepared Markdown to a Dify ingestion Workflow")
    p.add_argument("--category", required=True, help="Dify Workflow category or routing key")
    p.add_argument("--doc-name", required=True, help="Document name to create or update")
    p.add_argument("--file", required=True, help="Path to the prepared Markdown file")
    p.add_argument("--base", default=None, help="Dify base URL")
    p.add_argument("--config", default=None, help="Config file path")
    p.add_argument("--user", default="dify-rag-skill", help="Workflow user identifier")
    p.add_argument("--dry-run", action="store_true", help="Print a request summary without sending")
    args = p.parse_args()

    conf = load_config(args.config)

    # base URL: argument > environment > config
    base = (args.base
            or os.environ.get("DIFY_BASE_URL", "").strip()
            or conf.get("DIFY_BASE_URL", "").strip())
    if not base:
        sys.exit("ERROR: DIFY_BASE_URL is not set. Fill it in config or pass --base.")
    base = base.rstrip("/")

    # API key: environment > config
    app_key = (os.environ.get("DIFY_APP_KEY", "").strip()
               or conf.get("DIFY_APP_KEY", "").strip())
    if not args.dry_run and not app_key:
        sys.exit("ERROR: DIFY_APP_KEY is not set. Fill it in config or set the environment variable.")

    # Read document body.
    try:
        with open(args.file, encoding="utf-8") as f:
            doc_text = f.read()
    except FileNotFoundError:
        sys.exit(f"ERROR: file not found: {args.file}")
    if not doc_text.strip():
        sys.exit("ERROR: file is empty.")

    payload = {
        "inputs": {
            "category": args.category,
            "doc_name": args.doc_name,
            "doc_text": doc_text,
        },
        "response_mode": "blocking",
        "user": args.user,
    }

    print("=== Ingestion Request ===")
    print(f"  endpoint : {base}/workflows/run")
    if conf.get("_loaded_from"):
        print(f"  config   : {conf['_loaded_from']}")
    print(f"  category : {args.category}")
    print(f"  doc_name : {args.doc_name}")
    print(f"  file     : {args.file}  ({len(doc_text)} chars)")
    print(f"  user     : {args.user}")
    print("================")

    if args.dry_run:
        print("[dry-run] request was not sent.")
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
        print(f"HTTP {e.code} error:\n{err_body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        sys.exit(f"Connection error: {e.reason}\nCheck whether the Dify URL is reachable and Dify is running.")

    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        print("Raw response:", body)
        return

    d = result.get("data", {})
    status = d.get("status", "?")
    print("=== Result ===")
    print(f"  status      : {status}")
    print(f"  total_steps : {d.get('total_steps', '?')}")
    print(f"  elapsed     : {d.get('elapsed_time', '?')}")
    if d.get("outputs"):
        print(f"  outputs     : {json.dumps(d['outputs'], ensure_ascii=False)}")
    if status != "succeeded":
        print("  status is not succeeded. error:", d.get("error"))
        sys.exit(2)
    print("Ingestion succeeded.")


if __name__ == "__main__":
    main()

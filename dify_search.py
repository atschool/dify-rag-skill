#!/usr/bin/env python3
"""
Search Dify knowledge bases and print retrieved chunks for Claude Code.

This client uses Dify's Knowledge Base retrieve API. It does not ask Dify to
generate an answer; it only returns source chunks so Claude can answer with
grounding.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_CONFIG_PATHS = [
    os.path.expanduser("~/.dify-rag/config"),
    os.path.expanduser("~/.claude/skills/dify-rag-search/config"),
    os.path.expanduser("~/.claude/skills/dify-rag-inject/config"),
    "./config",
]


class DifyHTTPError(Exception):
    def __init__(self, status, body):
        self.status = status
        self.body = body
        super().__init__(f"HTTP {status}: {body}")


def load_config(path=None):
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


def split_csv(value):
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def request_json(method, url, api_key, payload=None, timeout=60):
    data = None
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise DifyHTTPError(e.code, body) from e
    except urllib.error.URLError as e:
        raise SystemExit(
            f"Connection error: {e.reason}\n"
            "Check DIFY_BASE_URL, network access, and whether Dify is running."
        ) from e

    if not body:
        return {}
    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        raise SystemExit(f"Dify returned non-JSON response:\n{body}") from e


def list_datasets(base, api_key, timeout=60):
    datasets = []
    page = 1
    limit = 100

    while True:
        params = urllib.parse.urlencode(
            {"page": page, "limit": limit, "include_all": "true"}
        )
        result = request_json(
            "GET", f"{base}/datasets?{params}", api_key, timeout=timeout
        )

        page_items = result.get("data", [])
        if not isinstance(page_items, list):
            raise SystemExit(
                "Unexpected dataset list response:\n"
                f"{json.dumps(result, ensure_ascii=False, indent=2)}"
            )

        datasets.extend(page_items)

        has_more = result.get("has_more")
        total = result.get("total")
        if has_more is False:
            break
        if total is not None and len(datasets) >= int(total):
            break
        if not page_items:
            break
        page += 1

    return datasets


def retrieval_model(args):
    model = {
        "search_method": args.search_method,
        "reranking_enable": False,
        "top_k": args.per_dataset_top_k,
        "score_threshold_enabled": args.score_threshold is not None,
    }
    if args.score_threshold is not None:
        model["score_threshold"] = args.score_threshold
    return model


def retrieve_dataset(base, api_key, dataset, args):
    dataset_id = dataset["id"]
    payload = {
        "query": args.query,
        "retrieval_model": retrieval_model(args),
    }
    url = f"{base}/datasets/{dataset_id}/retrieve"

    try:
        result = request_json("POST", url, api_key, payload=payload, timeout=args.timeout)
    except DifyHTTPError as e:
        if e.status not in (400, 422):
            raise
        fallback_payload = {
            "query": args.query,
            "external_retrieval_model": retrieval_model(args),
        }
        result = request_json(
            "POST", url, api_key, payload=fallback_payload, timeout=args.timeout
        )

    records = result.get("records")
    if records is None and isinstance(result.get("data"), dict):
        records = result["data"].get("records")
    if records is None and isinstance(result.get("data"), list):
        records = result["data"]
    if records is None:
        records = []

    hits = []
    for record in records:
        segment = record.get("segment") or record.get("data") or {}
        document = segment.get("document") or record.get("document") or {}
        content = (
            segment.get("content")
            or record.get("content")
            or segment.get("answer")
            or ""
        )
        score = record.get("score")
        try:
            score_value = float(score) if score is not None else None
        except (TypeError, ValueError):
            score_value = None

        hits.append(
            {
                "dataset_id": dataset_id,
                "dataset_name": dataset.get("name", dataset_id),
                "document_id": document.get("id") or segment.get("document_id"),
                "document_name": document.get("name") or record.get("document_name") or "(unknown document)",
                "segment_id": segment.get("id") or record.get("segment_id"),
                "score": score_value,
                "content": content.strip(),
            }
        )

    return hits


def select_datasets(base, api_key, args, conf):
    cli_ids = args.dataset_id or []
    configured_ids = split_csv(
        os.environ.get("DIFY_DATASET_IDS", "").strip()
        or conf.get("DIFY_DATASET_IDS", "").strip()
    )

    if cli_ids and not args.category:
        return [{"id": dataset_id, "name": dataset_id} for dataset_id in cli_ids]
    if configured_ids and not args.category:
        return [{"id": dataset_id, "name": dataset_id} for dataset_id in configured_ids]

    datasets = list_datasets(base, api_key, timeout=args.timeout)
    if args.category:
        needle = args.category.lower()
        datasets = [
            d for d in datasets
            if needle in d.get("name", "").lower() or needle == d.get("id", "").lower()
        ]

    if cli_ids:
        wanted = set(cli_ids)
        datasets = [d for d in datasets if d.get("id") in wanted]
    elif configured_ids:
        wanted = set(configured_ids)
        datasets = [d for d in datasets if d.get("id") in wanted]

    return datasets


def sort_hits(hits):
    return sorted(
        hits,
        key=lambda h: h["score"] if h["score"] is not None else -1.0,
        reverse=True,
    )


def output_json(args, datasets, hits):
    payload = {
        "query": args.query,
        "top_k": args.top_k,
        "datasets_searched": [
            {"id": d.get("id"), "name": d.get("name", d.get("id"))}
            for d in datasets
        ],
        "hits": hits,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def output_markdown(args, datasets, hits):
    print("# Dify RAG Search Results")
    print()
    print(f"Query: {args.query}")
    print(f"Datasets searched: {len(datasets)}")
    print()

    if not hits:
        print("No matching chunks found.")
        return

    for i, hit in enumerate(hits, start=1):
        print(f"## Hit {i}")
        print()
        print(f"- Document: {hit['document_name']}")
        print(f"- Dataset: {hit['dataset_name']}")
        if hit["score"] is not None:
            print(f"- Score: {hit['score']:.4f}")
        else:
            print("- Score: (not provided)")
        if hit.get("segment_id"):
            print(f"- Segment ID: {hit['segment_id']}")
        print()
        print(hit["content"] or "(empty chunk)")
        print()


def print_dataset_list(datasets):
    if not datasets:
        print("No datasets found.")
        return
    for d in datasets:
        print(f"{d.get('id')}\t{d.get('name', '')}")


def fail_api_error(error):
    if error.status == 401:
        raise SystemExit(
            "HTTP 401: Dify rejected the API key.\n"
            "Check DIFY_DATASET_API_KEY and confirm it has Knowledge Base API access."
        )
    if error.status == 404:
        raise SystemExit(
            f"HTTP 404 from Dify:\n{error.body}\n"
            "Check DIFY_BASE_URL and dataset IDs."
        )
    raise SystemExit(f"HTTP {error.status} from Dify:\n{error.body}")


def main():
    p = argparse.ArgumentParser(description="Search Dify knowledge bases")
    p.add_argument("--query", help="Search query")
    p.add_argument("--top-k", type=int, default=5, help="Number of merged hits to print")
    p.add_argument("--per-dataset-top-k", type=int, default=None, help="Hits to request from each dataset")
    p.add_argument("--category", help="Filter datasets by name or exact dataset ID")
    p.add_argument("--dataset-id", action="append", help="Dataset ID to search; can be repeated")
    p.add_argument("--base", help="Dify API base URL")
    p.add_argument("--config", help="Config file path")
    p.add_argument("--api-key", help="Dify Knowledge Base API key")
    p.add_argument("--score-threshold", type=float, default=None, help="Optional minimum score")
    p.add_argument("--search-method", default="semantic_search", choices=["semantic_search", "full_text_search", "hybrid_search"], help="Dify search method")
    p.add_argument("--format", choices=["markdown", "json"], default="markdown", help="Output format")
    p.add_argument("--timeout", type=int, default=60, help="HTTP timeout in seconds")
    p.add_argument("--list-datasets", action="store_true", help="List visible datasets and exit")
    args = p.parse_args()

    conf = load_config(args.config)
    base = (
        args.base
        or os.environ.get("DIFY_BASE_URL", "").strip()
        or conf.get("DIFY_BASE_URL", "").strip()
    )
    if not base:
        raise SystemExit("ERROR: DIFY_BASE_URL is not set. Run ./install.sh or set the environment variable.")
    base = base.rstrip("/")

    api_key = (
        args.api_key
        or os.environ.get("DIFY_DATASET_API_KEY", "").strip()
        or os.environ.get("DIFY_API_KEY", "").strip()
        or conf.get("DIFY_DATASET_API_KEY", "").strip()
        or conf.get("DIFY_API_KEY", "").strip()
    )
    if not api_key:
        raise SystemExit("ERROR: DIFY_DATASET_API_KEY is not set. Run ./install.sh or set the environment variable.")

    if args.per_dataset_top_k is None:
        args.per_dataset_top_k = max(args.top_k, 5)

    try:
        datasets = select_datasets(base, api_key, args, conf)
        if args.list_datasets:
            print_dataset_list(datasets)
            return

        if not args.query:
            raise SystemExit("ERROR: --query is required unless --list-datasets is used.")
        if not datasets:
            raise SystemExit("No datasets matched. Check API key permissions, DIFY_DATASET_IDS, or --category.")

        all_hits = []
        for dataset in datasets:
            all_hits.extend(retrieve_dataset(base, api_key, dataset, args))

    except DifyHTTPError as e:
        fail_api_error(e)

    hits = sort_hits(all_hits)[: args.top_k]
    if args.format == "json":
        output_json(args, datasets, hits)
    else:
        output_markdown(args, datasets, hits)


if __name__ == "__main__":
    main()


# Troubleshooting

Use this runbook when Claude cannot search, the connector cannot connect, or ingestion fails.

Start from the layer closest to the failure and work inward.

## Quick Layer Map

```text
Claude Custom Connector
  -> Cloudflare Access
  -> Cloudflare Tunnel
  -> dify-rag-remote-mcp :8788
  -> dify-rag-gateway :8787
  -> Dify API
  -> Dify datasets
```

## Local Host Checks

On the Dify host:

```bash
./scripts/doctor-remote-mcp.sh
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8788/health
```

If local health fails:

- Check Node.js is installed.
- Check launchd services are loaded.
- Check logs under `~/.dify-rag/logs/`.
- Rerun `./install.sh` if dependencies are missing.

## Dify Checks

```bash
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
```

Common symptoms:

- `No route to host`: network path or tunnel is broken.
- `Connection refused`: host is reachable, but the target service is not listening.
- `401` or `403`: auth or API key problem.
- `200` from local health but no search hits: Dify is reachable, but dataset/search quality may be the issue.

## Public Cloudflare Checks

From a machine outside the Dify host:

```bash
curl -sS -I https://mcp.example.com/rag | sed -n '1,16p'
```

Expected before login:

```text
HTTP/2 302
www-authenticate: Cloudflare-Access ...
```

Interpretation:

- `302` to Cloudflare Access: good; hostname is protected.
- `200 OK`: dangerous if unauthenticated; Access may not be applied.
- `404`: hostname may route to the wrong service or path.
- `502` or `1033`: tunnel or origin service problem.
- Timeout: DNS, tunnel, firewall, or host sleep problem.

## Claude Uses Google Drive Instead Of Dify

Likely causes:

- Custom Connector is not connected or not enabled.
- The user was not allowed through Cloudflare Access.
- Claude did not infer that Dify or the configured knowledge base should be used.
- The prompt asked for the source document rather than the RAG knowledge base.

Recommended user prompt:

```text
Search the configured Dify knowledge base for <topic> and answer from the retrieved evidence.
```

If the tool is available, Claude should call `search_knowledge`.

## Search Works But Add Is Denied

For search-only users, this is expected.

The denial message is:

```text
This connector account is not allowed to add or update knowledge. Ask a maintainer to add the material.
```

If the user should be a maintainer, add their email to `DIFY_RAG_ADD_ALLOWED_EMAILS` on the Dify host and restart Remote MCP.

## Add Is Unexpectedly Allowed

Check:

```bash
grep '^DIFY_RAG_ADD_ALLOWED_EMAILS=' ~/.dify-rag/config
```

Remove broad domains or unintended emails. Use explicit maintainer emails.

## No Search Hits

Check:

```bash
python3 ~/.claude/skills/dify-rag-search/dify_search.py --list-datasets
python3 ~/.claude/skills/dify-rag-search/dify_search.py --query "test" --top-k 5
```

Possible causes:

- The document was never ingested.
- The Dify dataset API key cannot see the dataset.
- `DIFY_DATASET_IDS` restricts search too narrowly.
- Chunking or Markdown preparation is too sparse.
- Score threshold is too high.

## Ingestion Fails

Check:

- `DIFY_APP_KEY` is configured on the Dify host.
- The ingestion Workflow is published.
- The Workflow accepts `category`, `doc_name`, and `doc_text`.
- `pdftoppm` is installed for image-heavy PDFs.
- The source document was converted to clean Markdown before upload.

Dry-run local ingestion first:

```bash
python3 ~/.claude/skills/dify-rag-inject/dify_inject.py \
  --category "test" \
  --doc-name "test-doc" \
  --file ./test.md \
  --dry-run
```

# Safety And Review Checklist

Use this checklist before editing, committing, pushing, or changing access control.

## Non-Negotiables

- Do not commit `config`.
- Do not commit Dify API keys, Cloudflare API tokens, Cloudflare Tunnel tokens, Cloudflare Access service tokens, cookies, JWTs, SSH private keys, or one-time login codes.
- Do not commit real private IP addresses, private hostnames, dataset IDs, customer names, or production document names.
- Do not expose Dify itself to the public Internet.
- Do not give write access to broad groups. `add_knowledge` should stay limited to maintainers.

## Before Commit

Run:

```bash
git status --short
git diff --check
```

Then inspect staged files:

```bash
git diff --cached --name-only
```

Block the commit if any of these appear:

- `config`
- `*.pdf`
- generated page images
- OCR scratch files
- real API keys or tokens
- local logs containing headers or auth data

Search for accidental concrete environment details:

```bash
rg -n "192\\.168|10\\.|172\\.16|localhost/v1|dataset-|app-|Bearer |cf-access|cloudflared service install|eyJ" .
```

This search can produce false positives in documentation. Review each hit before deciding.

## Public Documentation Rules

Use placeholders:

```text
https://mcp.example.com/rag
https://api.example.com/rag
admin@example.com
user@example.com
```

Avoid production-only examples. If a specific local value is useful for the current operator, put it in a local file under `~/.dify-rag/`, not in Git.

## Access Control Rules

There are two independent permission layers:

- Remote MCP OAuth allowlist: who can use the connector. Configure this with `DIFY_RAG_AUTH_ALLOWED_EMAILS` or `DIFY_RAG_AUTH_ALLOWED_DOMAINS`.
- `DIFY_RAG_ADD_ALLOWED_EMAILS`: who can use `add_knowledge`.

Do not add every connector user to `DIFY_RAG_ADD_ALLOWED_EMAILS`. Most users should search only.

## Good Final Checks

For the Dify host:

```bash
./scripts/doctor-remote-mcp.sh
curl -sS http://127.0.0.1:8787/health
curl -sS http://127.0.0.1:8788/health
```

For public endpoints:

```bash
curl -sS https://mcp.example.com/.well-known/oauth-protected-resource/rag
```

The MCP hostname should expose OAuth protected resource metadata. A Cloudflare Access redirect on the MCP hostname will prevent Claude Custom Connectors from connecting.

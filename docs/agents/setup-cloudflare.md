# Set Up Cloudflare Tunnel And Access

Use this runbook to publish the Dify RAG connector without exposing Dify itself.

## Goal

Create two public hostnames:

```text
https://rag-api.example.com  -> http://127.0.0.1:8787
https://rag-mcp.example.com  -> http://127.0.0.1:8788
```

The important user-facing connector URL is:

```text
https://rag-mcp.example.com/mcp
```

`rag-api` is for the gateway and debugging. Employees should not open it directly.

## Cloudflare Tunnel

In Cloudflare Zero Trust, create or reuse a tunnel for the Dify host. Add public hostnames:

- `rag-api.example.com` to service `http://127.0.0.1:8787`
- `rag-mcp.example.com` to service `http://127.0.0.1:8788`

Install the tunnel on the Dify host using the Cloudflare-provided command. The command contains a token. Do not paste that token into Git, issues, chat logs, or docs.

Verify on the host:

```bash
launchctl print system/com.cloudflare.cloudflared | sed -n '1,35p'
```

If the command output contains a token, do not copy it into final reports.

## Cloudflare Access

Create a self-hosted Access application for the Remote MCP hostname:

```text
Application name: rag-mcp
Destination: rag-mcp.example.com
Policy: allow only approved user emails
```

Create another Access application for the gateway hostname if you publish it:

```text
Application name: rag-api
Destination: rag-api.example.com
Policy: allow only approved admin or operator emails
```

Cloudflare Access should pass the authenticated email to the origin. The Remote MCP server checks these headers:

- `cf-access-authenticated-user-email`
- `cf-access-jwt-assertion`
- `authorization` bearer JWT with an `email` claim

## Public Verification

From any machine not already authenticated through Cloudflare Access:

```bash
curl -sS -I https://rag-mcp.example.com/health | sed -n '1,16p'
curl -sS -I https://rag-mcp.example.com/mcp | sed -n '1,16p'
```

Expected result:

```text
HTTP/2 302
location: https://...cloudflareaccess.com/...
www-authenticate: Cloudflare-Access ...
```

If you get `200 OK` without authentication, the hostname is exposed and the Access app is not protecting it.

## Connector URL For Claude

Use:

```text
https://rag-mcp.example.com/mcp
```

Do not configure Claude to use:

```text
https://rag-api.example.com
https://rag-mcp.example.com/health
http://127.0.0.1:8788/mcp
```

## Acceptance Criteria

- Dify host local `/health` endpoints return `200`.
- Public `rag-mcp` returns Cloudflare Access redirect before login.
- After login, Claude Custom Connector can list `search_knowledge` and `add_knowledge`.
- A search-only user can use `search_knowledge`.
- A search-only user receives the write-denied message when calling `add_knowledge`.
- A maintainer listed in `DIFY_RAG_ADD_ALLOWED_EMAILS` can use `add_knowledge`.


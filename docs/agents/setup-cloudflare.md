# Set Up Cloudflare Tunnel And Access

Use this runbook to publish the Dify RAG connector without exposing Dify itself.

## Goal

Create two public hostnames:

```text
https://api.example.com/rag  -> http://127.0.0.1:8787
https://mcp.example.com/rag  -> http://127.0.0.1:8788
```

The important user-facing connector URL is:

```text
https://mcp.example.com/rag
```

`api.example.com/rag` is for the gateway and debugging. End users should not open it directly.

## Cloudflare Tunnel

In Cloudflare Zero Trust, create or reuse a tunnel for the Dify host. Add public hostnames:

- `api.example.com` to service `http://127.0.0.1:8787`
- `mcp.example.com` to service `http://127.0.0.1:8788`

Install the tunnel on the Dify host using the Cloudflare-provided command. The command contains a token. Do not paste that token into Git, issues, chat logs, or docs.

Verify on the host:

```bash
launchctl print system/com.cloudflare.cloudflared | sed -n '1,35p'
```

If the command output contains a token, do not copy it into final reports.

## Cloudflare Access

Create a self-hosted Access application for the Remote MCP hostname:

```text
Application name: mcp-rag
Destination: mcp.example.com
Policy: allow only approved user emails
```

Create another Access application for the gateway hostname if you publish it:

```text
Application name: api-rag
Destination: api.example.com
Policy: allow only approved admin or operator emails
```

Cloudflare Access should pass the authenticated email to the origin. The Remote MCP server checks these headers:

- `cf-access-authenticated-user-email`
- `cf-access-jwt-assertion`
- `authorization` bearer JWT with an `email` claim

## Public Verification

From any machine not already authenticated through Cloudflare Access:

```bash
curl -sS -I https://mcp.example.com/rag | sed -n '1,16p'
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
https://mcp.example.com/rag
```

Do not configure Claude to use:

```text
https://api.example.com/rag
https://mcp.example.com/health
http://127.0.0.1:8788/rag
```

## Acceptance Criteria

- Dify host local `/health` endpoints return `200`.
- Public `mcp.example.com/rag` returns Cloudflare Access redirect before login.
- After login, Claude Custom Connector can list `search_knowledge` and `add_knowledge`.
- A search-only user can use `search_knowledge`.
- A search-only user receives the write-denied message when calling `add_knowledge`.
- A maintainer listed in `DIFY_RAG_ADD_ALLOWED_EMAILS` can use `add_knowledge`.

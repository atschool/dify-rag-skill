# Set Up Cloudflare Tunnel And Remote MCP OAuth

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

## Remote MCP OAuth

Do not put Cloudflare Access in front of `mcp.example.com`. Claude Custom Connectors need to reach the MCP endpoint and complete OAuth with the connector. A Cloudflare Access redirect makes Claude see a login page instead of an MCP server.

Set OAuth on the Dify host:

```bash
DIFY_RAG_REMOTE_PUBLIC_URL=https://mcp.example.com/rag
DIFY_RAG_AUTH_PROVIDER=google
DIFY_RAG_AUTH_ALLOWED_EMAILS=user@example.com,maintainer@example.com
DIFY_RAG_AUTH_ALLOWED_DOMAINS=example.com
DIFY_RAG_ADD_ALLOWED_EMAILS=maintainer@example.com
```

Create a Google Cloud Web OAuth client and configure Claude's Custom Connector with that client ID and client secret.

Authorized redirect URI:

```text
https://claude.ai/api/mcp/auth_callback
```

Use scopes:

```text
openid email profile
```

## Cloudflare Access For Gateway

Create a self-hosted Access application for the gateway hostname if you publish it:

```text
Application name: api-rag
Destination: api.example.com
Policy: allow only approved admin or operator emails
```

## Public Verification

From any machine:

```bash
curl -sS https://mcp.example.com/.well-known/oauth-protected-resource/rag
```

Expected result:

```json
{
  "resource": "https://mcp.example.com/rag",
  "authorization_servers": ["https://accounts.google.com"]
}
```

An unauthenticated protected tool call should return `401` with a `WWW-Authenticate: Bearer ...` challenge. A Cloudflare Access `302` redirect on the MCP hostname is a misconfiguration for Claude Custom Connectors.

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
- Public `mcp.example.com/.well-known/oauth-protected-resource/rag` returns OAuth protected resource metadata.
- Claude Custom Connector can list `search_knowledge` and `add_knowledge`.
- A search-only user can use `search_knowledge`.
- A search-only user receives the write-denied message when calling `add_knowledge`.
- A maintainer listed in `DIFY_RAG_ADD_ALLOWED_EMAILS` can use `add_knowledge`.

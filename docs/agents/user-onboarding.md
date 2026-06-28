# Connector User Onboarding

Use this runbook when adding, removing, or testing a Claude user.

## Decide The User Type

Search-only user:

- Add the email to Cloudflare Access.
- Do not add the email to `DIFY_RAG_ADD_ALLOWED_EMAILS`.

Knowledge maintainer:

- Add the email to Cloudflare Access.
- Add the email to `DIFY_RAG_ADD_ALLOWED_EMAILS` on the Dify host.
- Restart or reload the Remote MCP service if needed.

Most users should be search-only users.

## Add Search Access

On an admin machine with `rag-access-email` configured:

```bash
rag-access-email add user@example.com
rag-access-email list
```

Tell the user to connect Claude to:

```text
https://rag-mcp.example.com/mcp
```

They do not need:

- Dify API keys.
- Cloudflare API tokens.
- This repository.
- Terminal commands.
- Local `config` files.

## Test Search

Ask Claude something like:

```text
Search the configured Dify knowledge base for what the product overview says about service features.
```

Expected behavior:

- Claude uses the Custom Connector / Remote MCP.
- `search_knowledge` is called.
- The answer is based on retrieved chunks.
- Claude should not search Google Drive as the primary route when the user explicitly asks for Dify or the configured knowledge base.

## Test Write Permission For Search-Only Users

Ask Claude to add a small test document to the knowledge base. For search-only users, expected response from `add_knowledge` is:

```text
This connector account is not allowed to add or update knowledge. Ask a maintainer to add the material.
```

If a search-only user can add knowledge, remove their email from `DIFY_RAG_ADD_ALLOWED_EMAILS`.

## Add Maintainer Write Access

On the Dify host, edit:

```text
~/.dify-rag/config
```

Set:

```bash
DIFY_RAG_ADD_ALLOWED_EMAILS=admin@example.com,maintainer@example.com
```

Restart the Remote MCP service:

```bash
launchctl kickstart -k "gui/$(id -u)/com.atschool.dify-rag-remote-mcp"
./scripts/doctor-remote-mcp.sh
```

Then test `add_knowledge` with that maintainer account.

## Remove A User

Remove connector access:

```bash
rag-access-email remove user@example.com
rag-access-email list
```

If the user was a maintainer, also remove them from `DIFY_RAG_ADD_ALLOWED_EMAILS` on the Dify host and restart Remote MCP.

## Acceptance Checklist

- User can authenticate through Cloudflare Access.
- User can connect Claude to the Remote MCP URL.
- Search-only user can search.
- Search-only user cannot add knowledge.
- Maintainer can add knowledge only when explicitly allowlisted.

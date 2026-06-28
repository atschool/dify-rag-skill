# Agent Operating Guide

This file is the entry point for Claude, Codex, and other coding agents working in this repository.

The repository manages a Dify-backed RAG connector for Claude. The public README explains the project for humans. The files under `docs/agents/` are operational runbooks for agents that need to set up, maintain, or troubleshoot the system.

## First Rules

- Never commit or print local `config` files, Dify API keys, Cloudflare API tokens, Cloudflare Tunnel tokens, service tokens, session cookies, or copied JWTs.
- Never put real internal IP addresses, private hostnames, customer names, dataset IDs, or production-only examples into public docs.
- Keep `config.example` generic and empty.
- Prefer `rg` for repository search.
- Use `apply_patch` for manual edits.
- Before committing, run `git status --short` and verify that no local config, token, PDF, generated page image, or temporary extraction file is staged.
- Do not expose the Dify web/API service directly to the Internet. Public traffic should go through the Remote MCP or gateway endpoint protected by an identity-aware layer such as Cloudflare Access.

## Architecture Summary

There are three layers:

```text
Claude
  -> Remote MCP or local MCP
  -> dify-rag-gateway
  -> local Dify API
```

The preferred team deployment is:

```text
Employee Claude
  -> Claude Custom Connector
  -> https://rag-mcp.example.com/mcp
  -> Cloudflare Access
  -> Cloudflare Tunnel
  -> dify-rag-remote-mcp on the Dify host
  -> dify-rag-gateway on the Dify host
  -> local Dify API
```

The Remote MCP exposes:

- `search_knowledge`: available to users who can pass Cloudflare Access.
- `add_knowledge`: available only when the authenticated user email is listed in `DIFY_RAG_ADD_ALLOWED_EMAILS`.

Cloudflare Access controls who can reach the connector. `DIFY_RAG_ADD_ALLOWED_EMAILS` controls who can add or update knowledge after connecting. Keep those two permission layers separate.

## Task Routing

Read the relevant runbook before acting:

- Dify host setup or service install: `docs/agents/setup-dify-host.md`
- Cloudflare Tunnel, hostnames, or Access app setup: `docs/agents/setup-cloudflare.md`
- `rag-access-email` command setup: `docs/agents/setup-admin-command.md`
- Add, remove, or test an employee: `docs/agents/employee-onboarding.md`
- Diagnose broken search, connector, tunnel, or write permission: `docs/agents/troubleshooting.md`
- General safety rules and review checklist: `docs/agents/safety.md`

## Human-Required Boundaries

Agents can prepare commands, edit repository files, inspect logs, and run local checks. A human may need to complete or approve:

- Creating Cloudflare API tokens.
- Logging in to Cloudflare, Claude, Google, or Dify.
- Approving browser permission prompts that change access policy or create persistent credentials.
- Pasting one-time secrets into Keychain or local environment variables.
- Confirming public DNS, Cloudflare Access policies, and employee email lists.

When a task touches access control, first inspect the current state and prepare the exact change. Only apply the change when the user has clearly asked you to proceed.


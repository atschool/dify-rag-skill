# Set Up Or Repair The Dify Host

Use this runbook on the always-on machine that runs Dify, the gateway, and the Remote MCP server.

## Goal

The host should run:

- Dify itself.
- `dify-rag-gateway` on `127.0.0.1:8787`.
- `dify-rag-remote-mcp` on `127.0.0.1:8788/rag`.
- `cloudflared` as a system service that publishes public hostnames through Cloudflare Tunnel.

Only this host should store Dify API keys.

## Prerequisites

Install runtime dependencies:

```bash
brew install node cloudflared poppler
```

Verify:

```bash
node -v
npm -v
cloudflared --version
pdftoppm -v
```

## Install The Repository

```bash
git clone https://github.com/atschool/dify-rag-skill.git
cd dify-rag-skill
git checkout develop
./install.sh
```

For the Dify host, leave `DIFY_RAG_GATEWAY_URL` empty when prompted. Enter:

- Dify Workflow API key for ingestion.
- Dify Knowledge Base API key for search.
- Dify API base URL, usually a local URL such as `http://127.0.0.1/v1`.

The installer writes local config to:

```text
~/.dify-rag/config
```

Do not commit this file.

## Configure Remote MCP Host Values

On the Dify host, the Remote MCP should call the local gateway:

```bash
grep -q '^DIFY_RAG_REMOTE_GATEWAY_URL=' ~/.dify-rag/config &&
  sed -i.bak 's#^DIFY_RAG_REMOTE_GATEWAY_URL=.*#DIFY_RAG_REMOTE_GATEWAY_URL=http://127.0.0.1:8787#' ~/.dify-rag/config
```

Set write access only for maintainers:

```bash
grep -q '^DIFY_RAG_ADD_ALLOWED_EMAILS=' ~/.dify-rag/config &&
  sed -i.bak 's#^DIFY_RAG_ADD_ALLOWED_EMAILS=.*#DIFY_RAG_ADD_ALLOWED_EMAILS=admin@example.com#' ~/.dify-rag/config
```

Adjust the email list for the real maintainers. Do not add ordinary search-only users here.

## Install launchd Services

```bash
./scripts/install-gateway-launchd.sh
./scripts/install-remote-mcp-launchd.sh
```

Verify:

```bash
./scripts/doctor-remote-mcp.sh
```

Expected local health:

```json
{
  "ok": true,
  "service": "dify-rag-gateway",
  "config_loaded": true
}
```

```json
{
  "ok": true,
  "service": "dify-rag-remote-mcp",
  "config_loaded": true,
  "gateway_url": "http://127.0.0.1:8787",
  "add_allowlist_configured": true
}
```

## Test MCP Tools Locally

From the Dify host:

```bash
cd ~/.dify-rag/remote-mcp
node --input-type=module <<'NODE'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "smoke-test", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8788/rag"));
await client.connect(transport);
const tools = await client.listTools();
console.log(tools.tools.map((tool) => `${tool.name}: ${tool.description}`).join("\n"));
await client.close();
NODE
```

Expected tools:

```text
search_knowledge: Search the configured Dify knowledge base for relevant source chunks.
add_knowledge: Add or update prepared Markdown in the configured Dify knowledge base. Maintainer access is required.
```

## Dify Health

Check Dify containers and local web frontend:

```bash
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
```

A redirect from the frontend can be normal. API failures should be diagnosed with Dify container logs.

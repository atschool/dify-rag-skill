# dify-rag-skill

Claude Code skills and scripts for using Dify as a RAG knowledge system.

This repository contains two companion skills:

- `dify-rag-inject`: prepare Google Drive documents as retrieval-friendly Markdown and send them to a Dify ingestion Workflow.
- `dify-rag-search`: search Dify knowledge bases and return retrieved chunks so Claude can write the final answer.
- `dify-rag` MCP server: expose Dify search and ingestion to Claude.app / Claude Desktop.
- `dify-rag-gateway`: optional HTTP gateway for teams, so employee machines do not need Dify API keys.
- `dify-rag-remote-mcp`: Remote MCP server for a Claude Custom Connector.

The design keeps responsibilities separate:

- Dify stores and retrieves knowledge.
- Claude Code reads source documents, prepares Markdown, inspects retrieved chunks, and writes user-facing answers.
- Dify is not asked to generate the final answer in the search flow.
- In team mode, only the gateway host stores Dify API keys. Employee machines call the gateway.
- In connector mode, employees connect Claude to one Remote MCP endpoint. Search is available to connector users, while document addition is allowlisted by email.

This is an independent helper project. It is not an official Dify, Anthropic, or Google product.

## What It Does

### Ingestion

When you ask Claude Code to add a Drive document to Dify, the ingestion skill guides Claude Code through:

1. Find the target file in Google Drive.
2. Detect whether the file has a text layer.
3. Convert image-heavy PDFs into page images when needed.
4. Read and structure the content as Markdown.
5. Send `category`, `doc_name`, and `doc_text` to a Dify Workflow API.
6. Let your Dify Workflow create or update the appropriate knowledge document.

Claude.app / Claude Desktop can do the same ingestion flow through the MCP server:

1. Use its Drive connector to read the source document.
2. Convert the content into retrieval-friendly Markdown.
3. Call `inject_dify_knowledge` with `category`, `doc_name`, and `markdown`.
4. Let the local MCP server call the configured Dify ingestion Workflow.

### Search

When you ask Claude Code to search the knowledge base, the search skill:

1. Sends the query to Dify Knowledge Base retrieve APIs.
2. Searches one or more Dify datasets.
3. Merges retrieved chunks by score.
4. Prints source document names, scores, and chunk text.
5. Lets Claude produce the final answer from that evidence.

## Repository Contents

- `SKILL.md`: ingestion skill instructions.
- `search/SKILL.md`: search skill instructions.
- `dify_inject.py`: Python client for calling Dify `/workflows/run`.
- `dify_search.py`: Python client for Dify dataset listing and retrieval.
- `mcp-server/`: local MCP server for Claude.app / Claude Desktop.
- `gateway/`: HTTP gateway for shared/team deployments.
- `remote-mcp/`: Streamable HTTP Remote MCP server for Claude Custom Connectors.
- `install.sh`: interactive installer for both skills.
- `config.example`: safe config template with no real URL or API key.
- `AGENTS.md`: entry point for Claude, Codex, and other agents operating this repo.
- `docs/agents/`: task-specific setup, onboarding, and troubleshooting runbooks for agents.

## Requirements

- macOS or Linux shell environment.
- Claude Code with Google Drive MCP or an equivalent Drive connector configured.
- A populated Dify knowledge base.
- A published Dify Workflow app for ingestion.
- A Dify Workflow API key for ingestion.
- A Dify Knowledge Base API key for search.
- Python 3.
- Node.js 20 or later for Claude.app MCP use and gateway use.
- `pdftoppm` from Poppler for image-heavy PDFs.

On macOS, install Poppler with:

```bash
brew install poppler
```

## Dify API Contracts

### Ingestion Workflow

The ingestion skill does not create the Dify Workflow for you. You need a published Dify Workflow app that accepts these inputs:

| Input | Type | Description |
|---|---|---|
| `category` | string | Knowledge base, collection, or routing category. |
| `doc_name` | string | Document name to create or update. |
| `doc_text` | string | Retrieval-ready Markdown body. |

The included ingestion client sends this payload to:

```text
<DIFY_BASE_URL>/workflows/run
```

with:

```json
{
  "inputs": {
    "category": "...",
    "doc_name": "...",
    "doc_text": "..."
  },
  "response_mode": "blocking",
  "user": "dify-rag-skill"
}
```

How the Dify Workflow creates datasets, documents, chunks, or upserts is up to your Dify implementation.

### Search Retrieve API

The search skill uses Dify Knowledge Base APIs:

- `GET /datasets` to discover visible datasets.
- `POST /datasets/{dataset_id}/retrieve` to retrieve chunks.

If `DIFY_DATASET_IDS` is empty, the search client lists visible datasets and searches across them. If you want to restrict search scope, configure comma-separated dataset IDs.

## Install

Clone the repository and run the installer:

```bash
git clone https://github.com/atschool/dify-rag-skill.git
cd dify-rag-skill
./install.sh
```

The installer will:

- Copy the ingestion skill to `~/.claude/skills/dify-rag-inject/`.
- Copy the search skill to `~/.claude/skills/dify-rag-search/`.
- Copy the MCP server to `~/.dify-rag/mcp-server/`.
- Copy the Remote MCP server to `~/.dify-rag/remote-mcp/`.
- Check whether `pdftoppm` is available.
- Install MCP server and Remote MCP npm dependencies when Node.js and npm are available.
- Create a shared local config at `~/.dify-rag/config`.
- Ask for your Dify Workflow API key.
- Ask for your Dify Knowledge Base API key.
- Ask for your Dify API base URL if it is not already configured.

The config file is local to your machine and is intentionally ignored by Git.

For employee installs that should not store Dify API keys locally, enter a hosted gateway URL when the installer asks for it. In that mode, the installer skips the Dify API key prompts.

## Claude.app / Claude Desktop MCP Setup

Claude Code can read the installed skills directly. Claude.app / Claude Desktop cannot. To use Dify search from Claude.app, add the MCP server to your Claude desktop config.

After running `./install.sh`, the MCP server is installed at:

```text
~/.dify-rag/mcp-server/server.mjs
```

On macOS, edit:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Add or merge this entry, replacing `/Users/you` with your actual home directory:

```json
{
  "mcpServers": {
    "dify-rag": {
      "command": "node",
      "args": ["/Users/you/.dify-rag/mcp-server/server.mjs"]
    }
  }
}
```

Then restart Claude.app.

The MCP server exposes:

- `search_dify_knowledge`: search Dify and return retrieved chunks.
- `list_dify_datasets`: list datasets visible to the configured Knowledge Base API key.
- `inject_dify_knowledge`: add or update a prepared Markdown document through the configured Dify ingestion Workflow.

## Configuration

The installer creates:

```text
~/.dify-rag/config
```

The file uses simple `KEY=VALUE` lines:

```bash
DIFY_BASE_URL=
DIFY_APP_KEY=
DIFY_DATASET_API_KEY=
DIFY_DATASET_IDS=
DIFY_RAG_GATEWAY_URL=
DIFY_RAG_REMOTE_GATEWAY_URL=
DIFY_RAG_SHARED_SECRET=
DIFY_RAG_CLOUDFLARE_ACCESS=auto
DIFY_RAG_CLOUDFLARED_BIN=cloudflared
DIFY_RAG_REMOTE_MCP_HOST=127.0.0.1
DIFY_RAG_REMOTE_MCP_PORT=8788
DIFY_RAG_REMOTE_MCP_PATH=/mcp
DIFY_RAG_ADD_ALLOWED_EMAILS=
```

Use the Dify API base URL for `DIFY_BASE_URL`. Common examples look like:

```bash
DIFY_BASE_URL=https://your-dify.example.com/v1
DIFY_BASE_URL=http://localhost/v1
```

Use:

- `DIFY_APP_KEY` for the ingestion Workflow API key.
- `DIFY_DATASET_API_KEY` for Knowledge Base search API access.
- `DIFY_DATASET_IDS` only when you want to restrict search to specific datasets.
- `DIFY_RAG_GATEWAY_URL` for employee/team installs that should call a hosted gateway instead of Dify directly.
- `DIFY_RAG_REMOTE_GATEWAY_URL` for the Remote MCP server when it should call a different gateway URL. Leave empty on the Dify host to use `http://127.0.0.1:8787`.
- `DIFY_RAG_SHARED_SECRET` only when you deliberately protect the gateway with a shared bearer token. Prefer Cloudflare Access or another identity-aware proxy for team use.
- `DIFY_RAG_CLOUDFLARE_ACCESS=auto` lets the MCP server automatically attach a user-scoped Cloudflare Access token when the gateway redirects to Access.
- `DIFY_RAG_CLOUDFLARED_BIN` can point to a custom `cloudflared` binary path.
- `DIFY_RAG_REMOTE_MCP_HOST`, `DIFY_RAG_REMOTE_MCP_PORT`, and `DIFY_RAG_REMOTE_MCP_PATH` control the Remote MCP listener. The default endpoint is `http://127.0.0.1:8788/mcp`.
- `DIFY_RAG_ADD_ALLOWED_EMAILS` is a comma-separated allowlist for `add_knowledge`. Users not on the list can still use `search_knowledge`.

Environment variables are also supported and take precedence over the config file:

```bash
export DIFY_BASE_URL="https://your-dify.example.com/v1"
export DIFY_APP_KEY="your-workflow-api-key"
export DIFY_DATASET_API_KEY="your-knowledge-base-api-key"
export DIFY_DATASET_IDS="dataset-id-1,dataset-id-2"
export DIFY_RAG_GATEWAY_URL="https://your-gateway.example.com"
export DIFY_RAG_CLOUDFLARE_ACCESS="auto"
export DIFY_RAG_ADD_ALLOWED_EMAILS="admin@example.com,knowledge-owner@example.com"
```

## Team Gateway Mode

Use gateway mode when multiple employees need Claude.app access but you do not want to distribute Dify API keys.

Recommended layout:

```text
Employee Claude.app
  -> local dify-rag MCP server
  -> https://your-gateway.example.com
  -> Cloudflare Tunnel / Access
  -> dify-rag-gateway on the Dify host
  -> local Dify API
```

On the Dify host, install this repository normally and configure direct Dify settings:

```bash
git clone https://github.com/atschool/dify-rag-skill.git
cd dify-rag-skill
./install.sh
```

Then run the gateway:

```bash
node ~/.dify-rag/gateway/server.mjs
```

The gateway listens on `127.0.0.1:8787` by default. Put Cloudflare Tunnel in front of that local service. Do not route a public hostname directly to Dify itself.

For an always-on Mac host, install the gateway as a launchd service:

```bash
./scripts/install-gateway-launchd.sh
./scripts/doctor-gateway.sh
```

The doctor command checks local Dify, the gateway health endpoint, the launchd service, and whether `cloudflared` is running.

For employee machines, install the same repository and enter only the hosted gateway URL when prompted:

```bash
git clone https://github.com/atschool/dify-rag-skill.git
cd dify-rag-skill
./install.sh
```

After installation, configure Claude.app to run:

```text
node ~/.dify-rag/mcp-server/server.mjs
```

The employee MCP server will call `DIFY_RAG_GATEWAY_URL` and will not require `DIFY_BASE_URL`, `DIFY_APP_KEY`, or `DIFY_DATASET_API_KEY`.

If the hosted gateway is protected by Cloudflare Access, each employee should install `cloudflared` and authenticate once:

```bash
brew install cloudflared
cloudflared access login https://your-gateway.example.com
```

After login, the MCP server obtains a user-scoped Access token with `cloudflared access token -app=...` and sends it as the `cf-access-token` header. Employees do not receive Dify API keys.

## Remote MCP / Custom Connector Mode

Use Remote MCP mode when employees should use Claude from web, desktop, or mobile without installing this repository locally.

Recommended layout:

```text
Employee Claude
  -> Claude Custom Connector
  -> https://your-mcp.example.com/mcp
  -> Cloudflare Access
  -> Cloudflare Tunnel
  -> dify-rag-remote-mcp on the Dify host
  -> dify-rag-gateway on the Dify host
  -> local Dify API
```

Keep the two hostnames conceptually separate:

- `rag-api.example.com`: internal gateway API for installed local clients or debugging.
- `rag-mcp.example.com`: Remote MCP endpoint that Claude Custom Connector connects to.

The public Custom Connector should point to the Remote MCP URL:

```text
https://rag-mcp.example.com/mcp
```

The Remote MCP server exposes exactly two user-facing tools:

- `search_knowledge`: `社内ナレッジから関連情報を検索します。`
- `add_knowledge`: `資料を社内ナレッジに追加・更新します。利用権限があるメンバー向けの機能です。`

Configure the allowlist on the Dify host:

```bash
DIFY_RAG_ADD_ALLOWED_EMAILS=admin@example.com,knowledge-owner@example.com
```

If a user who is not allowlisted tries to add material, the tool returns:

```text
この機能は、現在のアカウントでは利用できません。資料追加が必要な場合は、管理者またはナレッジ担当者に依頼してください。
```

On the Dify host, install and start both local services:

```bash
./install.sh
./scripts/install-gateway-launchd.sh
./scripts/install-remote-mcp-launchd.sh
./scripts/doctor-remote-mcp.sh
```

The Remote MCP server listens on `127.0.0.1:8788` by default. Put a Cloudflare Tunnel public hostname in front of it:

```text
https://rag-mcp.example.com -> http://127.0.0.1:8788
```

Protect that hostname with Cloudflare Access or equivalent identity-aware access control so the Remote MCP server receives the authenticated user email header.

For Claude Custom Connector setup, use Streamable HTTP and the `/mcp` endpoint. Claude custom connectors are configured from Claude settings and connect to a publicly reachable HTTPS MCP server.

### Manage Cloudflare Access Emails

For small teams, you can add or remove allowed connector users from the command line instead of opening the Cloudflare dashboard every time.

This is an administrator-only task. Regular connector users do not need a Cloudflare API token, this repository, a terminal command, or local setup for `rag-access-email`. They only need to connect Claude to the published Custom Connector URL after their email address has been allowed in Cloudflare Access.

Recommended operation:

- Admins who add or remove connector users configure `rag-access-email`.
- Employees who only search knowledge do not configure it.
- Windows employees do not need this command unless they are also responsible for managing the Cloudflare Access allowlist.
- For simplicity, keep allowlist management on one or two admin Macs.

First create a Cloudflare API token with permission to edit Access policies. Store only non-secret IDs in a local config file:

```bash
mkdir -p ~/.dify-rag
cat > ~/.dify-rag/cloudflare-access.env <<'EOF'
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_ACCESS_POLICY_ID=your-policy-id
EOF
```

Store the API token in macOS Keychain:

```bash
security add-generic-password \
  -a "$USER" \
  -s dify-rag-cloudflare-api-token \
  -w "YOUR_CLOUDFLARE_API_TOKEN" \
  -U
```

Then use:

```bash
./scripts/cloudflare-access-email.sh list
./scripts/cloudflare-access-email.sh add user@example.com
./scripts/cloudflare-access-email.sh remove user@example.com
```

To call it from anywhere, install the shortcut command:

```bash
./scripts/install-admin-command.sh
```

Then:

```bash
rag-access-email add user@example.com
rag-access-email list
```

This controls who can reach the Remote MCP connector through Cloudflare Access. It is separate from `DIFY_RAG_ADD_ALLOWED_EMAILS`, which controls who can use the `add_knowledge` tool after they are already connected.

## Usage From Claude Code

### Add Documents To Dify

Ask Claude Code something like:

```text
Find the product overview PDF in Drive and add it to Dify under category "product-docs".
```

Claude Code should use `dify-rag-inject`.

### Search Dify

Ask Claude Code something like:

```text
Search Dify for what the product docs say about account setup.
```

Or:

```text
/rag account setup
```

Claude Code should use `dify-rag-search`, inspect the returned chunks, and answer from those chunks. If the chunks do not support an answer, Claude should say so instead of guessing.

In Claude.app / Claude Desktop, ask the same thing after configuring the MCP server. Claude should use the `search_dify_knowledge` MCP tool instead of searching Google Drive directly.

### Add Documents From Claude.app / Claude Desktop

Ask Claude.app something like:

```text
Find the event sponsorship PDF in Google Drive, convert it to RAG-friendly Markdown, and add it to Dify under category "events".
```

Claude.app should read the source document with its Drive connector, prepare Markdown, and then call `inject_dify_knowledge`. The MCP server reads `DIFY_APP_KEY` from your local config; the key is not committed to Git.

## Manual Ingestion

If you already have a Markdown file, call the ingestion client directly:

```bash
python3 ~/.claude/skills/dify-rag-inject/dify_inject.py \
  --category "product-docs" \
  --doc-name "product-overview" \
  --file "./product-overview.md"
```

Preview without sending:

```bash
python3 ~/.claude/skills/dify-rag-inject/dify_inject.py \
  --category "product-docs" \
  --doc-name "product-overview" \
  --file "./product-overview.md" \
  --dry-run
```

## Manual Search

Search all visible datasets:

```bash
python3 ~/.claude/skills/dify-rag-search/dify_search.py \
  --query "account setup" \
  --top-k 5
```

Search a specific dataset:

```bash
python3 ~/.claude/skills/dify-rag-search/dify_search.py \
  --query "account setup" \
  --dataset-id "<dataset-id>" \
  --top-k 5
```

Filter datasets by name or exact ID:

```bash
python3 ~/.claude/skills/dify-rag-search/dify_search.py \
  --query "account setup" \
  --category "onboarding" \
  --top-k 5
```

JSON output:

```bash
python3 ~/.claude/skills/dify-rag-search/dify_search.py \
  --query "account setup" \
  --format json
```

List visible datasets:

```bash
python3 ~/.claude/skills/dify-rag-search/dify_search.py \
  --list-datasets
```

## Uninstall

Remove installed skills and local config:

```bash
rm -rf ~/.claude/skills/dify-rag-inject
rm -rf ~/.claude/skills/dify-rag-search
rm -rf ~/.dify-rag
```

This does not remove anything from Dify.

## Security Notes

- Never commit `config`; it may contain API keys.
- `config.example` must stay free of real URLs, keys, dataset IDs, customer names, or internal examples.
- The installer sets the local config file to mode `600` when it creates or updates it.
- The search client prints retrieved source chunks. Treat terminal output and logs accordingly.
- Review generated Markdown before uploading if the source document contains sensitive data.
- For public forks, keep examples generic and avoid real company, customer, dataset, or network details.
- For team deployments, publish only the gateway or Remote MCP endpoint. Do not expose the Dify web/API service directly to the Internet.
- For Custom Connector deployments, point Claude at the Remote MCP endpoint rather than Dify itself.
- Protect the gateway and Remote MCP endpoint with Cloudflare Access, a private network, or equivalent controls before running them against sensitive knowledge bases.
- Keep `DIFY_RAG_ADD_ALLOWED_EMAILS` narrow. Search and write permissions are intentionally separate.

## Troubleshooting

| Symptom | Likely Cause | What To Check |
|---|---|---|
| `DIFY_BASE_URL is not set` | Missing base URL | Run `./install.sh` or set the environment variable. |
| `APIキーが未設定` or `DIFY_APP_KEY` missing | Missing Workflow API key | Set the ingestion Workflow API key. |
| `DIFY_DATASET_API_KEY is not set` | Missing Knowledge Base API key | Set the Knowledge Base API key. |
| `HTTP 401` | Invalid key or wrong key type | Check whether you are using the right key for Workflow or Knowledge Base API access. |
| `No datasets matched` | Dataset filter too narrow or key lacks access | Check `DIFY_DATASET_IDS`, `--category`, and key permissions. |
| Claude.app searches Google Drive instead of Dify | MCP server is not configured or Claude.app was not restarted | Check `claude_desktop_config.json`, restart Claude.app, and confirm the `dify-rag` MCP server is connected. |
| MCP server fails to start | Node dependencies are missing | Rerun `./install.sh` after installing Node.js and npm. |
| `Workflow not published` | Dify Workflow is not published | Publish the Workflow app in Dify. |
| Connection error | Dify is unreachable | Confirm the URL, network, reverse proxy, and `/v1` API path. |
| `pdftoppm` not found | Poppler is missing | Install Poppler with `brew install poppler` on macOS. |
| Image text is hard to read | PDF render resolution is too low | Increase the `pdftoppm` DPI in the ingestion skill workflow. |

## Development

Run basic checks before opening a pull request:

```bash
bash -n install.sh
python3 -m py_compile dify_inject.py dify_search.py
node --check mcp-server/server.mjs
node --check gateway/server.mjs
node --check remote-mcp/server.mjs
```

Test the installer without touching your real home directory:

```bash
tmp_home=$(mktemp -d)
printf 'workflow-key\nknowledge-key\nhttp://localhost/v1\n' | HOME="$tmp_home" bash install.sh
cat "$tmp_home/.dify-rag/config"
```

Test MCP server startup:

```bash
node ~/.dify-rag/mcp-server/server.mjs
```

It should stay running and log to stderr. Press `Ctrl-C` to stop it.

Before publishing or releasing, scan for accidental private data:

```bash
rg -n '192\.168\.[0-9]+\.[0-9]+|(^|[^0-9])10\.[0-9]+\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[0-1])\.[0-9]+\.[0-9]+|DIFY_APP_KEY=.+|DIFY_DATASET_API_KEY=.+|customer|internal' .
git status --short
```

## Repository Status

This project is a lightweight integration helper. It assumes you already operate Dify and can design the ingestion Workflow and dataset permissions appropriate for your organization.

## License

MIT. See [LICENSE](./LICENSE).

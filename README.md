# dify-rag-skill

Claude Code skills and scripts for using Dify as a RAG knowledge system.

This repository contains two companion skills:

- `dify-rag-inject`: prepare Google Drive documents as retrieval-friendly Markdown and send them to a Dify ingestion Workflow.
- `dify-rag-search`: search Dify knowledge bases and return retrieved chunks so Claude can write the final answer.

The design keeps responsibilities separate:

- Dify stores and retrieves knowledge.
- Claude Code reads source documents, prepares Markdown, inspects retrieved chunks, and writes user-facing answers.
- Dify is not asked to generate the final answer in the search flow.

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
- `install.sh`: interactive installer for both skills.
- `config.example`: safe config template with no real URL or API key.

## Requirements

- macOS or Linux shell environment.
- Claude Code with Google Drive MCP or an equivalent Drive connector configured.
- A populated Dify knowledge base.
- A published Dify Workflow app for ingestion.
- A Dify Workflow API key for ingestion.
- A Dify Knowledge Base API key for search.
- Python 3.
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
- Check whether `pdftoppm` is available.
- Create a shared local config at `~/.dify-rag/config`.
- Ask for your Dify Workflow API key.
- Ask for your Dify Knowledge Base API key.
- Ask for your Dify API base URL if it is not already configured.

The config file is local to your machine and is intentionally ignored by Git.

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

Environment variables are also supported and take precedence over the config file:

```bash
export DIFY_BASE_URL="https://your-dify.example.com/v1"
export DIFY_APP_KEY="your-workflow-api-key"
export DIFY_DATASET_API_KEY="your-knowledge-base-api-key"
export DIFY_DATASET_IDS="dataset-id-1,dataset-id-2"
```

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

## Troubleshooting

| Symptom | Likely Cause | What To Check |
|---|---|---|
| `DIFY_BASE_URL is not set` | Missing base URL | Run `./install.sh` or set the environment variable. |
| `APIキーが未設定` or `DIFY_APP_KEY` missing | Missing Workflow API key | Set the ingestion Workflow API key. |
| `DIFY_DATASET_API_KEY is not set` | Missing Knowledge Base API key | Set the Knowledge Base API key. |
| `HTTP 401` | Invalid key or wrong key type | Check whether you are using the right key for Workflow or Knowledge Base API access. |
| `No datasets matched` | Dataset filter too narrow or key lacks access | Check `DIFY_DATASET_IDS`, `--category`, and key permissions. |
| `Workflow not published` | Dify Workflow is not published | Publish the Workflow app in Dify. |
| Connection error | Dify is unreachable | Confirm the URL, network, reverse proxy, and `/v1` API path. |
| `pdftoppm` not found | Poppler is missing | Install Poppler with `brew install poppler` on macOS. |
| Image text is hard to read | PDF render resolution is too low | Increase the `pdftoppm` DPI in the ingestion skill workflow. |

## Development

Run basic checks before opening a pull request:

```bash
bash -n install.sh
python3 -m py_compile dify_inject.py dify_search.py
```

Test the installer without touching your real home directory:

```bash
tmp_home=$(mktemp -d)
printf 'workflow-key\nknowledge-key\nhttp://localhost/v1\n' | HOME="$tmp_home" bash install.sh
cat "$tmp_home/.dify-rag/config"
```

Before publishing or releasing, scan for accidental private data:

```bash
rg -n '192\.168|10\.|172\.(1[6-9]|2[0-9]|3[0-1])|DIFY_APP_KEY=.+|DIFY_DATASET_API_KEY=.+|customer|internal' .
git status --short
```

## Repository Status

This project is a lightweight integration helper. It assumes you already operate Dify and can design the ingestion Workflow and dataset permissions appropriate for your organization.

## License

MIT. See [LICENSE](./LICENSE).

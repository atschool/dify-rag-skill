# dify-rag-skill

Claude Code skill for turning Google Drive documents into clean Markdown and sending them to a Dify Workflow for RAG knowledge ingestion.

This repository is designed for teams that want Claude Code to help with the messy part of RAG preparation: finding a Drive document, reading image-heavy PDFs, rewriting the content into retrieval-friendly Markdown, and sending the result to Dify.

This is an independent helper project. It is not an official Dify, Anthropic, or Google product.

## What It Does

When you ask Claude Code to add a Drive document to Dify, this skill guides Claude Code through the workflow:

1. Find the target file in Google Drive.
2. Detect whether the file has a text layer.
3. Convert image-heavy PDFs into page images when needed.
4. Read and structure the content as Markdown.
5. Send `category`, `doc_name`, and `doc_text` to a Dify Workflow API.
6. Let the Dify Workflow create or update the appropriate knowledge document.

The repository includes:

- `SKILL.md`: the Claude Code skill instructions.
- `dify_inject.py`: a small Python client for calling Dify `/workflows/run`.
- `install.sh`: an interactive installer for local Claude Code skill setup.
- `config.example`: a safe config template with no real URL or API key.

## Requirements

- macOS or Linux shell environment.
- Claude Code with Google Drive MCP or an equivalent Drive connector configured.
- A Dify Workflow app published with API access enabled.
- A Dify Workflow API key.
- Python 3.
- `pdftoppm` from Poppler for image-heavy PDFs.

On macOS, install Poppler with:

```bash
brew install poppler
```

## Dify Workflow Contract

This skill does not create the Dify Workflow for you. You need a published Dify Workflow app that accepts these inputs:

| Input | Type | Description |
|---|---|---|
| `category` | string | Knowledge base, collection, or routing category. |
| `doc_name` | string | Document name to create or update. |
| `doc_text` | string | Retrieval-ready Markdown body. |

The included client sends this payload to:

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

## Install

Clone the repository and run the installer:

```bash
git clone https://github.com/atschool/dify-rag-skill.git
cd dify-rag-skill
./install.sh
```

The installer will:

- Copy `SKILL.md` and `dify_inject.py` to `~/.claude/skills/dify-rag-inject/`.
- Check whether `pdftoppm` is available.
- Create `~/.claude/skills/dify-rag-inject/config` if it does not exist.
- Ask for your Dify Workflow API key.
- Ask for your Dify API base URL if it is not already configured.

The config file is local to your machine and is intentionally ignored by Git.

## Configuration

The installer creates:

```text
~/.claude/skills/dify-rag-inject/config
```

The file uses simple `KEY=VALUE` lines:

```bash
DIFY_BASE_URL=
DIFY_APP_KEY=
```

Use the Dify API base URL for `DIFY_BASE_URL`. Common examples look like:

```bash
DIFY_BASE_URL=https://your-dify.example.com/v1
DIFY_BASE_URL=http://localhost/v1
```

Use a Workflow API key for `DIFY_APP_KEY`.

You can also provide settings through environment variables:

```bash
export DIFY_BASE_URL="https://your-dify.example.com/v1"
export DIFY_APP_KEY="your-workflow-api-key"
```

Environment variables take precedence over the config file.

## Usage From Claude Code

After installation, ask Claude Code something like:

```text
Find the product overview PDF in Drive and add it to Dify under category "product-docs".
```

Claude Code should use the skill when the task involves:

- Adding Drive documents to Dify.
- Preparing image-heavy PDFs for RAG.
- Turning slide decks or scanned PDFs into structured Markdown.
- Sending retrieval-ready Markdown to the configured Dify Workflow.

## Manual Upload

If you already have a Markdown file, you can call the Python client directly:

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

Use a custom config path:

```bash
python3 ~/.claude/skills/dify-rag-inject/dify_inject.py \
  --config "./config" \
  --category "product-docs" \
  --doc-name "product-overview" \
  --file "./product-overview.md"
```

## Uninstall

Remove the installed skill and local config:

```bash
rm -rf ~/.claude/skills/dify-rag-inject
```

This does not remove anything from Dify.

## Security Notes

- Never commit `config`; it may contain API keys.
- `config.example` must stay free of real URLs, keys, customer names, or internal examples.
- The installer sets the local config file to mode `600` when it creates or updates it.
- Review generated Markdown before uploading if the source document contains sensitive data.
- For public forks, keep examples generic and avoid real company, customer, dataset, or network details.
- The Python client sends document text to the Dify endpoint you configure. Make sure that endpoint is allowed to receive the source content.

## Troubleshooting

| Symptom | Likely Cause | What To Check |
|---|---|---|
| `ERROR: Dify のベースURLが未設定です` | Missing base URL | Set `DIFY_BASE_URL` in config or environment variables. |
| `ERROR: APIキーが未設定です` | Missing Workflow API key | Set `DIFY_APP_KEY` in config or environment variables. |
| `HTTP 401` | Invalid API key | Recreate the Workflow API key in Dify and rerun `./install.sh`. |
| `Workflow not published` | Dify Workflow is not published | Publish the Workflow app in Dify. |
| Connection error | Dify is unreachable | Confirm the URL, network, reverse proxy, and `/v1` API path. |
| `pdftoppm` not found | Poppler is missing | Install Poppler with `brew install poppler` on macOS. |
| Image text is hard to read | PDF render resolution is too low | Increase the `pdftoppm` DPI in the skill workflow. |

## Development

Run basic checks before opening a pull request:

```bash
bash -n install.sh
python3 -m py_compile dify_inject.py
```

Test the installer without touching your real home directory:

```bash
tmp_home=$(mktemp -d)
printf 'test-key\nhttp://localhost/v1\n' | HOME="$tmp_home" bash install.sh
cat "$tmp_home/.claude/skills/dify-rag-inject/config"
```

Before publishing or releasing, scan for accidental private data:

```bash
rg -n '192\.168|10\.|172\.(1[6-9]|2[0-9]|3[0-1])|DIFY_APP_KEY=.+|customer|internal' .
git status --short
```

## Repository Status

This project is a lightweight integration helper. It assumes you already operate Dify and can design the ingestion Workflow appropriate for your organization.

## License

MIT. See [LICENSE](./LICENSE).

---
name: dify-rag-inject
description: Prepare Google Drive documents, especially image-heavy PDF slide decks, as retrieval-friendly Markdown and send them to a Dify ingestion Workflow. Use when the user asks to add a Drive file to Dify, convert a document for RAG, or update a Dify knowledge base.
---

# Drive Document To Dify RAG

This skill helps Claude Code ingest Google Drive documents into a Dify knowledge base. It is designed for image-heavy PDFs, such as slide decks exported to PDF without a text layer, but it also works with text PDFs and Google Docs.

Claude Code reads and structures the source content itself. Do not send the document to an external Claude API from this skill.

## Prerequisites

- Google Drive MCP, or an equivalent Drive connector, is available.
- `pdftoppm` from Poppler is available. On macOS: `brew install poppler`.
- The installed skill directory contains `dify_inject.py` and local config.
- Local config contains `DIFY_BASE_URL` and `DIFY_APP_KEY`.
- A published Dify Workflow accepts `category`, `doc_name`, and `doc_text`.

## Flow

```text
Drive connector
  -> detect text layer
  -> render image-heavy PDFs when needed
  -> read and structure content
  -> write retrieval-friendly Markdown
  -> send with dify_inject.py
```

## Step 1: Locate The Source File

Use the Drive connector to find the target file. Record the file ID. If there are multiple likely matches, ask the user to choose.

## Step 2: Check For A Text Layer

Try the available Drive text-reading tool first.

- If text is returned, skip rendering and continue to Step 5.
- If no useful text is returned, treat the file as an image-heavy PDF and continue to Step 3.

## Step 3: Download And Render Image-Heavy PDFs

### 3.1 Decode The Downloaded PDF

Some Drive tool results wrap JSON inside JSON. The outer value may be an array like `[{type, text}]`, where `text` contains another JSON string. The PDF base64 is usually in the inner `content` field.

```python
import base64
import json

with open("<tool-result-json-path>") as f:
    data = json.load(f)

inner = json.loads(data[0]["text"])
pdf = base64.b64decode(inner["content"])

with open("source.pdf", "wb") as f:
    f.write(pdf)
```

### 3.2 Confirm Whether Rendering Is Needed

```bash
pdffonts source.pdf | head
pdftotext source.pdf - | head
```

If the text output is empty or unusable, render pages to images.

### 3.3 Render Pages

```bash
mkdir -p pages
pdftoppm -jpeg -r 160 source.pdf pages/page
```

If small tables or numbers are hard to read, raise the resolution to `180` or `200`.

## Step 4: Read Rendered Images

If the viewer rejects very large images, resize pages to about 1100px wide and combine two pages vertically per contact sheet.

```bash
python3 - <<'PY'
from PIL import Image
from pathlib import Path

pages = sorted(Path("pages").glob("*.jpg"))
for i in range(0, len(pages), 2):
    imgs = []
    for page in pages[i:i+2]:
        img = Image.open(page)
        width = 1100
        height = int(img.height * width / img.width)
        imgs.append(img.resize((width, height)))

    sheet = Image.new("RGB", (1100, sum(img.height for img in imgs)), "white")
    y = 0
    for img in imgs:
        sheet.paste(img, (0, y))
        y += img.height
    sheet.save(f"group-{i//2+1:03}.jpg", quality=90)
PY
```

Read each contact sheet carefully. Preserve tables, numbers, dates, names, product terms, and definitions.

## Step 5: Write Retrieval-Friendly Markdown

Retrieval quality depends heavily on the Markdown structure.

1. Start with short metadata: document title, source, document type, and useful anchors.
2. Use headings to separate semantic units.
3. Put numbers, pricing, dates, conditions, and plans into tables where possible.
4. Keep proper nouns, abbreviations, and product terms explicit.
5. Convert chart visuals into written values and observations.
6. Keep one source file as one Markdown document unless the user asks otherwise.

Save the file as:

```text
<doc_name>_prepared.md
```

## Step 6: Choose A Category

`category` is passed to the Dify ingestion Workflow. It can represent a dataset, collection, routing key, or any other grouping implemented by that Workflow.

Use a stable, human-readable category. If unsure, propose a few options and ask the user to choose.

## Step 7: Send To Dify

```bash
python3 ~/.claude/skills/dify-rag-inject/dify_inject.py \
  --category "<category>" \
  --doc-name "<doc_name>" \
  --file "./<doc_name>_prepared.md"
```

- API keys and base URL are read from local config.
- Use `--dry-run` to preview without sending.
- A successful call reports `status: succeeded`.
- Whether repeated calls upsert, replace, or duplicate documents depends on the configured Dify Workflow.

## Step 8: Ask The User To Verify

After ingestion, ask the user to confirm in Dify that:

- The expected dataset or collection exists.
- The document appears under the expected name.
- The document was segmented or indexed as expected.
- A Dify recall/retrieval test can find relevant chunks.

## Troubleshooting

| Symptom | Likely Cause | What To Check |
|---|---|---|
| `401` | Wrong or missing Workflow API key | Check `DIFY_APP_KEY`. |
| Connection error | Dify URL is unreachable | Check Dify, network, proxy, and `DIFY_BASE_URL`. |
| `400 Workflow not published` | The Dify Workflow is not published | Publish the Workflow app in Dify. |
| Empty text from Drive | Image-heavy PDF | Continue with rendering. |
| Table text is unreadable | Render resolution is too low | Re-render with higher DPI. |
| Download payload is confusing | Nested JSON wrapper | Decode the inner `text` JSON first. |

If all routes fail, explain what failed, why it likely failed, and what the user should do next.

## Text PDFs And Google Docs

If Step 2 returns usable text, rendering is unnecessary. Structure the text according to Step 5, then send it to Dify with Step 7.

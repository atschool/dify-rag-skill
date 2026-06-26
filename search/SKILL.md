---
name: dify-rag-search
description: Search Dify RAG knowledge bases when the user asks about reference material, asks "is X true?", "what does our docs say about X?", "search Dify for X", or uses a /rag-style query. The skill retrieves source chunks from Dify only; it does not ask Dify to generate the final answer.
---

# Dify RAG Search

Use this skill when the user wants to look up information from Dify knowledge bases and answer from retrieved evidence.

## Core Rule

Dify is the search engine. Claude writes the final answer.

Do not ask Dify to generate the response. Run `dify_search.py`, read the retrieved chunks, then answer the user using the chunks as evidence. If the chunks are weak or absent, say that the knowledge base did not provide enough support.

## Search

Run:

```bash
python3 "$HOME/.claude/skills/dify-rag-search/dify_search.py" \
  --query "<user question>" \
  --top-k 5
```

For a narrower search:

```bash
python3 "$HOME/.claude/skills/dify-rag-search/dify_search.py" \
  --query "<user question>" \
  --category "<dataset name or id fragment>" \
  --top-k 5
```

Use JSON when another script needs structured output:

```bash
python3 "$HOME/.claude/skills/dify-rag-search/dify_search.py" \
  --query "<user question>" \
  --format json
```

## Answering

When hits are returned:

1. Read the chunks.
2. Prefer the strongest, most specific hits.
3. Mention source document names when useful.
4. Answer only what the retrieved evidence supports.
5. If sources conflict, call that out.

When no hits are returned:

- Do not invent an answer.
- Say that no matching Dify chunks were found.
- Suggest a narrower or alternative query if appropriate.

## Troubleshooting

| Symptom | What to do |
|---|---|
| Missing base URL | Run `./install.sh` or set `DIFY_BASE_URL`. |
| Missing API key | Run `./install.sh` or set `DIFY_DATASET_API_KEY`. |
| HTTP 401 | Check that the key has Knowledge Base API access. |
| No datasets matched | Check `DIFY_DATASET_IDS`, `--category`, and API key permissions. |
| Connection error | Check Dify URL, network, and whether Dify is running. |


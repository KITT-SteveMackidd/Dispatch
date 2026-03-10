---
name: qmd
description: Local hybrid search for markdown notes and docs. Use when searching notes, finding related content, or retrieving documents from indexed collections on disk.
metadata:
  openclaw:
    requires:
      bins: ["qmd"]
---

# qmd - Quick Markdown Search

Use qmd to search local markdown collections.

## Default behavior

- Prefer `qmd search` (BM25 keyword search) for speed.
- Use `qmd vsearch` only when keyword search is insufficient.
- Use `qmd query` only when the user explicitly wants highest-quality hybrid/reranked results and accepts slower runtime.

## Setup (one-time)

```bash
qmd collection add /path/to/notes --name notes --mask "**/*.md"
qmd context add qmd://notes "Description of this collection"  # optional
qmd embed  # needed for vector/hybrid search
```

## Common commands

```bash
qmd search "query"
qmd vsearch "query"
qmd query "query"
qmd search "query" -c notes
qmd search "query" -n 10
qmd search "query" --json
qmd search "query" --all --files --min-score 0.3
```

## Retrieve files

```bash
qmd get "path/to/file.md"
qmd get "#docid"
qmd multi-get "journals/2025-05*.md"
qmd multi-get "doc1.md, doc2.md, #abc123" --json
```

## Maintenance

```bash
qmd status
qmd update
qmd embed
```

## Notes

- `qmd search` is usually instant.
- `vsearch` and `query` can be much slower on CPU-only systems.
- qmd searches local indexed markdown files; this is separate from OpenClaw `memory_search`.

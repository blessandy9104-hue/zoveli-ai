# ADR 004: Local-First Memory (SQLite store; vault as export mirror)

## Status
Superseded in substance by [docs/memory-store.md](../memory-store.md) —
kept as the historical record of the original vault decision.

> The Markdown vault is no longer the source of truth. `@zoveli/memory-store`
> (SQLite + FTS5, `~/.zoveli/memory.db`) owns notes/tags/links; `knowledge-vault/`
> is a human-readable export mirror (Obsidian-compatible) with one-time import.

## Context
Zoveli needs persistent, user-owned memory that:
- Survives restarts and updates
- Is portable and human-readable
- Supports linking and organization
- Works offline
- No vendor lock-in

## Decision
Use **Obsidian-compatible Markdown vault** as the knowledge base.

### Vault Structure
```
knowledge-vault/
  ├── welcome.md           # Getting started
  ├── preferences.md       # User preferences
  ├── projects.md          # Project tracking
  ├── <uuid>.md            # Auto-generated notes
  └── .obsidian/           # Obsidian config (ignored)
```

### Note Format
```markdown
---
title: "Note Title"
created: 2026-10-11T10:30:00.000Z
tags: ["preference", "project-alpha"]
links: ["related-note", "another-note"]
---

# Note Title

Content in Markdown...

## Links
- [[related-note]]
- [[another-note]]
```

### Tag Taxonomy
| Tag | Purpose |
|-----|---------|
| `#person` | People, contacts |
| `#preference` | User preferences |
| `#fact` | Verified facts |
| `#project` | Active projects |
| `#reference` | Reference materials |
| `#meeting` | Meeting notes |
| `#idea` | Ideas, brainstorming |
| `#goal` | Goals, objectives |

### Operations (via Memory Tools)
- `memory_create_note` - Create with frontmatter, tags, links
- `memory_search` - Full-text + tag filtering
- `memory_read_note` - Read by title/filename
- `memory_list_tags` - List all tags

## Integration
- **Filesystem Plugin**: `fs` provides vault-mirror access
- **Capability**: `memory.vault` registered in capability system
- **Auto-indexing**: FTS5 index maintained transactionally (was: background indexing for search)
- **Sync**: Git-based backup of the Markdown mirror (optional)

## Consequences

### Positive
- **Portability**: Plain Markdown, openable in any editor
- **Ownership**: User controls data, no cloud required
- **Interop**: Works with Obsidian, VS Code, any Markdown tool
- **Version Control**: Git-friendly for history/backup
- **Extensibility**: Plugins can add custom note types

### Negative
- **Search Performance**: Linear scan for large vaults (mitigated by indexing)
- **Concurrency**: No built-in locking (single-user assumed)
- **Schema Evolution**: Frontmatter changes need migration
- **Binary Files**: Not suitable for images/attachments (separate storage)

## Implementation
- `packages/memory-store/`: SQLite source of truth (`MemoryStore`, FTS5)
- `packages/memory-store/src/index.ts`: `memory_*` tool definitions and the
  `memory`/`search` compatibility services
- `knowledge-vault/`: export mirror with examples (plus one-time legacy import)
- `config/*.cordis.yml`: Filesystem provider config

## References
- [Obsidian Format](https://obsidian.md/)
- [ADR 002: Capability Awareness](./002-capability-awareness.md)
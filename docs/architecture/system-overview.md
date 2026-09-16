# System Overview

POS Native has three deployable adapters: a responsive web/PWA client, a
versioned HTTP API and an MCP service. They consume shared contracts and domain
services; only repository implementations communicate with PostgreSQL/files.

```text
Web/PWA ─┐
API ─────┼─> validation -> domain commands -> transaction/repositories
MCP ─────┘                                      │
                                                ├─ PostgreSQL canonical state
                                                └─ filesystem asset store
```

Search indexes, exports, backups and future semantic indexes are derived from
canonical state. They cannot become the sole source of truth.

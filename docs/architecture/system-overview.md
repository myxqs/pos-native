# System Overview

POS Native currently has two deployable adapters: a responsive web/PWA client
and a versioned HTTP API. A dedicated model-neutral MCP adapter is required by
the architecture but remains planned and unimplemented. All current and future
adapters consume shared contracts and domain services; only repository
implementations communicate with PostgreSQL/files.

```text
Web/PWA ─┐
API ─────┼─> validation -> domain commands -> transaction/repositories
         │                                      │
         │                                      ├─ PostgreSQL canonical state
         │                                      └─ filesystem asset store
         └─ planned MCP adapter uses the same boundary
```

Search indexes, exports, backups and future semantic indexes are derived from
canonical state. They cannot become the sole source of truth.

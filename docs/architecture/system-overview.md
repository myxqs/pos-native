# System Overview

POS Native currently has a responsive browser shell and a versioned HTTP API.
Installable PWA/offline capabilities and a dedicated model-neutral MCP adapter
are required later by the architecture but remain planned and unimplemented.
All current and future adapters consume shared contracts and domain services;
only repository implementations communicate with PostgreSQL/files.

```text
Browser shell ─┐
API ───────────┼─> validation -> domain commands -> transaction/repositories
               │                                      │
               │                                      ├─ PostgreSQL canonical state
               │                                      └─ filesystem asset store
               └─ planned PWA and MCP adapters use the same boundary
```

Search indexes, exports, backups and future semantic indexes are derived from
canonical state. They cannot become the sole source of truth.

# AI and MCP Architecture

The dedicated MCP service is not implemented in this repository. M5 provides a
model-neutral, versioned machine HTTP contract for schema discovery, bounded
query/traversal/context, redacted history, and existing audited atomic
mutations. A future MCP service should remain a thin adapter over that contract;
it must not receive direct database access. See `m5-machine-interface.md`.

# AI and MCP Architecture

The MCP service is a model-neutral adapter over the same versioned API/domain
boundary used by the web client. Initial tools are read-only and bounded:
search, page/block retrieval, database queries, relations/backlinks and context
bundles. Future writes require explicit token scopes, validation, idempotency
and audit records; MCP never receives direct database access.

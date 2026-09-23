# AI and MCP Architecture

The dedicated MCP service is planned but is not implemented in this repository.
When delivered, it will be a model-neutral adapter over the same versioned
API/domain boundary used by the web client. Its initial tools will be read-only
and bounded: search, page/block retrieval, database queries,
relations/backlinks and context bundles. Future writes will require explicit
token scopes, validation, idempotency and audit records; MCP will never receive
direct database access.

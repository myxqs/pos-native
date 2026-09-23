# Security Architecture

The initial threat model is in `pos-native-foundation.md`. M1-M3 apply it
through Argon2id password hashing, secure cookie sessions, CSRF protection,
CSP/security headers, rate limits, runtime validation, token-scope and
idempotency contracts, and append-oriented audit records. Secrets exist only
in environment configuration.

The current API has authenticated state-changing routes for page creation and
updates, page hierarchy/archive/restore operations, and block-document writes.
Cookie-session mutations require the CSRF proof; external input is validated at
the API/domain boundary; revision-aware endpoints use explicit compare-and-swap
preconditions; and actor identity is derived by the server before domain and
repository layers record revisions and audit events. API-token scopes and
idempotency are modelled boundaries, not a claim that broad external token
mutation is enabled.

These controls are source- and synthetic-test evidence. Live PostgreSQL,
owner-bootstrap, authenticated browser-flow, and deployment acceptance remain
unproven gates rather than production-readiness claims.

The service is designed for Tailscale/private-LAN access, but application
authentication remains mandatory. No telemetry, analytics, public exposure,
untrusted code execution or secret logging is permitted by default.

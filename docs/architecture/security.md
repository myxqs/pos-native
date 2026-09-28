# Security Architecture

The initial threat model is in `pos-native-foundation.md`. The implemented
source slices apply it
through Argon2id password hashing, secure cookie sessions, CSRF protection,
CSP/security headers, rate limits, runtime validation, token-scope and
idempotency contracts, and append-oriented audit records. Secrets exist only
in environment configuration.

The current API has authenticated state-changing routes for page creation and
updates, page hierarchy/archive/restore operations, block-document writes,
structured data, asset upload and page attachment, and page-link creation and
recoverable unlink.
Cookie-session mutations require the CSRF proof; external input is validated at
the API/domain boundary; revision-aware endpoints use explicit compare-and-swap
preconditions; and actor identity is derived by the server before domain and
repository layers record revisions and audit events. API-token scopes and
idempotency are modelled boundaries, not a claim that broad external token
mutation is enabled.

These controls have source, synthetic, live disposable PostgreSQL, and bounded
authenticated browser-flow evidence. Production owner bootstrap, deployment,
real personal data, and the deferred human-operated file chooser remain
unproven gates rather than production-readiness claims. Page-link creation
shares the hierarchy advisory transaction lock with page archive operations;
after it obtains that lock it rechecks both endpoints, preventing a link from
committing on an endpoint concurrently archived by another transaction.

The service is designed for Tailscale/private-LAN access, but application
authentication remains mandatory. No telemetry, analytics, public exposure,
untrusted code execution or secret logging is permitted by default.

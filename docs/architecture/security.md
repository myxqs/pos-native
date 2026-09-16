# Security Architecture

The initial threat model is in `pos-native-foundation.md`. M1 applies it through
Argon2id password hashing, secure cookie sessions, CSRF protection,
CSP/security headers, rate limits, runtime validation, token scopes,
idempotency keys and append-oriented audit records. The current API has no
mutation routes; CSRF middleware will be registered with the first
cookie-authenticated state-changing route. Secrets exist only in environment
configuration.

The service is designed for Tailscale/private-LAN access, but application
authentication remains mandatory. No telemetry, analytics, public exposure,
untrusted code execution or secret logging is permitted by default.

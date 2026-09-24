# Deployment Operations

Production targets a user-owned Linux host on Ethernet behind Tailscale/private
networking. The service is not initially exposed to the public internet.
Application authentication, PostgreSQL storage, filesystem assets and backups
remain on user-controlled infrastructure. Production deployment is deferred
until disposable PostgreSQL migration and transaction acceptance, restart
persistence, owner bootstrap, authenticated browser flow, backup/restore, and
Linux/Tailscale operational checks have passed. Source and synthetic tests do
not substitute for those live gates.

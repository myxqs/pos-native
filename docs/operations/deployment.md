# Deployment Operations

Production targets a user-owned Linux host on Ethernet behind Tailscale/private
networking. The service is not initially exposed to the public internet.
Application authentication, PostgreSQL storage, filesystem assets and backups
remain on user-controlled infrastructure. Production deployment is deferred
until M1–M2 have passed verification.

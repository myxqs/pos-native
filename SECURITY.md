# Security policy

POS Native is early-stage software handling a category of data that can become highly sensitive. Treat all real personal context stores as private unless you have deliberately configured otherwise.

## Reporting a vulnerability

Please report security issues privately to the maintainer rather than publishing exploit details in a public issue. Until a dedicated disclosure address is configured, use GitHub's private vulnerability reporting feature if it is enabled for the repository.

## Current security boundaries

- No credentials or secrets should be stored in repository source.
- The reference store is local SQLite and does not expose a network service.
- The current core performs no autonomous external actions.
- Agent permissions, connector credentials, encryption and remote access are future work and must be explicitly threat-modelled before release.

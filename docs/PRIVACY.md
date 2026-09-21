# Privacy and data boundaries

A personal context system can contain unusually broad and sensitive information. POS Native therefore separates the public software project from any real user dataset.

## Public repository

Safe to include:

- source code;
- schemas and migration logic;
- synthetic fixtures;
- generic architecture documentation;
- non-sensitive test data.

Never include:

- real personal POS exports;
- emails, medical, financial or employment records;
- API keys, OAuth tokens, cookies or credentials;
- private database snapshots;
- machine-specific backup material.

## Local deployments

The current reference implementation is local-only and has no network listener. That is a useful baseline, not a complete security model. Encryption at rest, secret management, remote access, multi-user permissions and connector isolation remain future work.

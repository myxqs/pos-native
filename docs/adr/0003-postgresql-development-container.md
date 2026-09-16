# ADR 0003: PostgreSQL 18.6 local development container

## Status

Accepted — 2026-09-14.

## Decision

Use the current supported PostgreSQL 18.6 image for local development through
`compose.yaml`. Bind its database port only to `127.0.0.1`, require credentials
from an untracked `.env`, and retain its data in a named local volume.

## Rationale

PostgreSQL 18 is the current supported major release and is supported through 2030. A compose definition gives Windows development and future Linux hosting a
repeatable local database topology without a cloud service dependency.

## Consequences

The configuration is committed but has not been run: Docker is currently absent
from the development host. Installing Docker remains a separate explicit user
decision because it changes host software.

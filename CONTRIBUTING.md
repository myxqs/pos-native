# Contributing

POS Native is at an early contract-design stage. Contributions are welcome, especially around local-first data modelling, provenance, migration safety, retrieval interfaces, privacy boundaries and interoperability.

## Before opening a change

- Keep the core AI-provider agnostic.
- Do not add personal data, production databases, credentials, tokens or private exports.
- Preserve append-only audit semantics unless a proposal explicitly changes the contract.
- Add or update tests for behavioural changes.
- Prefer small changes with a clear rationale over broad speculative abstractions.

## Development

```bash
python -m pip install -e .
python -m unittest discover -s tests -v
```

For architectural changes, open an issue first so the data contract and migration implications can be discussed before implementation.

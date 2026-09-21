from __future__ import annotations

import argparse
import json
from dataclasses import asdict

from .store import Store


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pos-native", description="Local-first personal context store")
    sub = parser.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init", help="initialise a local POS Native database")
    init.add_argument("--db", required=True)

    add_entity = sub.add_parser("add-entity", help="create an entity")
    add_entity.add_argument("--db", required=True)
    add_entity.add_argument("--type", required=True, dest="entity_type")
    add_entity.add_argument("--name", required=True)

    list_entities = sub.add_parser("list-entities", help="list entities")
    list_entities.add_argument("--db", required=True)

    add_evidence = sub.add_parser("add-evidence", help="attach source-backed evidence to an entity")
    add_evidence.add_argument("--db", required=True)
    add_evidence.add_argument("--entity", required=True, dest="entity_id")
    add_evidence.add_argument("--source", required=True, dest="source_uri")
    add_evidence.add_argument("--assertion", required=True)
    add_evidence.add_argument("--authority", default="unknown")
    add_evidence.add_argument("--confidence", type=float, default=0.5)

    list_evidence = sub.add_parser("list-evidence", help="list evidence")
    list_evidence.add_argument("--db", required=True)
    list_evidence.add_argument("--entity", dest="entity_id")

    audit = sub.add_parser("audit", help="show append-only audit events")
    audit.add_argument("--db", required=True)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    store = Store(args.db)

    if args.command == "init":
        store.init()
        print(json.dumps({"database": args.db, "status": "initialised"}))
        return 0

    store.init()

    if args.command == "add-entity":
        print(json.dumps(asdict(store.add_entity(args.entity_type, args.name)), indent=2))
    elif args.command == "list-entities":
        print(json.dumps([asdict(x) for x in store.list_entities()], indent=2))
    elif args.command == "add-evidence":
        item = store.add_evidence(
            entity_id=args.entity_id,
            source_uri=args.source_uri,
            assertion=args.assertion,
            authority=args.authority,
            confidence=args.confidence,
        )
        print(json.dumps(asdict(item), indent=2))
    elif args.command == "list-evidence":
        print(json.dumps([asdict(x) for x in store.list_evidence(args.entity_id)], indent=2))
    elif args.command == "audit":
        print(json.dumps(store.audit_events(), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

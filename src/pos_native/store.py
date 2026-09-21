from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from .models import Entity, Evidence, new_id, utc_now


SCHEMA_VERSION = 1


class Store:
    """Small reference implementation of the POS Native storage contract."""

    def __init__(self, path: str | Path):
        self.path = Path(path)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def init(self) -> None:
        with self.connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS entities (
                    id TEXT PRIMARY KEY,
                    entity_type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS evidence (
                    id TEXT PRIMARY KEY,
                    entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
                    source_uri TEXT NOT NULL,
                    assertion TEXT NOT NULL,
                    authority TEXT NOT NULL,
                    confidence REAL NOT NULL CHECK(confidence >= 0.0 AND confidence <= 1.0),
                    observed_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS audit_events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    id TEXT NOT NULL UNIQUE,
                    event_type TEXT NOT NULL,
                    subject_id TEXT,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )
            db.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )

    def _audit(
        self,
        db: sqlite3.Connection,
        *,
        event_type: str,
        subject_id: str | None,
        payload: dict,
    ) -> None:
        db.execute(
            """
            INSERT INTO audit_events(id, event_type, subject_id, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (new_id("aud"), event_type, subject_id, json.dumps(payload, sort_keys=True), utc_now()),
        )

    def add_entity(self, entity_type: str, name: str) -> Entity:
        if not entity_type.strip() or not name.strip():
            raise ValueError("entity type and name are required")
        entity = Entity.create(entity_type, name)
        with self.connect() as db:
            db.execute(
                """
                INSERT INTO entities(id, entity_type, name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (entity.id, entity.entity_type, entity.name, entity.created_at, entity.updated_at),
            )
            self._audit(
                db,
                event_type="entity.created",
                subject_id=entity.id,
                payload={"entity_type": entity.entity_type, "name": entity.name},
            )
        return entity

    def list_entities(self) -> list[Entity]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT id, entity_type, name, created_at, updated_at FROM entities ORDER BY created_at"
            ).fetchall()
        return [Entity(**dict(row)) for row in rows]

    def add_evidence(
        self,
        *,
        entity_id: str,
        source_uri: str,
        assertion: str,
        authority: str = "unknown",
        confidence: float = 0.5,
        observed_at: str | None = None,
    ) -> Evidence:
        if not source_uri.strip() or not assertion.strip():
            raise ValueError("source URI and assertion are required")
        item = Evidence.create(
            entity_id=entity_id,
            source_uri=source_uri,
            assertion=assertion,
            authority=authority,
            confidence=confidence,
            observed_at=observed_at,
        )
        with self.connect() as db:
            if db.execute("SELECT 1 FROM entities WHERE id = ?", (entity_id,)).fetchone() is None:
                raise KeyError(f"unknown entity: {entity_id}")
            db.execute(
                """
                INSERT INTO evidence(
                    id, entity_id, source_uri, assertion, authority,
                    confidence, observed_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item.id,
                    item.entity_id,
                    item.source_uri,
                    item.assertion,
                    item.authority,
                    item.confidence,
                    item.observed_at,
                    item.created_at,
                ),
            )
            self._audit(
                db,
                event_type="evidence.created",
                subject_id=item.id,
                payload={"entity_id": entity_id, "source_uri": source_uri},
            )
        return item

    def list_evidence(self, entity_id: str | None = None) -> list[Evidence]:
        with self.connect() as db:
            if entity_id:
                rows = db.execute(
                    """SELECT id, entity_id, source_uri, assertion, authority,
                              confidence, observed_at, created_at
                       FROM evidence WHERE entity_id = ? ORDER BY created_at""",
                    (entity_id,),
                ).fetchall()
            else:
                rows = db.execute(
                    """SELECT id, entity_id, source_uri, assertion, authority,
                              confidence, observed_at, created_at
                       FROM evidence ORDER BY created_at"""
                ).fetchall()
        return [Evidence(**dict(row)) for row in rows]

    def audit_events(self) -> list[dict]:
        with self.connect() as db:
            rows = db.execute(
                """SELECT sequence, id, event_type, subject_id, payload_json, created_at
                   FROM audit_events ORDER BY sequence"""
            ).fetchall()
        return [
            {
                "sequence": row["sequence"],
                "id": row["id"],
                "event_type": row["event_type"],
                "subject_id": row["subject_id"],
                "payload": json.loads(row["payload_json"]),
                "created_at": row["created_at"],
            }
            for row in rows
        ]

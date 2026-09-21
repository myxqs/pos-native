from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4()}"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True, slots=True)
class Entity:
    id: str
    entity_type: str
    name: str
    created_at: str
    updated_at: str

    @classmethod
    def create(cls, entity_type: str, name: str) -> "Entity":
        now = utc_now()
        return cls(
            id=new_id("ent"),
            entity_type=entity_type.strip(),
            name=name.strip(),
            created_at=now,
            updated_at=now,
        )


@dataclass(frozen=True, slots=True)
class Evidence:
    id: str
    entity_id: str
    source_uri: str
    assertion: str
    authority: str
    confidence: float
    observed_at: str
    created_at: str

    @classmethod
    def create(
        cls,
        *,
        entity_id: str,
        source_uri: str,
        assertion: str,
        authority: str = "unknown",
        confidence: float = 0.5,
        observed_at: Optional[str] = None,
    ) -> "Evidence":
        if not 0.0 <= confidence <= 1.0:
            raise ValueError("confidence must be between 0 and 1")
        now = utc_now()
        return cls(
            id=new_id("evd"),
            entity_id=entity_id,
            source_uri=source_uri.strip(),
            assertion=assertion.strip(),
            authority=authority.strip(),
            confidence=confidence,
            observed_at=observed_at or now,
            created_at=now,
        )

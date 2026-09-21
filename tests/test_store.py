import tempfile
import unittest
from pathlib import Path

from pos_native.store import Store


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "pos.db"
        self.store = Store(self.db)
        self.store.init()

    def tearDown(self):
        self.tmp.cleanup()

    def test_entity_and_audit_event_are_created(self):
        entity = self.store.add_entity("project", "Example")
        self.assertTrue(entity.id.startswith("ent_"))
        self.assertEqual(self.store.list_entities()[0].name, "Example")
        events = self.store.audit_events()
        self.assertEqual(events[0]["event_type"], "entity.created")
        self.assertEqual(events[0]["subject_id"], entity.id)

    def test_evidence_is_linked_and_audited(self):
        entity = self.store.add_entity("project", "Example")
        evidence = self.store.add_evidence(
            entity_id=entity.id,
            source_uri="https://example.invalid/source",
            assertion="Synthetic example assertion",
            authority="demo",
            confidence=0.8,
        )
        self.assertEqual(self.store.list_evidence(entity.id)[0].id, evidence.id)
        self.assertEqual([e["event_type"] for e in self.store.audit_events()], [
            "entity.created",
            "evidence.created",
        ])

    def test_unknown_entity_rejects_evidence(self):
        with self.assertRaises(KeyError):
            self.store.add_evidence(
                entity_id="ent_missing",
                source_uri="https://example.invalid/source",
                assertion="Should fail",
            )

    def test_confidence_bounds_are_enforced(self):
        entity = self.store.add_entity("project", "Example")
        with self.assertRaises(ValueError):
            self.store.add_evidence(
                entity_id=entity.id,
                source_uri="https://example.invalid/source",
                assertion="Invalid confidence",
                confidence=1.1,
            )


if __name__ == "__main__":
    unittest.main()

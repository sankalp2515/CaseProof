from typing import Any
from uuid import uuid4

from caseproof.domain.contracts import ArtifactRef


class Intake:
    def __init__(self, storage, store):
        self.storage = storage
        self.store = store

    def add(
        self,
        case_id: str,
        data: Any,
        mime: Any,
        kind: Any,
        stage: str = "initial",
        expected_revision: Any = None,
        artifact_id: Any = None,
        receipt_request_id: Any = None,
    ) -> Any:
        """Validate and store an immutable artifact in a new case revision."""
        snap = self.store.get(case_id)
        if expected_revision is not None and expected_revision != snap.revision:
            from caseproof.adapters.sqlite_casestore import ConflictError

            raise ConflictError("stale_revision")
        if (
            len(snap.artifacts) >= 6
            or sum(a.byte_count for a in snap.artifacts) + len(data) > 20 * 1024 * 1024
        ):
            raise ValueError("case_limit")
        key, digest = self.storage.put(data, mime)
        if any(a.sha256 == digest for a in snap.artifacts):
            return snap
        artifact = ArtifactRef(
            artifact_id=artifact_id or "ART-" + uuid4().hex[:12],
            case_id=case_id,
            kind=kind,
            mime_type=mime,
            sha256=digest,
            byte_count=len(data),
            object_key=key,
            stage=stage,
        )
        old = snap.revision
        snap.artifacts.append(artifact)
        if receipt_request_id and kind == "receipt" and stage == "followup":
            chosen = next((r for r in snap.requests if r.request_id == receipt_request_id), None)
            if (
                chosen
                and chosen.state == "accepted"
                and chosen.catalogue_id in {"request_readable_receipt", "identify_receipt_payment"}
            ):
                chosen.explanation.setdefault("replacement_artifact_ids", []).append(
                    artifact.artifact_id
                )
        snap.revision += 1
        # New evidence invalidates readiness immediately, before async processing.
        snap.readiness.disposition = "REVIEW_REQUIRED"
        return self.store.publish(snap, old, "artifact_added")

"""Quality findings: what the pipeline found wrong with the data, written
down and never fixed by guessing. A gap stays a gap; a bad checksum stays a
bad checksum. What to do about it is a decision for a person or for the
dataset filters, made with the finding in front of them."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .db import canonical, jsonb, new_id

# Every kind the pipeline writes, with what it means. docs/DATOS.md §7.
KINDS = {
    "not_uploaded": "The recording stayed on the phone; only its metadata is here.",
    "incomplete_session": "The recording was never stopped.",
    "clock_untrusted": "No reliable clock fix: offsets to server time are approximate.",
    "clock_drift": "Later clock fixes disagree with the first by more than a second.",
    "missing_segment": "A video segment index is missing from an otherwise continuous run.",
    "missing_object": "A row says a piece was uploaded; the bucket does not have it.",
    "checksum_mismatch": "The bytes in the bucket are not the bytes the phone hashed.",
    "corrupt_video": "The segment does not decode cleanly.",
    "missing_timestamps": "The segment has no readable frame timestamps.",
    "frame_rate_low": "Far fewer frames than configured: throttling, heat, or a stalled camera.",
    "video_gap": "Time between segments with no video; details say what the log shows there.",
    "inconsistent_boundaries": "Segments overlap by much more than the planned cut overlap.",
    "sensors_unavailable": "The phone reported it could not record motion.",
    "sensor_gap": "Time with no motion samples.",
    "sensor_mismatch": "A sensor chunk disagrees with its own receipt (count, window, format).",
    "piece_conflict": "The same piece was confirmed twice with different checksums.",
    "duplicate_recording": "Identical segment bytes appear under another recording.",
    "missing_annotations": "The camera ran but the worker marked no room or object: footage without labels.",
    "inconsistent_task_boundaries": "Two declared rooms or objects overlap in time without being marked as done together.",
}

SEVERITIES = ("info", "warning", "error")


@dataclass
class Finding:
    kind: str
    severity: str
    details: dict[str, Any] = field(default_factory=dict)
    segment_id: str | None = None

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"unknown finding kind {self.kind!r}")
        if self.severity not in SEVERITIES:
            raise ValueError(f"unknown severity {self.severity!r}")


def record(conn, recording_id: str, session_id: str | None, findings: list[Finding], version: str) -> int:
    """
    Writes findings not already on file for this recording and pipeline
    version, and returns how many were new. Re-running validation is safe:
    the same data gives the same findings, and a finding somebody already
    marked resolved keeps its resolution.
    """
    new = 0
    for f in findings:
        exists = conn.execute(
            'SELECT 1 FROM "QualityFinding" WHERE "recordingId" = %s AND kind = %s AND "pipelineVersion" = %s '
            'AND "segmentId" IS NOT DISTINCT FROM %s AND details = %s::jsonb LIMIT 1',
            [recording_id, f.kind, version, f.segment_id, canonical(f.details)],
        ).fetchone()
        if exists:
            continue
        conn.execute(
            'INSERT INTO "QualityFinding" (id, "recordingId", "sessionId", "segmentId", kind, severity, details, "pipelineVersion") '
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            [new_id("qf"), recording_id, session_id, f.segment_id, f.kind, f.severity, jsonb(f.details), version],
        )
        new += 1
    return new

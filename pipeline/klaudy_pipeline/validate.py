"""validate_recording: does the raw layer hold what the receipts say it holds?

Every piece is fetched and hashed against the checksum the phone computed
before uploading it; every video segment is decoded in full; the time
windows are checked for holes and the event log is read to say what
happened in each one. The result is a list of findings — nothing in the raw
layer is touched — and, for whatever passed, the next jobs in line.
"""

from __future__ import annotations

import hashlib
import tempfile
from datetime import timedelta
from pathlib import Path
from typing import Any

from . import PIPELINE_VERSION
from .context import Context
from .findings import Finding, record
from .formats import SensorFormatError, parse_sensor_chunk
from .media import decode_errors, frame_times_ms
from .queue import PermanentError, enqueue, pending
from .storage import MissingObject

# A cut between two segments overlaps by ~300 ms by design (components/pilot/capture.ts).
GAP_MS = 1500
OVERLAP_LIMIT_MS = 3000
SENSOR_GAP_MS = 2000
CLOCK_DRIFT_MS = 1000
# Below half the configured frame rate, something throttled the camera.
LOW_FPS_RATIO = 0.5
# Events that explain a hole in the video, and how.
EXPLAINS_GAP = {"privacy_pause", "privacy_resume", "hidden", "visible", "frozen", "resumed", "camera_ended", "camera_muted", "storage_full", "pagehide", "recorder_error"}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _events_between(events: list[dict[str, Any]], start: float, end: float) -> list[str]:
    return [e["kind"] for e in events if e["monoMs"] is not None and start - 3000 <= e["monoMs"] <= end + 1000 and e["kind"] in EXPLAINS_GAP]


def _gap_finding(events: list[dict[str, Any]], start: float, end: float, segment_id: str | None) -> Finding:
    seen = _events_between(events, start, end)
    # A privacy pause is the cleaner choosing not to film: expected, not a defect.
    severity = "info" if "privacy_pause" in seen else "warning"
    return Finding("video_gap", severity, {"fromMs": round(start, 1), "toMs": round(end, 1), "events": seen}, segment_id)


def validate_recording(ctx: Context, recording_id: str) -> dict[str, Any]:
    conn = ctx.conn
    rec = conn.execute('SELECT * FROM "JobRecording" WHERE id = %s', [recording_id]).fetchone()
    if not rec:
        raise PermanentError(f"unknown recording {recording_id}")
    segments = conn.execute('SELECT * FROM "VideoSegment" WHERE "recordingId" = %s ORDER BY index', [recording_id]).fetchall()
    chunks = conn.execute('SELECT * FROM "SensorChunk" WHERE "recordingId" = %s ORDER BY index', [recording_id]).fetchall()
    events = conn.execute(
        'SELECT seq, kind, "monoMs", data FROM "RecordingEvent" WHERE "recordingId" = %s ORDER BY "monoMs" NULLS FIRST, seq NULLS FIRST',
        [recording_id],
    ).fetchall()
    findings: list[Finding] = []

    if rec["storagePrefix"] is None and not segments:
        findings.append(Finding("not_uploaded", "info", {"note": "Saved on the phone; ingest its ZIP export to add the bytes."}))
        new = record(conn, recording_id, rec["sessionId"], findings, PIPELINE_VERSION)
        return {"findings": len(findings), "new": new, "errors": 0}

    if rec["endedAt"] is None:
        findings.append(Finding("incomplete_session", "warning", {}))

    # ── Clock ──
    if rec["clockOffsetMs"] is None:
        findings.append(Finding("clock_untrusted", "warning", {"rttMs": rec["clockRttMs"]}))
    else:
        later = [e["data"]["offsetMs"] for e in events if e["kind"] == "clock_sync" and isinstance(e["data"], dict) and isinstance(e["data"].get("offsetMs"), (int, float))]
        if later:
            drift = max(abs(o - rec["clockOffsetMs"]) for o in later)
            if drift > CLOCK_DRIFT_MS:
                findings.append(Finding("clock_drift", "warning", {"maxDriftMs": round(drift, 1), "fixes": len(later)}))

    # ── Video: every index present, every byte as hashed, every frame decodable ──
    configured_fps = ((rec["capture"] or {}).get("config") or {}).get("frameRate") or 15
    indexes = [s["index"] for s in segments]
    if indexes:
        for missing in sorted(set(range(1, max(indexes) + 1)) - set(indexes)):
            findings.append(Finding("missing_segment", "error", {"index": missing}))

    verified: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="klaudy-validate-") as tmp:
        for seg in segments:
            try:
                data = ctx.storage.get(seg["objectKey"])
            except MissingObject:
                findings.append(Finding("missing_object", "error", {"kind": "video", "index": seg["index"], "key": seg["objectKey"]}, seg["id"]))
                continue
            actual = _sha256(data)
            if actual != seg["sha256"] or len(data) != seg["bytes"]:
                findings.append(
                    Finding(
                        "checksum_mismatch",
                        "error",
                        {"kind": "video", "index": seg["index"], "expected": seg["sha256"], "actual": actual, "bytes": len(data), "expectedBytes": seg["bytes"]},
                        seg["id"],
                    )
                )
                continue
            path = Path(tmp) / f"{seg['index']:05d}.media"
            path.write_bytes(data)
            error = decode_errors(path)
            if error:
                findings.append(Finding("corrupt_video", "error", {"index": seg["index"], "error": error[:500]}, seg["id"]))
                continue
            times = frame_times_ms(path)
            if not times:
                findings.append(Finding("missing_timestamps", "error", {"index": seg["index"]}, seg["id"]))
                continue
            seconds = max(0.001, (seg["monoEndMs"] - seg["monoStartMs"]) / 1000)
            fps = len(times) / seconds
            if seconds >= 2 and fps < LOW_FPS_RATIO * configured_fps:
                findings.append(Finding("frame_rate_low", "warning", {"index": seg["index"], "fps": round(fps, 2), "configured": configured_fps}, seg["id"]))
            verified.append(seg)

    # ── Time: holes between segments, and what the log says about them ──
    for prev, nxt in zip(segments, segments[1:]):
        gap = nxt["monoStartMs"] - prev["monoEndMs"]
        if gap > GAP_MS:
            findings.append(_gap_finding(events, prev["monoEndMs"], nxt["monoStartMs"], nxt["id"]))
        elif gap < -OVERLAP_LIMIT_MS:
            findings.append(Finding("inconsistent_boundaries", "warning", {"index": nxt["index"], "overlapMs": round(-gap, 1)}, nxt["id"]))
    if segments and rec["endedAt"] is not None:
        end_ms = (rec["endedAt"] - rec["startedAt"]).total_seconds() * 1000
        tail = end_ms - segments[-1]["monoEndMs"]
        if tail > max(GAP_MS, rec["chunkSeconds"] * 1000 * 1.5):
            findings.append(_gap_finding(events, segments[-1]["monoEndMs"], end_ms, None))

    # ── Sensors ──
    unavailable = [e for e in events if e["kind"] == "sensors_unavailable"]
    if unavailable:
        reason = (unavailable[0]["data"] or {}).get("reason") if isinstance(unavailable[0]["data"], dict) else None
        findings.append(Finding("sensors_unavailable", "info", {"reason": reason}))
    elif not chunks and segments:
        findings.append(Finding("sensor_gap", "warning", {"note": "no motion data at all"}))
    sensors_ok = 0
    for chunk in chunks:
        try:
            data = ctx.storage.get(chunk["objectKey"])
        except MissingObject:
            findings.append(Finding("missing_object", "error", {"kind": "sensors", "index": chunk["index"], "key": chunk["objectKey"]}))
            continue
        actual = _sha256(data)
        if actual != chunk["sha256"] or len(data) != chunk["bytes"]:
            findings.append(Finding("checksum_mismatch", "error", {"kind": "sensors", "index": chunk["index"], "expected": chunk["sha256"], "actual": actual}))
            continue
        try:
            samples = parse_sensor_chunk(data)
        except SensorFormatError as err:
            findings.append(Finding("sensor_mismatch", "error", {"index": chunk["index"], "error": str(err)[:300]}))
            continue
        problems = {}
        if len(samples) != chunk["samples"]:
            problems["count"] = {"receipt": chunk["samples"], "file": len(samples)}
        outside = sum(1 for s in samples if not (chunk["monoStartMs"] - 5 <= s["t"] <= chunk["monoEndMs"] + 5))
        if outside:
            problems["outsideWindow"] = outside
        if problems:
            findings.append(Finding("sensor_mismatch", "warning", {"index": chunk["index"], **problems}))
        sensors_ok += 1
    for prev, nxt in zip(chunks, chunks[1:]):
        if nxt["monoStartMs"] - prev["monoEndMs"] > SENSOR_GAP_MS:
            findings.append(Finding("sensor_gap", "warning", {"fromMs": prev["monoEndMs"], "toMs": nxt["monoStartMs"]}))

    # ── What the worker declared while filming: the labels the video comes with ──
    if segments:
        film_end = rec["endedAt"] or rec["startedAt"] + timedelta(milliseconds=segments[-1]["monoEndMs"])
        declared = conn.execute(
            'SELECT id, together, "startedAt", "endedAt" FROM "ActivitySegment" WHERE "sessionId" = %s AND NOT excluded ORDER BY "startedAt", id',
            [rec["sessionId"]],
        ).fetchall()
        during = [d for d in declared if d["startedAt"] < film_end and (d["endedAt"] or film_end) > rec["startedAt"]]
        if not during:
            findings.append(Finding("missing_annotations", "warning", {"note": "nothing was marked while the camera ran"}))
        for prev, nxt in zip(during, during[1:]):
            overlap = ((prev["endedAt"] or film_end) - nxt["startedAt"]).total_seconds() * 1000
            if overlap > 1000 and not (prev["together"] or nxt["together"]):
                findings.append(Finding("inconsistent_task_boundaries", "warning", {"declared": [prev["id"], nxt["id"]], "overlapMs": round(overlap)}))

    # ── What the server noticed while receiving ──
    for e in events:
        if e["kind"] == "piece_conflict":
            findings.append(Finding("piece_conflict", "error", e["data"] if isinstance(e["data"], dict) else {}))

    if segments:
        others = conn.execute(
            'SELECT DISTINCT "recordingId" FROM "VideoSegment" WHERE sha256 = ANY(%s) AND "recordingId" <> %s ORDER BY 1',
            [[s["sha256"] for s in segments], recording_id],
        ).fetchall()
        if others:
            findings.append(Finding("duplicate_recording", "warning", {"otherRecordings": [o["recordingId"] for o in others]}))

    new = record(conn, recording_id, rec["sessionId"], findings, PIPELINE_VERSION)

    # What passed goes on to the next stage; what failed stays out of it.
    queued = []
    if verified and not pending(conn, "extract_frames", "recordingId", recording_id):
        enqueue(conn, "extract_frames", {"recordingId": recording_id})
        queued.append("extract_frames")
    if sensors_ok and not pending(conn, "summarize_sensors", "recordingId", recording_id):
        enqueue(conn, "summarize_sensors", {"recordingId": recording_id})
        queued.append("summarize_sensors")
    errors = sum(1 for f in findings if f.severity == "error")
    return {"findings": len(findings), "new": new, "errors": errors, "verifiedSegments": len(verified), "queued": queued}

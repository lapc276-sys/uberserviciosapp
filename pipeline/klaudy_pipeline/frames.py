"""extract_frames: still images from the verified video segments.

DERIVED and reproducible. Each frame keeps its exact presentation time
inside its segment and its offset from the recording's t0, plus a pointer
to the segment it came from — so a frame shown to a labeller, or to a
model, can always be traced to the second of the job it shows, and
regenerated from the raw bytes if the derived copy is ever lost.

Two ways of choosing, both kept and told apart by `method`:
- uniform: one frame every 1/PIPELINE_FRAMES_PER_SECOND seconds;
- scene:   adaptive, where the picture changes (PIPELINE_SCENE_THRESHOLD).
"""

from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path
from typing import Any

from . import PIPELINE_VERSION
from .context import Context
from .db import new_id
from .media import extract_scene, extract_uniform
from .queue import PermanentError
from .storage import MissingObject


def derived_prefix(recording_id: str) -> str:
    """Everything derived from one recording lives under one prefix, so deleting it is one call."""
    return f"derived/{recording_id}/"


def frame_key(recording_id: str, method: str, segment_index: int, pts_ms: float) -> str:
    return f"{derived_prefix(recording_id)}frames/{PIPELINE_VERSION}/{method}/{segment_index:05d}/{int(round(pts_ms)):08d}.jpg"


def extract_frames(ctx: Context, recording_id: str) -> dict[str, Any]:
    conn = ctx.conn
    rec = conn.execute('SELECT id FROM "JobRecording" WHERE id = %s', [recording_id]).fetchone()
    if not rec:
        raise PermanentError(f"unknown recording {recording_id}")
    segments = conn.execute('SELECT * FROM "VideoSegment" WHERE "recordingId" = %s ORDER BY index', [recording_id]).fetchall()
    # Segments validation flagged as broken are left alone: frames from bytes
    # that are not what the phone recorded would be data about nothing.
    broken = {
        row["segmentId"]
        for row in conn.execute(
            'SELECT "segmentId" FROM "QualityFinding" WHERE "recordingId" = %s AND severity = \'error\' AND "segmentId" IS NOT NULL AND "resolvedAt" IS NULL',
            [recording_id],
        ).fetchall()
    }
    methods = {"uniform": lambda src, out: extract_uniform(src, out, ctx.settings.frames_per_second)}
    if ctx.settings.scene_threshold > 0:
        methods["scene"] = lambda src, out: extract_scene(src, out, ctx.settings.scene_threshold)

    written = {name: 0 for name in methods}
    skipped = 0
    with tempfile.TemporaryDirectory(prefix="klaudy-frames-") as tmp:
        for seg in segments:
            todo = [
                name
                for name in methods
                if not conn.execute(
                    'SELECT 1 FROM "ExtractedFrame" WHERE "segmentId" = %s AND method = %s AND "pipelineVersion" = %s LIMIT 1',
                    [seg["id"], name, PIPELINE_VERSION],
                ).fetchone()
            ]
            if seg["id"] in broken or not todo:
                skipped += 1
                continue
            try:
                data = ctx.storage.get(seg["objectKey"])
            except MissingObject:
                skipped += 1
                continue
            if hashlib.sha256(data).hexdigest() != seg["sha256"]:
                skipped += 1
                continue
            source = Path(tmp) / f"{seg['index']:05d}.media"
            source.write_bytes(data)
            for name in todo:
                for pts_ms, jpeg, width, height in methods[name](source, Path(tmp) / name / f"{seg['index']:05d}"):
                    image = jpeg.read_bytes()
                    key = frame_key(recording_id, name, seg["index"], pts_ms)
                    ctx.storage.put(key, image, "image/jpeg")
                    cur = conn.execute(
                        'INSERT INTO "ExtractedFrame" (id, "recordingId", "segmentId", "ptsMs", "offsetMs", "objectKey", width, height, sha256, method, "pipelineVersion") '
                        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                        'ON CONFLICT ("segmentId", "ptsMs", method, "pipelineVersion") DO NOTHING',
                        [
                            new_id("xf"),
                            recording_id,
                            seg["id"],
                            pts_ms,
                            # The segment's start on the phone's monotonic clock plus the
                            # frame's place inside it: good to about one frame.
                            round(seg["monoStartMs"] + pts_ms, 1),
                            key,
                            width,
                            height,
                            hashlib.sha256(image).hexdigest(),
                            name,
                            PIPELINE_VERSION,
                        ],
                    )
                    written[name] += cur.rowcount
    return {"frames": sum(written.values()), "byMethod": written, "skippedSegments": skipped}

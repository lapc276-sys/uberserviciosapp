"""ingest_zip: a recording that never reached the bucket, brought in from the
ZIP the phone exported (components/pilot/recordingStore.ts).

The ZIP is the same unit an upload would have produced: the pieces under
the same names, and a manifest with each one's checksum and time window.
Every piece is checked against that checksum before it is stored; the rows
and events are added only where missing; then validation runs exactly as
for an upload. This is the one place the pipeline writes under
recordings/ — and only bytes the phone itself vouched for.
"""

from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path
from typing import Any

from .context import Context
from .db import jsonb, new_id
from .formats import content_type, piece_name
from .queue import PermanentError, enqueue, pending


def ingest_zip(ctx: Context, path: str | Path) -> dict[str, Any]:
    conn = ctx.conn
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("format") != "klaudy-recording/1":
            raise PermanentError(f"not a recording export: {manifest.get('format')!r}")
        recording_id = manifest["recordingId"]
        rec = conn.execute('SELECT * FROM "JobRecording" WHERE id = %s', [recording_id]).fetchone()
        if not rec:
            raise PermanentError(f"unknown recording {recording_id}: exports are added to recordings this app started")
        prefix = rec["storagePrefix"] or f"recordings/{rec['sessionId']}/{recording_id}"
        mime = rec["mimeType"]

        stored = rows = 0
        for piece in manifest["pieces"]:
            kind, index = piece["kind"], int(piece["index"])
            name = piece_name(kind, index, mime)
            if name != piece["file"]:
                raise PermanentError(f"unexpected file name {piece['file']!r} for {kind} {index}")
            data = archive.read(name)
            digest = hashlib.sha256(data).hexdigest()
            if digest != piece["sha256"] or len(data) != piece["bytes"]:
                raise PermanentError(f"{name}: the bytes are not the ones the phone hashed")
            key = f"{prefix}/{name}"
            if not ctx.storage.exists(key):
                ctx.storage.put(key, data, content_type(kind, mime), allow_raw=True)
                stored += 1
            if kind == "video":
                cur = conn.execute(
                    'INSERT INTO "VideoSegment" (id, "recordingId", index, "objectKey", "mimeType", bytes, sha256, "monoStartMs", "monoEndMs") '
                    'VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT ("recordingId", index) DO NOTHING',
                    [new_id("vs"), recording_id, index, key, mime, piece["bytes"], digest, piece["monoStartMs"], piece["monoEndMs"]],
                )
            else:
                cur = conn.execute(
                    'INSERT INTO "SensorChunk" (id, "recordingId", index, "objectKey", bytes, sha256, samples, streams, "monoStartMs", "monoEndMs") '
                    'VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT ("recordingId", index) DO NOTHING',
                    [new_id("sc"), recording_id, index, key, piece["bytes"], digest, piece.get("samples") or 0, piece.get("streams") or [], piece["monoStartMs"], piece["monoEndMs"]],
                )
            rows += cur.rowcount

        events = 0
        for e in manifest.get("events", []):
            cur = conn.execute(
                'INSERT INTO "RecordingEvent" (id, "recordingId", seq, kind, "monoMs", "clientUtcMs", data) VALUES (%s, %s, %s, %s, %s, %s, %s) '
                'ON CONFLICT ("recordingId", seq) DO NOTHING',
                [new_id("ev"), recording_id, e["seq"], e["kind"], e.get("monoMs"), e.get("clientUtcMs"), jsonb(e.get("data"))],
            )
            events += cur.rowcount

    # Where the bytes now live. Not an observation being edited: the
    # recording said "not in the bucket", and now they are — so the finding
    # that said so is resolved, not deleted.
    conn.execute('UPDATE "JobRecording" SET "storagePrefix" = %s WHERE id = %s AND "storagePrefix" IS NULL', [prefix, recording_id])
    conn.execute(
        'UPDATE "QualityFinding" SET "resolvedAt" = now() WHERE "recordingId" = %s AND kind = \'not_uploaded\' AND "resolvedAt" IS NULL',
        [recording_id],
    )
    conn.execute(
        'INSERT INTO "DataAccessLog" (id, actor, action, resource, reason) VALUES (%s, %s, %s, %s, %s)',
        [new_id("da"), "pipeline", "ingest", f"recording:{recording_id}", Path(path).name],
    )
    if not pending(conn, "validate_recording", "recordingId", recording_id):
        enqueue(conn, "validate_recording", {"recordingId": recording_id})
    return {"recordingId": recording_id, "stored": stored, "rows": rows, "events": events}

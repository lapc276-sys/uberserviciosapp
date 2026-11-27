"""Deleting: on request, past a retention period, or when consent is withdrawn.

The consent a worker gives (lib/activity/recordings.ts) says they can ask
for what was filmed to be deleted, so there has to be a way that actually
does it — bytes, derived copies and rows — and leaves a record that it
happened. Nothing here runs on its own: retention is a command someone
runs with a number of days, and it does nothing without --apply.

Datasets already exported are immutable and are not rewritten: their rows
stay, and the bytes those rows point to are gone. The deletion is in the
access log, so a dataset version that includes a deleted recording can be
found and retired.
"""

from __future__ import annotations

from typing import Any

from .context import Context
from .db import new_id
from .frames import derived_prefix
from .queue import PermanentError


def delete_recording(ctx: Context, recording_id: str, actor: str, reason: str) -> dict[str, Any]:
    conn = ctx.conn
    rec = conn.execute('SELECT id, "storagePrefix" FROM "JobRecording" WHERE id = %s', [recording_id]).fetchone()
    if not rec:
        raise PermanentError(f"unknown recording {recording_id}")
    removed = 0
    if rec["storagePrefix"]:
        removed += ctx.storage.delete_prefix(rec["storagePrefix"] + "/", allow_raw=True)
    removed += ctx.storage.delete_prefix(derived_prefix(recording_id))
    with conn.transaction():
        # Interpretations of a recording go with it: an annotation about
        # footage that no longer exists cannot be checked by anyone.
        conn.execute('DELETE FROM "Annotation" WHERE "recordingId" = %s', [recording_id])
        conn.execute('DELETE FROM "QualityFinding" WHERE "recordingId" = %s', [recording_id])
        # Segments, sensor chunks, events and frames go by cascade.
        conn.execute('DELETE FROM "JobRecording" WHERE id = %s', [recording_id])
        conn.execute(
            'INSERT INTO "DataAccessLog" (id, actor, action, resource, reason) VALUES (%s, %s, %s, %s, %s)',
            [new_id("da"), actor, "delete", f"recording:{recording_id}", reason],
        )
    return {"recordingId": recording_id, "objectsRemoved": removed}


def purge(ctx: Context, older_than_days: int, actor: str, apply: bool = False) -> dict[str, Any]:
    if older_than_days < 1:
        raise ValueError("older_than_days must be at least 1")
    rows = ctx.conn.execute(
        'SELECT id FROM "JobRecording" WHERE "startedAt" < now() - make_interval(days => %s) ORDER BY "startedAt", id', [older_than_days]
    ).fetchall()
    ids = [r["id"] for r in rows]
    if not apply:
        return {"wouldDelete": len(ids), "first": ids[:20], "note": "dry run: add --apply to delete"}
    for recording_id in ids:
        delete_recording(ctx, recording_id, actor, f"retention: older than {older_than_days} days")
    return {"deleted": len(ids)}


def withdraw_worker_consent(ctx: Context, worker_id: str, actor: str, reason: str | None = None) -> dict[str, Any]:
    """From now on, nothing of this worker's goes into a dataset. Deleting what exists is a separate, explicit step."""
    cur = ctx.conn.execute(
        'UPDATE "RecordingConsent" SET "withdrawnAt" = now() WHERE kind = \'worker\' AND "workerId" = %s AND "withdrawnAt" IS NULL',
        [worker_id],
    )
    ctx.conn.execute(
        'INSERT INTO "DataAccessLog" (id, actor, action, resource, reason) VALUES (%s, %s, %s, %s, %s)',
        [new_id("da"), actor, "withdraw", f"worker:{worker_id}", reason],
    )
    return {"workerId": worker_id, "consentsWithdrawn": cur.rowcount}

"""The work queue: the ProcessingJob table.

Postgres rather than Redis at this scale. FOR UPDATE SKIP LOCKED gives the
property that matters — two workers never take the same job — without one
more service to run on Replit. Redis becomes the right call when the number
that matters is jobs per second, not jobs per day.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from .db import jsonb, new_id

KINDS = ("validate_recording", "extract_frames", "summarize_sensors", "export_dataset")


@dataclass
class Job:
    id: str
    kind: str
    payload: dict[str, Any]
    attempts: int
    max_attempts: int


class PermanentError(Exception):
    """Retrying will not help: the job fails now instead of five times."""


def enqueue(conn, kind: str, payload: dict[str, Any], run_after: datetime | None = None) -> str:
    job_id = new_id("pj")
    when = (run_after or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(tzinfo=None)
    conn.execute(
        'INSERT INTO "ProcessingJob" (id, kind, payload, "runAfter") VALUES (%s, %s, %s, %s)',
        [job_id, kind, jsonb(payload), when],
    )
    return job_id


def pending(conn, kind: str, payload_key: str, value: str) -> bool:
    """Whether a job of this kind for this subject is already waiting or running."""
    row = conn.execute(
        'SELECT 1 FROM "ProcessingJob" WHERE kind = %s AND status IN (\'queued\', \'running\') AND payload ->> %s = %s LIMIT 1',
        [kind, payload_key, value],
    ).fetchone()
    return row is not None


def claim(conn, worker: str, kinds: tuple[str, ...] = KINDS) -> Job | None:
    """Takes the oldest due job, or None. One statement, so it is atomic on its own."""
    # runAfter is stored to the millisecond, ROUNDED: a job queued "now" can
    # land up to half a millisecond in the future. Due means due to the ms.
    row = conn.execute(
        """
        UPDATE "ProcessingJob"
           SET status = 'running', "lockedAt" = now(), "lockedBy" = %s, attempts = attempts + 1
         WHERE id = (
               SELECT id FROM "ProcessingJob"
                WHERE status = 'queued' AND "runAfter" < now() + interval '1 millisecond' AND kind = ANY(%s)
                ORDER BY "runAfter", "createdAt"
                LIMIT 1
                FOR UPDATE SKIP LOCKED)
        RETURNING id, kind, payload, attempts, "maxAttempts"
        """,
        [worker, list(kinds)],
    ).fetchone()
    if not row:
        return None
    return Job(row["id"], row["kind"], row["payload"] or {}, row["attempts"], row["maxAttempts"])


def finish(conn, job: Job) -> None:
    conn.execute(
        'UPDATE "ProcessingJob" SET status = \'done\', "finishedAt" = now(), "lockedAt" = NULL, error = NULL WHERE id = %s',
        [job.id],
    )


def fail(conn, job: Job, error: str, permanent: bool = False) -> str:
    """Back to the queue with a growing wait (1, 2, 4, 8… minutes), or failed for good."""
    if permanent or job.attempts >= job.max_attempts:
        conn.execute(
            'UPDATE "ProcessingJob" SET status = \'failed\', error = %s, "finishedAt" = now(), "lockedAt" = NULL WHERE id = %s',
            [error[:2000], job.id],
        )
        return "failed"
    wait = timedelta(minutes=2 ** (job.attempts - 1))
    conn.execute(
        'UPDATE "ProcessingJob" SET status = \'queued\', error = %s, "lockedAt" = NULL, "lockedBy" = NULL, "runAfter" = now() + %s WHERE id = %s',
        [error[:2000], wait, job.id],
    )
    return "queued"


def requeue_stuck(conn, older_than: timedelta = timedelta(minutes=30)) -> int:
    """A worker that died mid-job leaves it 'running' forever; this puts it back."""
    cur = conn.execute(
        'UPDATE "ProcessingJob" SET status = \'queued\', "lockedAt" = NULL, "lockedBy" = NULL '
        "WHERE status = 'running' AND \"lockedAt\" < now() - %s",
        [older_than],
    )
    return cur.rowcount

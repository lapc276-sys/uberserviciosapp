"""Command line.

    python -m klaudy_pipeline run [--once]       work the queue (--once: until empty, then exit)
    python -m klaudy_pipeline sweep              requeue stuck jobs; validate recordings never stopped
    python -m klaudy_pipeline validate REC_ID    run one validation now, without the queue
    python -m klaudy_pipeline export NAME [--from 2026-11-01] [--to …] [--include-errors] [--description …]
    python -m klaudy_pipeline ingest-zip FILE.zip
    python -m klaudy_pipeline delete-recording REC_ID --reason "…"      bytes, derived copies and rows
    python -m klaudy_pipeline purge --older-than-days N [--apply]       retention; a dry run without --apply
    python -m klaudy_pipeline withdraw-consent WORKER_ID [--reason "…"]

On Replit: a Scheduled Deployment running `run --once` every few minutes
and `sweep` hourly is enough for a pilot (SETUP.md, Paso 13).
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
import traceback
from datetime import timedelta

from . import PIPELINE_VERSION
from .config import settings
from .context import Context
from .db import connect
from .export import export_dataset
from .frames import extract_frames
from .ingest import ingest_zip
from .queue import Job, PermanentError, claim, enqueue, fail, finish, pending, requeue_stuck
from .retention import delete_recording, purge, withdraw_worker_consent
from .sensors import summarize_sensors
from .storage import from_settings
from .validate import validate_recording

HANDLERS = {
    "validate_recording": lambda ctx, p: validate_recording(ctx, p["recordingId"]),
    "extract_frames": lambda ctx, p: extract_frames(ctx, p["recordingId"]),
    "summarize_sensors": lambda ctx, p: summarize_sensors(ctx, p["recordingId"]),
    "export_dataset": lambda ctx, p: export_dataset(ctx, p["name"], p.get("filters"), p.get("description"), p.get("requestedBy", "pipeline")),
}


def context() -> Context:
    s = settings()
    if not s.database_url:
        raise SystemExit("DATABASE_URL is not set: the pipeline works on the app's database.")
    return Context(conn=connect(s.database_url), storage=from_settings(s), settings=s)


def run_one(ctx: Context, job: Job, worker: str) -> None:
    handler = HANDLERS.get(job.kind)
    try:
        if handler is None:
            raise PermanentError(f"no handler for {job.kind}")
        result = handler(ctx, job.payload)
        finish(ctx.conn, job)
        print(json.dumps({"job": job.id, "kind": job.kind, "ok": True, "result": result}, default=str), flush=True)
    except PermanentError as err:
        fail(ctx.conn, job, str(err), permanent=True)
        print(json.dumps({"job": job.id, "kind": job.kind, "ok": False, "permanent": True, "error": str(err)}), flush=True)
    except Exception as err:  # noqa: BLE001 - every other failure is retried with backoff
        status = fail(ctx.conn, job, f"{type(err).__name__}: {err}\n{traceback.format_exc()[-1500:]}")
        print(json.dumps({"job": job.id, "kind": job.kind, "ok": False, "status": status, "error": str(err)}), flush=True)


def cmd_run(args: argparse.Namespace) -> int:
    ctx = context()
    worker = f"{socket.gethostname()}:{os.getpid()}"
    while True:
        job = claim(ctx.conn, worker)
        if job is None:
            if args.once:
                return 0
            time.sleep(args.idle)
            continue
        run_one(ctx, job, worker)


def cmd_sweep(_: argparse.Namespace) -> int:
    ctx = context()
    requeued = requeue_stuck(ctx.conn, timedelta(minutes=30))
    stale = ctx.conn.execute(
        'SELECT id FROM "JobRecording" WHERE "endedAt" IS NULL AND "createdAt" < now() - interval \'6 hours\' ORDER BY "createdAt"'
    ).fetchall()
    queued = 0
    for row in stale:
        done = ctx.conn.execute(
            'SELECT 1 FROM "QualityFinding" WHERE "recordingId" = %s AND kind = \'incomplete_session\' AND "pipelineVersion" = %s LIMIT 1',
            [row["id"], PIPELINE_VERSION],
        ).fetchone()
        if not done and not pending(ctx.conn, "validate_recording", "recordingId", row["id"]):
            enqueue(ctx.conn, "validate_recording", {"recordingId": row["id"]})
            queued += 1
    print(json.dumps({"requeuedStuck": requeued, "staleRecordingsQueued": queued}))
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    print(json.dumps(validate_recording(context(), args.recording_id), default=str, indent=2))
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    filters = {"excludeErrors": not args.include_errors}
    if args.date_from:
        filters["from"] = args.date_from
    if args.date_to:
        filters["to"] = args.date_to
    print(json.dumps(export_dataset(context(), args.name, filters, args.description, args.requested_by), default=str, indent=2))
    return 0


def cmd_ingest(args: argparse.Namespace) -> int:
    print(json.dumps(ingest_zip(context(), args.file), default=str, indent=2))
    return 0


def cmd_delete(args: argparse.Namespace) -> int:
    print(json.dumps(delete_recording(context(), args.recording_id, args.actor, args.reason), indent=2))
    return 0


def cmd_purge(args: argparse.Namespace) -> int:
    print(json.dumps(purge(context(), args.older_than_days, args.actor, apply=args.apply), indent=2))
    return 0


def cmd_withdraw(args: argparse.Namespace) -> int:
    print(json.dumps(withdraw_worker_consent(context(), args.worker_id, args.actor, args.reason), indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="klaudy_pipeline", description=f"Klaudy data pipeline {PIPELINE_VERSION}")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="work the queue")
    run.add_argument("--once", action="store_true", help="exit when the queue is empty")
    run.add_argument("--idle", type=float, default=5.0, help="seconds to wait when there is nothing to do")
    run.set_defaults(fn=cmd_run)

    sub.add_parser("sweep", help="requeue stuck jobs and validate recordings never stopped").set_defaults(fn=cmd_sweep)

    validate = sub.add_parser("validate", help="validate one recording now")
    validate.add_argument("recording_id")
    validate.set_defaults(fn=cmd_validate)

    export = sub.add_parser("export", help="write a new dataset version")
    export.add_argument("name")
    export.add_argument("--from", dest="date_from")
    export.add_argument("--to", dest="date_to")
    export.add_argument("--include-errors", action="store_true", help="also recordings with unresolved error findings")
    export.add_argument("--description")
    export.add_argument("--requested-by", default=os.environ.get("USER", "pipeline"))
    export.set_defaults(fn=cmd_export)

    ingest = sub.add_parser("ingest-zip", help="add a recording exported from a phone")
    ingest.add_argument("file")
    ingest.set_defaults(fn=cmd_ingest)

    actor = os.environ.get("USER", "pipeline")
    delete = sub.add_parser("delete-recording", help="delete a recording's bytes, derived copies and rows")
    delete.add_argument("recording_id")
    delete.add_argument("--reason", required=True)
    delete.add_argument("--actor", default=actor)
    delete.set_defaults(fn=cmd_delete)

    retention = sub.add_parser("purge", help="delete recordings older than N days (dry run without --apply)")
    retention.add_argument("--older-than-days", type=int, required=True)
    retention.add_argument("--apply", action="store_true")
    retention.add_argument("--actor", default=actor)
    retention.set_defaults(fn=cmd_purge)

    withdraw = sub.add_parser("withdraw-consent", help="stop a worker's recordings from entering datasets")
    withdraw.add_argument("worker_id")
    withdraw.add_argument("--reason")
    withdraw.add_argument("--actor", default=actor)
    withdraw.set_defaults(fn=cmd_withdraw)

    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())

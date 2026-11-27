"""Datasets: versioned, checksummed, reproducible, and only what may be used."""

import hashlib
import json
from datetime import timedelta

from klaudy_pipeline.export import TABLES, export_dataset
from klaudy_pipeline.findings import Finding, record

from conftest import T0, add_event, make_consents, make_recording, make_session, put_segment, put_sensors, still_then_moving, webm


def job_with_video(ctx, *, source="field", customer=True, worker="wk_maria"):
    session = make_session(ctx.conn, source=source, worker_id=worker)
    make_consents(ctx.conn, session, worker_id=worker, customer=customer)
    rec = make_recording(ctx.conn, session)
    put_segment(ctx, rec, 1, webm(3), 0, 3000)
    put_sensors(ctx, rec, 1, still_then_moving(0, 1), 0, 2000)
    add_event(ctx.conn, rec, 1, "recorder_started", 10)
    # What the worker declared: the oven, 1 s into the video, for 2 s.
    ctx.conn.execute(
        'INSERT INTO "ActivitySegment" (id, "sessionId", "roomType", "roomKey", "taskKey", "predictedMinutes", "startedAt", "endedAt", minutes) '
        "VALUES (%s, %s, 'kitchen', 'kitchen-1', 'oven', 25, %s, %s, 0)",
        [f"seg_{rec}", session, T0 + timedelta(seconds=1), T0 + timedelta(seconds=3)],
    )
    return session, rec


def test_only_real_consented_clean_jobs_go_in(ctx):
    _, good = job_with_video(ctx)
    job_with_video(ctx, source="test")  # practice run
    job_with_video(ctx, customer=False, worker="wk_rosa")  # the customer never said yes
    _, broken = job_with_video(ctx, worker="wk_ana")
    record(ctx.conn, broken, None, [Finding("checksum_mismatch", "error", {"index": 1})], "test")

    result = export_dataset(ctx, "work-demos", description="first cut")
    assert result["version"] == 1
    assert result["counts"]["recordings"] == 1
    manifest = json.loads(ctx.storage.get(result["manifestKey"]))
    recordings = [json.loads(line) for line in ctx.storage.get("datasets/work-demos/v1/recordings.jsonl").decode().splitlines()]
    assert [r["id"] for r in recordings] == [good]
    assert "loggedBy" not in recordings[0], "no emails in a dataset"

    # Every file is listed with the checksum of exactly what was written.
    assert {f["path"] for f in manifest["files"]} == {f"{t}.{s}" for t in TABLES for s in ("jsonl", "parquet")}
    for f in manifest["files"]:
        data = ctx.storage.get(f"datasets/work-demos/v1/{f['path']}")
        assert hashlib.sha256(data).hexdigest() == f["sha256"] and len(data) == f["bytes"]

    # The worker's own declaration lands on the video's timeline.
    work = [json.loads(line) for line in ctx.storage.get("datasets/work-demos/v1/work_segments.jsonl").decode().splitlines()]
    assert work[0]["recordingId"] == good and work[0]["startOffsetMs"] == 1000 and work[0]["endOffsetMs"] == 3000
    assert work[0]["source"] == "worker" and work[0]["predictedMinutes"] == 25

    row = ctx.conn.execute('SELECT version, "pipelineVersion", counts FROM "DatasetVersion" WHERE name = \'work-demos\'').fetchone()
    assert row["version"] == 1 and row["counts"]["recordings"] == 1
    log = ctx.conn.execute('SELECT actor, action, resource FROM "DataAccessLog"').fetchall()
    assert {"actor": "pipeline", "action": "export", "resource": "dataset:work-demos/v1"} in log

    # Asked for explicitly, the one with an error comes along too.
    wider = export_dataset(ctx, "work-demos-all", filters={"excludeErrors": False})
    assert wider["counts"]["recordings"] == 2


def test_the_same_data_exports_to_the_same_bytes(ctx):
    job_with_video(ctx)
    a = export_dataset(ctx, "repro")
    b = export_dataset(ctx, "repro")
    assert (a["version"], b["version"]) == (1, 2), "a new version, never a rewrite"
    files_a = {f["path"]: f["sha256"] for f in json.loads(ctx.storage.get(a["manifestKey"]))["files"]}
    files_b = {f["path"]: f["sha256"] for f in json.loads(ctx.storage.get(b["manifestKey"]))["files"]}
    assert files_a == files_b
    assert ctx.storage.exists("datasets/repro/v1/manifest.json"), "v1 is still there"

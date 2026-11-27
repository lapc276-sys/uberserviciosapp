"""Deleting is complete, logged, and never automatic."""

from klaudy_pipeline.frames import extract_frames
from klaudy_pipeline.retention import delete_recording, purge, withdraw_worker_consent

from conftest import add_event, make_consents, make_recording, make_session, put_segment, put_sensors, still_then_moving, webm


def test_a_deleted_recording_leaves_no_bytes_and_no_rows_but_a_record(ctx):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session)
    put_segment(ctx, rec, 1, webm(3), 0, 3000)
    put_sensors(ctx, rec, 1, still_then_moving(0, 1), 0, 2000)
    add_event(ctx.conn, rec, 1, "recorder_started", 5)
    extract_frames(ctx, rec)
    keep = make_recording(ctx.conn, session)
    put_segment(ctx, keep, 1, webm(3), 0, 3000)

    result = delete_recording(ctx, rec, "admin@example.com", "the worker asked")
    assert result["objectsRemoved"] >= 5  # video, sensors, frames
    for table in ("VideoSegment", "SensorChunk", "RecordingEvent", "ExtractedFrame"):
        n = ctx.conn.execute(f'SELECT count(*) AS n FROM "{table}" WHERE "recordingId" = %s', [rec]).fetchone()["n"]
        assert n == 0, table
    assert not ctx.storage.exists(f"recordings/{session}/{rec}/video/00001.webm")
    assert ctx.storage.exists(f"recordings/{session}/{keep}/video/00001.webm"), "only that recording"
    log = ctx.conn.execute('SELECT actor, action, resource, reason FROM "DataAccessLog"').fetchall()
    assert log == [{"actor": "admin@example.com", "action": "delete", "resource": f"recording:{rec}", "reason": "the worker asked"}]


def test_retention_is_a_dry_run_until_told_otherwise(ctx):
    session = make_session(ctx.conn)
    old = make_recording(ctx.conn, session)  # T0 is 2026-11-26: "now" in these tests is later
    ctx.conn.execute('UPDATE "JobRecording" SET "startedAt" = now() - interval \'400 days\' WHERE id = %s', [old])
    recent = make_recording(ctx.conn, session)
    ctx.conn.execute('UPDATE "JobRecording" SET "startedAt" = now() - interval \'2 days\' WHERE id = %s', [recent])

    dry = purge(ctx, 365, "ops")
    assert dry["wouldDelete"] == 1 and dry["first"] == [old]
    assert ctx.conn.execute('SELECT count(*) AS n FROM "JobRecording"').fetchone()["n"] == 2

    assert purge(ctx, 365, "ops", apply=True) == {"deleted": 1}
    assert [r["id"] for r in ctx.conn.execute('SELECT id FROM "JobRecording"').fetchall()] == [recent]


def test_withdrawn_consent_keeps_a_worker_out_of_the_next_dataset(ctx):
    from klaudy_pipeline.export import export_dataset

    session = make_session(ctx.conn)
    make_consents(ctx.conn, session)
    rec = make_recording(ctx.conn, session)
    put_segment(ctx, rec, 1, webm(3), 0, 3000)
    assert export_dataset(ctx, "before")["counts"]["recordings"] == 1
    assert withdraw_worker_consent(ctx, "wk_maria", "admin@example.com", "asked by phone")["consentsWithdrawn"] == 1
    assert export_dataset(ctx, "after")["counts"]["recordings"] == 0

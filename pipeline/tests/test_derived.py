"""Frames and sensor summaries: derived, traceable, and safe to re-run."""

import hashlib
import io

import pyarrow.parquet as pq

from klaudy_pipeline import PIPELINE_VERSION
from klaudy_pipeline.frames import extract_frames
from klaudy_pipeline.sensors import summarize_sensors, summary_key
from klaudy_pipeline.validate import validate_recording

from conftest import make_recording, make_session, put_segment, put_sensors, scene_change_clip, still_then_moving, webm


def test_frames_keep_their_exact_time_and_their_source(ctx):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session)
    clip = webm(3)
    first = put_segment(ctx, rec, 1, clip, 120.5, 3120.5)
    put_segment(ctx, rec, 2, clip, 2820, 5820)

    result = extract_frames(ctx, rec)
    assert result["byMethod"]["uniform"] == 6

    rows = ctx.conn.execute(
        'SELECT "segmentId", "ptsMs", "offsetMs", "objectKey", width, height, sha256, "pipelineVersion" FROM "ExtractedFrame" '
        'WHERE "recordingId" = %s AND method = \'uniform\' ORDER BY "offsetMs"',
        [rec],
    ).fetchall()
    one = [r for r in rows if r["segmentId"] == first]
    # One frame per second of the source, at the source's own timestamps.
    assert [r["ptsMs"] for r in one] == [0, 1000, 2000]
    # Placed on the recording's timeline: the segment's start plus the pts.
    assert [r["offsetMs"] for r in one] == [120.5, 1120.5, 2120.5]
    for r in rows:
        assert (r["width"], r["height"]) == (320, 240)
        assert r["pipelineVersion"] == PIPELINE_VERSION
        image = ctx.storage.get(r["objectKey"])
        assert image[:2] == b"\xff\xd8", "a JPEG"
        assert hashlib.sha256(image).hexdigest() == r["sha256"]
        assert r["objectKey"].startswith(f"derived/{rec}/frames/{PIPELINE_VERSION}/uniform/")

    assert extract_frames(ctx, rec)["frames"] == 0, "a second run adds nothing"


def test_adaptive_frames_land_where_the_picture_changes(ctx):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session)
    put_segment(ctx, rec, 1, scene_change_clip(), 1000, 4000)
    extract_frames(ctx, rec)
    scenes = ctx.conn.execute(
        'SELECT "ptsMs", "offsetMs" FROM "ExtractedFrame" WHERE "recordingId" = %s AND method = \'scene\' ORDER BY "ptsMs"', [rec]
    ).fetchall()
    # One cut: the first frame of the second picture, 1533 ms into the
    # segment (23 frames at 15 fps), so 2533 ms into the recording.
    assert [(s["ptsMs"], s["offsetMs"]) for s in scenes] == [(1533, 2533)]


def test_frames_are_not_taken_from_segments_validation_rejected(ctx):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session, seconds=6)
    clip = webm(3)
    put_segment(ctx, rec, 1, clip, 0, 3000)
    bad = put_segment(ctx, rec, 2, clip, 2700, 5700)
    key = ctx.conn.execute('SELECT "objectKey" FROM "VideoSegment" WHERE id = %s', [bad]).fetchone()["objectKey"]
    ctx.storage.put(key, clip[:-1] + b"!", "video/webm", allow_raw=True)
    validate_recording(ctx, rec)
    extract_frames(ctx, rec)
    sources = {r["segmentId"] for r in ctx.conn.execute('SELECT "segmentId" FROM "ExtractedFrame" WHERE "recordingId" = %s', [rec]).fetchall()}
    assert bad not in sources and len(sources) == 1


def test_sensor_summary_is_derived_and_the_motion_label_is_an_opinion_with_a_source(ctx):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session, seconds=20)
    samples = still_then_moving(0, 10)
    put_sensors(ctx, rec, 1, samples[: len(samples) // 2], 0, 10_000)
    put_sensors(ctx, rec, 2, samples[len(samples) // 2 :], 10_000, 20_000)

    result = summarize_sensors(ctx, rec)
    assert result == {"samples": 1000, "seconds": 20, "annotations": 2}

    table = pq.read_table(io.BytesIO(ctx.storage.get(summary_key(rec))))
    assert table.num_rows == 20
    assert table.column("second").to_pylist() == list(range(20))

    notes = ctx.conn.execute(
        'SELECT a.label, a."startOffsetMs", a."endOffsetMs", a."activeMs", a."waitingMs", a.source, a."reviewStatus", m.model, m.config '
        'FROM "Annotation" a JOIN "ModelVersion" m ON m.id = a."modelVersionId" WHERE a."recordingId" = %s ORDER BY a."startOffsetMs"',
        [rec],
    ).fetchall()
    assert [(n["label"], n["startOffsetMs"], n["endOffsetMs"]) for n in notes] == [("still", 0, 10_000), ("moving", 10_000, 20_000)]
    assert notes[0]["waitingMs"] == 10_000 and notes[1]["activeMs"] == 10_000
    assert {n["source"] for n in notes} == {"machine"}
    assert {n["reviewStatus"] for n in notes} == {"unreviewed"}
    assert notes[0]["model"] == "motion-rules" and notes[0]["config"]["windowSeconds"] == 5

    assert summarize_sensors(ctx, rec)["annotations"] == 0, "the same model version does not say it twice"


def test_a_person_corrects_the_machine_without_erasing_it(ctx):
    """The append-only rule, at the database: a correction is a new row pointing at the old one."""
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session, seconds=20)
    put_sensors(ctx, rec, 1, still_then_moving(0, 10), 0, 20_000)
    summarize_sensors(ctx, rec)
    machine = ctx.conn.execute('SELECT id FROM "Annotation" WHERE "recordingId" = %s AND label = \'still\'', [rec]).fetchone()["id"]
    ctx.conn.execute(
        'INSERT INTO "Annotation" (id, kind, label, "recordingId", "startOffsetMs", "endOffsetMs", source, "annotatorId", "supersedesId", "reviewStatus") '
        "VALUES ('an_fix', 'activity', 'moving', %s, 0, 10000, 'human', 'admin@example.com', %s, 'accepted')",
        [rec, machine],
    )
    both = ctx.conn.execute(
        'SELECT a.source, a.label, b.source AS corrected_source, b.label AS corrected_label FROM "Annotation" a '
        'JOIN "Annotation" b ON b.id = a."supersedesId" WHERE a.id = \'an_fix\''
    ).fetchone()
    assert both == {"source": "human", "label": "moving", "corrected_source": "machine", "corrected_label": "still"}

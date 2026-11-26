"""Validation says what is wrong and fixes nothing."""

import hashlib
import os

from klaudy_pipeline.validate import validate_recording

from conftest import add_event, declare, make_recording, make_session, put_segment, put_sensors, still_then_moving, webm


def kinds(conn, recording_id):
    rows = conn.execute('SELECT kind, severity FROM "QualityFinding" WHERE "recordingId" = %s ORDER BY kind', [recording_id]).fetchall()
    return [(r["kind"], r["severity"]) for r in rows]


def queued(conn):
    return sorted(r["kind"] for r in conn.execute('SELECT kind FROM "ProcessingJob" WHERE status = \'queued\'').fetchall())


def clean_recording(ctx):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session)
    clip = webm(3)
    # Three segments of 3 s, cut with the planned ~300 ms overlap.
    for i, start in enumerate((0, 2700, 5400), start=1):
        put_segment(ctx, rec, i, clip, start, start + 3000)
    put_sensors(ctx, rec, 1, still_then_moving(0, 4), 0, 8400)
    add_event(ctx.conn, rec, 1, "recorder_started", 10)
    declare(ctx.conn, session, 1, 5, "kitchen-1")
    declare(ctx.conn, session, 5, 8, "bathroom-1")
    return rec


def test_a_clean_recording_has_nothing_to_report_and_moves_on(ctx):
    rec = clean_recording(ctx)
    result = validate_recording(ctx, rec)
    assert kinds(ctx.conn, rec) == []
    assert result["verifiedSegments"] == 3
    assert queued(ctx.conn) == ["extract_frames", "summarize_sensors"]


def test_every_defect_is_named_and_nothing_is_repaired(ctx):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session, seconds=40)
    clip = webm(3)
    put_segment(ctx, rec, 1, clip, 0, 3000)
    tampered = put_segment(ctx, rec, 2, clip, 2700, 5700)
    # Segment 3 never arrived; 4 comes 20 s later with nothing in the log.
    put_segment(ctx, rec, 4, clip, 25_000, 28_000)
    # 5 is garbage the phone faithfully hashed: the checksum passes, decoding does not.
    put_segment(ctx, rec, 5, os.urandom(4000), 27_700, 30_700)
    add_event(ctx.conn, rec, 1, "piece_conflict", None, {"kind": "video", "index": 2, "first": "a" * 64, "second": "b" * 64})
    # Someone changed segment 2's bytes in the bucket after upload.
    key = ctx.conn.execute('SELECT "objectKey" FROM "VideoSegment" WHERE id = %s', [tampered]).fetchone()["objectKey"]
    ctx.storage.put(key, clip[:-10] + b"0123456789", "video/webm", allow_raw=True)

    validate_recording(ctx, rec)
    found = kinds(ctx.conn, rec)
    assert ("missing_segment", "error") in found
    assert ("checksum_mismatch", "error") in found
    assert ("corrupt_video", "error") in found
    assert ("piece_conflict", "error") in found
    assert ("video_gap", "warning") in found, "a hole nobody explained"
    assert ("sensor_gap", "warning") in found, "no motion data at all, and no reason given"
    # The hole in the middle, and the tail: the recording ran to 40 s but
    # the last piece ended at 30.7 s.
    gaps = ctx.conn.execute('SELECT details FROM "QualityFinding" WHERE "recordingId" = %s AND kind = \'video_gap\'', [rec]).fetchall()
    assert sorted((g["details"]["fromMs"], g["details"]["toMs"]) for g in gaps) == [(5700, 25000), (30700, 40000)]

    # The receipt still says what the phone said: validation edits nothing.
    row = ctx.conn.execute('SELECT sha256 FROM "VideoSegment" WHERE id = %s', [tampered]).fetchone()
    assert row["sha256"] == hashlib.sha256(clip).hexdigest()


def test_a_privacy_pause_is_expected_not_a_defect(ctx):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session, seconds=20)
    clip = webm(3)
    put_segment(ctx, rec, 1, clip, 0, 3000)
    put_segment(ctx, rec, 2, clip, 15_000, 18_000)
    add_event(ctx.conn, rec, 1, "privacy_pause", 3010)
    add_event(ctx.conn, rec, 2, "privacy_resume", 14_990)
    add_event(ctx.conn, rec, 3, "sensors_unavailable", 5, {"reason": "permission_denied"})
    declare(ctx.conn, session, 0, 18, "bathroom-1")
    validate_recording(ctx, rec)
    found = kinds(ctx.conn, rec)
    assert ("video_gap", "info") in found
    assert ("sensors_unavailable", "info") in found
    assert not [k for k in found if k[1] != "info"]


def test_running_it_twice_adds_nothing(ctx):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session, clock=False)
    put_segment(ctx, rec, 1, webm(3), 0, 3000)
    first = validate_recording(ctx, rec)
    second = validate_recording(ctx, rec)
    assert first["new"] > 0 and second["new"] == 0
    assert ("clock_untrusted", "warning") in kinds(ctx.conn, rec)


def test_a_recording_left_on_the_phone_is_noted_not_failed(ctx):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session, uploaded=False)
    validate_recording(ctx, rec)
    assert kinds(ctx.conn, rec) == [("not_uploaded", "info")]
    assert queued(ctx.conn) == []


def test_footage_without_labels_and_labels_that_collide_are_named(ctx):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session)
    put_segment(ctx, rec, 1, webm(3), 0, 3000)
    validate_recording(ctx, rec)
    assert ("missing_annotations", "warning") in kinds(ctx.conn, rec)

    other = make_session(ctx.conn)
    rec2 = make_recording(ctx.conn, other)
    put_segment(ctx, rec2, 1, webm(3), 0, 3000)
    a = declare(ctx.conn, other, 0, 6, "kitchen-1")
    b = declare(ctx.conn, other, 2, 8, "bathroom-1")  # two rooms at once, nobody said "together"
    declare(ctx.conn, other, 7, 9, "kitchen-1", together=True)  # a shared room overlapping is fine
    validate_recording(ctx, rec2)
    collided = ctx.conn.execute(
        'SELECT details FROM "QualityFinding" WHERE "recordingId" = %s AND kind = \'inconsistent_task_boundaries\'', [rec2]
    ).fetchall()
    assert [c["details"] for c in collided] == [{"declared": [a, b], "overlapMs": 4000}]


def test_the_same_bytes_under_two_recordings_are_flagged(ctx):
    session = make_session(ctx.conn)
    a, b = make_recording(ctx.conn, session), make_recording(ctx.conn, session)
    clip = webm(3)
    put_segment(ctx, a, 1, clip, 0, 3000)
    put_segment(ctx, b, 1, clip, 0, 3000)
    validate_recording(ctx, b)
    assert ("duplicate_recording", "warning") in kinds(ctx.conn, b)

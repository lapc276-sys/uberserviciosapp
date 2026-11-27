"""A recording that stayed on the phone comes in through its ZIP export."""

import hashlib
import json
import zipfile

import pytest

from klaudy_pipeline.ingest import ingest_zip
from klaudy_pipeline.queue import PermanentError
from klaudy_pipeline.validate import validate_recording

from conftest import add_event, make_recording, make_session, sensor_gz, still_then_moving, webm


def phone_zip(path, recording_id, *, tamper=False):
    """What components/pilot/recordingStore.ts exportRecording() writes."""
    clip = webm(3)
    sensors = sensor_gz(still_then_moving(0, 1))
    pieces = [
        ("video/00001.webm", "video", 1, clip, 0, 3000),
        ("sensors/00001.jsonl.gz", "sensors", 1, sensors, 0, 2000),
    ]
    manifest = {
        "format": "klaudy-recording/1",
        "recordingId": recording_id,
        "mimeType": "video/webm",
        "part": {"number": 1, "of": 1},
        "pieces": [
            {"file": name, "kind": kind, "index": index, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
             "monoStartMs": start, "monoEndMs": end, **({"samples": 100, "streams": ["motion"]} if kind == "sensors" else {})}
            for name, kind, index, data, start, end in pieces
        ],
        "events": [{"seq": 1, "kind": "recorder_started", "monoMs": 5, "clientUtcMs": 1}, {"seq": 2, "kind": "privacy_pause", "monoMs": 2500, "clientUtcMs": 2}],
    }
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_STORED) as z:
        z.writestr("manifest.json", json.dumps(manifest))
        for name, _, _, data, _, _ in pieces:
            z.writestr(name, data[:-1] + b"x" if tamper and name.startswith("video") else data)
    return path


def test_an_export_becomes_an_uploaded_recording(ctx, tmp_path):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session, uploaded=False)
    add_event(ctx.conn, rec, 1, "recorder_started", 5)  # already received while recording
    validate_recording(ctx, rec)  # "not uploaded", as it was then
    ctx.conn.execute('DELETE FROM "ProcessingJob"')

    result = ingest_zip(ctx, phone_zip(tmp_path / "trabajo.zip", rec))
    assert result == {"recordingId": rec, "stored": 2, "rows": 2, "events": 1}
    note = ctx.conn.execute('SELECT "resolvedAt" FROM "QualityFinding" WHERE "recordingId" = %s AND kind = \'not_uploaded\'', [rec]).fetchone()
    assert note["resolvedAt"] is not None, "resolved by the ingest, and still on file"

    prefix = ctx.conn.execute('SELECT "storagePrefix" FROM "JobRecording" WHERE id = %s', [rec]).fetchone()["storagePrefix"]
    assert prefix == f"recordings/{session}/{rec}"
    seg = ctx.conn.execute('SELECT "objectKey", sha256 FROM "VideoSegment" WHERE "recordingId" = %s', [rec]).fetchone()
    assert hashlib.sha256(ctx.storage.get(seg["objectKey"])).hexdigest() == seg["sha256"]
    assert ctx.conn.execute('SELECT kind FROM "ProcessingJob"').fetchall() == [{"kind": "validate_recording"}]

    again = ingest_zip(ctx, tmp_path / "trabajo.zip")
    assert again["stored"] == 0 and again["rows"] == 0 and again["events"] == 0


def test_bytes_the_phone_did_not_hash_are_refused(ctx, tmp_path):
    session = make_session(ctx.conn)
    rec = make_recording(ctx.conn, session, uploaded=False)
    with pytest.raises(PermanentError):
        ingest_zip(ctx, phone_zip(tmp_path / "bad.zip", rec, tamper=True))
    assert ctx.conn.execute('SELECT count(*) AS n FROM "VideoSegment"').fetchone()["n"] == 0


def test_an_export_of_a_recording_this_app_never_started_is_refused(ctx, tmp_path):
    with pytest.raises(PermanentError):
        ingest_zip(ctx, phone_zip(tmp_path / "stranger.zip", "rec_nobody"))

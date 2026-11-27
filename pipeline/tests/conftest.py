"""Fixtures: a throwaway Postgres schema built from the app's own Prisma
schema, a directory standing in for the bucket, and media made by ffmpeg.

The database tests need DATABASE_URL (the app's Postgres) and are skipped
without it; nothing is written to the app's own tables — each run creates
its own schema and drops it at the end.
"""

from __future__ import annotations

import gzip
import json
import os
import subprocess
import sys
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))

from klaudy_pipeline.config import Settings  # noqa: E402
from klaudy_pipeline.context import Context  # noqa: E402
from klaudy_pipeline.db import connect, jsonb  # noqa: E402
from klaudy_pipeline.storage import LocalStorage  # noqa: E402

TABLES = [
    "ProcessingJob",
    "QualityFinding",
    "ExtractedFrame",
    "Annotation",
    "ModelVersion",
    "DatasetVersion",
    "DataAccessLog",
    "RecordingEvent",
    "SensorChunk",
    "VideoSegment",
    "RecordingConsent",
    "JobRecording",
    "ActivitySegment",
    "ActivitySession",
    "Worker",
]


@pytest.fixture(scope="session")
def database_url():
    url = os.environ.get("DATABASE_URL")
    if not url:
        pytest.skip("DATABASE_URL is not set: the database tests run against the app's Postgres")
    schema = f"pipeline_test_{uuid.uuid4().hex[:8]}"
    test_url = f"{url}{'&' if '?' in url else '?'}schema={schema}"
    prisma = REPO / "node_modules" / ".bin" / "prisma"
    result = subprocess.run(
        [str(prisma), "db", "push", "--skip-generate", "--accept-data-loss"],
        cwd=REPO,
        env={**os.environ, "DATABASE_URL": test_url},
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        pytest.fail(f"prisma db push failed:\n{result.stdout}\n{result.stderr}")
    yield test_url
    with connect(url) as conn:
        conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')


@pytest.fixture
def conn(database_url):
    c = connect(database_url)
    c.execute("TRUNCATE " + ", ".join(f'"{t}"' for t in TABLES) + " CASCADE")
    yield c
    c.close()


@pytest.fixture
def ctx(conn, tmp_path):
    bucket = tmp_path / "bucket"
    settings = Settings(
        database_url=None,
        s3_endpoint=None,
        s3_bucket=None,
        s3_key_id=None,
        s3_secret=None,
        s3_region="auto",
        local_storage=str(bucket),
        frames_per_second=1.0,
        scene_threshold=0.3,
        code_version="test",
    )
    return Context(conn=conn, storage=LocalStorage(bucket), settings=settings)


# ── Media ───────────────────────────────────────────────────────────────────

_MEDIA: dict[tuple[float, int], bytes] = {}


def webm(seconds: float, fps: int = 15) -> bytes:
    """A VP8 WebM like the phone's, from ffmpeg's test pattern."""
    key = (seconds, fps)
    if key not in _MEDIA:
        result = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", f"testsrc=size=320x240:rate={fps}", "-t", str(seconds),
             "-c:v", "libvpx", "-b:v", "300k", "-f", "webm", "pipe:1"],
            capture_output=True,
            check=True,
            stdin=subprocess.DEVNULL,
        )
        _MEDIA[key] = result.stdout
    return _MEDIA[key]


def scene_change_clip() -> bytes:
    """1.5 s of one picture, then 1.5 s of a completely different one."""
    key = (-1.0, 15)
    if key not in _MEDIA:
        result = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error",
             "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=1.5",
             "-f", "lavfi", "-i", "smptebars=size=320x240:rate=15:duration=1.5",
             "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]",
             "-c:v", "libvpx", "-b:v", "300k", "-f", "webm", "pipe:1"],
            capture_output=True,
            check=True,
            stdin=subprocess.DEVNULL,
        )
        _MEDIA[key] = result.stdout
    return _MEDIA[key]


def sensor_gz(samples: list[dict]) -> bytes:
    return gzip.compress("".join(json.dumps(s) + "\n" for s in samples).encode())


# ── Rows ────────────────────────────────────────────────────────────────────

T0 = datetime(2026, 11, 26, 10, 0, 0)


def make_session(conn, *, source: str = "field", worker_id: str = "wk_maria", logged_by: str = "maria@example.com") -> str:
    session_id = f"as_{uuid.uuid4().hex[:10]}"
    conn.execute('INSERT INTO "Worker" (id, name) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING', [worker_id, worker_id.removeprefix("wk_").title()])
    conn.execute(
        'INSERT INTO "ActivitySession" (id, "loggedBy", "workerId", source, "startedAt") VALUES (%s, %s, %s, %s, %s)',
        [session_id, logged_by, worker_id, source, T0 - timedelta(minutes=2)],
    )
    return session_id


def make_consents(conn, session_id: str, worker_id: str = "wk_maria", customer: bool = True) -> None:
    conn.execute(
        'INSERT INTO "RecordingConsent" (id, kind, "workerId", version, statement, "recordedBy") VALUES (%s, \'worker\', %s, \'v1\', \'…\', \'x\')',
        [f"cs_{uuid.uuid4().hex[:10]}", worker_id],
    )
    if customer:
        conn.execute(
            'INSERT INTO "RecordingConsent" (id, kind, "workerId", "sessionId", version, statement, "recordedBy") VALUES (%s, \'customer\', %s, %s, \'v1\', \'…\', \'x\')',
            [f"cs_{uuid.uuid4().hex[:10]}", worker_id, session_id],
        )


def make_recording(conn, session_id: str, *, uploaded: bool = True, seconds: float = 9.0, clock: bool = True) -> str:
    recording_id = f"rec_{uuid.uuid4().hex[:10]}"
    conn.execute(
        'INSERT INTO "JobRecording" (id, "sessionId", "startedAt", "endedAt", "mimeType", "chunkSeconds", "storagePrefix", "clockOffsetMs", "clockRttMs", capture) '
        "VALUES (%s, %s, %s, %s, 'video/webm', 3, %s, %s, %s, %s)",
        [
            recording_id,
            session_id,
            T0,
            T0 + timedelta(seconds=seconds),
            f"recordings/{session_id}/{recording_id}" if uploaded else None,
            12.5 if clock else None,
            30.0 if clock else None,
            jsonb({"config": {"frameRate": 15, "segmentSeconds": 3}}),
        ],
    )
    return recording_id


def put_segment(ctx: Context, recording_id: str, index: int, data: bytes, start: float, end: float, *, receipt_sha: str | None = None) -> str:
    import hashlib

    rec = ctx.conn.execute('SELECT "storagePrefix" FROM "JobRecording" WHERE id = %s', [recording_id]).fetchone()
    key = f"{rec['storagePrefix']}/video/{index:05d}.webm"
    ctx.storage.put(key, data, "video/webm", allow_raw=True)
    segment_id = f"vs_{uuid.uuid4().hex[:10]}"
    ctx.conn.execute(
        'INSERT INTO "VideoSegment" (id, "recordingId", index, "objectKey", "mimeType", bytes, sha256, "monoStartMs", "monoEndMs") '
        "VALUES (%s, %s, %s, %s, 'video/webm', %s, %s, %s, %s)",
        [segment_id, recording_id, index, key, len(data), receipt_sha or hashlib.sha256(data).hexdigest(), start, end],
    )
    return segment_id


def put_sensors(ctx: Context, recording_id: str, index: int, samples: list[dict], start: float, end: float) -> None:
    import hashlib

    data = sensor_gz(samples)
    rec = ctx.conn.execute('SELECT "storagePrefix" FROM "JobRecording" WHERE id = %s', [recording_id]).fetchone()
    key = f"{rec['storagePrefix']}/sensors/{index:05d}.jsonl.gz"
    ctx.storage.put(key, data, "application/gzip", allow_raw=True)
    ctx.conn.execute(
        'INSERT INTO "SensorChunk" (id, "recordingId", index, "objectKey", bytes, sha256, samples, streams, "monoStartMs", "monoEndMs") '
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        [f"sc_{uuid.uuid4().hex[:10]}", recording_id, index, key, len(data), hashlib.sha256(data).hexdigest(), len(samples), ["motion"], start, end],
    )


def declare(conn, session_id: str, start_s: float, end_s: float | None, room_key: str = "kitchen-1", together: bool = False) -> str:
    """What the worker marked: a room or object, from start_s to end_s seconds after T0."""
    segment_id = f"seg_{uuid.uuid4().hex[:10]}"
    conn.execute(
        'INSERT INTO "ActivitySegment" (id, "sessionId", "roomType", "roomKey", together, "startedAt", "endedAt") VALUES (%s, %s, %s, %s, %s, %s, %s)',
        [segment_id, session_id, room_key.split("-")[0], room_key, together, T0 + timedelta(seconds=start_s), T0 + timedelta(seconds=end_s) if end_s is not None else None],
    )
    return segment_id


def add_event(conn, recording_id: str, seq: int | None, kind: str, mono: float | None, data: dict | None = None) -> None:
    conn.execute(
        'INSERT INTO "RecordingEvent" (id, "recordingId", seq, kind, "monoMs", data) VALUES (%s, %s, %s, %s, %s, %s)',
        [f"ev_{uuid.uuid4().hex[:10]}", recording_id, seq, kind, mono, jsonb(data)],
    )


def motion(t: float, acc: float = 0.0, rot: float = 0.0) -> dict:
    return {"t": t, "s": "motion", "a": [acc, 0.0, 0.0], "g": [acc, 9.81, 0.0], "r": [rot, 0.0, 0.0], "i": 16}


def still_then_moving(start: float, seconds_each: int) -> list[dict]:
    """A phone held still, then swinging: 50 Hz."""
    import math

    out = []
    for k in range(seconds_each * 50):
        out.append(motion(start + k * 20, acc=0.01 * math.sin(k), rot=0.5))
    base = start + seconds_each * 1000
    for k in range(seconds_each * 50):
        out.append(motion(base + k * 20, acc=2.5 * math.sin(k / 3), rot=60 + 30 * math.sin(k / 5)))
    return out

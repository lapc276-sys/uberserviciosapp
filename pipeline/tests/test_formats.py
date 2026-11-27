"""The formats and the arithmetic, without a database."""

import gzip
import json

import pytest

from klaudy_pipeline.db import libpq_url
from klaudy_pipeline.findings import Finding
from klaudy_pipeline.formats import SensorFormatError, magnitude, parse_sensor_chunk, piece_name
from klaudy_pipeline.sensors import motion_states, per_second
from klaudy_pipeline.storage import LocalStorage, RawWriteRefused

from conftest import motion, still_then_moving


def test_piece_names_match_the_phone():
    # The same three examples as tests/recordings.test.ts.
    assert piece_name("video", 1, "video/webm") == "video/00001.webm"
    assert piece_name("video", 360, "video/mp4") == "video/00360.mp4"
    assert piece_name("sensors", 12, "video/webm") == "sensors/00012.jsonl.gz"


def test_sensor_chunks_parse_and_refuse_what_is_not_the_format():
    lines = [motion(10), {"t": 20.5, "s": "orientation", "o": [1, 2, 3], "abs": False}]
    data = gzip.compress("".join(json.dumps(x) + "\n" for x in lines).encode())
    assert [s["s"] for s in parse_sensor_chunk(data)] == ["motion", "orientation"]
    with pytest.raises(SensorFormatError):
        parse_sensor_chunk(b"not gzip")
    with pytest.raises(SensorFormatError):
        parse_sensor_chunk(gzip.compress(b'{"t": 1, "s": "temperature"}\n'))
    assert magnitude([3, 4, 0]) == 5
    assert magnitude([None, 1, 1]) is None, "an axis the phone does not measure is not a zero"


def test_prisma_urls_become_libpq_urls():
    clean, schema = libpq_url("postgresql://u:p@h:5432/db?host=/tmp&schema=pipeline_x&connection_limit=5&sslmode=require")
    assert schema == "pipeline_x"
    assert "schema" not in clean and "connection_limit" not in clean
    assert "sslmode=require" in clean and "host=%2Ftmp" in clean


def test_still_and_moving_are_told_apart_and_merged_into_runs():
    runs = motion_states(still_then_moving(0, 10))
    assert [(r["label"], r["startMs"], r["endMs"]) for r in runs] == [("still", 0, 10_000), ("moving", 10_000, 20_000)]
    seconds = per_second(still_then_moving(0, 2))
    assert [s["second"] for s in seconds] == [0, 1, 2, 3]
    assert all(s["motion_samples"] == 50 for s in seconds)


def test_findings_only_of_known_kinds():
    with pytest.raises(ValueError):
        Finding("looks_odd", "warning")
    with pytest.raises(ValueError):
        Finding("video_gap", "catastrophic")


def test_the_pipeline_cannot_overwrite_raw_recordings(tmp_path):
    storage = LocalStorage(tmp_path)
    with pytest.raises(RawWriteRefused):
        storage.put("recordings/as_1/rec_1/video/00001.webm", b"x", "video/webm")
    storage.put("derived/frames/x.jpg", b"x", "image/jpeg")
    with pytest.raises(ValueError):
        storage.put("derived/../recordings/x", b"x", "video/webm")

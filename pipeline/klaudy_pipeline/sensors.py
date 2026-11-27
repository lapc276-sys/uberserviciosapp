"""summarize_sensors: motion, one row per second, and a first machine opinion.

Two different things, kept apart on purpose:

- The per-second summary is DERIVED: arithmetic on the raw samples, the same
  every time it runs. It goes to the bucket as Parquet.
- "Still" or "moving" per stretch of time is an INTERPRETATION, even though
  a few thresholds produce it. It is written as Annotation rows with
  source = machine and a ModelVersion that records the thresholds, so when a
  person later says "she was scrubbing, not standing still", that goes in as
  a correction pointing at it — and how often the rule was wrong becomes a
  query instead of an argument.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
from collections import defaultdict
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from . import PIPELINE_VERSION
from .context import Context
from .db import jsonb, new_id
from .formats import SensorFormatError, magnitude, parse_sensor_chunk
from .queue import PermanentError
from .storage import MissingObject

GRAVITY = 9.80665

# The rule, in full. Hypotheses: set by hand, not measured — the same rule as
# every other constant here (CLAUDE.md). A labelled week will say better.
MOTION_RULES = {"windowSeconds": 5, "movingAccStd": 0.35, "movingRotationDegPerS": 20.0, "minSamplesPerWindow": 20}


def summary_key(recording_id: str) -> str:
    return f"derived/{recording_id}/sensors/{PIPELINE_VERSION}/per_second.parquet"


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _std(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    m = sum(values) / len(values)
    return math.sqrt(sum((v - m) ** 2 for v in values) / (len(values) - 1))


def _linear(sample: dict[str, Any]) -> float | None:
    """Acceleration without gravity: measured directly where the phone can, otherwise |g| − 1 g."""
    direct = magnitude(sample.get("a"))
    if direct is not None:
        return direct
    with_gravity = magnitude(sample.get("g"))
    return abs(with_gravity - GRAVITY) if with_gravity is not None else None


def per_second(samples: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[int, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for s in samples:
        b = buckets[int(s["t"] // 1000)]
        if s["s"] == "motion":
            b["n"].append(1)
            acc = _linear(s)
            if acc is not None:
                b["acc"].append(acc)
            rot = magnitude(s.get("r"))
            if rot is not None:
                b["rot"].append(rot)
        else:
            o = s.get("o") or [None, None, None]
            if o[1] is not None:
                b["beta"].append(o[1])
            if o[2] is not None:
                b["gamma"].append(o[2])
    rows = []
    for second in sorted(buckets):
        b = buckets[second]
        rows.append(
            {
                "second": second,
                "motion_samples": len(b["n"]),
                "acc_mean": _mean(b["acc"]),
                "acc_std": _std(b["acc"]),
                "rot_mean": _mean(b["rot"]),
                "beta_mean": _mean(b["beta"]),
                "gamma_mean": _mean(b["gamma"]),
            }
        )
    return rows


def motion_states(samples: list[dict[str, Any]], rules: dict[str, Any] = MOTION_RULES) -> list[dict[str, Any]]:
    """Fixed windows labelled still/moving, merged into runs: [{label, startMs, endMs, accStd, rotMean}]."""
    width = rules["windowSeconds"] * 1000
    windows: dict[int, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for s in samples:
        if s["s"] != "motion":
            continue
        w = windows[int(s["t"] // width)]
        acc = _linear(s)
        if acc is not None:
            w["acc"].append(acc)
        rot = magnitude(s.get("r"))
        if rot is not None:
            w["rot"].append(rot)
    runs: list[dict[str, Any]] = []
    for index in sorted(windows):
        w = windows[index]
        if len(w["acc"]) < rules["minSamplesPerWindow"]:
            continue
        acc_std = _std(w["acc"]) or 0.0
        rot_mean = _mean(w["rot"]) or 0.0
        label = "moving" if acc_std > rules["movingAccStd"] or rot_mean > rules["movingRotationDegPerS"] else "still"
        start, end = index * width, (index + 1) * width
        if runs and runs[-1]["label"] == label and runs[-1]["endMs"] == start:
            run = runs[-1]
            run["endMs"] = end
            run["accStd"].append(acc_std)
            run["rotMean"].append(rot_mean)
        else:
            runs.append({"label": label, "startMs": start, "endMs": end, "accStd": [acc_std], "rotMean": [rot_mean]})
    for run in runs:
        run["accStd"] = round(_mean(run["accStd"]) or 0.0, 4)
        run["rotMean"] = round(_mean(run["rotMean"]) or 0.0, 4)
    return runs


def ensure_model_version(conn, provider: str, model: str, version: str, config: dict[str, Any], prompt_version: str = "") -> str:
    config_hash = hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()[:16]
    conn.execute(
        'INSERT INTO "ModelVersion" (id, provider, model, version, "promptVersion", "configHash", config) VALUES (%s, %s, %s, %s, %s, %s, %s) '
        'ON CONFLICT (provider, model, version, "promptVersion", "configHash") DO NOTHING',
        [new_id("mv"), provider, model, version, prompt_version, config_hash, jsonb(config)],
    )
    row = conn.execute(
        'SELECT id FROM "ModelVersion" WHERE provider = %s AND model = %s AND version = %s AND "promptVersion" = %s AND "configHash" = %s',
        [provider, model, version, prompt_version, config_hash],
    ).fetchone()
    return row["id"]


def summarize_sensors(ctx: Context, recording_id: str) -> dict[str, Any]:
    conn = ctx.conn
    rec = conn.execute('SELECT id, "sessionId" FROM "JobRecording" WHERE id = %s', [recording_id]).fetchone()
    if not rec:
        raise PermanentError(f"unknown recording {recording_id}")
    chunks = conn.execute('SELECT * FROM "SensorChunk" WHERE "recordingId" = %s ORDER BY index', [recording_id]).fetchall()
    samples: list[dict[str, Any]] = []
    for chunk in chunks:
        try:
            data = ctx.storage.get(chunk["objectKey"])
        except MissingObject:
            continue
        if hashlib.sha256(data).hexdigest() != chunk["sha256"]:
            continue  # validation has already said so
        try:
            samples.extend(parse_sensor_chunk(data))
        except SensorFormatError:
            continue
    samples.sort(key=lambda s: s["t"])

    rows = per_second(samples)
    table = pa.Table.from_pylist([{"recording_id": recording_id, **row, "pipeline_version": PIPELINE_VERSION} for row in rows])
    buffer = io.BytesIO()
    pq.write_table(table, buffer)
    ctx.storage.put(summary_key(recording_id), buffer.getvalue(), "application/vnd.apache.parquet")

    model_id = ensure_model_version(conn, "klaudy", "motion-rules", PIPELINE_VERSION, MOTION_RULES)
    already = conn.execute(
        'SELECT 1 FROM "Annotation" WHERE "recordingId" = %s AND "modelVersionId" = %s LIMIT 1', [recording_id, model_id]
    ).fetchone()
    annotations = 0
    if not already:
        for run in motion_states(samples):
            moving = run["label"] == "moving"
            duration = run["endMs"] - run["startMs"]
            conn.execute(
                'INSERT INTO "Annotation" (id, kind, label, "recordingId", "sessionId", "startOffsetMs", "endOffsetMs", "activeMs", "waitingMs", '
                'attributes, confidence, source, "modelVersionId") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
                [
                    new_id("an"),
                    "activity",
                    run["label"],
                    recording_id,
                    rec["sessionId"],
                    run["startMs"],
                    run["endMs"],
                    duration if moving else 0,
                    0 if moving else duration,
                    jsonb({"accStd": run["accStd"], "rotMean": run["rotMean"]}),
                    # A threshold on a chest is a weak witness: low confidence until
                    # people have corrected enough of these to measure it.
                    0.5,
                    "machine",
                    model_id,
                ],
            )
            annotations += 1
    return {"samples": len(samples), "seconds": len(rows), "annotations": annotations}

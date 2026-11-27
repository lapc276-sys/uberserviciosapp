"""The phone's formats, read back. Mirror of lib/recording/format.ts — change
both or neither."""

from __future__ import annotations

import gzip
import json
from typing import Any


def piece_name(kind: str, index: int, mime_type: str) -> str:
    n = f"{index:05d}"
    if kind == "video":
        return f"video/{n}.{'mp4' if mime_type.startswith('video/mp4') else 'webm'}"
    return f"sensors/{n}.jsonl.gz"


def content_type(kind: str, mime_type: str) -> str:
    return mime_type if kind == "video" else "application/gzip"


class SensorFormatError(ValueError):
    pass


def parse_sensor_chunk(data: bytes) -> list[dict[str, Any]]:
    """One gzipped JSONL chunk → samples. Raises on anything that is not the format."""
    try:
        text = gzip.decompress(data).decode("utf-8")
    except (OSError, EOFError, UnicodeDecodeError) as err:
        raise SensorFormatError(f"not gzipped UTF-8: {err}") from err
    samples = []
    for number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            sample = json.loads(line)
        except json.JSONDecodeError as err:
            raise SensorFormatError(f"line {number}: {err}") from err
        if not isinstance(sample, dict) or not isinstance(sample.get("t"), (int, float)) or sample.get("s") not in {"motion", "orientation"}:
            raise SensorFormatError(f"line {number}: missing t or s")
        samples.append(sample)
    return samples


def magnitude(vector: Any) -> float | None:
    if not isinstance(vector, list) or len(vector) != 3 or any(v is None for v in vector):
        return None
    return float(sum(v * v for v in vector) ** 0.5)

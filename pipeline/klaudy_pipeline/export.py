"""export_dataset: an immutable, versioned snapshot for training and analysis.

Writes one JSONL and one Parquet file per table under
datasets/<name>/v<version>/, a manifest.json with the checksum of every file,
and a DatasetVersion row. A model trained on "work-demos v7" can always be
traced to exactly the rows it saw, and v7 is never rewritten: the next
export is v8.

Raw video is not copied — each row carries its objectKey and sha256, which
say exactly which bytes it means. Emails, names and addresses are not
exported: people appear as worker ids.

What goes in:
- only real jobs (source <> 'test');
- only recordings with both consents on file and not withdrawn;
- by default, only recordings without unresolved error findings.
"""

from __future__ import annotations

import hashlib
import io
import json
from datetime import date, datetime, timezone
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from . import PIPELINE_VERSION
from .context import Context
from .db import jsonb, new_id

TABLES = (
    "recordings",
    "video_segments",
    "sensor_chunks",
    "events",
    "work_segments",
    "annotations",
    "frames",
    "quality_findings",
    "consents",
)


def _plain(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z") if value.tzinfo is None else value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _jsonl(rows: list[dict[str, Any]]) -> bytes:
    return "".join(json.dumps({k: _plain(v) for k, v in row.items()}, sort_keys=True, ensure_ascii=False) + "\n" for row in rows).encode()


def _parquet(rows: list[dict[str, Any]]) -> bytes:
    # Nested JSON as strings: one stable column type, whatever is inside.
    # Times stay timestamps (UTC, like every DateTime Prisma writes).
    flat = [{k: (json.dumps(v, sort_keys=True) if isinstance(v, (dict, list)) and not _is_str_list(v) else v) for k, v in row.items()} for row in rows]
    buffer = io.BytesIO()
    pq.write_table(pa.Table.from_pylist(flat), buffer)
    return buffer.getvalue()


def _is_str_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(v, str) for v in value)


def _select(conn, filters: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    params = {
        "from": filters.get("from"),
        "to": filters.get("to"),
        "exclude_errors": bool(filters.get("excludeErrors", True)),
    }
    recordings = conn.execute(
        """
        SELECT r.id, r."sessionId", s."workerId", s.region, s."analysisId", s."serviceSlug", s."crewSize",
               r."startedAt", r."endedAt", r."mimeType", r."chunkSeconds", r."storagePrefix",
               r."clockOffsetMs", r."clockRttMs", r.capture, r.device, r.audio
          FROM "JobRecording" r
          JOIN "ActivitySession" s ON s.id = r."sessionId"
         WHERE s.source <> 'test'
           AND r."storagePrefix" IS NOT NULL
           AND (%(from)s::timestamp IS NULL OR r."startedAt" >= %(from)s::timestamp)
           AND (%(to)s::timestamp IS NULL OR r."startedAt" < %(to)s::timestamp)
           AND EXISTS (SELECT 1 FROM "RecordingConsent" c
                        WHERE c.kind = 'worker' AND c."workerId" = s."workerId" AND c."withdrawnAt" IS NULL)
           AND EXISTS (SELECT 1 FROM "RecordingConsent" c
                        WHERE c.kind = 'customer' AND c."sessionId" = s.id AND c."withdrawnAt" IS NULL)
           AND (NOT %(exclude_errors)s OR NOT EXISTS (
                SELECT 1 FROM "QualityFinding" q
                 WHERE q."recordingId" = r.id AND q.severity = 'error' AND q."resolvedAt" IS NULL))
         ORDER BY r."startedAt", r.id
        """,
        params,
    ).fetchall()
    ids = [r["id"] for r in recordings]
    sessions = sorted({r["sessionId"] for r in recordings})

    def rows(sql: str, key: list[str]) -> list[dict[str, Any]]:
        return conn.execute(sql, [key]).fetchall() if key else []

    work = rows(
        'SELECT id, "sessionId", "roomType", "roomKey", "taskKey", depth, "predictedMinutes", together, excluded, "excludedReason", '
        '"startedAt", "endedAt", minutes FROM "ActivitySegment" WHERE "sessionId" = ANY(%s) ORDER BY "startedAt", id',
        sessions,
    )
    # Each declared room or object, placed on the timeline of the recording
    # that covers it: where in the video the worker said it began and ended.
    by_session: dict[str, list[dict[str, Any]]] = {}
    for r in recordings:
        by_session.setdefault(r["sessionId"], []).append(r)
    for w in work:
        w["recordingId"] = w["startOffsetMs"] = w["endOffsetMs"] = None
        for r in by_session.get(w["sessionId"], []):
            end = r["endedAt"] or datetime.max
            if r["startedAt"] <= w["startedAt"] <= end:
                w["recordingId"] = r["id"]
                w["startOffsetMs"] = round((w["startedAt"] - r["startedAt"]).total_seconds() * 1000, 1)
                if w["endedAt"] is not None:
                    w["endOffsetMs"] = round((w["endedAt"] - r["startedAt"]).total_seconds() * 1000, 1)
                break
        w["source"] = "worker"

    return {
        "recordings": recordings,
        "video_segments": rows(
            'SELECT "recordingId", index, "objectKey", "mimeType", bytes, sha256, "monoStartMs", "monoEndMs", "uploadedAt" '
            'FROM "VideoSegment" WHERE "recordingId" = ANY(%s) ORDER BY "recordingId", index',
            ids,
        ),
        "sensor_chunks": rows(
            'SELECT "recordingId", index, "objectKey", bytes, sha256, samples, streams, "monoStartMs", "monoEndMs", "uploadedAt" '
            'FROM "SensorChunk" WHERE "recordingId" = ANY(%s) ORDER BY "recordingId", index',
            ids,
        ),
        "events": rows(
            'SELECT "recordingId", seq, kind, "monoMs", "clientUtcMs", "serverAt", data FROM "RecordingEvent" '
            'WHERE "recordingId" = ANY(%s) ORDER BY "recordingId", "monoMs" NULLS FIRST, seq NULLS FIRST, "serverAt", id',
            ids,
        ),
        "work_segments": work,
        "annotations": rows(
            'SELECT a.id, a.kind, a.label, a."recordingId", a."sessionId", a."startOffsetMs", a."endOffsetMs", a."activeMs", a."waitingMs", '
            'a.repetitions, a."objectKey", a.surface, a."roomKey", a.tools, a.conditions, a.attributes, a."frameRefs", a.confidence, '
            'a.source, a."reviewStatus", a."supersedesId", a."createdAt", m.provider, m.model, m.version AS "modelVersion", m."promptVersion" '
            'FROM "Annotation" a LEFT JOIN "ModelVersion" m ON m.id = a."modelVersionId" '
            'WHERE a."recordingId" = ANY(%s) ORDER BY a."recordingId", a."startOffsetMs" NULLS FIRST, a."createdAt", a.id',
            ids,
        ),
        "frames": rows(
            'SELECT f."recordingId", s.index AS "segmentIndex", f."ptsMs", f."offsetMs", f."objectKey", f.width, f.height, f.sha256, '
            'f.method, f."pipelineVersion" FROM "ExtractedFrame" f JOIN "VideoSegment" s ON s.id = f."segmentId" '
            'WHERE f."recordingId" = ANY(%s) ORDER BY f."recordingId", f."offsetMs", f.method, f."pipelineVersion"',
            ids,
        ),
        "quality_findings": rows(
            'SELECT "recordingId", kind, severity, details, "pipelineVersion", "createdAt", "resolvedAt" FROM "QualityFinding" '
            'WHERE "recordingId" = ANY(%s) ORDER BY "recordingId", kind, "createdAt", id',
            ids,
        ),
        "consents": conn.execute(
            'SELECT c.kind, c."workerId", c."sessionId", c.version, c.video, c.audio, c."givenAt" FROM "RecordingConsent" c '
            'WHERE c."withdrawnAt" IS NULL AND (c."sessionId" = ANY(%s) OR (c.kind = \'worker\' AND c."workerId" IN '
            '(SELECT DISTINCT "workerId" FROM "ActivitySession" WHERE id = ANY(%s)))) ORDER BY c.kind, c."workerId", c."givenAt", c.id',
            [sessions, sessions],
        ).fetchall()
        if sessions
        else [],
    }


def export_dataset(ctx: Context, name: str, filters: dict[str, Any] | None = None, description: str | None = None, requested_by: str = "pipeline") -> dict[str, Any]:
    conn = ctx.conn
    filters = {"excludeErrors": True, **(filters or {})}
    if not name.replace("-", "").replace("_", "").isalnum():
        raise ValueError(f"dataset names are letters, digits, - and _: {name!r}")

    with conn.transaction():
        # One version number per name, even with two exports at once.
        conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [f"dataset:{name}"])
        version = conn.execute('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM "DatasetVersion" WHERE name = %s', [name]).fetchone()["v"]
        tables = _select(conn, filters)
        prefix = f"datasets/{name}/v{version}"
        files = []
        for table in TABLES:
            for suffix, data, content_type in (
                ("jsonl", _jsonl(tables[table]), "application/x-ndjson"),
                ("parquet", _parquet(tables[table]), "application/vnd.apache.parquet"),
            ):
                path = f"{table}.{suffix}"
                ctx.storage.put(f"{prefix}/{path}", data, content_type)
                files.append({"path": path, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "rows": len(tables[table])})
        counts = {table: len(tables[table]) for table in TABLES}
        manifest = {
            "name": name,
            "version": version,
            "description": description,
            "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "pipelineVersion": PIPELINE_VERSION,
            "codeVersion": ctx.settings.code_version,
            "filters": filters,
            "counts": counts,
            "files": files,
            "rawObjects": "Not copied. Each row's objectKey names the bytes in the bucket and its sha256 says exactly what they must be.",
        }
        manifest_key = f"{prefix}/manifest.json"
        ctx.storage.put(manifest_key, json.dumps(manifest, indent=2, sort_keys=True).encode(), "application/json")
        conn.execute(
            'INSERT INTO "DatasetVersion" (id, name, version, description, filters, "codeVersion", "pipelineVersion", "manifestKey", counts) '
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            [new_id("dv"), name, version, description, jsonb(filters), ctx.settings.code_version, PIPELINE_VERSION, manifest_key, jsonb(counts)],
        )
        conn.execute(
            'INSERT INTO "DataAccessLog" (id, actor, action, resource, reason) VALUES (%s, %s, %s, %s, %s)',
            [new_id("da"), requested_by, "export", f"dataset:{name}/v{version}", description],
        )
    return {"name": name, "version": version, "manifestKey": manifest_key, "counts": counts}

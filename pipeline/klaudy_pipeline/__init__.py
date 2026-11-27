"""Klaudy's data pipeline: from raw recordings to versioned datasets.

It reads what the app wrote — rows in Postgres, bytes in the bucket — and
never edits either. Everything it produces is written BESIDE the raw layer:
quality findings, extracted frames, sensor summaries, machine annotations,
dataset exports. Each carries the pipeline version that made it, so a
result can always be traced to the code that produced it, and re-run.

Design and reasons: docs/DATOS.md.
"""

# Bump when any derived output would change. Old outputs stay, labelled with
# the version that made them; nothing is overwritten in place.
PIPELINE_VERSION = "2026.11.1"

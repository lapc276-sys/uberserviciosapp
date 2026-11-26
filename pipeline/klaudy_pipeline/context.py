from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .config import Settings
from .storage import Storage


@dataclass
class Context:
    """What every job needs: the database, the bucket, the settings."""

    conn: Any  # psycopg.Connection[dict]
    storage: Storage
    settings: Settings

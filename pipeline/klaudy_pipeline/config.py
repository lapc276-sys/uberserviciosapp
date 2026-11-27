"""Settings from the environment: the same variables the app uses, so one
set of Replit Secrets configures both."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str | None
    s3_endpoint: str | None
    s3_bucket: str | None
    s3_key_id: str | None
    s3_secret: str | None
    s3_region: str
    # A directory standing in for the bucket: tests, a laptop, an export
    # that never left the phone.
    local_storage: str | None
    frames_per_second: float
    # ffmpeg scene score above which a frame counts as a change; 0 turns the
    # adaptive frames off and leaves only the uniform ones.
    scene_threshold: float
    code_version: str


def _code_version() -> str:
    explicit = os.environ.get("CODE_VERSION")
    if explicit:
        return explicit
    try:
        out = subprocess.run(["git", "rev-parse", "--short=12", "HEAD"], capture_output=True, text=True, timeout=5, check=False)
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def settings() -> Settings:
    def env(name: str) -> str | None:
        value = os.environ.get(name, "").strip()
        return value or None

    fps = env("PIPELINE_FRAMES_PER_SECOND")
    scene = env("PIPELINE_SCENE_THRESHOLD")
    return Settings(
        database_url=env("DATABASE_URL"),
        s3_endpoint=(env("STORAGE_S3_ENDPOINT") or "").rstrip("/") or None,
        s3_bucket=env("STORAGE_S3_BUCKET"),
        s3_key_id=env("STORAGE_S3_ACCESS_KEY_ID"),
        s3_secret=env("STORAGE_S3_SECRET_ACCESS_KEY"),
        s3_region=env("STORAGE_S3_REGION") or "auto",
        local_storage=env("PIPELINE_LOCAL_STORAGE"),
        frames_per_second=float(fps) if fps else 1.0,
        scene_threshold=float(scene) if scene else 0.3,
        code_version=_code_version(),
    )

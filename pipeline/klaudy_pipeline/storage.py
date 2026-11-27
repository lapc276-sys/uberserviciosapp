"""The bucket, or a directory standing in for it.

The pipeline only ever WRITES under derived/ and datasets/. Raw recordings
live under recordings/, put there by the phone, and a put() there is refused
unless it is the one legitimate case: ingesting an export that never reached
the bucket (ingest.py), which writes bytes whose checksum it has verified
against the phone's own manifest.
"""

from __future__ import annotations

from pathlib import Path
from typing import Protocol

RAW_PREFIX = "recordings/"


class MissingObject(Exception):
    """The row says the bytes are there; the bucket says they are not."""


class RawWriteRefused(Exception):
    pass


class Storage(Protocol):
    def get(self, key: str) -> bytes: ...

    def put(self, key: str, data: bytes, content_type: str, *, allow_raw: bool = False) -> None: ...

    def exists(self, key: str) -> bool: ...

    def delete_prefix(self, prefix: str, *, allow_raw: bool = False) -> int: ...


def _guard(key: str, allow_raw: bool) -> None:
    if key.startswith(RAW_PREFIX) and not allow_raw:
        raise RawWriteRefused(key)
    if ".." in key.split("/") or key.startswith("/"):
        raise ValueError(f"bad key: {key!r}")


class LocalStorage:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        if ".." in key.split("/") or key.startswith("/"):
            raise ValueError(f"bad key: {key!r}")
        return self.root / key

    def get(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError as err:
            raise MissingObject(key) from err

    def put(self, key: str, data: bytes, content_type: str, *, allow_raw: bool = False) -> None:
        _guard(key, allow_raw)
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete_prefix(self, prefix: str, *, allow_raw: bool = False) -> int:
        _guard_prefix(prefix, allow_raw)
        base = self._path(prefix.rstrip("/"))
        if not base.exists():
            return 0
        files = [p for p in base.rglob("*") if p.is_file()]
        for p in files:
            p.unlink()
        return len(files)


def _guard_prefix(prefix: str, allow_raw: bool) -> None:
    # A prefix this short would be a whole tree: refuse rather than trust it.
    if prefix.count("/") < 1 or len(prefix.strip("/")) < 8:
        raise ValueError(f"refusing to delete under {prefix!r}")
    _guard(prefix, allow_raw)


class S3Storage:
    def __init__(self, endpoint: str, bucket: str, key_id: str, secret: str, region: str) -> None:
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=key_id,
            aws_secret_access_key=secret,
            region_name=region,
            config=Config(s3={"addressing_style": "path"}, retries={"max_attempts": 5, "mode": "standard"}),
        )

    def get(self, key: str) -> bytes:
        from botocore.exceptions import ClientError

        try:
            return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") in {"NoSuchKey", "404", "NotFound"}:
                raise MissingObject(key) from err
            raise

    def put(self, key: str, data: bytes, content_type: str, *, allow_raw: bool = False) -> None:
        _guard(key, allow_raw)
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") in {"NoSuchKey", "404", "NotFound"}:
                return False
            raise

    def delete_prefix(self, prefix: str, *, allow_raw: bool = False) -> int:
        _guard_prefix(prefix, allow_raw)
        removed = 0
        for page in self.client.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix):
            keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            for i in range(0, len(keys), 1000):
                self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": keys[i : i + 1000], "Quiet": True})
                removed += len(keys[i : i + 1000])
        return removed


def from_settings(s) -> Storage:  # noqa: ANN001 - config.Settings, imported lazily to keep this module standalone
    if s.local_storage:
        return LocalStorage(s.local_storage)
    if s.s3_endpoint and s.s3_bucket and s.s3_key_id and s.s3_secret:
        return S3Storage(s.s3_endpoint, s.s3_bucket, s.s3_key_id, s.s3_secret, s.s3_region)
    raise SystemExit("No storage: set the STORAGE_S3_* variables, or PIPELINE_LOCAL_STORAGE to a directory.")

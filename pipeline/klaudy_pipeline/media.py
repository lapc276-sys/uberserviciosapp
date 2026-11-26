"""ffmpeg and ffprobe, called as programs: the same tools anyone can run by
hand on a downloaded segment to check what the pipeline said about it."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path


class MediaError(Exception):
    pass


def _run(cmd: list[str], timeout: int = 600) -> subprocess.CompletedProcess[str]:
    # stdin closed: ffmpeg otherwise reads it and swallows whatever the
    # caller was feeding through it.
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL, check=False)


def decode_errors(path: Path) -> str | None:
    """Decodes every frame. None when it decoded cleanly, ffmpeg's complaint otherwise."""
    result = _run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-f", "null", "-"])
    text = (result.stderr or "").strip()
    if result.returncode != 0 or text:
        return text[-1000:] or f"ffmpeg exited {result.returncode}"
    return None


def frame_times_ms(path: Path) -> list[float]:
    """The presentation time of every video frame, as the container states it."""
    result = _run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "frame=best_effort_timestamp_time", "-of", "csv=p=0", str(path)]
    )
    times = []
    for line in result.stdout.splitlines():
        value = line.strip().rstrip(",")
        try:
            times.append(round(float(value) * 1000, 3))
        except ValueError:
            continue
    return times


_SHOWINFO = re.compile(r"\bn:\s*(\d+)\b.*?\bpts_time:\s*([-\d.]+).*?\bs:(\d+)x(\d+)")


def extract_uniform(path: Path, out_dir: Path, fps: float) -> list[tuple[float, Path, int, int]]:
    """One frame per 1/fps seconds of the source."""
    return _extract(path, out_dir, f"isnan(prev_selected_t)+gte(t-prev_selected_t,{1.0 / fps:.6f})")


def extract_scene(path: Path, out_dir: Path, threshold: float, min_gap_ms: float = 1000) -> list[tuple[float, Path, int, int]]:
    """
    Adaptive: frames where the picture changes — a door opening, the camera
    turning to the oven — scored by ffmpeg's scene detector. A chest camera
    moving fast fires in bursts, so frames closer than min_gap_ms to the last
    one kept are dropped.
    """
    frames = _extract(path, out_dir, f"gt(scene,{threshold:.4f})")
    kept: list[tuple[float, Path, int, int]] = []
    for frame in frames:
        if kept and frame[0] - kept[-1][0] < min_gap_ms:
            frame[1].unlink(missing_ok=True)
            continue
        kept.append(frame)
    return kept


def _extract(path: Path, out_dir: Path, select: str) -> list[tuple[float, Path, int, int]]:
    """
    Frames chosen by an ffmpeg select expression, each kept with its EXACT
    presentation time in the source — not a re-timed output timestamp. The
    select filter picks source frames; showinfo reports the pts of each one
    it lets through. Returns (pts_ms, jpeg_path, width, height) in order.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    graph = f"select='{select}',showinfo"
    base = ["ffmpeg", "-nostdin", "-hide_banner", "-i", str(path), "-vf", graph]
    tail = ["-q:v", "3", str(out_dir / "f_%05d.jpg")]
    result = _run(base + ["-fps_mode", "passthrough"] + tail)
    if result.returncode != 0 and "fps_mode" in (result.stderr or ""):
        result = _run(base + ["-vsync", "0"] + tail)  # ffmpeg older than 5.1
    if result.returncode != 0:
        raise MediaError((result.stderr or "")[-2000:])
    infos = []
    for line in (result.stderr or "").splitlines():
        if "showinfo" not in line or "pts_time:" not in line:
            continue
        match = _SHOWINFO.search(line)
        if match:
            infos.append((round(float(match.group(2)) * 1000, 3), int(match.group(3)), int(match.group(4))))
    files = sorted(out_dir.glob("f_*.jpg"))
    if len(files) != len(infos):
        raise MediaError(f"{len(files)} frames written but {len(infos)} reported")
    return [(pts, file, width, height) for (pts, width, height), file in zip(infos, files)]

"""Arma un video vertical (9:16) de un short y lo sube a YouTube.

Dos partes independientes:

1. **Video** — necesita `ffmpeg` en el sistema. Toma el MP3 del short y unas
   fotos de libre uso (Wikimedia Commons) y arma un MP4 vertical 1080x1920
   con la voz de fondo y las fotos rotando como un documental.

2. **Subida** — necesita OAuth de la YouTube Data API v3 (subir video NO
   funciona con una simple API key; requiere autorización del dueño del
   canal). Variables de entorno:
       YOUTUBE_CLIENT_ID
       YOUTUBE_CLIENT_SECRET
       YOUTUBE_REFRESH_TOKEN
   El refresh token se saca UNA sola vez con:  python3 autorizar_youtube.py

Config opcional:
       YOUTUBE_PRIVACIDAD   private | unlisted | public   (defecto: unlisted)
"""

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile

import httpx

log = logging.getLogger("youtube")

VERT_W, VERT_H = 1080, 1920
SCOPES_SUBIR = ["https://www.googleapis.com/auth/youtube.upload"]
_UA = {"User-Agent": "Mozilla/5.0 (F1FanChannel shorts uploader)"}

_FUENTES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial.ttf",
]


def ffmpeg_disponible():
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def oauth_configurado():
    return all(os.environ.get(v) for v in
               ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET",
                "YOUTUBE_REFRESH_TOKEN"))


def _fuente():
    for p in _FUENTES:
        if os.path.exists(p):
            return p
    return None


async def _descargar(url, destino):
    try:
        async with httpx.AsyncClient(follow_redirects=True, headers=_UA) as c:
            r = await c.get(url, timeout=30)
            r.raise_for_status()
            with open(destino, "wb") as f:
                f.write(r.content)
        return os.path.getsize(destino) > 0
    except Exception as e:
        log.info("No se pudo descargar imagen (%s)", e)
        return False


def _duracion_audio(path):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=30)
        return float(out.stdout.strip())
    except Exception:
        return 0.0


def _envolver(texto, ancho=26):
    """Parte el título en varias líneas cortas para el rótulo."""
    palabras, lineas, actual = texto.split(), [], ""
    for w in palabras:
        if len(actual) + len(w) + 1 <= ancho:
            actual = (actual + " " + w).strip()
        else:
            if actual:
                lineas.append(actual)
            actual = w
    if actual:
        lineas.append(actual)
    return "\n".join(lineas[:4])


def _construir_ffmpeg(imgs, audio, salida, per, rotulo_txt):
    """Arma la lista de argumentos de ffmpeg (con o sin rótulo de texto)."""
    args = ["ffmpeg", "-y"]
    for img in imgs:
        args += ["-loop", "1", "-t", f"{per:.2f}", "-i", img]
    args += ["-i", audio]
    n = len(imgs)

    partes = []
    for i in range(n):
        partes.append(
            f"[{i}:v]scale={VERT_W}:{VERT_H}:force_original_aspect_ratio="
            f"increase,crop={VERT_W}:{VERT_H},setsar=1,fps=30[v{i}]")
    cadena = "".join(f"[v{i}]" for i in range(n))
    partes.append(f"{cadena}concat=n={n}:v=1:a=0[vc]")

    salida_v = "[vc]"
    fuente = _fuente()
    if rotulo_txt and fuente:
        partes.append(
            f"[vc]drawtext=fontfile='{fuente}':textfile='{rotulo_txt}':"
            "fontcolor=white:fontsize=54:line_spacing=14:box=1:"
            "boxcolor=black@0.55:boxborderw=26:x=(w-text_w)/2:"
            "y=h-text_h-190[vt]")
        salida_v = "[vt]"

    args += [
        "-filter_complex", ";".join(partes),
        "-map", salida_v, "-map", f"{n}:a",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-shortest",
        "-movflags", "+faststart", salida,
    ]
    return args


async def armar_video(audio_path, fotos_urls, titulo, salida_mp4):
    """Construye el MP4 vertical. Devuelve True si se creó."""
    if not ffmpeg_disponible():
        log.warning("ffmpeg no disponible: no se puede armar el video")
        return False
    if not (audio_path and os.path.exists(audio_path)):
        log.warning("Short sin audio: no se puede armar el video")
        return False

    dur = _duracion_audio(audio_path) or 25.0
    tmp = tempfile.mkdtemp(prefix="short_")
    try:
        # Descargar fotos de libre uso
        imgs = []
        for i, url in enumerate((fotos_urls or [])[:6]):
            destino = os.path.join(tmp, f"img_{i}.jpg")
            if await _descargar(url, destino):
                imgs.append(destino)

        # Sin fotos: un fondo negro sólido como respaldo
        if not imgs:
            fondo = os.path.join(tmp, "fondo.png")
            r = subprocess.run(
                ["ffmpeg", "-y", "-f", "lavfi", "-i",
                 f"color=c=0x0a0a12:s={VERT_W}x{VERT_H}", "-frames:v", "1",
                 fondo], capture_output=True, timeout=30)
            if r.returncode == 0:
                imgs = [fondo]
            else:
                log.warning("No se pudo crear fondo de respaldo")
                return False

        per = max(2.0, dur / len(imgs))

        # Rótulo con el título (si hay fuente disponible)
        rotulo = os.path.join(tmp, "rotulo.txt")
        with open(rotulo, "w") as f:
            f.write(_envolver(titulo))

        for con_texto in (True, False):  # si el texto falla, reintenta sin él
            args = _construir_ffmpeg(
                imgs, audio_path, salida_mp4, per,
                rotulo if con_texto else None)
            r = subprocess.run(args, capture_output=True, timeout=300)
            if r.returncode == 0 and os.path.exists(salida_mp4):
                return True
            log.info("ffmpeg %s texto falló: %s", "con" if con_texto else "sin",
                     (r.stderr or b"")[-300:].decode("utf-8", "ignore"))
        return False
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _credenciales():
    from google.oauth2.credentials import Credentials
    return Credentials(
        token=None,
        refresh_token=os.environ["YOUTUBE_REFRESH_TOKEN"],
        client_id=os.environ["YOUTUBE_CLIENT_ID"],
        client_secret=os.environ["YOUTUBE_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=SCOPES_SUBIR,
    )


def _subir_sync(video_path, titulo, descripcion, tags, privacidad):
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    yt = build("youtube", "v3", credentials=_credenciales(),
               cache_discovery=False)
    body = {
        "snippet": {
            "title": titulo[:100],
            "description": descripcion[:4900],
            "tags": tags[:15],
            "categoryId": "17",  # Sports
        },
        "status": {
            "privacyStatus": privacidad,
            "selfDeclaredMadeForKids": False,
        },
    }
    media = MediaFileUpload(video_path, chunksize=-1, resumable=True,
                            mimetype="video/mp4")
    req = yt.videos().insert(part="snippet,status", body=body, media_body=media)
    return req.execute()


async def subir_video(video_path, titulo, descripcion, tags, privacidad=None):
    """Sube el MP4 a YouTube. Devuelve {'id', 'url'} o None."""
    if not oauth_configurado():
        log.warning("OAuth de YouTube sin configurar: no se sube "
                    "(faltan YOUTUBE_CLIENT_ID / SECRET / REFRESH_TOKEN)")
        return None
    privacidad = privacidad or os.environ.get("YOUTUBE_PRIVACIDAD", "unlisted")
    try:
        resp = await asyncio.to_thread(
            _subir_sync, video_path, titulo, descripcion, tags, privacidad)
        vid = resp.get("id")
        if vid:
            log.info("📤 Short subido a YouTube: https://youtu.be/%s (%s)",
                     vid, privacidad)
            return {"id": vid, "url": f"https://youtu.be/{vid}"}
        return None
    except Exception as e:
        log.error("Falló la subida a YouTube (%s)", e)
        return None

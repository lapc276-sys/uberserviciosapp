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
import contextlib
import logging
import os
import shutil
import subprocess
import tempfile

import httpx

log = logging.getLogger("youtube")

VERT_W, VERT_H = 1080, 1920
SCOPES_SUBIR = ["https://www.googleapis.com/auth/youtube.upload"]
# User-Agent conforme a la política de Wikimedia (identificable + contacto);
# sin esto, upload.wikimedia.org responde 429 a IPs compartidas como Replit
_UA = {"User-Agent":
       "F1FanChannelBot/1.0 "
       "(https://github.com/lapc276-sys/uberserviciosapp; automated "
       "motorsport channel) httpx"}

_FUENTES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial.ttf",
]


# ffmpeg propio: el de Replit (nix) puede estar roto en tiempo de
# ejecución (symbol lookup error de harfbuzz/freetype) aunque exista en el
# PATH. Se prueba de verdad (-version) y, si falla, se descarga un build
# ESTÁTICO independiente del sistema a ./bin (una sola vez, ~80 MB).
BIN_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bin")
FFMPEG_STATICO_URL = ("https://johnvansickle.com/ffmpeg/releases/"
                      "ffmpeg-release-amd64-static.tar.xz")
_bins = {"ffmpeg": None, "ffprobe": None, "probado": False}


def _funciona(ruta):
    try:
        r = subprocess.run([ruta, "-version"], capture_output=True,
                           timeout=20)
        return r.returncode == 0
    except Exception:
        return False


def _resolver_binarios():
    if _bins["probado"]:
        return
    candidatos = []
    if os.environ.get("FFMPEG_BIN"):
        candidatos.append(os.path.dirname(os.environ["FFMPEG_BIN"]))
    candidatos.append(BIN_DIR)
    candidatos.append(None)  # PATH del sistema
    for base in candidatos:
        f = (os.path.join(base, "ffmpeg") if base
             else shutil.which("ffmpeg"))
        p = (os.path.join(base, "ffprobe") if base
             else shutil.which("ffprobe"))
        if f and p and os.path.exists(f) and _funciona(f):
            _bins["ffmpeg"], _bins["ffprobe"] = f, p
            break
    _bins["probado"] = True
    if _bins["ffmpeg"]:
        log.info("🎞️  ffmpeg operativo: %s", _bins["ffmpeg"])


def _descargar_ffmpeg_estatico():
    """Baja el build estático de ffmpeg a ./bin. Devuelve True si quedó
    operativo."""
    import tarfile
    import urllib.request
    os.makedirs(BIN_DIR, exist_ok=True)
    paquete = os.path.join(BIN_DIR, "ffmpeg-static.tar.xz")
    log.info("⬇️  El ffmpeg del sistema está roto — descargando build "
             "estático (~80 MB, solo esta vez)…")
    urllib.request.urlretrieve(FFMPEG_STATICO_URL, paquete)
    with tarfile.open(paquete, "r:xz") as t:
        for m in t.getmembers():
            nombre = os.path.basename(m.name)
            if nombre in ("ffmpeg", "ffprobe") and m.isfile():
                m.name = nombre
                t.extract(m, BIN_DIR)
                os.chmod(os.path.join(BIN_DIR, nombre), 0o755)
    with contextlib.suppress(OSError):
        os.remove(paquete)
    _bins["probado"] = False
    _resolver_binarios()
    return _bins["ffmpeg"] is not None


async def asegurar_ffmpeg():
    """True si hay un ffmpeg que FUNCIONA (descargándolo si hace falta)."""
    _resolver_binarios()
    if _bins["ffmpeg"]:
        return True
    try:
        return await asyncio.to_thread(_descargar_ffmpeg_estatico)
    except Exception as e:
        log.warning("No se pudo descargar el ffmpeg estático (%s)", e)
        return False


def _ffmpeg():
    return _bins["ffmpeg"] or "ffmpeg"


def _ffprobe():
    return _bins["ffprobe"] or "ffprobe"


def ffmpeg_disponible():
    _resolver_binarios()
    return _bins["ffmpeg"] is not None


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
    """Descarga una imagen con reintentos: si Wikimedia pide esperar
    (429), espera y reintenta hasta 3 veces."""
    for intento in range(3):
        try:
            async with httpx.AsyncClient(follow_redirects=True,
                                         headers=_UA) as c:
                r = await c.get(url, timeout=30)
                if r.status_code == 429:
                    espera = (float(r.headers.get("retry-after", 0) or 0)
                              or 5.0 * (intento + 1))
                    log.info("Wikimedia pide esperar %.0fs (imagen)", espera)
                    await asyncio.sleep(min(espera, 30))
                    continue
                r.raise_for_status()
                with open(destino, "wb") as f:
                    f.write(r.content)
            return os.path.getsize(destino) > 0
        except Exception as e:
            log.info("No se pudo descargar imagen (%s)", e)
            return False
    return False


def _duracion_audio(path):
    try:
        out = subprocess.run(
            [_ffprobe(), "-v", "error", "-show_entries", "format=duration",
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


def _construir_ffmpeg(imgs, audio, salida, per, w, h, fps):
    """Arma la lista de argumentos de ffmpeg (el rótulo ya viene pintado
    en las imágenes con Pillow — el drawtext del build estático no está
    disponible)."""
    args = [_ffmpeg(), "-y"]
    for img in imgs:
        args += ["-loop", "1", "-t", f"{per:.2f}", "-i", img]
    args += ["-i", audio]
    n = len(imgs)

    partes = []
    for i in range(n):
        partes.append(
            f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio="
            f"increase,crop={w}:{h},setsar=1,fps={fps}[v{i}]")
    cadena = "".join(f"[v{i}]" for i in range(n))
    partes.append(f"{cadena}concat=n={n}:v=1:a=0[vc]")

    args += [
        "-filter_complex", ";".join(partes),
        "-map", "[vc]", "-map", f"{n}:a",
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-shortest",
        "-movflags", "+faststart", salida,
    ]
    return args


def _preparar_imagen(ruta, texto, w, h):
    """Deja la imagen lista con Pillow: recorte a w×h (tipo cover) y el
    título pintado sobre una banda oscura. Nunca lanza — si algo falla,
    la imagen queda como estaba."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        im = Image.open(ruta).convert("RGB")
        esc = max(w / im.width, h / im.height)
        im = im.resize((max(1, round(im.width * esc)),
                        max(1, round(im.height * esc))))
        x = (im.width - w) // 2
        y = (im.height - h) // 2
        im = im.crop((x, y, x + w, y + h))
        if texto:
            d = ImageDraw.Draw(im, "RGBA")
            tam = w // 18
            fnt = None
            for f in _FUENTES:
                if os.path.exists(f):
                    try:
                        fnt = ImageFont.truetype(f, size=tam)
                        break
                    except Exception:
                        pass
            if fnt is None:
                try:
                    fnt = ImageFont.load_default(size=tam)
                except TypeError:
                    fnt = ImageFont.load_default()
            lineas = _envolver(texto, ancho=26 if h > w else 44).split("\n")
            alto = round(tam * 1.35)
            total = alto * len(lineas)
            y0 = h - total - (190 if h > w else 64)
            d.rectangle([0, y0 - 26, w, y0 + total + 26], fill=(0, 0, 0, 150))
            for i, ln in enumerate(lineas):
                caja = d.textbbox((0, 0), ln, font=fnt)
                d.text(((w - (caja[2] - caja[0])) / 2, y0 + i * alto),
                       ln, font=fnt, fill=(255, 255, 255, 255))
        im.save(ruta, quality=88)
    except Exception as e:
        log.info("No se pudo rotular la imagen (%s)", e)


def concat_audios(rutas, salida):
    """Une varios MP3 en un solo archivo (para el VOD de una sesión)."""
    if not rutas:
        return False
    lista = salida + ".txt"
    try:
        with open(lista, "w") as f:
            for r in rutas:
                f.write(f"file '{os.path.abspath(r)}'\n")
        r = subprocess.run(
            [_ffmpeg(), "-y", "-f", "concat", "-safe", "0", "-i", lista,
             "-c:a", "libmp3lame", "-b:a", "128k", salida],
            capture_output=True, timeout=900)
        return r.returncode == 0 and os.path.exists(salida)
    except Exception as e:
        log.warning("No se pudo unir el audio del VOD (%s)", e)
        return False
    finally:
        with contextlib.suppress(OSError):
            os.remove(lista)


async def armar_video(audio_path, fotos_urls, titulo, salida_mp4,
                      horizontal=False):
    """Construye el MP4 (vertical para shorts; 16:9 para VODs de sesión).
    Devuelve True si se creó."""
    if not ffmpeg_disponible():
        log.warning("ffmpeg no disponible: no se puede armar el video")
        return False
    if not (audio_path and os.path.exists(audio_path)):
        log.warning("Sin audio: no se puede armar el video")
        return False

    w, h, fps = (1280, 720, 24) if horizontal else (VERT_W, VERT_H, 30)
    dur = _duracion_audio(audio_path) or 25.0
    tmp = tempfile.mkdtemp(prefix="video_")
    try:
        # Descargar fotos de libre uso (con pausa: Wikimedia devuelve 429
        # si se piden muy seguidas)
        imgs = []
        for i, url in enumerate((fotos_urls or [])[:6]):
            if i:
                await asyncio.sleep(2)
            destino = os.path.join(tmp, f"img_{i}.jpg")
            if await _descargar(url, destino):
                imgs.append(destino)

        # Sin fotos: un fondo oscuro sólido como respaldo. Pillow primero
        # (siempre disponible); ffmpeg lavfi como plan B con su error real
        # en el log.
        if not imgs:
            fondo = os.path.join(tmp, "fondo.png")
            try:
                from PIL import Image
                Image.new("RGB", (w, h), (10, 12, 18)).save(fondo)
            except Exception as e:
                log.info("Pillow no pudo crear el fondo (%s) — pruebo "
                         "ffmpeg", e)
                r = subprocess.run(
                    [_ffmpeg(), "-y", "-f", "lavfi", "-i",
                     f"color=c=0x0a0a12:s={w}x{h}", "-frames:v", "1",
                     fondo], capture_output=True, timeout=30)
                if r.returncode != 0:
                    log.warning("Fondo de respaldo imposible: %s",
                                (r.stderr or b"")[-200:].decode(
                                    "utf-8", "ignore"))
            if os.path.exists(fondo):
                imgs = [fondo]
            else:
                return False

        per = max(2.0, dur / len(imgs))

        # Rótulo del título pintado sobre cada imagen (Pillow, infalible)
        for img in imgs:
            _preparar_imagen(img, titulo, w, h)

        limite = 1800 if horizontal else 300  # un VOD largo tarda en codificar
        args = _construir_ffmpeg(imgs, audio_path, salida_mp4, per, w, h, fps)
        r = subprocess.run(args, capture_output=True, timeout=limite)
        if r.returncode == 0 and os.path.exists(salida_mp4):
            return True
        log.warning("ffmpeg falló al armar el video: %s",
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
    privacidad = privacidad or os.environ.get("YOUTUBE_PRIVACIDAD", "public")
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

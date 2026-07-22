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
import random
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

# Música de fondo para documentales/programas (estilo Nat Geo/Discovery):
# instrumental suave, muy bajita, bajo la narración. El track lo aporta el
# usuario vía el Secret MUSICA_DOCU (URL a un MP3 SIN copyright —
# Pixabay Music / YouTube Audio Library CC0). Si no hay track o falla la
# descarga, el video se arma igual, solo sin música.
MUSICA_DOCU_URL = os.environ.get("MUSICA_DOCU", "").strip()
try:
    MUSICA_VOLUMEN = float(os.environ.get("MUSICA_VOLUMEN", "0.12"))
except ValueError:
    MUSICA_VOLUMEN = 0.12
# Efecto Ken Burns (zoom/paneo lento sobre las fotos) para que no se vean
# estáticas. Activado de fábrica; se apaga con KEN_BURNS=off. Los gráficos
# de datos NUNCA llevan Ken Burns (recortaría ejes/etiquetas).
KEN_BURNS = os.environ.get("KEN_BURNS", "on").strip().lower() not in (
    "", "off", "no", "0", "false")
# Clips de VIDEO de la biblioteca curada (dominio público / CC0 — p. ej.
# noticiarios antiguos de archive.org): se intercalan como tomas en
# movimiento entre las fotos. Solo archivos locales aprobados por el dueño.
_EXT_CLIP = (".mp4", ".mov", ".webm", ".m4v", ".mpg", ".mpeg", ".avi")
_DIR_BASE = os.path.dirname(os.path.abspath(__file__))
_MUSICA_CACHE = os.path.join(_DIR_BASE, "musica_docu.mp3")   # track del usuario
_MUSICA_GEN = os.path.join(_DIR_BASE, "musica_ambiente.mp3")  # bed generado
_musica_estado = {"listo": False, "ruta": None}


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


def _generar_musica_ambiente(destino):
    """Sintetiza un lecho ambiental ORIGINAL con ffmpeg (acorde de quintas
    abiertas + swell lento + eco/reverb + filtro cálido). 100% propio → sin
    copyright ni Content ID, y siempre disponible aunque no haya red. ~90 s,
    se reproduce en bucle bajo la narración. Devuelve True si lo creó."""
    if not ffmpeg_disponible():
        return False
    # Quintas abiertas (A2–E3–A3–E4): sonido cinematográfico, ni alegre ni
    # triste — encaja como fondo de documental.
    frecs = [110.0, 164.81, 220.0, 329.63]
    args = [_ffmpeg(), "-y"]
    for f in frecs:
        args += ["-f", "lavfi", "-i", f"sine=frequency={f}:duration=92"]
    n = len(frecs)
    mezcla = "".join(f"[{i}]" for i in range(n))
    filtro = (
        f"{mezcla}amix=inputs={n}:normalize=0,"
        "volume=0.15,"                                # evita saturar la suma
        "aformat=channel_layouts=stereo,"
        "tremolo=f=0.12:d=0.5,"                       # swell lento (respira)
        "aecho=0.8:0.85:70|130:0.35|0.28,"            # sensación de espacio
        "lowpass=f=900,highpass=f=60,"                # cálido, sin agudos duros
        "afade=t=in:st=0:d=6,afade=t=out:st=86:d=6"   # entra y sale suave
    )
    args += ["-filter_complex", filtro,
             "-c:a", "libmp3lame", "-b:a", "128k", destino]
    try:
        r = subprocess.run(args, capture_output=True, timeout=120)
        if r.returncode == 0 and os.path.exists(destino) \
                and os.path.getsize(destino) > 0:
            log.info("🎵 Lecho ambiental generado (%s)", destino)
            return True
        log.info("No se pudo generar el lecho ambiental: %s",
                 (r.stderr or b"")[-200:].decode("utf-8", "ignore"))
    except Exception as e:
        log.info("Fallo generando el lecho ambiental (%s)", e)
    return False


async def _musica_docu():
    """Devuelve la ruta local a la música de fondo (o None).

    Prioridad:
    1. Track del usuario (Secret MUSICA_DOCU con una URL a un MP3 sin
       copyright — Pixabay/YouTube Audio Library). Se baja y cachea 1 vez.
    2. Si no hay URL o la descarga falla → un lecho ambiental ORIGINAL
       sintetizado con ffmpeg (sin copyright, siempre disponible).
    Todo se resuelve una sola vez y se recuerda para no repetir trabajo."""
    if _musica_estado["listo"]:
        return _musica_estado["ruta"]

    # 1) Track del usuario por URL
    if MUSICA_DOCU_URL:
        if os.path.exists(_MUSICA_CACHE) and os.path.getsize(_MUSICA_CACHE) > 0:
            _musica_estado.update(listo=True, ruta=_MUSICA_CACHE)
            return _MUSICA_CACHE
        try:
            async with httpx.AsyncClient(follow_redirects=True,
                                         headers=_UA) as c:
                r = await c.get(MUSICA_DOCU_URL, timeout=90)
                r.raise_for_status()
                with open(_MUSICA_CACHE, "wb") as f:
                    f.write(r.content)
            if os.path.getsize(_MUSICA_CACHE) > 0:
                _musica_estado.update(listo=True, ruta=_MUSICA_CACHE)
                log.info("🎵 Música de fondo lista (track del usuario)")
                return _MUSICA_CACHE
        except Exception as e:
            log.info("No se pudo bajar MUSICA_DOCU (%s) — uso lecho propio", e)

    # 2) Lecho ambiental original (generado o ya cacheado)
    if os.path.exists(_MUSICA_GEN) and os.path.getsize(_MUSICA_GEN) > 0:
        _musica_estado.update(listo=True, ruta=_MUSICA_GEN)
        return _MUSICA_GEN
    if await asyncio.to_thread(_generar_musica_ambiente, _MUSICA_GEN):
        _musica_estado.update(listo=True, ruta=_MUSICA_GEN)
        return _MUSICA_GEN

    # Nada disponible: seguir sin música
    _musica_estado.update(listo=True, ruta=None)
    return None


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


def _construir_ffmpeg(imgs, audio, salida, per, w, h, fps, musica=None,
                      es_clip=None):
    """Arma la lista de argumentos de ffmpeg (el rótulo ya viene pintado
    en las imágenes con Pillow — el drawtext del build estático no está
    disponible).

    Si `musica` es una ruta a un MP3, se mezcla en bucle MUY bajita bajo la
    narración (estilo documental) y se corta con la voz (duration=first).
    Las entradas marcadas en `es_clip` son segmentos de video YA
    normalizados (per s, w×h, mudos) — entran tal cual, sin -loop."""
    es_clip = es_clip or [False] * len(imgs)
    args = [_ffmpeg(), "-y"]
    for img, cl in zip(imgs, es_clip):
        if cl:
            args += ["-i", img]
        else:
            args += ["-loop", "1", "-t", f"{per:.2f}", "-i", img]
    args += ["-i", audio]                       # entrada n = voz
    n = len(imgs)
    if musica:
        args += ["-stream_loop", "-1", "-i", musica]   # entrada n+1 = música

    partes = []
    for i in range(n):
        if es_clip[i]:
            partes.append(f"[{i}:v]scale={w}:{h},setsar=1,fps={fps}[v{i}]")
        else:
            partes.append(
                f"[{i}:v]scale={w}:{h}:force_original_aspect_ratio="
                f"increase,crop={w}:{h},setsar=1,fps={fps}[v{i}]")
    cadena = "".join(f"[v{i}]" for i in range(n))
    partes.append(f"{cadena}concat=n={n}:v=1:a=0[vc]")

    if musica:
        vol = max(0.0, min(1.0, MUSICA_VOLUMEN))
        partes.append(f"[{n}:a]volume=1.0[voz]")
        partes.append(f"[{n + 1}:a]volume={vol:.3f}[bg]")
        # duration=first → la mezcla dura lo que la voz; dropout_transition=0
        # evita que la música suba de volumen si la voz calla un instante.
        partes.append("[voz][bg]amix=inputs=2:duration=first:"
                      "dropout_transition=0,dynaudnorm[aout]")
        mapa_audio = "[aout]"
    else:
        mapa_audio = f"{n}:a"

    args += [
        "-filter_complex", ";".join(partes),
        "-map", "[vc]", "-map", mapa_audio,
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-shortest",
        "-movflags", "+faststart", salida,
    ]
    return args


def _par(x):
    """Entero par (libx264 exige dimensiones pares)."""
    x = int(round(x))
    return x if x % 2 == 0 else x + 1


def _construir_ffmpeg_kb(imgs, es_chart, titulo_png, audio, salida, per,
                         w, h, fps, musica=None, es_clip=None):
    """Como _construir_ffmpeg pero con efecto Ken Burns (zoom lento) en las
    FOTOS. Los gráficos (es_chart) quedan estáticos y encajados; los clips
    (es_clip, ya normalizados) entran tal cual — traen movimiento propio.
    El título va como overlay FIJO encima (no se mueve con el zoom)."""
    es_clip = es_clip or [False] * len(imgs)
    frames = max(2, int(round(per * fps)))
    # zoom que sube 1.0→~1.18 (o baja, alternando) a lo largo de la foto
    paso = 0.18 / frames
    up = _par(w * 1.30)
    hp = _par(h * 1.30)

    args = [_ffmpeg(), "-y"]
    for img, cl in zip(imgs, es_clip):
        if cl:
            args += ["-i", img]
        else:
            args += ["-loop", "1", "-framerate", str(fps),
                     "-t", f"{per:.2f}", "-i", img]
    args += ["-i", audio]                       # entrada n = voz
    n = len(imgs)
    idx = n
    idx_mus = None
    if musica:
        idx_mus = idx + 1
        args += ["-stream_loop", "-1", "-i", musica]
    idx_tit = None
    if titulo_png:
        idx_tit = (idx_mus if idx_mus is not None else idx) + 1
        args += ["-loop", "1", "-framerate", str(fps), "-i", titulo_png]

    partes = []
    for i in range(n):
        if es_chart[i] or es_clip[i]:
            # Gráfico (estático, encajado) o clip (movimiento propio)
            partes.append(f"[{i}:v]scale={w}:{h},setsar=1,fps={fps}[v{i}]")
        else:
            # Foto: sube de resolución y aplica zoom centrado. Alterna
            # acercar/alejar para que no todas se muevan igual.
            if i % 2 == 0:
                z = f"min(1.0+{paso:.6f}*on,1.18)"
            else:
                z = f"max(1.18-{paso:.6f}*on,1.0)"
            # d=1: la entrada ya trae per*fps fotogramas (por -loop/-t); con
            # d=1 sale 1 por 1 y el zoom avanza con 'on' a lo largo del clip.
            # (d={frames} multiplicaría los fotogramas y reventaría el encode.)
            partes.append(
                f"[{i}:v]scale={up}:{hp}:force_original_aspect_ratio="
                f"increase,crop={up}:{hp},setsar=1,"
                f"zoompan=z='{z}':x='iw/2-(iw/zoom/2)':"
                f"y='ih/2-(ih/zoom/2)':d=1:s={w}x{h}:fps={fps}[v{i}]")
    cadena = "".join(f"[v{i}]" for i in range(n))
    partes.append(f"{cadena}concat=n={n}:v=1:a=0[vbg]")

    if idx_tit is not None:
        partes.append(f"[{idx_tit}:v]scale={w}:{h},setsar=1[tit]")
        partes.append("[vbg][tit]overlay=0:0:shortest=0[vc]")
    else:
        partes.append("[vbg]null[vc]")

    if musica:
        vol = max(0.0, min(1.0, MUSICA_VOLUMEN))
        partes.append(f"[{idx}:a]volume=1.0[voz]")
        partes.append(f"[{idx_mus}:a]volume={vol:.3f}[bg]")
        partes.append("[voz][bg]amix=inputs=2:duration=first:"
                      "dropout_transition=0,dynaudnorm[aout]")
        mapa_audio = "[aout]"
    else:
        mapa_audio = f"{idx}:a"

    args += [
        "-filter_complex", ";".join(partes),
        "-map", "[vc]", "-map", mapa_audio,
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-shortest",
        "-movflags", "+faststart", salida,
    ]
    return args


def _dibujar_titulo(im, texto, w, h):
    """Pinta la banda oscura + el título sobre una imagen PIL (RGB o RGBA).
    Se usa tanto para rotular la foto directamente como para armar el
    overlay transparente del efecto Ken Burns."""
    from PIL import ImageDraw, ImageFont
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


def _cubrir_imagen(ruta, w, h):
    """Recorta la foto a w×h tipo 'cover' (sin rótulo). Nunca lanza."""
    try:
        from PIL import Image
        im = Image.open(ruta).convert("RGB")
        esc = max(w / im.width, h / im.height)
        im = im.resize((max(1, round(im.width * esc)),
                        max(1, round(im.height * esc))))
        x = (im.width - w) // 2
        y = (im.height - h) // 2
        im = im.crop((x, y, x + w, y + h))
        im.save(ruta, quality=88)
        return True
    except Exception as e:
        log.info("No se pudo recortar la imagen (%s)", e)
        return False


def _titulo_overlay(texto, w, h, salida_png):
    """Crea un PNG TRANSPARENTE w×h con solo la banda + el título, para
    superponerlo FIJO encima de la foto que se mueve (Ken Burns). Devuelve
    la ruta, o None si no hay texto o falla."""
    if not texto:
        return None
    try:
        from PIL import Image
        capa = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        _dibujar_titulo(capa, texto, w, h)
        capa.save(salida_png)
        return salida_png
    except Exception as e:
        log.info("No se pudo crear el overlay del título (%s)", e)
        return None


def _preparar_imagen(ruta, texto, w, h):
    """Deja la imagen lista con Pillow: recorte a w×h (tipo cover) y el
    título pintado sobre una banda oscura. Nunca lanza — si algo falla,
    la imagen queda como estaba. (Ruta clásica sin Ken Burns.)"""
    try:
        from PIL import Image
        im = Image.open(ruta).convert("RGB")
        esc = max(w / im.width, h / im.height)
        im = im.resize((max(1, round(im.width * esc)),
                        max(1, round(im.height * esc))))
        x = (im.width - w) // 2
        y = (im.height - h) // 2
        im = im.crop((x, y, x + w, y + h))
        if texto:
            _dibujar_titulo(im, texto, w, h)
        im.save(ruta, quality=88)
    except Exception as e:
        log.info("No se pudo rotular la imagen (%s)", e)


def _preparar_chart(ruta, w, h):
    """Encaja un gráfico (ya diseñado) COMPLETO en el lienzo w×h con fondo
    oscuro, sin recorte ni rótulo — para no tapar ejes ni etiquetas."""
    try:
        from PIL import Image
        im = Image.open(ruta).convert("RGB")
        esc = min(w / im.width, h / im.height)
        nw, nh = max(1, round(im.width * esc)), max(1, round(im.height * esc))
        im = im.resize((nw, nh))
        lienzo = Image.new("RGB", (w, h), (10, 12, 18))
        lienzo.paste(im, ((w - nw) // 2, (h - nh) // 2))
        lienzo.save(ruta, quality=90)
    except Exception as e:
        log.info("No se pudo encajar el gráfico (%s)", e)


def _preparar_clip(src, destino, per, w, h, fps):
    """Normaliza un clip de la biblioteca a EXACTAMENTE per segundos, w×h
    y sin audio (la narración manda). Si el clip es más largo, arranca en
    un punto al azar (variedad); si es más corto, se repite en bucle.
    Devuelve True si quedó listo."""
    try:
        args = [_ffmpeg(), "-y"]
        dur_clip = _duracion_audio(src)   # ffprobe: sirve para video también
        if dur_clip > per + 2:
            args += ["-ss", f"{random.uniform(0, dur_clip - per - 1):.1f}"]
        args += ["-stream_loop", "-1", "-i", src, "-t", f"{per:.2f}",
                 "-vf", (f"scale={w}:{h}:force_original_aspect_ratio="
                         f"increase,crop={w}:{h},setsar=1,fps={fps}"),
                 "-an", "-c:v", "libx264", "-preset", "veryfast",
                 "-pix_fmt", "yuv420p", destino]
        r = subprocess.run(args, capture_output=True, timeout=300)
        if r.returncode == 0 and os.path.exists(destino) \
                and os.path.getsize(destino) > 0:
            return True
        log.info("Clip no se pudo preparar: %s",
                 (r.stderr or b"")[-200:].decode("utf-8", "ignore"))
    except Exception as e:
        log.info("Clip no se pudo preparar (%s)", e)
    return False


def _correr_ffmpeg(args, salida, limite):
    """Ejecuta ffmpeg; devuelve (ok, cola_de_stderr)."""
    try:
        r = subprocess.run(args, capture_output=True, timeout=limite)
        if r.returncode == 0 and os.path.exists(salida) \
                and os.path.getsize(salida) > 0:
            return True, ""
        return False, (r.stderr or b"")[-300:].decode("utf-8", "ignore")
    except Exception as e:
        return False, str(e)


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
                      horizontal=False, con_musica=False):
    """Construye el MP4 (vertical para shorts; 16:9 para VODs de sesión).
    Devuelve True si se creó.

    con_musica=True mezcla música de fondo suave bajo la narración (solo si
    hay MUSICA_DOCU configurada) — pensado para documentales/programas."""
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
        # Cada elemento puede ser una URL (foto a descargar) o una RUTA
        # LOCAL: los gráficos (archivos g_*.png de graficos_f1) se encajan
        # completos y sin rótulo; las fotos locales de la biblioteca curada
        # y las URLs se recortan, llevan título y Ken Burns. En un video
        # largo (16:9) entran hasta 24 imágenes para que roten seguido; en
        # un short vertical bastan 8.
        tope = 24 if horizontal else 8
        imgs = []          # rutas listas
        es_chart = []      # gráfico/tarjeta: completo, sin rótulo ni zoom
        es_clip = []       # clip de video de la biblioteca (en movimiento)
        for i, src in enumerate((fotos_urls or [])[:tope]):
            if src and os.path.exists(str(src)):   # archivo local
                base = os.path.basename(str(src))
                # g_* = gráfico de datos; card_* = tarjeta de título/cierre.
                # Ambos van completos, sin recorte ni rótulo ni movimiento.
                chart = base.startswith("g_") or base.startswith("card_")
                clip = (not chart
                        and os.path.splitext(base)[1].lower() in _EXT_CLIP)
                ext = ".png" if chart else os.path.splitext(str(src))[1] or ".jpg"
                pref = "g" if chart else ("clip" if clip else "lib")
                destino = os.path.join(tmp, f"{pref}_{i}{ext}")
                try:
                    shutil.copy(src, destino)
                    imgs.append(destino)
                    es_chart.append(chart)
                    es_clip.append(clip)
                except Exception:
                    pass
                continue
            if len(imgs) - sum(es_chart) > 0:
                await asyncio.sleep(2)  # pausa entre descargas Wikimedia
            destino = os.path.join(tmp, f"img_{i}.jpg")
            if await _descargar(src, destino):
                imgs.append(destino)
                es_chart.append(False)
                es_clip.append(False)

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
                es_chart = [False]
                es_clip = [False]
            else:
                return False

        per = max(2.0, dur / len(imgs))

        # Ritmo visual: ninguna imagen quieta más de ~18 s (el ojo se cansa
        # y la gente se va). Si hay pocas fotos para el largo del video, se
        # REPITEN en segunda pasada — con el Ken Burns alternando acercar/
        # alejar, la foto repetida parece otra toma. Los gráficos y las
        # tarjetas no se repiten.
        if horizontal and per > 18.0:
            # Si el video termina con una tarjeta de cierre (chart al
            # final), mantenerla de ÚLTIMA: los repetidos van antes.
            cola = []
            if es_chart and es_chart[-1]:
                cola = [(imgs.pop(), es_chart.pop(), es_clip.pop())]
            fotos_i = [i for i, (ch, cl) in enumerate(zip(es_chart, es_clip))
                       if not ch and not cl]
            total = len(imgs) + len(cola)
            while fotos_i and dur / total > 18.0 and total < 60:
                j = fotos_i[(total - len(fotos_i)) % len(fotos_i)]
                imgs.append(imgs[j])
                es_chart.append(es_chart[j])
                es_clip.append(False)
                total += 1
            for im_, ch_, cl_ in cola:
                imgs.append(im_)
                es_chart.append(ch_)
                es_clip.append(cl_)
            per = max(2.0, dur / len(imgs))

        # Normalizar los clips de la biblioteca a per segundos, w×h, mudos.
        # Un clip que falle se cae de la lista y el video sigue con el resto.
        if any(es_clip):
            listos = {}
            for i, (img, cl) in enumerate(zip(imgs, es_clip)):
                if not cl or img in listos:
                    continue
                destino = img + f".seg.mp4"
                listos[img] = destino if await asyncio.to_thread(
                    _preparar_clip, img, destino, per, w, h, fps) else None
            filtrado = [(listos.get(im, im) if cl else im, ch, cl)
                        for im, ch, cl in zip(imgs, es_chart, es_clip)
                        if not (cl and listos.get(im) is None)]
            if not filtrado:
                return False
            imgs, es_chart, es_clip = (list(x) for x in zip(*filtrado))
            # Los clips ya quedaron recortados al per anterior; si alguno
            # se cayó, las FOTOS absorben su tiempo para que el video no
            # quede más corto que la narración.
            n_cl = sum(es_clip)
            n_resto = len(imgs) - n_cl
            if n_resto > 0:
                per = max(2.0, (dur - n_cl * per) / n_resto)

        musica = await _musica_docu() if con_musica else None
        limite = 1800 if horizontal else 300  # un VOD largo tarda en codificar
        # Ken Burns solo si está activo y hay al menos una FOTO (los
        # gráficos nunca se mueven; los clips ya traen movimiento propio).
        usar_kb = KEN_BURNS and any(
            not (ch or cl) for ch, cl in zip(es_chart, es_clip))

        # (una foto repetida para el ritmo visual solo se procesa UNA vez —
        # dos pasadas pintarían el rótulo doble; los clips no se tocan)
        def _prep(fn_foto, fn_chart=None):
            vistos = set()
            for img, chart, clip in zip(imgs, es_chart, es_clip):
                if img in vistos or clip:
                    continue
                vistos.add(img)
                if chart:
                    (fn_chart or _preparar_chart)(img, w, h)
                else:
                    fn_foto(img, w, h)

        # 1) Intento principal: con Ken Burns (título como overlay fijo)
        if usar_kb:
            _prep(_cubrir_imagen)               # recorte SIN rótulo
            titulo_png = _titulo_overlay(
                titulo, w, h, os.path.join(tmp, "titulo.png"))
            args = _construir_ffmpeg_kb(imgs, es_chart, titulo_png, audio_path,
                                        salida_mp4, per, w, h, fps,
                                        musica=musica, es_clip=es_clip)
            ok, err = _correr_ffmpeg(args, salida_mp4, limite)
            if ok:
                return True
            log.warning("Ken Burns falló (%s) — armo el video clásico", err)
            # Para el plan clásico las fotos necesitan el título pintado
            _prep(lambda img, w_, h_: _preparar_imagen(img, titulo, w_, h_),
                  fn_chart=lambda img, w_, h_: None)
        else:
            _prep(lambda img, w_, h_: _preparar_imagen(img, titulo, w_, h_))

        # 2) Plan clásico (concat sin movimiento), con música
        args = _construir_ffmpeg(imgs, audio_path, salida_mp4, per, w, h, fps,
                                 musica=musica, es_clip=es_clip)
        ok, err = _correr_ffmpeg(args, salida_mp4, limite)
        if ok:
            return True
        log.warning("ffmpeg falló al armar el video: %s", err)

        # 3) Último recurso: sin música por si el mix de audio fue el problema
        if musica:
            log.info("Reintento el video sin música de fondo")
            args = _construir_ffmpeg(imgs, audio_path, salida_mp4, per, w, h,
                                     fps, musica=None, es_clip=es_clip)
            ok, err = _correr_ffmpeg(args, salida_mp4, limite)
            if ok:
                return True
            log.warning("ffmpeg falló (sin música también): %s", err)
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


def _miniatura_sync(video_id, imagen_path):
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload
    yt = build("youtube", "v3", credentials=_credenciales(),
               cache_discovery=False)
    media = MediaFileUpload(imagen_path, mimetype="image/jpeg")
    yt.thumbnails().set(videoId=video_id, media_body=media).execute()


async def subir_miniatura(video_id, imagen_path):
    """Fija una miniatura propia al video. Requiere el canal VERIFICADO
    (por teléfono); si no lo está, YouTube la rechaza y seguimos igual —
    el video ya está subido. No lanza."""
    if not (video_id and imagen_path and os.path.exists(imagen_path)):
        return False
    try:
        await asyncio.to_thread(_miniatura_sync, video_id, imagen_path)
        log.info("🖼️  Miniatura personalizada fijada en %s", video_id)
        return True
    except Exception as e:
        log.info("No se pudo fijar la miniatura (¿canal sin verificar?) — "
                 "el video queda con frame automático (%s)", e)
        return False


async def subir_video(video_path, titulo, descripcion, tags, privacidad=None,
                      miniatura=None):
    """Sube el MP4 a YouTube. Devuelve {'id', 'url'} o None. Si `miniatura`
    es una ruta a una imagen, la fija como portada del video."""
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
            log.info("📤 Subido a YouTube: https://youtu.be/%s (%s)",
                     vid, privacidad)
            if miniatura:
                await subir_miniatura(vid, miniatura)
            return {"id": vid, "url": f"https://youtu.be/{vid}"}
        return None
    except Exception as e:
        log.error("Falló la subida a YouTube (%s)", e)
        return None

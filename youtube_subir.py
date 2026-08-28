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
# Lectura: solo hace falta para LISTAR los videos ya subidos y re-generarles
# la miniatura. Requiere re-autorizar (autorizar_youtube.py) una vez.
SCOPES_LECTURA = ["https://www.googleapis.com/auth/youtube.upload",
                  "https://www.googleapis.com/auth/youtube.readonly"]
# force-ssl hace falta para LEER y RESPONDER comentarios del propio canal.
SCOPES_COMENTARIOS = ["https://www.googleapis.com/auth/youtube.upload",
                      "https://www.googleapis.com/auth/youtube.readonly",
                      "https://www.googleapis.com/auth/youtube.force-ssl"]
# Los subtítulos (captions.insert) piden force-ssl igual que los comentarios:
# una sola re-autorización desbloquea las dos cosas.
SCOPES_SUBTITULOS = SCOPES_COMENTARIOS
# User-Agent conforme a la política de Wikimedia (identificable + contacto);
# sin esto, upload.wikimedia.org responde 429 a IPs compartidas como Replit
_UA = {"User-Agent":
       "F1FanChannelBot/1.0 "
       "(https://github.com/lapc276-sys/uberserviciosapp; automated "
       "motorsport channel) httpx"}

# La tipografía del canal delante; DejaVu queda de respaldo. Esta lista la
# consultan también la miniatura de los videos y los rótulos de ffmpeg.
try:
    import fuentes as _fu
    _FUENTES = _fu.lista(negrita=True) + ["/Library/Fonts/Arial.ttf"]
except Exception:                        # pragma: no cover
    _fu = None
    _FUENTES = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/Library/Fonts/Arial.ttf",
    ]


def recargar_fuentes():
    """Reconstruye la lista tras instalar la tipografía del canal."""
    global _FUENTES
    if _fu is not None:
        _FUENTES = _fu.lista(negrita=True) + ["/Library/Fonts/Arial.ttf"]

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
# .ogv/.ogg entran por Wikimedia Commons, que publica mucho vídeo en
# formatos libres; ffmpeg los decodifica igual que el resto.
_EXT_CLIP = (".mp4", ".mov", ".webm", ".m4v", ".mpg", ".mpeg", ".avi",
             ".ogv", ".ogg")
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


def _construir_ffmpeg(imgs, audio, salida, pers, w, h, fps, musica=None,
                      es_clip=None):
    """Arma la lista de argumentos de ffmpeg (el rótulo ya viene pintado
    en las imágenes con Pillow — el drawtext del build estático no está
    disponible).

    Si `musica` es una ruta a un MP3, se mezcla en bucle MUY bajita bajo la
    narración (estilo documental) y se corta con la voz (duration=first).
    Las entradas marcadas en `es_clip` son segmentos de video YA
    normalizados (per s, w×h, mudos) — entran tal cual, sin -loop."""
    es_clip = es_clip or [False] * len(imgs)
    if not isinstance(pers, (list, tuple)):
        pers = [pers] * len(imgs)
    args = [_ffmpeg(), "-y"]
    for img, cl, d in zip(imgs, es_clip, pers):
        if cl:
            args += ["-i", img]
        else:
            args += ["-loop", "1", "-t", f"{d:.2f}", "-i", img]
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


def _construir_ffmpeg_kb(imgs, es_chart, titulo_png, audio, salida, pers,
                         w, h, fps, musica=None, es_clip=None):
    """Como _construir_ffmpeg pero con efecto Ken Burns (zoom lento) en las
    FOTOS. Los gráficos (es_chart) quedan estáticos y encajados; los clips
    (es_clip, ya normalizados) entran tal cual — traen movimiento propio.
    El título va como overlay FIJO encima (no se mueve con el zoom)."""
    es_clip = es_clip or [False] * len(imgs)
    # Cada toma dura lo suyo (`pers` es una lista, no un número): el primer
    # minuto va más rápido y los gráficos aguantan más porque llevan texto.
    if not isinstance(pers, (list, tuple)):
        pers = [pers] * len(imgs)
    media = sum(pers) / max(1, len(pers))
    frames = max(2, int(round(media * fps)))
    # zoom que sube 1.0→~1.18 (o baja, alternando) a lo largo de la foto
    paso = 0.18 / frames
    up = _par(w * 1.30)
    hp = _par(h * 1.30)

    args = [_ffmpeg(), "-y"]
    for img, cl, d in zip(imgs, es_clip, pers):
        if cl:
            args += ["-i", img]
        else:
            args += ["-loop", "1", "-framerate", str(fps),
                     "-t", f"{d:.2f}", "-i", img]
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


def _fuente_tam(tam):
    from PIL import ImageFont
    for f in _FUENTES:
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size=tam)
            except Exception:
                pass
    try:
        return ImageFont.load_default(size=tam)
    except TypeError:
        return ImageFont.load_default()


def _envolver_px(draw, texto, fnt, max_w):
    """Parte el texto en líneas que caben en max_w PÍXELES (ancho real)."""
    palabras, lineas, actual = texto.split(), [], ""
    for w in palabras:
        prueba = (actual + " " + w).strip()
        if draw.textlength(prueba, font=fnt) <= max_w or not actual:
            actual = prueba
        else:
            lineas.append(actual)
            actual = w
    if actual:
        lineas.append(actual)
    return lineas


def _texto_borde(d, xy, texto, fnt, grosor, relleno=(255, 255, 255, 255)):
    """Dibuja texto con contorno negro grueso (stroke), con respaldo manual
    si la versión de Pillow no soporta stroke_width."""
    x, y = xy
    try:
        d.text((x, y), texto, font=fnt, fill=relleno,
               stroke_width=grosor, stroke_fill=(0, 0, 0, 255))
    except TypeError:
        for dx in range(-grosor, grosor + 1, max(1, grosor)):
            for dy in range(-grosor, grosor + 1, max(1, grosor)):
                d.text((x + dx, y + dy), texto, font=fnt, fill=(0, 0, 0, 255))
        d.text((x, y), texto, font=fnt, fill=relleno)


def _dibujar_chip_serie(d, texto, w):
    """Pega arriba-centro una 'píldora' roja con el nombre de la serie
    (crea sensación de serie → la gente vuelve). Devuelve el alto ocupado."""
    if not texto:
        return 0
    fnt = _fuente_tam(max(28, w // 26))
    caja = d.textbbox((0, 0), texto, font=fnt)
    tw, th = caja[2] - caja[0], caja[3] - caja[1]
    padx, pady = int(w * 0.03), int(w * 0.016)
    bw, bh = tw + padx * 2, th + pady * 2
    bx, by = (w - bw) // 2, int(w * 0.05)
    with contextlib.suppress(Exception):
        d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh // 2,
                            fill=(225, 6, 0, 235))
    d.text((bx + padx - caja[0], by + pady - caja[1]), texto, font=fnt,
           fill=(255, 255, 255, 255))
    return by + bh


def _dibujar_titulo_short(im, texto, w, h):
    """Rótulo estilo 'F1 Shorts' para VERTICALES: texto GRANDE en MAYÚSCULAS,
    blanco con contorno negro grueso, arriba-centro, sin banda — se lee de
    lejos al pasar por el feed."""
    from PIL import ImageDraw
    d = ImageDraw.Draw(im, "RGBA")
    texto = (texto or "").upper().strip()
    if not texto:
        return
    margen = int(w * 0.06)
    zona_w = w - margen * 2
    fnt, lineas = None, None
    for tam in range(int(w * 0.155), int(w * 0.05), -4):
        f = _fuente_tam(tam)
        ls = _envolver_px(d, texto, f, zona_w)
        if len(ls) <= 4:
            fnt, lineas = f, ls
            break
    if fnt is None:
        fnt = _fuente_tam(int(w * 0.06))
        lineas = _envolver_px(d, texto, fnt, zona_w)[:4]
    tam = getattr(fnt, "size", int(w * 0.1))
    alto = int(tam * 1.14)
    grosor = max(6, tam // 11)
    y0 = int(h * 0.11)
    for i, ln in enumerate(lineas):
        tw = d.textlength(ln, font=fnt)
        _texto_borde(d, ((w - tw) // 2, y0 + i * alto), ln, fnt, grosor)


def _dibujar_titulo(im, texto, w, h):
    """Rótulo del video. Vertical (shorts) → estilo grande F1 Shorts; 16:9
    (VODs/documentales) → banda oscura clásica abajo."""
    if h > w:
        _dibujar_titulo_short(im, texto, w, h)
        return
    from PIL import ImageDraw
    d = ImageDraw.Draw(im, "RGBA")
    tam = w // 18
    fnt = _fuente_tam(tam)
    lineas = _envolver(texto, ancho=44).split("\n")
    alto = round(tam * 1.35)
    total = alto * len(lineas)
    y0 = h - total - 64
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


def _titulo_overlay(texto, w, h, salida_png, chip=None):
    """Crea un PNG TRANSPARENTE w×h con el título (y, si se pasa `chip`, la
    píldora de serie arriba) para superponerlo FIJO sobre la foto en
    movimiento (Ken Burns). Devuelve la ruta, o None si no hay nada/falla."""
    if not (texto or chip):
        return None
    try:
        from PIL import Image, ImageDraw
        capa = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        if texto:
            _dibujar_titulo(capa, texto, w, h)
        if chip and h > w:
            _dibujar_chip_serie(ImageDraw.Draw(capa, "RGBA"), chip, w)
        capa.save(salida_png)
        return salida_png
    except Exception as e:
        log.info("No se pudo crear el overlay del título (%s)", e)
        return None


def _cta_overlay(w, h, salida_png, texto):
    """PNG transparente w×h con una 'píldora' de suscripción (barra roja
    redondeada + texto blanco, estilo YouTube) en el tercio inferior-centro,
    para superponerla en los últimos segundos del short. Ruta o None."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        capa = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(capa)
        tam = max(30, w // 15)
        fnt = None
        for f in _FUENTES:
            if os.path.exists(f):
                try:
                    fnt = ImageFont.truetype(f, size=tam)
                    break
                except Exception:
                    pass
        if fnt is None:
            fnt = ImageFont.load_default()
        caja = d.textbbox((0, 0), texto, font=fnt)
        tw, th = caja[2] - caja[0], caja[3] - caja[1]
        padx, pady = int(tam * 0.9), int(tam * 0.5)
        bw, bh = tw + padx * 2, th + pady * 2
        bx = (w - bw) // 2
        by = int(h * 0.58)                       # sobre la banda del título
        d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=bh // 2,
                            fill=(225, 6, 0, 235))
        d.text((bx + padx - caja[0], by + pady - caja[1]), texto,
               font=fnt, fill=(255, 255, 255, 255))
        capa.save(salida_png)
        return salida_png
    except Exception as e:
        log.info("No se pudo crear el overlay de CTA (%s)", e)
        return None


def _aplicar_cta(video_in, texto, dur, w, h, fps):
    """SEGUNDA pasada AISLADA: superpone la píldora de suscripción en los
    últimos ~3.5 s del short. Si algo falla, devuelve False y el llamador se
    queda con el video original INTACTO — nunca rompe el pipeline principal."""
    if not (texto and video_in and os.path.exists(video_in)):
        return False
    png = None
    try:
        png = os.path.join(os.path.dirname(os.path.abspath(video_in)),
                           "cta_overlay.png")
        if not _cta_overlay(w, h, png, texto):
            return False
        # La píldora aparece a MITAD del short, no en los últimos segundos:
        # la retención media ronda el 55-60%, así que un CTA pegado al final
        # no lo ve casi nadie. Desde la mitad lo alcanza la mayoría, y sigue
        # lo bastante tarde como para no estorbar el gancho de entrada.
        desde = max(0.5, min(dur * 0.5, dur - 3.0))
        salida = video_in + ".cta.mp4"
        args = [_ffmpeg(), "-y", "-i", video_in,
                "-loop", "1", "-framerate", str(fps), "-i", png,
                "-filter_complex",
                f"[0:v][1:v]overlay=0:0:enable='gte(t,{desde:.2f})':"
                f"shortest=1[v]",
                "-map", "[v]", "-map", "0:a?",
                "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt",
                "yuv420p", "-c:a", "copy", "-movflags", "+faststart", salida]
        r = subprocess.run(args, capture_output=True, timeout=300)
        if r.returncode == 0 and os.path.exists(salida) \
                and os.path.getsize(salida) > 0:
            os.replace(salida, video_in)
            log.info("👍 CTA de suscripción añadido al final del short")
            return True
        log.info("CTA overlay falló (%s) — el short queda sin CTA",
                 (r.stderr or b"")[-200:].decode("utf-8", "ignore"))
    except Exception as e:
        log.info("CTA overlay no aplicado (%s)", e)
    finally:
        with contextlib.suppress(OSError):
            if png and os.path.exists(png):
                os.remove(png)
    return False


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


# Rótulo del título superpuesto sobre el video. APAGADO por decisión del
# dueño: el texto grande se quedaba fijo durante los 40 segundos enteros del
# short y tapaba las imágenes, que son lo que hay que ver. El título sigue
# estando donde importa —el de YouTube, la miniatura y la descripción—, que
# es lo que decide si alguien entra.
#
# Se puede recuperar con el Secret TITULO_EN_VIDEO=on.
TITULO_EN_VIDEO = os.environ.get("TITULO_EN_VIDEO", "off").strip().lower() in (
    "on", "1", "yes", "si", "sí", "true")


async def armar_video(audio_path, fotos_urls, titulo, salida_mp4,
                      horizontal=False, con_musica=False, cta_texto=None,
                      chip=None, capitulos=()):
    """Construye el MP4 y, si es un short vertical con `cta_texto`, le añade
    una píldora de suscripción en los últimos segundos (segunda pasada
    aislada: si falla, el video queda igual). `chip` = nombre de serie que se
    pinta arriba (crea sensación de serie). Devuelve True si se creó."""
    if not TITULO_EN_VIDEO:
        titulo = ""      # el chip de serie sí se mantiene
    ok = await _armar_video_base(audio_path, fotos_urls, titulo, salida_mp4,
                                 horizontal=horizontal, con_musica=con_musica,
                                 chip=chip, capitulos=capitulos)
    if ok and cta_texto and not horizontal:
        dur = _duracion_audio(audio_path) or 25.0
        with contextlib.suppress(Exception):
            await asyncio.to_thread(_aplicar_cta, salida_mp4, cta_texto,
                                    dur, VERT_W, VERT_H, 30)
    return ok


# ── Ritmo visual ──────────────────────────────────────────────────────
# Cuánto dura cada toma. Antes una foto podía quedarse quieta hasta 18
# segundos: la gente se va. Estos son los números que manda la práctica de
# YouTube — corte cada pocos segundos, y más rápido al principio, porque
# el primer minuto decide si se quedan.
TOMA_ARRANQUE = float(os.environ.get("TOMA_ARRANQUE", "3.2"))   # primeros 60 s
TOMA_NORMAL = float(os.environ.get("TOMA_NORMAL", "4.6"))       # el resto
TOMA_CHART = float(os.environ.get("TOMA_CHART", "6.5"))         # tienen texto
TOMA_CLIP = float(os.environ.get("TOMA_CLIP", "5.0"))           # video propio
# La hoja de capítulo. Corta a propósito: es un respiro y un rótulo, no
# una pausa. Más de tres segundos de texto quieto sobre la narración ya
# se siente como que el video se ha parado.
TOMA_CAPITULO = float(os.environ.get("TOMA_CAPITULO", "2.6"))
ARRANQUE_S = 60.0
# Tope de tomas: cada una es una entrada de ffmpeg y el filtergraph crece
# con ellas. Por encima de esto el encode se vuelve lentísimo, así que en
# un video muy largo las tomas duran más de lo ideal.
MAX_TOMAS = int(os.environ.get("MAX_TOMAS", "240"))
# Cuántas veces puede repetirse una misma foto en un video. Con el Ken
# Burns alternando acercar y alejar, una foto que vuelve pasa por otra
# toma; catorce veces ya no.
VUELTAS_MAX = int(os.environ.get("VUELTAS_MAX", "14"))


def _plan_tomas(dur, imgs, es_chart, es_clip, horizontal, marcas=()):
    """Reparte el video en tomas: qué se ve en cada una y cuánto dura.

    Devuelve (imgs, es_chart, es_clip, duraciones).

    Dos cosas cambian respecto a repartir el tiempo a partes iguales:

    - Las fotos ROTAN EN CICLO. Antes las repeticiones se añadían al final
      de la lista, así que la misma foto podía salir dos veces seguidas.
      En ciclo, una foto no vuelve hasta que han pasado todas las demás.
    - El primer minuto va más rápido. Es donde se decide si el
      espectador se queda, y ahí la variedad importa más que en el diez.
    """
    n = len(imgs)
    if not n:
        return imgs, es_chart, es_clip, []

    # Un cierre con tarjeta se queda de último pase lo que pase
    cierre = None
    if es_chart and es_chart[-1] and n > 1:
        cierre = (imgs[-1], es_chart[-1], es_clip[-1])
        imgs, es_chart, es_clip = imgs[:-1], es_chart[:-1], es_clip[:-1]

    fotos = [i for i in range(len(imgs)) if not es_chart[i] and not es_clip[i]]
    otros = [i for i in range(len(imgs)) if es_chart[i] or es_clip[i]]
    if not fotos and not otros:
        return imgs, es_chart, es_clip, [max(2.0, dur)]

    base = TOMA_NORMAL if horizontal else 3.0
    arranque = TOMA_ARRANQUE if horizontal else 2.6
    # Si el video es tan largo que no cabe a este ritmo, las tomas se
    # alargan lo justo para no pasar del tope.
    if dur / base > MAX_TOMAS:
        base = dur / MAX_TOMAS
        arranque = base
    # Con poco material no hay ritmo que valga: cortar treinta veces a la
    # MISMA foto no se lee como montaje, se lee como un video roto. Cada
    # foto aparece un número limitado de veces y, si no dan para llenar el
    # video, las tomas se alargan en vez de multiplicarse.
    if fotos:
        tope_fotos = len(fotos) * (VUELTAS_MAX if len(fotos) >= 3 else 1)
        cabe = tope_fotos + len(otros)
        if cabe and dur / base > cabe:
            base = arranque = dur / cabe

    def _dura(idx, transcurrido):
        if es_clip[idx]:
            return TOMA_CLIP
        if es_chart[idx]:
            return TOMA_CHART
        return arranque if transcurrido < ARRANQUE_S else base

    dur_cierre = TOMA_CHART if cierre else 0.0
    objetivo = max(0.0, dur - dur_cierre)

    # Los gráficos y clips se reparten por el video en vez de amontonarse.
    cada = max(4, (len(fotos) or 1)) if otros else 0

    # Las hojas de capítulo, pendientes de colocar. Van en el SEGUNDO
    # EXACTO en el que empieza su capítulo: si se pusieran "más o menos
    # ahí", el índice de la descripción llevaría al espectador a un sitio
    # y la hoja diría otra cosa.
    pend = sorted((m for m in (marcas or []) if m.get("png")),
                  key=lambda m: m["inicio"])

    sec, chart2, clip2, pers = [], [], [], []
    t = 0.0
    k = j = puesto = 0
    while t < objetivo and len(sec) < MAX_TOMAS:
        # ¿Toca hoja de capítulo? Va antes de elegir foto: es una cita
        # con un segundo concreto, no una toma más del reparto.
        if pend and t >= pend[0]["inicio"] - 0.05:
            mk = pend.pop(0)
            d = min(TOMA_CAPITULO, max(1.2, objetivo - t))
            sec.append(mk["png"]); chart2.append(True); clip2.append(False)
            pers.append(d)
            t += d
            continue
        if otros and cada and puesto and puesto % cada == 0 and j < len(otros):
            idx = otros[j]; j += 1
        elif fotos:
            idx = fotos[k % len(fotos)]; k += 1      # ciclo: nunca seguidas
        elif otros:
            idx = otros[j % len(otros)]; j += 1
        else:
            break
        d = _dura(idx, t)
        # Y si esta toma se comería el momento de la siguiente hoja, se
        # corta justo ahí. Así la hoja entra clavada en su segundo.
        if pend and t + d > pend[0]["inicio"]:
            d = max(1.2, pend[0]["inicio"] - t)
        # La última toma se ajusta para no pasarse del audio
        if t + d > objetivo:
            d = max(1.5, objetivo - t)
        sec.append(imgs[idx]); chart2.append(es_chart[idx])
        clip2.append(es_clip[idx]); pers.append(d)
        t += d; puesto += 1

    if not sec:                       # audio muy corto: una sola toma
        sec, chart2, clip2, pers = ([imgs[0]], [es_chart[0]], [es_clip[0]],
                                    [max(1.5, objetivo)])
    if cierre:
        sec.append(cierre[0]); chart2.append(cierre[1])
        clip2.append(cierre[2]); pers.append(max(2.0, dur - t))
    return sec, chart2, clip2, pers


def _imagen_valida(path):
    """True si Pillow puede abrir el archivo como imagen RASTER. Descarta los
    SVG (mapas de circuito de Wikimedia), páginas HTML de error y archivos
    corruptos: si uno de esos entra al filtergraph, ffmpeg no puede
    decodificarlo ('no decoder found for: svg') y REVIENTA el video entero."""
    try:
        from PIL import Image
        with Image.open(path) as im:
            im.verify()
        return True
    except Exception:
        return False


async def _armar_video_base(audio_path, fotos_urls, titulo, salida_mp4,
                            horizontal=False, con_musica=False, chip=None,
                            capitulos=()):
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
        # Cuántas imágenes DISTINTAS entran. Cada una se prepara una sola
        # vez aunque salga varias veces en el montaje, así que subir esto
        # no encarece el encode: lo que da es variedad, y sin variedad no
        # se puede cortar cada cuatro segundos sin repetirse.
        tope = 40 if horizontal else 10
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
                    # Descartar imágenes locales ilegibles (SVG, corruptas):
                    # reventarían el filtergraph. Los clips (video) no se validan
                    # como imagen; los gráficos son PNG propios y sí pasan.
                    if not clip and not _imagen_valida(destino):
                        log.info("Imagen local ilegible descartada: %s", base)
                        with contextlib.suppress(OSError):
                            os.remove(destino)
                        continue
                    imgs.append(destino)
                    es_chart.append(chart)
                    es_clip.append(clip)
                except Exception:
                    pass
                continue
            if len(imgs) - sum(es_chart) > 0:
                await asyncio.sleep(2)  # pausa entre descargas Wikimedia
            destino = os.path.join(tmp, f"img_{i}.jpg")
            # Solo entra si se descargó Y Pillow la puede abrir (un SVG o un
            # HTML de error tumbarían todo el video).
            if await _descargar(src, destino) and _imagen_valida(destino):
                imgs.append(destino)
                es_chart.append(False)
                es_clip.append(False)

        # Sin fotos: un fondo oscuro sólido como respaldo. Pillow primero
        # (siempre disponible); ffmpeg lavfi como plan B con su error real
        # en el log.
        if not imgs:
            # Que se vea en el log: un video así sale casi negro, y hasta
            # ahora esto pasaba en silencio. Quien llama decide si publicarlo.
            log.warning("⚠️  Ninguna de las %d imágenes entró — el video "
                        "saldrá con fondo liso, sin fotos",
                        len(fotos_urls or []))
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

        # El plan de tomas: qué se ve, en qué orden y cuánto dura cada
        # una. Antes se repartía el tiempo a partes iguales y las fotos
        # repetidas se pegaban al final de la lista, así que la misma
        # imagen salía dos veces seguidas y podía quedarse quieta casi
        # veinte segundos.
        imgs, es_chart, es_clip, pers = _plan_tomas(
            dur, imgs, es_chart, es_clip, horizontal, capitulos)
        if not imgs:
            return False

        # Normalizar los clips de la biblioteca a su duración de toma,
        # w×h y mudos. Un clip que falle se cae de la lista y el video
        # sigue con el resto — pero su tiempo tiene que ir a algún sitio o
        # el video saldría más corto que la narración.
        if any(es_clip):
            listos = {}
            for img, cl, d in zip(imgs, es_clip, pers):
                if not cl or img in listos:
                    continue
                destino = img + ".seg.mp4"
                listos[img] = destino if await asyncio.to_thread(
                    _preparar_clip, img, destino, d, w, h, fps) else None
            filtrado = [(listos.get(im, im) if cl else im, ch, cl, d)
                        for im, ch, cl, d in zip(imgs, es_chart, es_clip, pers)
                        if not (cl and listos.get(im) is None)]
            if not filtrado:
                return False
            perdido = sum(pers) - sum(x[3] for x in filtrado)
            imgs, es_chart, es_clip, pers = (list(x) for x in zip(*filtrado))
            if perdido > 0.05:
                # El hueco se reparte entre las tomas que NO son clip: los
                # clips ya están recortados a su duración y estirarlos los
                # dejaría congelados al final.
                estirables = [i for i, cl in enumerate(es_clip) if not cl]
                if estirables:
                    extra = perdido / len(estirables)
                    for i in estirables:
                        pers[i] += extra

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
                titulo, w, h, os.path.join(tmp, "titulo.png"), chip=chip)
            args = _construir_ffmpeg_kb(imgs, es_chart, titulo_png, audio_path,
                                        salida_mp4, pers, w, h, fps,
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
        args = _construir_ffmpeg(imgs, audio_path, salida_mp4, pers, w, h, fps,
                                 musica=musica, es_clip=es_clip)
        ok, err = _correr_ffmpeg(args, salida_mp4, limite)
        if ok:
            return True
        log.warning("ffmpeg falló al armar el video: %s", err)

        # 3) Último recurso: sin música por si el mix de audio fue el problema
        if musica:
            log.info("Reintento el video sin música de fondo")
            args = _construir_ffmpeg(imgs, audio_path, salida_mp4, pers, w, h,
                                     fps, musica=None, es_clip=es_clip)
            ok, err = _correr_ffmpeg(args, salida_mp4, limite)
            if ok:
                return True
            log.warning("ffmpeg falló (sin música también): %s", err)
        return False
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _credenciales(scopes=None):
    from google.oauth2.credentials import Credentials
    return Credentials(
        token=None,
        refresh_token=os.environ["YOUTUBE_REFRESH_TOKEN"],
        client_id=os.environ["YOUTUBE_CLIENT_ID"],
        client_secret=os.environ["YOUTUBE_CLIENT_SECRET"],
        token_uri="https://oauth2.googleapis.com/token",
        scopes=scopes or SCOPES_SUBIR,
    )


def _listar_mis_videos_sync(max_n):
    """Lista los últimos videos subidos al canal (playlist de subidas).
    Devuelve [{'id','titulo','descripcion'}] o None si falla (típicamente
    porque el token no tiene el permiso de lectura → hay que re-autorizar)."""
    from googleapiclient.discovery import build
    yt = build("youtube", "v3", credentials=_credenciales(SCOPES_LECTURA),
               cache_discovery=False)
    ch = yt.channels().list(part="contentDetails", mine=True).execute()
    items = ch.get("items", [])
    if not items:
        return []
    uploads = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]
    videos, token = [], None
    while len(videos) < max_n:
        pl = yt.playlistItems().list(
            part="snippet,contentDetails", playlistId=uploads,
            maxResults=min(50, max_n - len(videos)), pageToken=token).execute()
        for it in pl.get("items", []):
            videos.append({
                "id": it["contentDetails"]["videoId"],
                "titulo": it["snippet"].get("title", ""),
                "descripcion": it["snippet"].get("description", ""),
            })
        token = pl.get("nextPageToken")
        if not token:
            break
    return videos


def listar_mis_videos(max_n=50):
    """Envoltura segura: None si no se puede listar (sin lanzar)."""
    if not oauth_configurado():
        return None
    try:
        return _listar_mis_videos_sync(max_n)
    except Exception as e:
        log.warning("No se pudieron listar los videos (¿falta el permiso de "
                    "lectura? re-autoriza con autorizar_youtube.py) — %s", e)
        return None


# ---------------------- comentarios del canal ----------------------

def _comentarios_sync(max_n):
    """Hilos de comentarios recientes del canal. Devuelve
    [{'id','texto','autor','video_id','respuestas'}]. `respuestas` es cuántas
    respuestas tiene ya el hilo (si es > 0, alguien —normalmente el dueño— ya
    contestó y no hay que volver a hacerlo)."""
    from googleapiclient.discovery import build
    yt = build("youtube", "v3", credentials=_credenciales(SCOPES_COMENTARIOS),
               cache_discovery=False)
    ch = yt.channels().list(part="id", mine=True).execute()
    items = ch.get("items", [])
    if not items:
        return []
    canal = items[0]["id"]
    r = yt.commentThreads().list(
        part="snippet,replies", allThreadsRelatedToChannelId=canal,
        maxResults=min(100, max_n), order="time",
        textFormat="plainText").execute()
    fuera = []
    for it in r.get("items", []):
        sn = it["snippet"]
        top = sn["topLevelComment"]["snippet"]
        # No contestarnos a nosotros mismos
        if (top.get("authorChannelId") or {}).get("value") == canal:
            continue
        fuera.append({
            "id": it["id"],
            "texto": top.get("textOriginal") or top.get("textDisplay") or "",
            "autor": top.get("authorDisplayName") or "",
            "video_id": sn.get("videoId") or "",
            "respuestas": int(sn.get("totalReplyCount") or 0),
        })
    return fuera


def listar_comentarios(max_n=50):
    """Envoltura segura: None si no se pudo (sin lanzar)."""
    if not oauth_configurado():
        return None
    try:
        return _comentarios_sync(max_n)
    except Exception as e:
        log.warning("No se pudieron leer los comentarios (¿falta el permiso "
                    "force-ssl? re-autoriza con autorizar_youtube.py) — %s", e)
        return None


def _responder_sync(comentario_id, texto):
    from googleapiclient.discovery import build
    yt = build("youtube", "v3", credentials=_credenciales(SCOPES_COMENTARIOS),
               cache_discovery=False)
    yt.comments().insert(part="snippet", body={"snippet": {
        "parentId": comentario_id, "textOriginal": texto}}).execute()


async def responder_comentario(comentario_id, texto):
    """Publica una respuesta a un comentario. True si se publicó. No lanza."""
    if not (comentario_id and texto):
        return False
    try:
        await asyncio.to_thread(_responder_sync, comentario_id, texto)
        log.info("💬 Respondido el comentario %s", comentario_id)
        return True
    except Exception as e:
        log.warning("No se pudo responder el comentario (%s)", e)
        return False


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


def _subtitulos_sync(video_id, srt_path, idioma, nombre):
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload
    yt = build("youtube", "v3", credentials=_credenciales(SCOPES_SUBTITULOS),
               cache_discovery=False)
    media = MediaFileUpload(srt_path, mimetype="application/octet-stream")
    yt.captions().insert(
        part="snippet",
        body={"snippet": {"videoId": video_id, "language": idioma,
                          "name": nombre, "isDraft": False}},
        media_body=media).execute()


async def subir_subtitulos(video_id, srt_path, idioma="en", nombre=""):
    """Sube una pista de subtítulos al video. True si entró.

    Cuesta ~400 unidades de cuota (una subida de video son ~1600), así que
    con 4 shorts al día cabe de sobra. Requiere el scope force-ssl — el
    mismo que los comentarios. No lanza: si falla, el video ya está subido
    y funcionando, que es lo que importa."""
    if not (video_id and srt_path and os.path.exists(srt_path)):
        return False
    try:
        await asyncio.to_thread(_subtitulos_sync, video_id, srt_path,
                                idioma, nombre)
        log.info("💬 Subtítulos (%s) puestos en %s", idioma, video_id)
        return True
    except Exception as e:
        log.info("No se pudieron subir los subtítulos de %s (%s) — "
                 "¿falta re-autorizar con force-ssl?", video_id, e)
        return False


# Por qué el motivo del fallo importa tanto: quien llama lleva la cuenta de
# los intentos de cada video y lo abandona tras unos pocos. Si un "hoy no
# hay cuota" contara como intento, los reintentos cada pocos minutos se
# comerían todos los intentos del día en un cuarto de hora y se perdería
# TODO lo pendiente — por algo que se arregla solo a medianoche.
#
# Se guarda en una variable del módulo, no se devuelve, para no cambiar la
# firma en los cinco sitios que suben video. Las subidas van una detrás de
# otra en un único bucle, así que no hay dos a la vez pisándose.
_ULTIMO_FALLO = None
# Fallos que NO son culpa del video: reintentar más tarde tiene sentido.
FALLOS_TEMPORALES = ("cuota", "auth", "red")


def ultimo_fallo():
    """Motivo del último fallo de subida: 'cuota', 'auth', 'red', 'video'
    o None si la última subida fue bien."""
    return _ULTIMO_FALLO


def _clasificar_fallo(e):
    """Traduce la excepción de la API a un motivo accionable."""
    t = f"{type(e).__name__} {e}".lower()
    if any(k in t for k in ("quotaexceeded", "ratelimitexceeded",
                            "uploadlimitexceeded", "dailylimitexceeded")):
        return "cuota"
    if any(k in t for k in ("invalid_grant", "invalid_scope", "unauthorized",
                            "refresherror", "invalid_client", "401")):
        return "auth"
    if any(k in t for k in ("timeout", "timed out", "connection", "ssl",
                            "temporarily", "backenderror", "503", "502",
                            "500", "socket", "broken pipe")):
        return "red"
    return "video"


async def subir_video(video_path, titulo, descripcion, tags, privacidad=None,
                      miniatura=None):
    """Sube el MP4 a YouTube. Devuelve {'id', 'url'} o None. Si `miniatura`
    es una ruta a una imagen, la fija como portada del video.

    Cuando devuelve None, `ultimo_fallo()` dice por qué.
    """
    global _ULTIMO_FALLO
    if not oauth_configurado():
        log.warning("OAuth de YouTube sin configurar: no se sube "
                    "(faltan YOUTUBE_CLIENT_ID / SECRET / REFRESH_TOKEN)")
        _ULTIMO_FALLO = "auth"
        return None
    # Una mirada al archivo ANTES de mandarlo. El control va aquí y no en
    # cada sitio que sube algo porque aquí pasan todos: shorts, VOD,
    # documentales y micro-shorts. Los avisos se cuentan y se sube igual
    # —quien decide si un fotograma está feo es una persona—; lo que se
    # PARA es lo que no tiene arreglo: sin imagen, sin audio o en negro.
    # Un video roto publicado no se puede despublicar del feed de nadie.
    if os.environ.get("REVISAR_ANTES", "on").lower() not in ("off", "0", ""):
        with contextlib.suppress(Exception):
            import revisar
            inf = await revisar.revisar_async(video_path, fotogramas=6)
            log.info("🔍 Revisión de %s: %s%s", os.path.basename(video_path),
                     revisar.resumen(inf),
                     "  →  /estatico/revision.png" if inf.get("url") else "")
            if inf.get("grave"):
                log.error("📤 NO se sube %s — %s. Los fotogramas están en "
                          "%s para que los mires.", os.path.basename(
                              video_path), "; ".join(inf["grave"]),
                          os.path.dirname((inf["fotogramas"] or [{}])[0]
                                          .get("png", "revision/")) or
                          "revision/")
                _ULTIMO_FALLO = "video_roto"
                return None
    privacidad = privacidad or os.environ.get("YOUTUBE_PRIVACIDAD", "public")
    try:
        resp = await asyncio.to_thread(
            _subir_sync, video_path, titulo, descripcion, tags, privacidad)
        vid = resp.get("id")
        if vid:
            log.info("📤 Subido a YouTube: https://youtu.be/%s (%s)",
                     vid, privacidad)
            _ULTIMO_FALLO = None
            if miniatura:
                await subir_miniatura(vid, miniatura)
            return {"id": vid, "url": f"https://youtu.be/{vid}"}
        _ULTIMO_FALLO = "video"
        return None
    except Exception as e:
        _ULTIMO_FALLO = _clasificar_fallo(e)
        if _ULTIMO_FALLO == "cuota":
            log.error("📤 CUOTA DIARIA DE YOUTUBE AGOTADA. No se sube nada "
                      "más hasta que se renueve (medianoche del Pacífico, "
                      "~07:00-08:00 UTC). Cada subida cuesta ~1600 de las "
                      "10000 unidades diarias: son ~6 videos al día "
                      "contando shorts Y videos largos. Lo pendiente NO se "
                      "pierde, sale mañana. (%s)", e)
        else:
            log.error("Falló la subida a YouTube [%s] (%s)", _ULTIMO_FALLO, e)
        return None

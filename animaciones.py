"""Biblioteca de MICROANIMACIONES técnicas propias (3-8 s, verticales).

Por qué existe: buscar fotos en internet para cada short trae siempre los
mismos problemas — material escaso de F1, imágenes de oficina que se cuelan,
y dudas de licencia. Estos clips los dibuja el propio canal, así que son
100% legales, tienen identidad visual propia y no dependen de nadie.

La clave es que NO son clips fijos: son GENERADORES paramétricos. El mismo
código de flujo de aire sirve para el alerón delantero, el trasero, el
difusor, con DRS abierto o cerrado, con o sin efecto suelo. Un generador
rinde decenas de tomas distintas.

Los clips resultantes entran en la MISMA lista que las fotos en
youtube_subir.armar_video (ya sabe intercalar clips de video con fotos), así
que no hace falta tocar el ensamblador.

Uso:
    ruta = await clip_flujo_aire(drs=True)      # devuelve un .mp4 cacheado
"""

import asyncio
import contextlib
import hashlib
import json
import logging
import math
import os
import shutil
import subprocess
import tempfile

log = logging.getLogger("animaciones")

ANCHO, ALTO = 1080, 1920
FPS = 24
DIR_CACHE = os.path.join("cache", "animaciones")

# Paleta del canal (la misma del mapa y las miniaturas: azul lento → rojo
# rápido), para que todo el material se vea de la misma familia.
_PARADAS_VEL = [(0.0, (60, 110, 230)), (0.45, (0, 205, 215)),
                (0.75, (250, 205, 0)), (1.0, (235, 45, 20))]
_FONDO = (9, 11, 17)
_REJILLA = (21, 25, 35)


def color_velocidad(v):
    """v 0..1 → color de la escala del canal (azul lento → rojo rápido)."""
    v = max(0.0, min(1.0, v))
    for i in range(len(_PARADAS_VEL) - 1):
        t0, c0 = _PARADAS_VEL[i]
        t1, c1 = _PARADAS_VEL[i + 1]
        if v <= t1:
            k = (v - t0) / ((t1 - t0) or 1)
            return tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
    return _PARADAS_VEL[-1][1]


def _fondo_tecnico(d, w, h):
    """Degradado oscuro + rejilla tenue: el 'plano técnico' del canal."""
    for y in range(0, h, 4):
        t = y / h
        d.line([(0, y), (w, y)],
               fill=(int(_FONDO[0] + 15 * (1 - t)),
                     int(_FONDO[1] + 19 * (1 - t)),
                     int(_FONDO[2] + 29 * (1 - t))), width=4)
    for gx in range(0, w, 90):
        d.line([(gx, 0), (gx, h)], fill=_REJILLA)
    for gy in range(0, h, 90):
        d.line([(0, gy), (w, gy)], fill=_REJILLA)


def _perfil_alar(cx, cy, cuerda, grosor, ang, comba=0.05):
    """Silueta de un perfil alar: línea de curvatura + espesor a ambos lados.
    Proporciones reales (espesor ~12% de la cuerda) para que se lea como un
    ala y no como una banana."""
    arriba, abajo = [], []
    for i in range(61):
        t = i / 60
        x = t * cuerda
        e = grosor * (1.4845 * math.sqrt(t) - 0.63 * t - 1.758 * t ** 2
                      + 1.4215 * t ** 3 - 0.5075 * t ** 4)
        yc = comba * cuerda * math.sin(math.pi * t)
        arriba.append((x, yc - e))
        abajo.append((x, yc + e))
    pts = arriba + abajo[::-1]
    ca, sa = math.cos(ang), math.sin(ang)
    return [(cx + px * ca - py * sa, cy + px * sa + py * ca) for px, py in pts]


# ─────────────────────── generador: flujo de aire ───────────────────────

def _desvio(x, y0, x0, x1, ala_y, fuerza, suelo):
    """Cuánto se desvía una línea de corriente al pasar por el ala."""
    if x < x0 - 300 or x > x1 + 460:
        return y0
    centro = (x0 + x1) / 2
    ancho = (x1 - x0) * 1.15
    campana = math.exp(-((x - centro) / ancho) ** 2 * 2.2)
    cercania = math.exp(-abs(y0 - ala_y) / (185 if suelo else 275))
    return y0 + fuerza * campana * cercania


def fotograma_flujo(fase, drs=False, suelo=True, n_lineas=23, ang=-0.13):
    """Un fotograma del flujo de aire sobre un alerón.

    drs=True    → el flap se abre: el aire se desvía mucho menos (menos
                  carga, menos resistencia) — sirve para explicar el DRS.
    suelo=True  → añade el asfalto: el flujo se acelera más cerca del suelo
                  (efecto suelo).
    """
    from PIL import Image, ImageDraw, ImageFilter
    im = Image.new("RGB", (ANCHO, ALTO), _FONDO)
    d = ImageDraw.Draw(im)
    _fondo_tecnico(d, ANCHO, ALTO)

    ala_y = ALTO * 0.46
    cuerda = ANCHO * 0.42
    x0 = ANCHO * 0.29
    x1 = x0 + cuerda
    fuerza = -26 if drs else -84

    y_suelo = ALTO * 0.88
    if suelo:
        d.rectangle([0, y_suelo, ANCHO, ALTO], fill=(13, 15, 21))
        d.line([(0, y_suelo), (ANCHO, y_suelo)], fill=(66, 74, 94), width=4)

    def lineas_corriente():
        for i in range(n_lineas):
            y0 = ALTO * 0.09 + i * (ALTO * 0.74 / (n_lineas - 1))
            yield i, y0, [(x, _desvio(x, y0, x0, x1, ala_y, fuerza, suelo))
                          for x in range(-60, ANCHO + 60, 10)]

    # Halo: se pinta en una capa aparte y se difumina
    capa = Image.new("RGB", (ANCHO, ALTO), (0, 0, 0))
    cd = ImageDraw.Draw(capa)
    trazos = []
    for i, y0, pts in lineas_corriente():
        cd.line(pts, fill=(33, 39, 54), width=3)
        for k in range(7):
            p = (fase + k / 7 + i * 0.019) % 1.0
            idx = int(p * (len(pts) - 10))
            x, y = pts[idx]
            # La velocidad sube donde el flujo se estrecha (más desvío)
            v = min(1.0, 0.16 + abs(y - y0) / 92)
            # ...y la estela se alarga con la velocidad: se LEE la velocidad
            largo = 3 + int(v * 7)
            x2, y2 = pts[min(idx + largo, len(pts) - 1)]
            col = color_velocidad(v)
            cd.line([(x, y), (x2, y2)], fill=col, width=8)
            trazos.append(((x, y), (x2, y2), col, v))
    capa = capa.filter(ImageFilter.GaussianBlur(10))
    im = Image.blend(im, capa, 0.5)
    d = ImageDraw.Draw(im)
    # Pasada nítida encima del halo
    for (a, b, col, v) in trazos:
        d.line([a, b], fill=col, width=4 + int(v * 3))

    # El alerón principal y el flap del DRS
    d.polygon(_perfil_alar(x0, ala_y, cuerda, 105, ang),
              fill=(30, 35, 46), outline=(172, 184, 206))
    fang = ang + (0.85 if drs else 0.18)
    d.polygon(_perfil_alar(x1 - cuerda * 0.06, ala_y - 66, cuerda * 0.24, 44,
                           fang, comba=0.04),
              fill=(36, 42, 55), outline=(182, 194, 216))
    return im


# ───────────────────────── montaje a MP4 + caché ─────────────────────────

def _ffmpeg():
    """Reusa el ffmpeg que ya resuelve youtube_subir (puede ser el estático
    descargado). Devuelve la ruta o None."""
    try:
        import youtube_subir
        if youtube_subir.ffmpeg_disponible():
            return youtube_subir._ffmpeg()
    except Exception:
        pass
    return shutil.which("ffmpeg")


def _clave(nombre, params, dur):
    crudo = json.dumps([nombre, params, dur], sort_keys=True)
    return f"{nombre}_{hashlib.md5(crudo.encode()).hexdigest()[:10]}.mp4"


def _render_sync(fn_fotograma, params, dur, destino):
    """Dibuja los fotogramas y los une en un MP4 con ffmpeg."""
    ffmpeg = _ffmpeg()
    if not ffmpeg:
        log.info("Sin ffmpeg: no se puede montar la animación")
        return None
    total = max(2, int(dur * FPS))
    tmp = tempfile.mkdtemp(prefix="anim_")
    try:
        for i in range(total):
            # fase 0..1 completa un ciclo: el clip queda en BUCLE perfecto
            im = fn_fotograma(i / total, **params)
            im.save(os.path.join(tmp, f"f{i:04d}.png"))
        args = [ffmpeg, "-y", "-framerate", str(FPS),
                "-i", os.path.join(tmp, "f%04d.png"),
                "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt",
                "yuv420p", "-movflags", "+faststart", destino]
        r = subprocess.run(args, capture_output=True, timeout=600)
        if r.returncode == 0 and os.path.exists(destino) \
                and os.path.getsize(destino) > 0:
            return destino
        log.info("ffmpeg no pudo montar la animación: %s",
                 (r.stderr or b"")[-200:].decode("utf-8", "ignore"))
        return None
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


async def _clip(nombre, fn_fotograma, params, dur):
    """Devuelve la ruta del MP4 (generándolo solo la primera vez)."""
    os.makedirs(DIR_CACHE, exist_ok=True)
    destino = os.path.join(DIR_CACHE, _clave(nombre, params, dur))
    if os.path.exists(destino) and os.path.getsize(destino) > 0:
        return destino
    try:
        salida = await asyncio.to_thread(_render_sync, fn_fotograma, params,
                                         dur, destino)
        if salida:
            log.info("🎬 Animación generada: %s", os.path.basename(salida))
        return salida
    except Exception as e:
        log.info("No se pudo generar la animación %s (%s)", nombre, e)
        with contextlib.suppress(OSError):
            os.remove(destino)
        return None


async def clip_flujo_aire(drs=False, suelo=True, dur=5.0):
    """Clip de flujo de aire sobre un alerón. Ruta al MP4, o None."""
    return await _clip("flujo", fotograma_flujo,
                       {"drs": bool(drs), "suelo": bool(suelo)}, dur)


# Vista previa rápida en GIF (para revisar el estilo sin ffmpeg)
def previsualizar(fn_fotograma, params, salida_gif, n=30, escala=0.25):
    frames = [fn_fotograma(i / n, **params) for i in range(n)]
    chicos = [f.resize((int(ANCHO * escala), int(ALTO * escala)))
              for f in frames]
    chicos[0].save(salida_gif, save_all=True, append_images=chicos[1:],
                   duration=int(1000 / FPS), loop=0, optimize=True)
    return salida_gif

"""animar.py — Un diagrama que se dibuja solo, en video.

Los diagramas de `diagramas.py` son láminas fijas. En un short de treinta
segundos una lámina fija funciona; en un video largo, seis segundos de
imagen quieta es donde la gente se va. Esto los convierte en un clip
corto: el dibujo APARECE, de izquierda a derecha, mientras la cámara se
acerca despacio.

Por qué un barrido y no reanimar cada plantilla por dentro
──────────────────────────────────────────────────────────
La otra opción era darle a cada plantilla un parámetro de progreso y que
se dibujara a medias. Son cuatro plantillas con geometría distinta, cada
una con su reparto de espacio ya cuadrado a base de arreglar solapes;
tocarlas por dentro es arriesgar esos arreglos por cuatro sitios.

Un barrido sobre el render ya terminado da justo lo que se quiere y no
toca nada: en `tendencia` la curva se traza sola, en `fases` las fases se
encienden por orden, en `comparar` las barras crecen, en `flujo` el aire
entra por delante. Es lo mismo que hace un canal de explicación, y
cuesta un render en vez de cuatro reescrituras.

El clip sale en H.264 con el ffmpeg que ya usa el canal.
"""

import logging
import math
import os
import shutil
import subprocess
import tempfile

import diagramas as D

log = logging.getLogger("animar")

#: Cuánto dura por defecto. Suficiente para leerlo, corto para no aburrir.
SEGUNDOS = 5.0
FPS = 25
#: Cuánto se acerca la cámara de principio a fin. Muy poco a propósito:
#: un zoom que se nota compite con el dibujo, que es lo que hay que leer.
ZOOM = 0.06
#: Fracción del clip que tarda en aparecer el dibujo entero. El resto se
#: queda quieto para poder leerlo — sin esa pausa el último dato aparece
#: justo cuando el clip se corta.
FRACCION_BARRIDO = 0.55
#: Ancho del degradado del borde del barrido, en tanto por uno del ancho.
#: Un corte duro se ve como una cortina; difuminado parece que se dibuja.
BORDE = 0.10


def _ffmpeg():
    """El mismo ffmpeg que usa el resto del canal."""
    try:
        import youtube_subir
        return youtube_subir._ffmpeg()
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


def _mascara_barrido(tam, avance):
    """Máscara del barrido: opaca hasta `avance`, con el borde difuminado.

    `avance` va de 0 (nada visible) a 1 (todo visible). Se construye a
    mano en vez de con un degradado de Pillow porque hace falta que el
    borde sea suave y el resto plano, y eso es una rampa por columnas.
    """
    from PIL import Image
    w, h = tam
    borde = max(1, int(w * BORDE))
    # x0 = donde empieza la rampa, x1 = donde ya es totalmente opaco.
    # Se pasa de -borde a w para que al principio no se vea nada y al
    # final no quede ni rastro de la rampa.
    x1 = -borde + avance * (w + borde)
    x0 = x1 - borde
    fila = bytearray(w)
    for x in range(w):
        if x <= x0:
            fila[x] = 255
        elif x >= x1:
            fila[x] = 0
        else:
            # Suavizado (coseno) en vez de lineal: el borde recto se nota
            t = (x - x0) / max(1e-6, x1 - x0)
            fila[x] = int(255 * (0.5 + 0.5 * math.cos(math.pi * t)))
    m = Image.frombytes("L", (w, 1), bytes(fila))
    return m.resize((w, h))


def _fotograma(base, fondo, avance, zoom):
    """Un fotograma: el dibujo barrido, sobre el fondo, con la cámara algo
    más cerca."""
    from PIL import Image
    w, h = base.size
    capa = base.copy()
    capa.putalpha(_mascara_barrido((w, h), avance))
    marco = fondo.copy()
    marco.paste(capa, (0, 0), capa)
    if zoom > 1.0001:
        nw, nh = int(w * zoom), int(h * zoom)
        marco = marco.resize((nw, nh), Image.LANCZOS)
        x0, y0 = (nw - w) // 2, (nh - h) // 2
        marco = marco.crop((x0, y0, x0 + w, y0 + h))
    return marco


def animar(spec, salida_mp4, segundos=SEGUNDOS, fps=FPS, tam=D.HORIZ,
           codec="libx264"):
    """Convierte una especificación de diagrama en un clip.

    `spec` es lo mismo que recibe `diagramas.dibujar`. Devuelve la ruta
    del clip, o None si no se pudo (plantilla desconocida, datos que no
    dan, o ffmpeg ausente) — igual que `dibujar`, nunca lanza.
    """
    from PIL import Image
    tmp = tempfile.mkdtemp(prefix="anim_")
    try:
        png = os.path.join(tmp, "base.png")
        if not D.dibujar(spec, png, tam=tam):
            return None
        base = Image.open(png).convert("RGBA")
        # El fondo es el color de panel del canal, no negro: así el
        # barrido descubre el dibujo sobre el mismo fondo que tendría la
        # lámina, en vez de sobre un agujero.
        fondo = Image.new("RGBA", base.size, D.FONDO)

        n = max(2, int(segundos * fps))
        for i in range(n):
            t = i / (n - 1)
            avance = min(1.0, t / FRACCION_BARRIDO)
            marco = _fotograma(base, fondo, avance, 1.0 + ZOOM * t)
            marco.convert("RGB").save(
                os.path.join(tmp, f"f_{i:05d}.png"))

        cmd = [_ffmpeg(), "-y", "-loglevel", "error",
               "-framerate", str(fps),
               "-i", os.path.join(tmp, "f_%05d.png"),
               "-c:v", codec, "-pix_fmt", "yuv420p"]
        if codec == "libx264":
            # veryfast: esto se monta en Replit, donde la CPU es poca y
            # hay varios clips por video.
            cmd += ["-preset", "veryfast", "-crf", "20"]
        cmd.append(salida_mp4)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            log.info("No pude montar el clip de '%s' (%s)",
                     spec.get("plantilla"), (r.stderr or "").strip()[:200])
            return None
        return salida_mp4
    except Exception as e:
        log.info("Diagrama animado '%s' no salió (%s)",
                 spec.get("plantilla"), e)
        return None
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

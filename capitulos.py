"""Capítulos de YouTube para los videos largos.

Los videos se montan concatenando un MP3 por línea narrada, así que la
duración de cada archivo da el minuto exacto en el que empieza cada trozo.
No hay que estimar nada: los tiempos son los reales.

Reglas de YouTube, que hay que cumplir TODAS o no aparecen los capítulos:

  · el primero tiene que empezar en 0:00,
  · como mínimo tres capítulos,
  · cada uno de al menos 10 segundos,
  · en orden ascendente,
  · uno por línea en la descripción, con el tiempo delante.

Si algo no cuadra, es mejor no poner capítulos que poner unos rotos: una
lista mal formada no se ignora parcialmente, YouTube la descarta entera.

OJO: los capítulos NO funcionan en Shorts, solo en videos normales.
"""

import contextlib
import logging
import os

log = logging.getLogger("capitulos")

MIN_S = 10.0          # mínimo que exige YouTube
MIN_CAPITULOS = 3
# Cuántos capítulos apuntamos a hacer. Ni tres para un documental de 10
# minutos (inútil) ni veinte (ruido).
OBJETIVO = 8
MAX_TITULO = 70


def formato(segundos):
    """Segundos → 0:07, 12:34 o 1:02:03 (el formato que YouTube entiende)."""
    s = max(0, int(segundos))
    h, resto = divmod(s, 3600)
    m, seg = divmod(resto, 60)
    return f"{h}:{m:02d}:{seg:02d}" if h else f"{m}:{seg:02d}"


def agrupar(piezas, objetivo=OBJETIVO, minimo_s=MIN_S):
    """Agrupa piezas [(duracion_s, texto)] en capítulos.

    Devuelve [{inicio, duracion, texto}] con el primero SIEMPRE en 0, o []
    si el material no da para cumplir las reglas de YouTube.
    """
    piezas = [(float(d), t) for d, t in (piezas or []) if d and d > 0]
    if not piezas:
        return []
    total = sum(d for d, _ in piezas)
    if total < minimo_s * MIN_CAPITULOS:
        return []                      # demasiado corto para tener capítulos
    # Largo ideal de cada capítulo, nunca por debajo del mínimo legal
    ideal = max(minimo_s, total / max(1, objetivo))

    caps, inicio, acum, textos = [], 0.0, 0.0, []
    for dur, texto in piezas:
        acum += dur
        if texto:
            textos.append(texto)
        if acum >= ideal:
            caps.append({"inicio": inicio, "duracion": acum,
                         "texto": " ".join(textos)})
            inicio += acum
            acum, textos = 0.0, []
    # Lo que sobra se pega al último capítulo: crear uno corto al final
    # rompería la regla de los 10 segundos.
    if acum > 0:
        if caps and acum < minimo_s:
            caps[-1]["duracion"] += acum
            if textos:
                caps[-1]["texto"] += " " + " ".join(textos)
        else:
            caps.append({"inicio": inicio, "duracion": acum,
                         "texto": " ".join(textos)})
    if len(caps) < MIN_CAPITULOS:
        return []
    return caps


def valido(caps):
    """¿Cumple esta lista TODAS las reglas de YouTube?"""
    if not caps or len(caps) < MIN_CAPITULOS:
        return False
    if int(caps[0]["inicio"]) != 0:
        return False
    ultimo = -1.0
    for c in caps:
        if c["inicio"] <= ultimo:        # tienen que ir subiendo
            return False
        if c["duracion"] < MIN_S:
            return False
        ultimo = c["inicio"]
    return True


# ── La hoja de capítulo ───────────────────────────────────────────────
# Como la página que separa los capítulos de un libro: negro, el número
# arriba y el título grande. Sirve para dos cosas a la vez — le da al
# espectador un respiro entre bloques, y le dice qué viene ahora, que es
# justo lo que hace que no se vaya.
#
# La tarjeta NO añade tiempo al video: se pone ENCIMA de la narración que
# ya está sonando, en el segundo exacto en el que empieza el capítulo.
# Meter una pausa de dos segundos en mitad de un video de YouTube para
# que la hoja "respire" es regalarle al espectador el momento perfecto
# para irse; y además correría todos los tiempos del índice.
CARD_FONDO = "#07090C"
CARD_TINTA = "#FFFFFF"
CARD_ACENTO = "#E10600"


def tarjeta(numero, titulo, salida, tam=(1920, 1080), total=None):
    """Dibuja la hoja de un capítulo. Devuelve la ruta o None."""
    if not titulo:
        return None
    try:
        from PIL import Image, ImageDraw
        import diagramas as D
    except Exception:
        return None
    w, h = tam
    corto = min(w, h)
    img = Image.new("RGB", (w, h), CARD_FONDO)
    dib = ImageDraw.Draw(img)
    m = int(w * 0.10) if w >= h else int(w * 0.11)

    f_num = D._fuente(int(corto * 0.030), True)
    f_tit = D._fuente(int(corto * (0.075 if w >= h else 0.068)), True)

    etiqueta = f"CHAPTER {numero}" + (f" OF {total}" if total else "")
    lineas = D._partir(dib, " ".join(str(titulo).split()), f_tit, w - 2 * m)[:4]
    alto_linea = int(corto * (0.092 if w >= h else 0.084))
    # El bloque entero va centrado en vertical: un título de una línea y
    # otro de tres tienen que sentarse igual de bien en la página.
    alto = int(corto * 0.052) + len(lineas) * alto_linea
    y = (h - alto) // 2

    dib.rectangle([m, y + int(corto * .012), m + int(corto * .055),
                   y + int(corto * .017)], fill=CARD_ACENTO)
    D._texto(dib, (m + int(corto * .075), y), etiqueta, f_num, CARD_ACENTO,
             esp=int(corto * .007))
    y += int(corto * 0.052)
    for ln in lineas:
        dib.text((m, y), ln, font=f_tit, fill=CARD_TINTA)
        y += alto_linea

    with contextlib.suppress(Exception):
        os.makedirs(os.path.dirname(os.path.abspath(salida)), exist_ok=True)
    try:
        img.save(salida, "PNG")
        return salida
    except Exception as e:
        log.info("No pude dibujar la hoja del capítulo %s (%s)", numero, e)
        return None


def tarjetas(marcas, carpeta, tam=(1920, 1080)):
    """Una hoja por capítulo. Devuelve [{inicio, png}] con las que salieron."""
    fuera = []
    for i, c in enumerate(marcas or [], start=1):
        # La primera no se dibuja: el video ya empieza por ahí y una hoja
        # en el segundo cero retrasa el gancho, que es lo único que decide
        # si alguien se queda.
        if i == 1:
            continue
        png = tarjeta(i, c.get("titulo"),
                      os.path.join(carpeta, f"cap_{i:02d}.png"), tam,
                      total=len(marcas))
        if png:
            fuera.append({"inicio": float(c.get("inicio") or 0), "png": png})
    return fuera


def bloque(caps, titulos):
    """Texto de los capítulos para la descripción, o "" si no son válidos.

    `titulos` son los nombres ya redactados, uno por capítulo. Se numeran
    para que se lean como un índice.
    """
    if not valido(caps) or len(titulos) != len(caps):
        return ""
    lineas = []
    for i, (c, t) in enumerate(zip(caps, titulos), start=1):
        t = " ".join(str(t).split())[:MAX_TITULO].strip(" -–—:·")
        if not t:
            return ""                    # sin título no se publica el índice
        # El tiempo va DELANTE, que es como YouTube los detecta
        lineas.append(f"{formato(c['inicio'])} {i}. {t}")
    return "\n".join(lineas)

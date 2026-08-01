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

import logging

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

"""Subtítulos a partir del guion que YA escribimos.

No hay que transcribir nada: el texto que se narra lo redacta el canal, y el
audio dura lo que dura. Con esas dos cosas sale un SRT.

El reparto de tiempos es proporcional a los CARACTERES de cada trozo, que
para una narración seguida y a ritmo constante es una aproximación buena.
No es alineación real palabra por palabra — para eso haría falta que el TTS
devolviera marcas de tiempo. Es honesto decirlo: los cortes pueden bailar
unas décimas, y aun así el subtítulo va pegado a lo que se oye.

Por qué importa la pista en INGLÉS aunque el público sea de India o de
habla hispana: YouTube traduce los subtítulos solo, pero hoy traduce a
partir de su propio reconocimiento de voz, que se come los nombres de los
pilotos y los términos técnicos. Dándole el texto exacto, las traducciones
automáticas mejoran sin gastar una sola unidad más de cuota.
"""

import logging
import re

log = logging.getLogger("subtitulos")

# Un subtítulo cómodo de leer: dos líneas cortas, ni un parpadeo ni eterno.
MAX_LINEA = 42          # caracteres por línea
MAX_LINEAS = 2
MIN_S = 1.0             # nadie lee un cue de medio segundo
MAX_S = 6.0             # más de esto se siente colgado


def _frases(texto):
    """Parte el guion en frases, conservando el signo final."""
    limpio = re.sub(r"\s+", " ", (texto or "").strip())
    if not limpio:
        return []
    partes = re.split(r"(?<=[.!?…])\s+", limpio)
    return [p.strip() for p in partes if p.strip()]


def _trocear(frase, tope):
    """Parte una frase larga en trozos de como mucho `tope` caracteres, sin
    cortar palabras.

    Reparte EQUILIBRADO en vez de llenar hasta el borde y dejar la sobra
    suelta: una frase de 91 con tope 84 da 46+45, no 84+7. Un cue con dos
    palabras sueltas se lee fatal.
    """
    frase = frase.strip()
    if len(frase) <= tope:
        return [frase]
    palabras = frase.split()
    n = max(2, -(-len(frase) // tope))        # trozos necesarios, redondeando
    objetivo = len(frase) / n                 # largo ideal de cada uno
    trozos, actual = [], ""
    for palabra in palabras:
        cabe = len(actual) + 1 + len(palabra) <= tope
        # Cerrar el trozo al pasar el objetivo, salvo que aún quepa y el
        # trozo esté claramente corto
        if actual and (not cabe or len(actual) >= objetivo):
            trozos.append(actual)
            actual = palabra
        else:
            actual = f"{actual} {palabra}".strip()
    if actual:
        trozos.append(actual)
    return trozos


def _envolver(trozo):
    """Reparte el trozo en líneas de MAX_LINEA sin partir palabras.

    NUNCA descarta texto: si por palabras muy largas salieran más líneas de
    las permitidas, las sobrantes se pegan a la última en vez de tirarse. Un
    subtítulo que se come palabras es peor que uno con una línea de más —
    tiene que decir exactamente lo que se oye.
    """
    lineas, actual = [], ""
    for palabra in trozo.split():
        if actual and len(actual) + 1 + len(palabra) > MAX_LINEA:
            lineas.append(actual)
            actual = palabra
        else:
            actual = f"{actual} {palabra}".strip()
    if actual:
        lineas.append(actual)
    if not lineas:
        return trozo
    if len(lineas) > MAX_LINEAS:
        lineas = lineas[:MAX_LINEAS - 1] + [" ".join(lineas[MAX_LINEAS - 1:])]
    return "\n".join(lineas)


def cues(texto, duracion):
    """[(inicio_s, fin_s, texto)] repartidos por peso de caracteres.

    Devuelve [] si falta el texto o la duración: sin eso no hay subtítulo
    honesto que hacer, y es mejor no poner ninguno que poner uno desfasado.
    """
    if not texto or not duracion or duracion <= 0:
        return []
    frases = _frases(texto)
    if not frases:
        return []

    def peso(t):
        # El largo SIN espacios se acerca más al tiempo que cuesta decirlo
        return max(1, len(t.replace(" ", "")))

    # Cuánto texto cabe en un cue: manda el límite de PANTALLA, pero si el
    # audio va lento ese bloque duraría demasiado, así que también se acota
    # por TIEMPO. Se trocea de más antes que recortar tiempos después —
    # recortar dejaba huecos mudos con el audio hablando.
    total_peso = sum(peso(f) for f in frases)
    por_segundo = total_peso / duracion                  # caracteres/segundo
    tope = MAX_LINEA * MAX_LINEAS
    if por_segundo > 0:
        tope = max(MAX_LINEA, min(tope, int(MAX_S * por_segundo)))

    trozos = []
    for frase in frases:
        trozos.extend(_trocear(frase, tope))
    # Un trozo tan corto que parpadearía se junta con el anterior, siempre
    # que quepa en pantalla. Mejor un cue algo más largo que un fogonazo.
    minimo_peso = MIN_S * por_segundo if por_segundo else 0
    fundidos = []
    for t in trozos:
        if (fundidos and peso(t) < minimo_peso
                and len(fundidos[-1]) + 1 + len(t) <= tope):
            fundidos[-1] = f"{fundidos[-1]} {t}"
        else:
            fundidos.append(t)
    trozos = fundidos or trozos

    # Tiempos CONTIGUOS: cada cue empieza donde acaba el anterior. Así no hay
    # huecos mudos ni solapes, y el último cierra exactamente con el audio.
    total = sum(peso(t) for t in trozos)
    salida, t0 = [], 0.0
    for i, trozo in enumerate(trozos):
        t1 = (duracion if i == len(trozos) - 1
              else min(duracion, t0 + duracion * peso(trozo) / total))
        if t1 > t0:
            salida.append((t0, t1, _envolver(trozo)))
        t0 = t1
    return salida


def _reloj(segundos):
    """Segundos → 00:00:01,500 (formato SRT, con coma decimal)."""
    segundos = max(0.0, float(segundos))
    h, resto = divmod(segundos, 3600)
    m, s = divmod(resto, 60)
    ms = int(round((s - int(s)) * 1000))
    if ms == 1000:                      # el redondeo puede desbordar
        s, ms = int(s) + 1, 0
    return f"{int(h):02d}:{int(m):02d}:{int(s):02d},{ms:03d}"


def a_srt(texto, duracion):
    """El SRT completo como cadena, o "" si no hay con qué construirlo."""
    partes = []
    for i, (inicio, fin, linea) in enumerate(cues(texto, duracion), start=1):
        partes.append(f"{i}\n{_reloj(inicio)} --> {_reloj(fin)}\n{linea}\n")
    return "\n".join(partes)


def escribir_srt(texto, duracion, salida):
    """Escribe el .srt y devuelve su ruta, o None si no había nada que
    escribir. Nunca lanza."""
    try:
        srt = a_srt(texto, duracion)
        if not srt.strip():
            return None
        with open(salida, "w", encoding="utf-8") as f:
            f.write(srt)
        return salida
    except Exception as e:
        log.warning("No se pudo escribir el SRT (%s)", e)
        return None

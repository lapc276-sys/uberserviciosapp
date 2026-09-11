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


# ── Rótulos QUEMADOS en la imagen ─────────────────────────────────────
#
# Por qué hacen falta, además del SRT de arriba
# ──────────────────────────────────────────────
# El SRT se sube como pista de subtítulos de YouTube, y eso sirve para el
# buscador y para las traducciones automáticas. Lo que NO hace es
# aparecer en pantalla: en Shorts los subtítulos van apagados por
# defecto y casi nadie entra a encenderlos. Así que el canal llevaba
# subtítulos que el espectador no veía.
#
# Estos van dentro de la imagen. No se pueden apagar, se leen con el
# móvil en silencio —que es como se ve la mitad de los Shorts— y son de
# las pocas cosas que se sabe que suben la retención de un vertical.
#
# Cómo se dibujan, y por qué así
# ───────────────────────────────
# Blanco tirando a plateado: el relleno es un degradado vertical de
# blanco a gris acero, que es lo que hace que unas letras parezcan metal
# en vez de papel. Debajo va un contorno oscuro, y no por estética: sin
# él, una letra blanca sobre el capó blanco de un coche desaparece. El
# contorno es lo que garantiza que se lea SIEMPRE, sobre cualquier foto.
#
# Y el ancho se mide en PÍXELES con la tipografía de verdad, no contando
# caracteres. Contando caracteres, una línea de eñes y una de íes miden
# lo mismo en el código y muy distinto en pantalla — y la que se pasa se
# sale del encuadre.

#: Zona segura vertical. La interfaz de Shorts tapa la franja de abajo
#: (título, canal, botones), y la píldora de suscripción del canal cae
#: sobre el 58% de la altura. El rótulo se pone por debajo de esa píldora
#: y por encima de la interfaz.
ALTO_ROTULO = 0.72
#: Ancho utilizable: se dejan márgenes a los lados para no pegarse al
#: borde ni meterse bajo la columna de botones de la derecha.
ANCHO_UTIL = 0.84
#: Cuerpo de letra de partida y mínimo, como fracción del ancho del
#: lienzo. Un Short se ve en una pantalla de mano: grande o no se lee.
CUERPO_MAX = 0.075
CUERPO_MIN = 0.044
#: Líneas como mucho. Tres ya es un párrafo tapando la imagen.
LINEAS_PANTALLA = 3

#: El degradado del relleno: de blanco puro a gris acero.
#: Blanco arriba, acero abajo. El extremo bajo NO baja más: el encargo
#: era "blanca tirando a plateada", y por debajo de esto deja de leerse
#: como plata y empieza a leerse como gris apagado.
PLATA_ALTA = (255, 255, 255)
PLATA_BAJA = (196, 204, 218)
#: El contorno y su sombra. Es lo que hace que se lea sobre una foto
#: clara; sin esto el rótulo se pierde la mitad de las veces.
BORDE = (6, 8, 12)


def _fuente_pil(rutas, tam):
    from PIL import ImageFont
    for p in (rutas or []):
        try:
            return ImageFont.truetype(p, size=tam)
        except Exception:
            continue
    return ImageFont.load_default()


def _envolver_ancho(dib, texto, fnt, ancho_max):
    """Parte el texto en líneas que de verdad CABEN, medidas con la
    tipografía. Devuelve la lista de líneas."""
    palabras = (texto or "").split()
    if not palabras:
        return []
    lineas, actual = [], palabras[0]
    for p in palabras[1:]:
        prueba = f"{actual} {p}"
        if dib.textlength(prueba, font=fnt) <= ancho_max:
            actual = prueba
        else:
            lineas.append(actual)
            actual = p
    lineas.append(actual)
    return lineas


def _degradado(tam, paso, y0):
    """El degradado plateado, repetido UNA VEZ POR LÍNEA.

    Que se repita es justo lo que lo hace parecer metal. Estirando un
    solo degradado sobre todo el bloque, un rótulo de una línea sale de
    un color plano y uno de tres sale con la primera línea blanca y la
    última gris, como si se apagara. Por línea, las tres brillan igual:
    claro arriba del trazo y acero abajo, que es como se ve una letra
    cromada de verdad.
    """
    from PIL import Image
    w, h = tam
    paso = max(2, int(paso))
    tira = Image.new("RGB", (1, paso))
    px = tira.load()
    for y in range(paso):
        t = y / (paso - 1)
        px[0, y] = tuple(
            int(PLATA_ALTA[i] + (PLATA_BAJA[i] - PLATA_ALTA[i]) * t)
            for i in range(3))
    tira = tira.resize((w, paso))
    lienzo = Image.new("RGB", (w, h), PLATA_BAJA)
    # Se empieza a embaldosar desde y0 para que cada línea de texto caiga
    # en la misma fase del degradado.
    y = y0 % paso - paso
    while y < h:
        lienzo.paste(tira, (0, y))
        y += paso
    return lienzo


def rotulo_png(texto, tam, salida, fuentes=(), alto=ALTO_ROTULO):
    """Un PNG transparente del tamaño del vídeo con UN rótulo dibujado.

    Devuelve la ruta o None. None no rompe nada: el vídeo se queda sin
    ese rótulo y sigue su camino.
    """
    texto = re.sub(r"\s+", " ", (texto or "").replace("\n", " ")).strip()
    if not texto:
        return None
    try:
        from PIL import Image, ImageDraw
        w, h = tam
        ancho_max = int(w * ANCHO_UTIL)
        # Se empieza grande y se baja hasta que quepa en las líneas
        # permitidas. Al revés —elegir el cuerpo por número de letras— es
        # lo que deja una línea saliéndose por la derecha.
        medidor = ImageDraw.Draw(Image.new("L", (8, 8)))
        cuerpo = int(w * CUERPO_MAX)
        piso = max(12, int(w * CUERPO_MIN))
        lineas, fnt = [], None
        while cuerpo >= piso:
            fnt = _fuente_pil(fuentes, cuerpo)
            lineas = _envolver_ancho(medidor, texto, fnt, ancho_max)
            if len(lineas) <= LINEAS_PANTALLA:
                break
            cuerpo -= max(2, cuerpo // 18)
        if not lineas or fnt is None:
            return None

        borde = max(3, cuerpo // 14)
        salto = int(cuerpo * 1.16)
        bloque = salto * len(lineas)
        y0 = int(h * alto - bloque / 2)

        # 1) El contorno oscuro, en su propia capa.
        capa = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(capa)
        for i, ln in enumerate(lineas):
            d.text((w // 2, y0 + i * salto), ln, font=fnt,
                   fill=BORDE + (255,), anchor="ma",
                   stroke_width=borde, stroke_fill=BORDE + (255,))

        # 2) El relleno plateado: se dibuja el texto en una máscara y el
        #    degradado se cuela POR ella. Pintar letra a letra con un
        #    color distinto cada una daría bandas, no un degradado.
        mascara = Image.new("L", (w, h), 0)
        dm = ImageDraw.Draw(mascara)
        for i, ln in enumerate(lineas):
            dm.text((w // 2, y0 + i * salto), ln, font=fnt, fill=255,
                    anchor="ma")
        # El degradado arranca un poco por encima de la altura de la
        # línea: así el blanco cae sobre el cuerpo de la letra y el acero
        # sobre su base, en vez de al contrario.
        plata = _degradado((w, h), salto, max(0, y0 - int(cuerpo * 0.18)))
        capa.paste(plata, (0, 0), mascara)

        capa.save(salida)
        return salida
    except Exception as e:
        log.info("No se pudo dibujar el rótulo (%s)", e)
        return None


def rotulos(texto, duracion, tam, carpeta, fuentes=(), maximo=40):
    """Un PNG por cue. Devuelve [(inicio, fin, ruta_png)].

    `maximo` existe porque cada rótulo es una entrada más en el
    filtergraph de ffmpeg: en un short son ocho o diez y va sobrado, pero
    un documental de diez minutos daría cientos y el encode se arrastra.
    Pasado el tope se devuelve lo que cabe en vez de fallar.
    """
    import os
    cs = cues(texto, duracion)
    if not cs:
        return []
    fuera = []
    for i, (t0, t1, linea) in enumerate(cs[:maximo]):
        ruta = os.path.join(carpeta, f"rotulo_{i:03d}.png")
        if rotulo_png(linea, tam, ruta, fuentes=fuentes):
            fuera.append((t0, t1, ruta))
    return fuera

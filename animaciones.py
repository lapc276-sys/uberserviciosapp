"""Biblioteca de MICROANIMACIONES técnicas propias (3-8 s, verticales).

Por qué existe: buscar fotos en internet para cada short trae siempre los
mismos problemas — material escaso de F1, imágenes de oficina que se cuelan,
y dudas de licencia. Estos clips los dibuja el propio canal, así que son
100% legales, tienen identidad visual propia y no dependen de nadie.

La clave es que NO son clips fijos: son GENERADORES paramétricos. El mismo
código de flujo de aire sirve para el alerón delantero, el trasero, el
difusor, con DRS abierto o cerrado, con o sin efecto suelo. Un generador
rinde decenas de tomas distintas.

Generadores, uno por familia técnica del canal:

    fotograma_flujo         aerodinámica: flujo sobre el ala, DRS, suelo
    fotograma_freno         freno de carbono y su ventana de temperatura
    fotograma_neumatico     neumático rodando: huella, calor, slick/lluvia
    fotograma_ers           híbrido: batería, MGU-K, MGU-H, deploy/harvest
    fotograma_carga         transferencia de peso al frenar/acelerar/girar
    fotograma_trazada       la trazada, el ápice y el error de girar pronto
    fotograma_degradacion   caída del blando y ventana de parada

Todos comparten rótulo, medidor y paleta (ver `_pie` y `_medidor`) para que
cinco clips seguidos dentro de un short se lean como UNA serie.

Los clips resultantes entran en la MISMA lista que las fotos en
youtube_subir.armar_video (ya sabe intercalar clips de video con fotos), así
que no hace falta tocar el ensamblador.

Uso:
    ruta = await clip("freno_caliente")     # devuelve un .mp4 cacheado
    ruta = animaciones.ruta_cacheada("freno_caliente")   # sin generar nada

Para VERLAS sin ffmpeg y sin publicar nada:
    python3 herramientas/ver_animaciones.py
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
# Duración por defecto de cada clip. Corta a propósito: en un short de ~45 s
# entran cinco o seis sin comerse el tiempo de las fotos, y cada fotograma
# se dibuja con Pillow, así que cada segundo de más son 24 imágenes más que
# renderizar la primera vez.
DUR = 4.0
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


# ────────────────── utilidades comunes de las animaciones ────────────────
# Todas las animaciones nuevas comparten rótulo, medidor y paleta para que
# cinco clips seguidos dentro de un short se lean como UNA serie y no como
# cinco cosas sueltas.

_TEXTO = (226, 234, 248)
_TENUE = (128, 140, 164)
_ACENTO = (0, 205, 215)
_AVISO = (235, 45, 20)

# Franjas verticales que ya están ocupadas cuando el clip va dentro de un
# short, y que por eso hay que dejar libres al dibujar:
#   0.11-0.35  título del short (rótulo blanco grande)
#   0.58-0.67  píldora de suscripción (aparece a mitad del short)
# Queda limpio el centro (0.36-0.57) y la banda baja (0.70-0.92).
Y_PIE = 0.790          # rótulo principal de la animación
Y_PIE_SUB = 0.856      # línea de apoyo


def _fuente(tam):
    """La tipografía del canal si está disponible; si no, la de Pillow.
    Nunca lanza: una animación no se cae por una fuente que falta."""
    from PIL import ImageFont
    with contextlib.suppress(Exception):
        import youtube_subir
        f = youtube_subir._fuente_tam(int(tam))
        if f is not None:
            return f
    with contextlib.suppress(Exception):
        return ImageFont.load_default(size=int(tam))
    return ImageFont.load_default()


def _texto(d, x, y, txt, tam=44, color=_TEXTO, centrado=True):
    """Escribe `txt`. Si `centrado`, `x` es el centro. Devuelve el ancho."""
    if not txt:
        return 0
    f = _fuente(tam)
    with contextlib.suppress(Exception):
        an = d.textlength(txt, font=f)
        d.text((x - an / 2 if centrado else x, y), txt, font=f, fill=color)
        return an
    return 0


def _pie(d, titulo, sub=None):
    """Rótulo inferior, común a todas las animaciones."""
    _texto(d, ANCHO / 2, ALTO * Y_PIE, (titulo or "").upper(), 58, _TEXTO)
    if sub:
        _texto(d, ANCHO / 2, ALTO * Y_PIE_SUB, sub, 38, _TENUE)


def _medidor(d, valor, ventana=None, etiqueta="TEMP", nota=None):
    """Barra vertical a la derecha con la aguja en `valor` (0..1).

    `ventana` es el tramo (a, b) de trabajo, resaltado. Esto es lo que
    convierte un dibujo bonito en una EXPLICACIÓN: se ve de un vistazo si
    el valor está dentro o fuera del rango en el que la pieza funciona.
    """
    x0, x1 = ANCHO * 0.862, ANCHO * 0.928
    y0, y1 = ALTO * 0.300, ALTO * 0.560
    alto = y1 - y0
    d.rounded_rectangle([x0, y0, x1, y1], radius=14, fill=(17, 20, 28),
                        outline=(58, 66, 84), width=3)
    if ventana:
        a, b = max(0.0, ventana[0]), min(1.0, ventana[1])
        d.rectangle([x0 + 4, y1 - alto * b, x1 - 4, y1 - alto * a],
                    fill=(20, 58, 60))
    v = max(0.0, min(1.0, float(valor)))
    if v > 0.01:
        d.rectangle([x0 + 9, y1 - alto * v, x1 - 9, y1 - 5],
                    fill=color_velocidad(v))
    d.line([(x0 - 14, y1 - alto * v), (x1 + 14, y1 - alto * v)],
           fill=_TEXTO, width=5)
    _texto(d, (x0 + x1) / 2, y0 - 58, etiqueta, 32, _TENUE)
    if ventana:
        _texto(d, (x0 + x1) / 2, y1 + 20, "WORKING", 27, _ACENTO)
        _texto(d, (x0 + x1) / 2, y1 + 54, "WINDOW", 27, _ACENTO)
    if nota:
        _texto(d, (x0 + x1) / 2, y1 + 96, nota, 25, _TENUE)


def _ciclo(fase):
    """0 → 1 → 0 suave y periódico. Sirve para cualquier magnitud que sube
    y baja (temperatura, carga, batería) sin dar un salto al cerrar el
    bucle, que es lo que hace que un clip corto se pueda repetir."""
    return 0.5 - 0.5 * math.cos(2 * math.pi * fase)


def _halo(im, capa, fuerza=0.5, radio=12):
    """Difumina `capa` y la funde sobre `im`: el brillo del canal."""
    from PIL import Image, ImageFilter
    return Image.blend(im, capa.filter(ImageFilter.GaussianBlur(radio)),
                       fuerza)


def _lienzo():
    """Fondo técnico listo para dibujar encima. (imagen, draw)."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (ANCHO, ALTO), _FONDO)
    d = ImageDraw.Draw(im)
    _fondo_tecnico(d, ANCHO, ALTO)
    return im, d


def _largos(pts):
    return [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
            for i in range(len(pts) - 1)]


def _sobre(pts, t):
    """Punto y tangente a lo largo de una polilínea, por LONGITUD DE ARCO
    normalizada (0..1). Sin esto los puntos animados corren más rápido en
    los tramos con vértices juntos y el movimiento se ve nervioso."""
    if len(pts) < 2:
        return (pts[0] if pts else (0.0, 0.0)), (1.0, 0.0)
    largos = _largos(pts)
    total = sum(largos) or 1.0
    objetivo = max(0.0, min(1.0, t)) * total
    acum = 0.0
    for i, L in enumerate(largos):
        if acum + L >= objetivo or i == len(largos) - 2:
            k = (objetivo - acum) / (L or 1.0)
            (ax, ay), (bx, by) = pts[i], pts[i + 1]
            n = math.hypot(bx - ax, by - ay) or 1.0
            return ((ax + (bx - ax) * k, ay + (by - ay) * k),
                    ((bx - ax) / n, (by - ay) / n))
        acum += L
    return pts[-1], (1.0, 0.0)


def _puntos_moviles(d, pts, fase, n=8, color=_ACENTO, radio=11, inverso=False):
    """Puntos que recorren una polilínea: así se LEE la dirección de un
    flujo (de aire, de energía) sin escribir una flecha en cada tramo."""
    for k in range(n):
        t = ((fase + k / n) % 1.0)
        if inverso:
            t = 1.0 - t
        (x, y), _ = _sobre(pts, t)
        d.ellipse([x - radio, y - radio, x + radio, y + radio], fill=color)


# ───────────────────── generador: freno de carbono ──────────────────────

def _color_disco(t):
    """Frío (gris oscuro) → rojo → naranja → amarillo incandescente.

    No llega al blanco a propósito: un disco blanco se lee como un plato de
    cerámica, y el naranja-amarillo es lo que la gente reconoce como metal
    al rojo.
    """
    paradas = [(0.00, (44, 48, 58)), (0.34, (112, 28, 14)),
               (0.60, (222, 88, 10)), (0.82, (252, 158, 26)),
               (1.00, (255, 214, 96))]
    t = max(0.0, min(1.0, t))
    for i in range(len(paradas) - 1):
        t0, c0 = paradas[i]
        t1, c1 = paradas[i + 1]
        if t <= t1:
            k = (t - t0) / ((t1 - t0) or 1)
            return tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
    return paradas[-1][1]


def fotograma_freno(fase, ventilado=True, frio=False):
    """Disco de freno de carbono que se calienta al frenar y se enfría al
    soltar.

    Lo que explica: el carbono NO frena en frío. Por eso hay un medidor con
    la ventana de trabajo, y con `frio=True` la aguja nunca llega a ella —
    se ve el problema, no hay que contarlo.
    """
    from PIL import Image, ImageDraw
    im, d = _lienzo()

    cx, cy = ANCHO * 0.44, ALTO * 0.455
    R = ANCHO * 0.285
    r_int = R * 0.42
    # Nunca llega al 1.0: el disco se pone naranja intenso, no amarillo
    # plano, que se leía como un plato y no como metal caliente.
    temp = 0.10 + 0.78 * _ciclo(fase) ** 0.9
    if frio:
        temp *= 0.32
    giro = 2 * math.pi * fase * 2          # dos vueltas por bucle
    col = _color_disco(temp)

    # Halo de calor: crece y brilla con la temperatura
    if temp > 0.04:
        capa = Image.new("RGB", (ANCHO, ALTO), (0, 0, 0))
        cd = ImageDraw.Draw(capa)
        rr = R * (1.0 + 0.11 * temp)
        cd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                   fill=tuple(int(c * (0.22 + 0.78 * temp)) for c in col))
        cd.ellipse([cx - r_int, cy - r_int, cx + r_int, cy + r_int],
                   fill=(0, 0, 0))
        im = _halo(im, capa, 0.42, 30)
        d = ImageDraw.Draw(im)

    # Corona de fricción
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=col,
              outline=(206, 216, 236), width=4)

    # Ranuras de ventilación: huecos oscuros que giran con el disco. Son lo
    # que hace que se VEA girar, porque un disco liso caliente no se mueve.
    oscuro = tuple(max(0, int(c * 0.42)) for c in col)
    if ventilado:
        for k in range(40):
            a = giro + 2 * math.pi * k / 40
            d.line([(cx + r_int * 1.03 * math.cos(a),
                     cy + r_int * 1.03 * math.sin(a)),
                    (cx + R * 0.95 * math.cos(a), cy + R * 0.95 * math.sin(a))],
                   fill=oscuro, width=7)

    # Taladros de refrigeración
    for k in range(20):
        a = giro * 1.0 + 2 * math.pi * k / 20 + 0.14
        px, py = cx + R * 0.80 * math.cos(a), cy + R * 0.80 * math.sin(a)
        d.ellipse([px - 11, py - 11, px + 11, py + 11], fill=oscuro)
    # Borde interior de la banda de fricción: separa la pista de las
    # pastillas de la campana, que si no el disco parece una moneda lisa.
    rf = R * 0.66
    d.ellipse([cx - rf, cy - rf, cx + rf, cy + rf], outline=oscuro, width=6)

    # Campana y buje
    d.ellipse([cx - r_int, cy - r_int, cx + r_int, cy + r_int],
              fill=(24, 28, 37), outline=(132, 144, 168), width=4)
    for k in range(6):
        a = giro + 2 * math.pi * k / 6
        px, py = cx + r_int * 0.56 * math.cos(a), cy + r_int * 0.56 * math.sin(a)
        d.ellipse([px - 14, py - 14, px + 14, py + 14], fill=(88, 98, 118))

    # Pinza a las 12: abraza el borde del disco, con la pastilla a la vista
    pw, py0, py1 = 108, cy - R - 38, cy - R * 0.34
    d.rounded_rectangle([cx - pw, py0, cx + pw, py1], radius=26,
                        fill=(42, 48, 62), outline=(162, 174, 196), width=5)
    d.rounded_rectangle([cx - pw * 0.66, py1 - 76, cx + pw * 0.66, py1 - 14],
                        radius=10, fill=(104, 70, 54))
    d.line([(cx - pw, py0 + 52), (cx + pw, py0 + 52)],
           fill=(96, 106, 128), width=4)
    _texto(d, cx, py0 - 46, "CALIPER", 34, _TENUE)

    # Aire de refrigeración entrando por el buje y saliendo por el borde
    if ventilado:
        for k in range(10):
            a = 2 * math.pi * k / 10 + 0.3
            t = (fase * 2 + k / 10) % 1.0
            r0 = r_int + (R - r_int) * t
            r1 = min(R * 1.02, r0 + (R - r_int) * 0.16)
            d.line([(cx + r0 * math.cos(a), cy + r0 * math.sin(a)),
                    (cx + r1 * math.cos(a), cy + r1 * math.sin(a))],
                   fill=_ACENTO, width=5)

    _medidor(d, temp, ventana=(0.42, 0.94), etiqueta="DISC TEMP",
             nota="≈400-1000 °C")
    if frio:
        _pie(d, "Cold carbon brakes", "Out of the window they barely bite")
    else:
        _pie(d, "Carbon brake disc", "Heat is what makes carbon grip")
    return im


# ───────────────────────── generador: neumático ─────────────────────────

def fotograma_neumatico(fase, mojado=False, desgastado=False):
    """Neumático rodando, visto de lado: huella de contacto, calor y dibujo.

    Lo que explica: la goma solo agarra dentro de su ventana de temperatura,
    el calor entra por la HUELLA (por eso el anillo está más caliente justo
    después de tocar el suelo) y el dibujo del mojado existe para sacar agua.
    """
    from PIL import Image, ImageDraw
    im, d = _lienzo()

    cx, cy = ANCHO * 0.44, ALTO * 0.445
    R = ANCHO * 0.285
    aplast = R * 0.115                    # la huella aplana la parte de abajo
    y_suelo = cy + R - aplast
    giro = 2 * math.pi * fase             # una vuelta por bucle
    temp = 0.30 + 0.62 * _ciclo(fase) ** 0.7
    if desgastado:
        temp = min(1.0, temp + 0.18)      # gastado = sobrecalentado
    if mojado:
        temp *= 0.74                      # con agua nunca entra del todo en ventana

    # Asfalto (con película de agua si es de lluvia)
    d.rectangle([0, y_suelo, ANCHO, ALTO], fill=(13, 15, 21))
    d.line([(0, y_suelo), (ANCHO, y_suelo)], fill=(70, 78, 98), width=5)
    if mojado:
        d.rectangle([0, y_suelo, ANCHO, y_suelo + 16], fill=(26, 52, 78))
    # Marcas del asfalto corriendo hacia atrás: se lee que el coche avanza
    for k in range(9):
        x = (ANCHO * 1.2 * ((fase * 1.6 + k / 9) % 1.0)) - ANCHO * 0.1
        d.line([(x, y_suelo + 46), (x - 70, y_suelo + 46)],
               fill=(38, 44, 58), width=6)

    def borde(ang):
        """Radio del neumático en `ang`, con el ensanchamiento del flanco
        junto a la huella (la carcasa se abomba donde apoya)."""
        da = abs((ang - math.pi / 2 + math.pi) % (2 * math.pi) - math.pi)
        return R * (1.0 + 0.055 * math.exp(-(da / 0.6) ** 2))

    def punto(ang, k=1.0):
        r = borde(ang) * k
        return cx + r * math.cos(ang), min(cy + r * math.sin(ang), y_suelo)

    # Carcasa: goma negra de verdad, no un aro de colores
    contorno = [punto(2 * math.pi * i / 220) for i in range(221)]
    d.polygon(contorno, fill=(31, 35, 45), outline=(126, 138, 162))

    # Banda de rodadura coloreada por CALOR. El calor entra por la huella y
    # se va disipando según el sector se aleja girando, así que el patrón es
    # fijo respecto al suelo (que es lo correcto) mientras el dibujo gira.
    # El color se MEZCLA con la goma: en frío se ve negro y solo brilla la
    # parte caliente. Un aro entero de color no explicaría nada.
    # El de lluvia trabaja frío, así que si se pinta con la misma goma casi
    # negra desaparece sobre el fondo: se le sube el gris de base para que
    # las ranuras se sigan viendo.
    goma = (44, 50, 62) if mojado else (26, 29, 37)
    grueso = 0.84 if desgastado else 0.875
    for i in range(140):
        a0 = 2 * math.pi * i / 140
        a1 = 2 * math.pi * (i + 1) / 140
        phi = (a0 - math.pi / 2) % (2 * math.pi)
        calor = temp * (0.22 + 0.78 * math.exp(-phi / 2.0))
        k = max(0.0, min(1.0, calor)) ** 0.9
        c = tuple(int(goma[j] + (color_velocidad(calor)[j] - goma[j]) * k)
                  for j in range(3))
        p0, p1 = punto(a0), punto(a1)
        p2, p3 = punto(a1, grueso), punto(a0, grueso)
        d.polygon([p0, p1, p2, p3], fill=c)

    if mojado:
        # El de lluvia va RANURADO: canales que giran con la rueda y sacan
        # el agua. Es toda la diferencia con el slick.
        for k in range(24):
            a = giro + 2 * math.pi * k / 24
            d.line([punto(a), punto(a, grueso)], fill=(12, 14, 19), width=11)
        for k in range(3):
            aro = [punto(2 * math.pi * i / 180, 0.895 + k * 0.032)
                   for i in range(181)]
            d.line(aro, fill=(12, 14, 19), width=8)
    else:
        # El slick es LISO. No se le pintan tacos: el giro se lee en los
        # radios de la llanta y en la marca de equilibrado del flanco.
        for k in range(3):
            a = giro + 2 * math.pi * k / 3
            p0, p1 = punto(a, 0.80), punto(a, 0.845)
            d.line([p0, p1], fill=(196, 206, 226), width=7)
    if desgastado:
        # Granulado: la goma se arranca a trozos y deja calvas
        for k in range(38):
            a = giro * 0.5 + 2 * math.pi * k / 38
            px, py = punto(a, 0.925)
            d.ellipse([px - 8, py - 8, px + 8, py + 8], fill=(58, 44, 36))

    # Llanta
    r_llanta = R * 0.60
    d.ellipse([cx - r_llanta, cy - r_llanta, cx + r_llanta, cy + r_llanta],
              fill=(24, 28, 37), outline=(140, 152, 176), width=4)
    for k in range(10):
        a = giro + 2 * math.pi * k / 10
        d.line([(cx + r_llanta * 0.22 * math.cos(a),
                 cy + r_llanta * 0.22 * math.sin(a)),
                (cx + r_llanta * 0.92 * math.cos(a),
                 cy + r_llanta * 0.92 * math.sin(a))],
               fill=(74, 84, 104), width=8)

    # Agua expulsada hacia atrás por las ranuras: sale de la huella y se
    # abre en abanico, que es lo que se ve de verdad detrás de un coche
    # bajo la lluvia.
    if mojado:
        capa = Image.new("RGB", (ANCHO, ALTO), (0, 0, 0))
        cd = ImageDraw.Draw(capa)
        for k in range(34):
            t = (fase * 2.2 + k / 34) % 1.0
            # dispersión pseudo-aleatoria pero estable: sin esto los puntos
            # salen alineados y parecen un error, no agua
            abre = 0.5 + 0.5 * math.sin(k * 2.399)
            x = cx - 30 - t * R * 1.25 - abre * 40
            y = y_suelo - t * t * (R * 0.30 + abre * R * 0.62)
            r = 6 + int(t * 13)
            cd.ellipse([x - r, y - r, x + r, y + r],
                       fill=(int(90 + 70 * (1 - t)), int(150 + 60 * (1 - t)),
                             int(205 + 40 * (1 - t))))
        im = _halo(im, capa, 0.6, 9)
        d = ImageDraw.Draw(im)

    # La huella, señalada
    hw = R * 0.30
    d.line([(cx - hw, y_suelo + 26), (cx + hw, y_suelo + 26)],
           fill=_ACENTO, width=5)
    d.line([(cx - hw, y_suelo + 14), (cx - hw, y_suelo + 38)],
           fill=_ACENTO, width=5)
    d.line([(cx + hw, y_suelo + 14), (cx + hw, y_suelo + 38)],
           fill=_ACENTO, width=5)
    _texto(d, cx, y_suelo + 52, "CONTACT PATCH", 36, _ACENTO)

    _medidor(d, temp, ventana=(0.45, 0.86), etiqueta="TYRE TEMP")
    if mojado:
        _pie(d, "Full wet tyre", "The grooves exist to throw water out")
    elif desgastado:
        _pie(d, "Worn tyre", "Less rubber, more heat, less grip")
    else:
        _pie(d, "Slick tyre", "All rubber, and only for a dry track")
    return im


# ──────────────────── generador: unidad de potencia ─────────────────────

def _caja(d, x, y, w, h, titulo, color=(30, 35, 46), borde=(150, 162, 186),
          tam=38, dy=0):
    """Caja de esquema con su rótulo. `dy` sube o baja el texto dentro de la
    caja, para dejar sitio a una barra debajo."""
    d.rounded_rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2],
                        radius=16, fill=color, outline=borde, width=4)
    _texto(d, x, y - tam * 0.62 + dy, titulo, tam, _TEXTO)
    return (x, y)


def fotograma_ers(fase, desplegando=True):
    """Flujo de energía del híbrido: batería, MGU-K, MGU-H y eje trasero.

    Lo que explica: el motor eléctrico no da potencia "gratis". O la sacas
    de la batería (deploy) o la metes en la batería frenando (harvest), y
    la barra de carga se vacía o se llena delante de quien lo mira.
    """
    from PIL import Image, ImageDraw
    im, d = _lienzo()

    cxa = ANCHO * 0.44
    y_eje, y_mgu, y_ice, y_bat = (ALTO * 0.245, ALTO * 0.375,
                                  ALTO * 0.500, ALTO * 0.655)
    x_k, x_h = cxa - 150, cxa + 190

    # Cajas del esquema
    _caja(d, cxa, y_eje, 560, 112, "REAR AXLE", (34, 40, 52))
    _caja(d, x_k, y_mgu, 260, 112, "MGU-K", (30, 35, 46))
    _caja(d, x_h, y_mgu, 268, 112, "MGU-H", (30, 35, 46))
    _caja(d, cxa, y_ice, 460, 120, "ICE  V6", (28, 33, 44))
    _caja(d, cxa, y_bat, 560, 176, "BATTERY", (26, 31, 42), dy=-40)

    # Barra de carga dentro de la batería, DEBAJO del rótulo
    carga = _ciclo(fase) if not desplegando else 1.0 - _ciclo(fase)
    bx0, bx1 = cxa - 248, cxa + 248
    by = y_bat + 40
    d.rounded_rectangle([bx0, by - 28, bx1, by + 28], radius=13,
                        fill=(15, 18, 25), outline=(70, 80, 100), width=3)
    if carga > 0.02:
        d.rounded_rectangle([bx0 + 5, by - 23,
                             bx0 + 5 + (bx1 - bx0 - 10) * carga, by + 23],
                            radius=10, fill=color_velocidad(0.25 + carga * 0.5))

    # Caminos de energía. El de MGU-H → batería siempre carga (recupera del
    # escape); el de batería ↔ MGU-K ↔ eje cambia de sentido.
    # El corredor de la batería rodea el motor POR FUERA: si lo cruzase por
    # dentro parecería que la energía eléctrica pasa por el V6, que es
    # justo lo que la animación tiene que dejar claro que NO ocurre.
    x_cor = 132
    via_k = [(cxa - 280, y_bat), (x_cor, y_bat), (x_cor, y_mgu),
             (x_k - 130, y_mgu)]
    via_eje = [(x_k, y_mgu - 56), (x_k, y_eje + 56)]
    via_ice = [(cxa, y_ice - 60), (cxa, y_mgu + 30), (x_k + 130, y_mgu + 30),
               (x_k + 130, y_mgu)]
    via_h = [(cxa + 230, y_ice - 40), (x_h, y_ice - 40), (x_h, y_mgu + 56)]
    via_h2 = [(x_h + 134, y_mgu), (ANCHO * 0.80, y_mgu),
              (ANCHO * 0.80, y_bat), (cxa + 280, y_bat)]
    color_k = _AVISO if desplegando else _ACENTO
    for via in (via_k, via_eje, via_ice, via_h, via_h2):
        d.line(via, fill=(46, 53, 68), width=14, joint="curve")
    # El motor mueve el eje SIEMPRE, en gris: no es energía recuperada
    _puntos_moviles(d, via_ice, fase, 4, (120, 132, 156), 8)
    capa = Image.new("RGB", (ANCHO, ALTO), (0, 0, 0))
    cd = ImageDraw.Draw(capa)
    for via in (via_k, via_eje):
        _puntos_moviles(cd, via, fase, 5, color_k, 13,
                        inverso=not desplegando)
    for via in (via_h, via_h2):
        _puntos_moviles(cd, via, fase, 4, _ACENTO, 11)
    im = _halo(im, capa, 0.55, 9)
    d = ImageDraw.Draw(im)
    for via in (via_k, via_eje):
        _puntos_moviles(d, via, fase, 5, color_k, 9,
                        inverso=not desplegando)
    for via in (via_h, via_h2):
        _puntos_moviles(d, via, fase, 4, _ACENTO, 8)

    _medidor(d, carga, etiqueta="CHARGE")
    if desplegando:
        _pie(d, "Deploy", "The battery pushes the rear axle")
    else:
        _pie(d, "Harvest", "Braking puts energy back in the battery")
    return im


# ───────────────── generador: transferencia de carga ────────────────────

# Silueta lateral de un monoplaza GENÉRICO (sin marcas ni números), en
# coordenadas locales: x hacia delante, y hacia arriba, origen a la altura
# del eje de las ruedas. Se dibuja rotada para que el coche se hunda de
# morro al frenar y se siente atrás al acelerar.
_PERFIL_LATERAL = [
    (-520, -66), (-520, -30), (-430, -22), (-370, 10), (-250, 22),
    (-150, 40), (-70, 96), (10, 118), (60, 120), (78, 62), (150, 52),
    (300, 56), (400, 48), (470, 44), (500, 150), (520, 152), (520, 92),
    (505, 88), (500, 30), (450, -30), (330, -46), (-330, -46), (-430, -60),
]
# Y la misma silueta vista DESDE ATRÁS, para la animación de curva: desde
# ahí se ven los dos neumáticos de canto (no como círculos) y el alerón
# trasero por encima, que es lo que hace que se lea como una vista trasera
# y no como un lateral aplastado.
_PERFIL_TRASERO = [
    (-268, -46), (-268, -6), (-196, 16), (-120, 30), (-92, 66), (-62, 128),
    (-30, 156), (30, 156), (62, 128), (92, 66), (120, 30), (196, 16),
    (268, -6), (268, -46),
]


def _rotar(pts, ang, pivote=(0.0, 40.0)):
    ca, sa = math.cos(ang), math.sin(ang)
    px, py = pivote
    return [((x - px) * ca - (y - py) * sa + px,
             (x - px) * sa + (y - py) * ca + py) for x, y in pts]


def _a_mundo(pts, ox, oy, esc):
    """Local (y hacia arriba) → pantalla (y hacia abajo)."""
    return [(ox + x * esc, oy - y * esc) for x, y in pts]


def fotograma_carga(fase, maniobra="brake"):
    """Cómo se reparte el peso entre los neumáticos al frenar, acelerar o
    girar. Las barras bajo cada rueda son la carga: crecen y menguan.

    Lo que explica: los neumáticos agarran según lo que los aplaste. Por eso
    se frena fuerte al principio (el morro va cargado) y se suelta al girar.
    """
    im, d = _lienzo()
    esc = ANCHO * 0.00092
    y_suelo = ALTO * 0.575
    r_rueda = 118 * esc * 1.0
    g = _ciclo(fase)

    d.rectangle([0, y_suelo, ANCHO, ALTO], fill=(13, 15, 21))
    d.line([(0, y_suelo), (ANCHO, y_suelo)], fill=(70, 78, 98), width=5)

    ox = ANCHO * 0.46
    oy = y_suelo - r_rueda                 # altura del eje de las ruedas

    trasera = maniobra == "corner"
    if trasera:
        perfil, angulo = _PERFIL_TRASERO, -0.105 * g
        ejes = (-360, 360)
        titulo = "Cornering"
        sub = "Load moves to the outside tyres"
        cargas = (0.5 - 0.30 * g, 0.5 + 0.30 * g)
        nombres = ("INSIDE", "OUTSIDE")
    else:
        perfil = _PERFIL_LATERAL
        ejes = (-330, 330)
        if maniobra == "accel":
            angulo = -0.055 * g            # se sienta atrás
            titulo, sub = "Acceleration", "Load moves onto the rear tyres"
            cargas = (0.5 - 0.26 * g, 0.5 + 0.26 * g)
        else:
            angulo = 0.055 * g             # se hunde de morro
            titulo, sub = "Braking", "Load moves onto the front tyres"
            cargas = (0.5 + 0.30 * g, 0.5 - 0.30 * g)
        nombres = ("FRONT", "REAR")

    # Ruedas. Desde atrás se ve el ANCHO del neumático (un rectángulo), no
    # el círculo del lateral; y la de fuera se aplasta con la carga.
    if trasera:
        for ex, carga in zip(ejes, cargas):
            wx = ox + ex * esc
            hw, hh = 62 * esc * 1.6, r_rueda
            hunde = (carga - 0.5) * 40 * esc
            d.rounded_rectangle([wx - hw, oy - hh + hunde, wx + hw, oy + hh],
                                radius=int(22 * esc * 1.6),
                                fill=(20, 22, 29), outline=(120, 130, 152),
                                width=5)
            for k in range(2):
                yy = oy - hh + hunde + (2 * hh - hunde) * (k + 1) / 3
                d.line([(wx - hw + 8, yy), (wx + hw - 8, yy)],
                       fill=(44, 50, 62), width=4)
    else:
        for ex in ejes:
            wx = ox + ex * esc
            d.ellipse([wx - r_rueda, oy - r_rueda, wx + r_rueda, oy + r_rueda],
                      fill=(20, 22, 29), outline=(110, 120, 142), width=5)
            rr = r_rueda * 0.52
            d.ellipse([wx - rr, oy - rr, wx + rr, oy + rr],
                      fill=(30, 35, 46), outline=(130, 142, 166), width=3)

    # Carrocería, inclinada
    cuerpo = _a_mundo(_rotar(perfil, angulo), ox, oy, esc)
    d.polygon(cuerpo, fill=(32, 37, 49), outline=(178, 190, 212))
    if trasera:
        # Alerón trasero: rueda con la carrocería, y es lo que remata la
        # lectura de "esto es el coche visto por detrás".
        ala = _a_mundo(_rotar([(-225, 198), (225, 198), (225, 250),
                               (-225, 250)], angulo), ox, oy, esc)
        d.polygon(ala, fill=(38, 44, 57), outline=(186, 198, 220))
        for sx in (-150, 150):
            d.line(_a_mundo(_rotar([(sx, 146), (sx, 198)], angulo),
                            ox, oy, esc), fill=(150, 162, 186), width=6)
        # Fondo plano entre las ruedas: sin él la carrocería flota
        d.line(_a_mundo(_rotar([(-268, -34), (268, -34)], angulo),
                        ox, oy, esc), fill=(120, 132, 156), width=7)

    # Barras de carga bajo cada rueda
    # La barra llena la caja cuando la rueda lleva el 80% de la carga; sin
    # este tope, en la punta de la frenada se salía del marco.
    caja_h = 250
    for (ex, carga, nombre) in zip(ejes, cargas, nombres):
        wx = ox + ex * esc
        alto = caja_h * max(0.05, min(1.0, carga * 1.25))
        d.rectangle([wx - 46, y_suelo + 30, wx + 46, y_suelo + 30 + caja_h],
                    outline=(52, 60, 76), width=3)
        d.rectangle([wx - 42, y_suelo + 30 + (caja_h - alto), wx + 42,
                     y_suelo + 26 + caja_h],
                    fill=color_velocidad(min(1.0, carga * 1.35)))
        _texto(d, wx, y_suelo + caja_h + 46, nombre, 34, _TENUE)

    # Flecha de la maniobra
    if maniobra == "corner":
        _texto(d, ANCHO * 0.5, ALTO * 0.685, "← CORNER FORCE", 40, _ACENTO)
    else:
        flecha = "◀ BRAKING" if maniobra != "accel" else "ACCELERATING ▶"
        _texto(d, ANCHO * 0.5, ALTO * 0.685, flecha, 40, _ACENTO)

    _pie(d, titulo, sub)
    return im


# ─────────────────────── generador: trazada ideal ───────────────────────

def _eje_curva():
    """Polilínea del eje de una curva de 90°: el coche sube por la recta de
    entrada, gira a la derecha y sale hacia el lado derecho de la pantalla.

    (En pantalla la y crece hacia ABAJO, así que el arco va de π a 3π/2 para
    que suba; con π a π/2 bajaría, que es justo lo contrario.)
    """
    pts = []
    x_ent, y_ini, y_arco = ANCHO * 0.255, ALTO * 0.720, ALTO * 0.600
    R = ANCHO * 0.245
    ccx, ccy = x_ent + R, y_arco
    for i in range(11):                    # recta de entrada, subiendo
        pts.append((x_ent, y_ini - (y_ini - y_arco) * i / 10))
    for i in range(1, 37):                 # arco de 90° hacia arriba-derecha
        a = math.pi + (math.pi / 2) * i / 36
        pts.append((ccx + R * math.cos(a), ccy + R * math.sin(a)))
    for i in range(1, 15):                 # recta de salida, hacia la derecha
        pts.append((ccx + (ANCHO * 0.88 - ccx) * i / 14, ccy - R))
    return pts


def _normales(pts):
    """Normal unitaria a la DERECHA del avance en cada punto (en pantalla,
    con la y hacia abajo, es rotar la tangente +90°)."""
    ns = []
    for i in range(len(pts)):
        a = pts[max(0, i - 1)]
        b = pts[min(len(pts) - 1, i + 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        n = math.hypot(tx, ty) or 1.0
        ns.append((-ty / n, tx / n))
    return ns


def fotograma_trazada(fase, mala=False):
    """La trazada: ancho-dentro-ancho, con el punto de frenada y el ápice.

    Lo que explica: la trazada no es "ir por el medio". Se entra por fuera
    para abrir el radio, se roza el ápice y se sale otra vez a fuera. Con
    `mala=True` aparece además el coche que gira antes de tiempo y se abre
    en la salida, y se ve cómo pierde terreno.
    """
    im, d = _lienzo()
    eje = _eje_curva()
    nor = _normales(eje)
    ancho = ANCHO * 0.155
    m = ancho / 2 - 16

    # Asfalto
    izq = [(p[0] - n[0] * ancho / 2, p[1] - n[1] * ancho / 2)
           for p, n in zip(eje, nor)]
    der = [(p[0] + n[0] * ancho / 2, p[1] + n[1] * ancho / 2)
           for p, n in zip(eje, nor)]
    # Cuadrilátero por tramo, NO un polígono único: una cinta en L es
    # cóncava y al rellenarla de una sola pieza se tapaba el interior de la
    # curva con un rectángulo.
    for i in range(len(eje) - 1):
        d.polygon([izq[i], izq[i + 1], der[i + 1], der[i]], fill=(26, 29, 38))
    d.line(izq, fill=(96, 106, 128), width=5, joint="curve")
    d.line(der, fill=(96, 106, 128), width=5, joint="curve")

    def linea(apice, sigma, deriva=0.0):
        """Trazada como desvío del eje: fuera (−) en rectas, dentro (+) en
        el ápice. `deriva` abre la salida (el error de girar pronto)."""
        out = []
        n_p = len(eje)
        for i, (p, n) in enumerate(zip(eje, nor)):
            s = i / (n_p - 1)
            o = m * (2 * math.exp(-((s - apice) / sigma) ** 2) - 1)
            if deriva:
                o -= deriva * m * max(0.0, s - apice - 0.12) * 3.2
            o = max(-m * 1.32, min(m, o))
            out.append((p[0] + n[0] * o, p[1] + n[1] * o))
        return out

    buena = linea(0.50, 0.17)
    peor = linea(0.34, 0.13, deriva=1.0) if mala else None

    def perfil_v(s, apice, hondo):
        return 1.0 - hondo * math.exp(-((s - apice) / 0.23) ** 2)

    def avance(fase_, apice, hondo, ritmo=1.0):
        """Posición 0..1 integrando la velocidad: el coche frena de verdad
        al llegar a la curva en vez de ir a ritmo constante."""
        n = 120
        vs = [perfil_v(i / n, apice, hondo) for i in range(n + 1)]
        tot = sum(vs) or 1.0
        objetivo = fase_ * tot * ritmo
        acum = 0.0
        for i, v in enumerate(vs):
            acum += v
            if acum >= objetivo:
                return i / n
        return min(1.0, acum / tot * ritmo)

    # Marcas de referencia
    (bx, by), _ = _sobre(eje, 0.17)
    nb = nor[int(0.17 * (len(eje) - 1))]
    d.line([(bx - nb[0] * ancho / 2, by - nb[1] * ancho / 2),
            (bx + nb[0] * ancho / 2, by + nb[1] * ancho / 2)],
           fill=_AVISO, width=9)
    _texto(d, bx - ancho * 0.5 - 92, by - 26, "BRAKE", 38, _AVISO)

    for pts, col, grosor in ((peor, (198, 78, 62), 7),
                             (buena, (240, 246, 255), 9)):
        if pts:
            d.line(pts, fill=col, width=grosor)

    (ax, ay), _ = _sobre(buena, 0.50)
    d.ellipse([ax - 28, ay - 28, ax + 28, ay + 28], outline=_ACENTO, width=6)
    _texto(d, ax - 132, ay - 96, "APEX", 38, _ACENTO)

    # Los coches
    def coche(pts, s, color, apice, hondo):
        (x, y), (tx, ty) = _sobre(pts, s)
        v = perfil_v(s, apice, hondo)
        d.ellipse([x - 19, y - 19, x + 19, y + 19],
                  fill=color_velocidad(max(0.0, min(1.0, v))),
                  outline=color, width=4)
        return x, y

    s_b = avance(fase, 0.50, 0.62)
    coche(buena, s_b, (255, 255, 255), 0.50, 0.62)
    if peor:
        s_p = avance(fase, 0.34, 0.80, ritmo=0.86)
        coche(peor, s_p, (190, 120, 120), 0.34, 0.80)
        _pie(d, "Early apex", "Turn in too soon and the exit is ruined")
    else:
        _pie(d, "The racing line", "Wide in, clip the apex, wide out")
    return im


# ──────────────────── generador: degradación y parada ───────────────────

def fotograma_degradacion(fase, parada_temprana=False):
    """Dos compuestos: el blando es más rápido al principio y se cae; el
    duro es más lento pero aguanta. Donde se cruzan está la ventana de pit.

    No lleva números: es un ESQUEMA del concepto, no la telemetría de una
    carrera concreta. Los datos reales del canal salen siempre de la API.
    """
    im, d = _lienzo()
    x0, x1 = ANCHO * 0.115, ANCHO * 0.885
    y0, y1 = ALTO * 0.320, ALTO * 0.640
    d.rectangle([x0, y0, x1, y1], outline=(52, 60, 76), width=3)
    for k in range(1, 5):
        d.line([(x0, y0 + (y1 - y0) * k / 5), (x1, y0 + (y1 - y0) * k / 5)],
               fill=(28, 33, 43), width=2)

    # Curvas (tiempo por vuelta: hacia ARRIBA = más lento)
    # Ajustado para que el cruce caiga a media tabla y se VEA dentro del
    # gráfico; pegado al borde derecho no se entendía que había cruce.
    dur_blando = 1.35 if parada_temprana else 0.80
    def blando(u):
        return 0.12 + dur_blando * u ** 1.9
    def duro(u):
        return 0.42 + 0.16 * u

    # OJO con el sentido: "más lento" es ARRIBA, así que un tiempo por
    # vuelta mayor tiene que alejarse de y1 (el suelo del gráfico).
    n = 90
    def _y(v):
        return y1 - (y1 - y0) * max(0.0, min(1.0, v))
    pts_b = [(x0 + (x1 - x0) * i / n, _y(blando(i / n))) for i in range(n + 1)]
    pts_d = [(x0 + (x1 - x0) * i / n, _y(duro(i / n))) for i in range(n + 1)]
    d.line(pts_d, fill=(228, 236, 250), width=8)
    d.line(pts_b, fill=(235, 45, 20), width=8)
    # Rótulos pegados a su curva, en la primera mitad: al final las dos se
    # juntan y ahí no se distinguiría cuál es cuál.
    i_s, i_d = int(n * 0.22), int(n * 0.30)
    _texto(d, pts_b[i_s][0], pts_b[i_s][1] + 26, "SOFT", 40, (235, 45, 20))
    _texto(d, pts_d[i_d][0], pts_d[i_d][1] - 68, "HARD", 40, (228, 236, 250))

    # Cruce: donde el blando pasa a ser más lento que el duro
    cruce = next((i / n for i in range(n + 1)
                  if blando(i / n) >= duro(i / n)), None)
    if cruce is not None:
        xc = x0 + (x1 - x0) * cruce
        pulso = 0.35 + 0.65 * _ciclo(fase)
        d.rectangle([xc - 26, y0, xc + 26, y1],
                    fill=(int(20 + 26 * pulso), int(52 + 30 * pulso),
                          int(56 + 30 * pulso)))
        d.line([(xc, y0), (xc, y1)], fill=_ACENTO, width=5)
        _texto(d, max(x0 + 150, min(x1 - 150, xc)), y0 - 62,
               "PIT WINDOW", 40, _ACENTO)

    # Barrido: los dos puntos avanzan vuelta a vuelta y se ve el cruce
    u = fase
    for pts, col in ((pts_b, (235, 45, 20)), (pts_d, (228, 236, 250))):
        px, py = pts[int(u * n)]
        d.ellipse([px - 15, py - 15, px + 15, py + 15], fill=col,
                  outline=(12, 14, 20), width=3)
    d.line([(x0 + (x1 - x0) * u, y0), (x0 + (x1 - x0) * u, y1)],
           fill=(70, 80, 100), width=3)

    _texto(d, x0 + 8, y0 - 58, "SLOWER ↑", 32, _TENUE, centrado=False)
    _texto(d, x1 - 130, y1 + 18, "LAPS →", 32, _TENUE, centrado=False)
    if parada_temprana:
        _pie(d, "Tyre degradation", "Softs fall away sooner: stop earlier")
    else:
        _pie(d, "Tyre degradation", "Where the lines cross is the pit window")
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


async def clip_freno(ventilado=True, frio=False, dur=DUR):
    return await _clip("freno", fotograma_freno,
                       {"ventilado": bool(ventilado), "frio": bool(frio)}, dur)


async def clip_neumatico(mojado=False, desgastado=False, dur=DUR):
    return await _clip("neumatico", fotograma_neumatico,
                       {"mojado": bool(mojado),
                        "desgastado": bool(desgastado)}, dur)


async def clip_ers(desplegando=True, dur=DUR):
    return await _clip("ers", fotograma_ers,
                       {"desplegando": bool(desplegando)}, dur)


async def clip_carga(maniobra="brake", dur=DUR):
    m = maniobra if maniobra in ("brake", "accel", "corner") else "brake"
    return await _clip("carga", fotograma_carga, {"maniobra": m}, dur)


async def clip_trazada(mala=False, dur=DUR):
    return await _clip("trazada", fotograma_trazada, {"mala": bool(mala)}, dur)


async def clip_degradacion(parada_temprana=False, dur=DUR):
    return await _clip("degradacion", fotograma_degradacion,
                       {"parada_temprana": bool(parada_temprana)}, dur)


# Catálogo: alias → (nombre interno, generador, parámetros). El selector de
# main.py trabaja sobre esto, así que añadir una animación nueva es añadir
# UNA línea aquí y otra en la tabla de temas — el pipeline no se toca.
CATALOGO = {
    "aero_ala":        ("flujo", fotograma_flujo,
                        {"drs": False, "suelo": False}),
    "aero_suelo":      ("flujo", fotograma_flujo,
                        {"drs": False, "suelo": True}),
    "aero_drs_on":     ("flujo", fotograma_flujo,
                        {"drs": True, "suelo": True}),
    "freno_caliente":  ("freno", fotograma_freno,
                        {"ventilado": True, "frio": False}),
    "freno_frio":      ("freno", fotograma_freno,
                        {"ventilado": True, "frio": True}),
    "neum_slick":      ("neumatico", fotograma_neumatico,
                        {"mojado": False, "desgastado": False}),
    "neum_mojado":     ("neumatico", fotograma_neumatico,
                        {"mojado": True, "desgastado": False}),
    "neum_gastado":    ("neumatico", fotograma_neumatico,
                        {"mojado": False, "desgastado": True}),
    "ers_deploy":      ("ers", fotograma_ers, {"desplegando": True}),
    "ers_harvest":     ("ers", fotograma_ers, {"desplegando": False}),
    "carga_frenada":   ("carga", fotograma_carga, {"maniobra": "brake"}),
    "carga_acelera":   ("carga", fotograma_carga, {"maniobra": "accel"}),
    "carga_curva":     ("carga", fotograma_carga, {"maniobra": "corner"}),
    "trazada":         ("trazada", fotograma_trazada, {"mala": False}),
    "trazada_mala":    ("trazada", fotograma_trazada, {"mala": True}),
    "degradacion":     ("degradacion", fotograma_degradacion,
                        {"parada_temprana": False}),
    "degradacion_pit": ("degradacion", fotograma_degradacion,
                        {"parada_temprana": True}),
}


def ruta_cacheada(alias, dur=DUR):
    """Ruta del MP4 si YA está generado, o None.

    Sirve para que un short no se quede parado generando media biblioteca:
    quien llama puede usar lo que ya existe y limitar cuántas piezas nuevas
    dibuja en un mismo ciclo.
    """
    entrada = CATALOGO.get(alias)
    if not entrada:
        return None
    nombre, _fn, params = entrada
    ruta = os.path.join(DIR_CACHE, _clave(nombre, params, dur))
    if os.path.exists(ruta) and os.path.getsize(ruta) > 0:
        return ruta
    return None


async def clip(alias, dur=DUR):
    """Genera por alias del catálogo. None si no existe o si falla."""
    entrada = CATALOGO.get(alias)
    if not entrada:
        return None
    nombre, fn, params = entrada
    return await _clip(nombre, fn, params, dur)


# Vista previa rápida en GIF (para revisar el estilo sin ffmpeg)
def previsualizar(fn_fotograma, params, salida_gif, n=30, escala=0.25):
    frames = [fn_fotograma(i / n, **params) for i in range(n)]
    chicos = [f.resize((int(ANCHO * escala), int(ALTO * escala)))
              for f in frames]
    chicos[0].save(salida_gif, save_all=True, append_images=chicos[1:],
                   duration=int(1000 / FPS), loop=0, optimize=True)
    return salida_gif

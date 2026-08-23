"""diagramas.py — Diagramas explicativos para los shorts técnicos.

Un short técnico ilustrado con fotos de archivo es una voz hablando sobre
imágenes que no explican nada. Esto dibuja lo que la voz está diciendo:
si el guion compara dos alturas de alerón, sale la comparación; si habla
de cómo cae el neumático, sale la curva con su punto marcado.

Todo el TEXTO que se dibuja va en INGLÉS. El canal publica solo en
inglés, y estas imágenes son contenido, no notas internas.

Se dibuja con Pillow y nada más. matplotlib solo sirve para las gráficas
de telemetría, y meter un motor de SVG añadiría una dependencia que en
Replit se rompe cada vez que cambia el contenedor.

Las plantillas son PARAMÉTRICAS a propósito: el guionista elige una y
rellena sus huecos, en vez de inventarse un dibujo entero. Un modelo
generando SVG libre produce cada vez una cosa distinta, y en un canal
que publica solo nadie va a revisar cada imagen antes de que salga.
"""

import logging
import math
import os

log = logging.getLogger("diagramas")

# Vertical para shorts; horizontal para VODs y documentales
VERT = (1080, 1920)
HORIZ = (1280, 720)

# La paleta del canal
FONDO = "#0A0C11"
PANEL = "#12161F"
LINEA = "#232B37"
TINTA = "#F2F4F8"
APAGADO = "#8892A3"
TENUE = "#5A6473"
ACENTO = "#FF2D16"
FRIO = "#2FC4E0"
CALIDO = "#FF8000"
VERDE = "#31D97A"

_FUENTES_BOLD = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
]
_FUENTES_NORMAL = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]
_cache_fuente = {}


def _fuente(tam, negrita=True):
    """Una fuente del sistema al tamaño pedido, o la de Pillow si no hay.

    La de Pillow es diminuta y fija, así que un diagrama con ella queda
    ilegible — pero es mejor que reventar: quien llama comprueba el
    resultado y, si no hay tipografía decente, no publica el diagrama.
    """
    clave = (tam, negrita)
    if clave in _cache_fuente:
        return _cache_fuente[clave]
    from PIL import ImageFont
    for ruta in (_FUENTES_BOLD if negrita else _FUENTES_NORMAL):
        if os.path.exists(ruta):
            try:
                f = ImageFont.truetype(ruta, size=tam)
                _cache_fuente[clave] = f
                return f
            except Exception:
                continue
    _cache_fuente[clave] = ImageFont.load_default()
    return _cache_fuente[clave]


def hay_tipografia():
    """False si no hay ninguna fuente real: sin ella no se publica nada."""
    return any(os.path.exists(r) for r in _FUENTES_BOLD + _FUENTES_NORMAL)


# ── utilidades de dibujo ──────────────────────────────────────────────

def _ancho(dib, texto, fnt, esp=0):
    if not esp:
        return dib.textlength(texto, font=fnt)
    return sum(dib.textlength(c, font=fnt) for c in texto) + esp * max(
        0, len(texto) - 1)


def _texto(dib, xy, texto, fnt, color, esp=0, centro=False, derecha=False):
    """Escribe texto, con espaciado entre letras si se pide.

    Pillow no sabe espaciar letras, y las etiquetas en mayúsculas de este
    canal lo llevan. Cuando hace falta se dibuja letra a letra.
    """
    x, y = xy
    ancho = _ancho(dib, texto, fnt, esp)
    if centro:
        x -= ancho / 2
    elif derecha:
        x -= ancho
    if not esp:
        dib.text((x, y), texto, font=fnt, fill=color)
        return ancho
    for c in texto:
        dib.text((x, y), c, font=fnt, fill=color)
        x += dib.textlength(c, font=fnt) + esp
    return ancho


def _partir(dib, texto, fnt, ancho_max):
    """Parte un texto en líneas que quepan."""
    palabras, lineas, actual = texto.split(), [], ""
    for p in palabras:
        prueba = (actual + " " + p).strip()
        if dib.textlength(prueba, font=fnt) <= ancho_max or not actual:
            actual = prueba
        else:
            lineas.append(actual)
            actual = p
    if actual:
        lineas.append(actual)
    return lineas


def _flecha(dib, a, b, color, grosor=6, punta=22):
    """Una flecha de a → b."""
    (x1, y1), (x2, y2) = a, b
    ang = math.atan2(y2 - y1, x2 - x1)
    # El tronco se acorta para que no asome por dentro de la punta
    xc, yc = x2 - punta * 0.78 * math.cos(ang), y2 - punta * 0.78 * math.sin(ang)
    dib.line([(x1, y1), (xc, yc)], fill=color, width=grosor)
    ap = math.radians(26)
    dib.polygon([
        (x2, y2),
        (x2 - punta * math.cos(ang - ap), y2 - punta * math.sin(ang - ap)),
        (x2 - punta * math.cos(ang + ap), y2 - punta * math.sin(ang + ap)),
    ], fill=color)


def _bezier(p0, p1, p2, p3, n=60):
    """Puntos de una curva cúbica: Pillow no dibuja beziers."""
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append((
            u**3 * p0[0] + 3 * u*u*t * p1[0] + 3 * u*t*t * p2[0] + t**3 * p3[0],
            u**3 * p0[1] + 3 * u*u*t * p1[1] + 3 * u*t*t * p2[1] + t**3 * p3[1],
        ))
    return out


def _alto_pie(img, dib, texto):
    """Cuánto ocupa el pie, para que el dibujo sepa dónde termina."""
    if not texto:
        return int(img.size[1] * 0.055)
    w, h = img.size
    f = _fuente(int(w * (0.030 if h > w else 0.024)), False)
    n = len(_partir(dib, texto, f, w - 2 * int(w * 0.075))[:3])
    alto = int(w * (0.042 if h > w else 0.034))
    return int(h * 0.055) + alto * n + int(w * 0.05)


def _marco(tam, titulo, etiqueta, pie=""):
    """El lienzo con la cabecera del canal.

    Devuelve (img, dib, y_arriba, y_abajo): entre esas dos alturas es
    donde la plantilla tiene que caber. Antes cada una elegía su alto a
    ojo, así que un diagrama corto dejaba media pantalla en negro y uno
    largo se comía el título.
    """
    from PIL import Image, ImageDraw
    w, h = tam
    img = Image.new("RGB", (w, h), FONDO)
    dib = ImageDraw.Draw(img)
    vert = h > w
    m = int(w * 0.075)                       # margen lateral

    y = int(h * (0.075 if vert else 0.07))
    if etiqueta:
        f_et = _fuente(int(w * (0.026 if vert else 0.020)), True)
        dib.rectangle([m, y + int(w * .012), m + int(w * .038),
                       y + int(w * .017)], fill=ACENTO)
        _texto(dib, (m + int(w * .055), y), etiqueta.upper(), f_et, ACENTO,
               esp=int(w * .006))
        y += int(w * (0.052 if vert else 0.042))

    if titulo:
        f_tit = _fuente(int(w * (0.062 if vert else 0.048)), True)
        for ln in _partir(dib, titulo, f_tit, w - 2 * m)[:3]:
            dib.text((m, y), ln, font=f_tit, fill=TINTA)
            y += int(w * (0.072 if vert else 0.056))
        y += int(w * 0.03)
    return img, dib, y, h - _alto_pie(img, dib, pie)


def _pie(img, dib, texto):
    """La línea de abajo que remata el diagrama."""
    if not texto:
        return
    w, h = img.size
    m = int(w * 0.075)
    f = _fuente(int(w * (0.030 if h > w else 0.024)), False)
    lineas = _partir(dib, texto, f, w - 2 * m)[:3]
    alto = int(w * (0.042 if h > w else 0.034))
    y = h - int(h * 0.055) - alto * len(lineas)
    dib.line([(m, y - int(w * .035)), (w - m, y - int(w * .035))],
             fill=LINEA, width=2)
    for ln in lineas:
        dib.text((m, y), ln, font=f, fill=APAGADO)
        y += alto


def _guardar(img, salida):
    try:
        img.save(salida, "PNG")
        return salida
    except Exception as e:
        log.info("No pude guardar el diagrama (%s)", e)
        return None


# ── plantillas ────────────────────────────────────────────────────────

def comparar(salida, titulo, izq, der, pie="", etiqueta="Compared",
             tam=VERT):
    """Dos cosas enfrentadas con su cifra. `izq`/`der` = {"nombre", "valor",
    "unidad", "nota"}.

    La barra es proporcional a los valores cuando son numéricos, y si no
    lo son las dos salen iguales: inventarse una proporción sería dibujar
    un dato que nadie midió.
    """
    img, dib, y, y_fin = _marco(tam, titulo, etiqueta, pie)
    w, h = img.size
    m = int(w * 0.075)
    ancho = w - 2 * m

    def _num(v):
        try:
            return abs(float(str(v).replace(",", ".").split()[0]))
        except Exception:
            return None

    a, b = _num(izq.get("valor")), _num(der.get("valor"))
    if a is not None and b is not None and max(a, b) > 0:
        fa, fb = a / max(a, b), b / max(a, b)
    else:
        fa = fb = 1.0

    # Los dos bloques se reparten el hueco libre en vez de tener un alto
    # fijo: así ni se salen ni dejan medio cuadro en negro.
    hueco = max(int(h * .10), (y_fin - y - int(h * .03)) // 2)
    for datos, color, frac in ((izq, FRIO, fa), (der, CALIDO, fb)):
        y_bloque = y
        f_n = _fuente(int(w * 0.034), True)
        _texto(dib, (m, y), str(datos.get("nombre", "")).upper(), f_n,
               APAGADO, esp=int(w * .004))
        y += int(w * 0.05)

        f_v = _fuente(int(w * 0.095), True)
        ancho_v = _texto(dib, (m, y), str(datos.get("valor", "")), f_v, TINTA)
        if datos.get("unidad"):
            f_u = _fuente(int(w * 0.038), True)
            dib.text((m + ancho_v + int(w * .014), y + int(w * .052)),
                     str(datos["unidad"]), font=f_u, fill=TENUE)
        y += int(w * 0.115)

        dib.rectangle([m, y, m + ancho, y + int(w * .022)], fill=PANEL)
        dib.rectangle([m, y, m + int(ancho * frac), y + int(w * .022)],
                      fill=color)
        y += int(w * 0.045)

        if datos.get("nota"):
            f_no = _fuente(int(w * 0.028), False)
            for ln in _partir(dib, str(datos["nota"]), f_no, ancho)[:2]:
                dib.text((m, y), ln, font=f_no, fill=TENUE)
                y += int(w * 0.038)
        y = y_bloque + hueco

    _pie(img, dib, pie)
    return _guardar(img, salida)


def tendencia(salida, titulo, puntos, eje_x="", eje_y="", marca=None,
              pie="", etiqueta="Measured", tam=VERT):
    """Una curva con un punto señalado. `puntos` = [(x, y), ...] en las
    unidades que sean; `marca` = {"i": índice, "texto": "..."}.

    Para degradación, carga aerodinámica contra velocidad, temperatura de
    neumático — cualquier cosa que suba o baje y tenga un punto que
    importe.
    """
    if not puntos or len(puntos) < 2:
        return None
    img, dib, y, y_fin = _marco(tam, titulo, etiqueta, pie)
    w, h = img.size
    m = int(w * 0.075)

    # La acotación se dibuja ENCIMA de la caja, así que su alto se reserva
    # antes: si no, se sube sobre el título y lo tapa.
    reserva = int(w * .075) if marca else 0
    caja_x = m + int(w * .09)
    caja_y = y + reserva
    caja_w = w - caja_x - m
    caja_h = max(int(h * .16), y_fin - caja_y - int(w * .075))

    xs = [p[0] for p in puntos]
    ys = [p[1] for p in puntos]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    rx = (x1 - x0) or 1.0
    ry = (y1 - y0) or 1.0
    # Un poco de aire arriba y abajo para que la curva no toque el borde
    y0 -= ry * .12
    y1 += ry * .12
    ry = (y1 - y0) or 1.0

    def px(p):
        return (caja_x + (p[0] - x0) / rx * caja_w,
                caja_y + caja_h - (p[1] - y0) / ry * caja_h)

    # Rejilla
    for i in range(5):
        gy = caja_y + caja_h * i / 4
        dib.line([(caja_x, gy), (caja_x + caja_w, gy)], fill=LINEA, width=1)
    dib.line([(caja_x, caja_y), (caja_x, caja_y + caja_h)], fill=TENUE, width=2)
    dib.line([(caja_x, caja_y + caja_h), (caja_x + caja_w, caja_y + caja_h)],
             fill=TENUE, width=2)

    pts = [px(p) for p in puntos]
    # Relleno bajo la curva, que da cuerpo sin robar atención
    dib.polygon(pts + [(pts[-1][0], caja_y + caja_h),
                       (pts[0][0], caja_y + caja_h)], fill="#1A1F2B")
    dib.line(pts, fill=ACENTO, width=max(4, int(w * .006)), joint="curve")

    if marca and 0 <= marca.get("i", -1) < len(pts):
        mx, my = pts[marca["i"]]
        dib.line([(mx, caja_y), (mx, caja_y + caja_h)], fill=CALIDO, width=2)
        r = int(w * .014)
        dib.ellipse([mx - r, my - r, mx + r, my + r], fill=CALIDO)
        if marca.get("texto"):
            f_m = _fuente(int(w * 0.030), True)
            t = str(marca["texto"])
            tw = dib.textlength(t, font=f_m)
            bx = min(max(caja_x, mx - tw / 2 - int(w * .02)),
                     caja_x + caja_w - tw - int(w * .04))
            by = caja_y - int(w * .062)
            dib.rectangle([bx, by, bx + tw + int(w * .04),
                           by + int(w * .052)], fill=PANEL, outline=CALIDO)
            dib.text((bx + int(w * .02), by + int(w * .011)), t,
                     font=f_m, fill=TINTA)

    f_e = _fuente(int(w * 0.026), True)
    if eje_x:
        _texto(dib, (caja_x + caja_w / 2, caja_y + caja_h + int(w * .022)),
               eje_x.upper(), f_e, TENUE, esp=int(w * .004), centro=True)
    if eje_y:
        _texto(dib, (m, caja_y + caja_h / 2), eje_y.upper(), f_e, TENUE,
               esp=int(w * .004))

    _pie(img, dib, pie)
    return _guardar(img, salida)


def flujo(salida, titulo, forma, flechas=5, notas=(), pie="",
          etiqueta="Airflow", tam=VERT):
    """Aire moviéndose por una sección. `forma` = "suelo" | "ala" | "cuerpo";
    `notas` = [(frac_x, texto)] señalando puntos del recorrido.

    Es la plantilla que más se va a usar: casi todo lo técnico de la F1
    acaba siendo aire haciendo algo alrededor de una superficie. Lo que
    tiene que verse es el CANAL que forman la superficie y el suelo — que
    se estrecha y se ensancha — porque ahí está la explicación.
    """
    img, dib, y, y_fin = _marco(tam, titulo, etiqueta, pie)
    w, h = img.size
    m = int(w * 0.075)
    ancho = w - 2 * m

    notas = list(notas)[:3]
    alto_notas = (int(w * .052) * len(notas)
                  + (int(w * .095) if notas else 0))
    # El dibujo tiene proporción propia: dejarlo estirarse a todo el alto
    # de un vertical lo deformaba hasta comerse la cabecera.
    disp = y_fin - y - alto_notas
    alto = max(int(w * .34), min(int(w * .62), disp))
    y = y + max(0, (disp - alto) // 2)       # centrado en el hueco
    suelo = y + alto

    def canal(fx):
        """Altura del techo del canal en fx (0..1). El hueco se estrecha
        hasta el punto más bajo y luego se abre: eso es el venturi."""
        if forma == "ala":
            return alto * (0.30 + 0.34 * math.sin(math.pi * fx))
        if forma == "cuerpo":
            return alto * (0.28 + 0.30 * math.sin(math.pi * min(1, fx * 1.15)))
        # suelo: entra ancho, garganta al 45%, difusor abriéndose
        return alto * (0.62 - 0.42 * math.exp(-((fx - 0.45) ** 2) / 0.045)
                       + 0.34 * max(0.0, fx - 0.55) ** 1.4)

    n = 96
    techo = [(m + ancho * i / n, suelo - canal(i / n)) for i in range(n + 1)]

    # El coche por encima (relleno) y el asfalto por debajo
    dib.polygon(techo + [(m + ancho, y), (m, y)], fill="#1C222D")
    dib.line(techo, fill=TINTA, width=max(4, int(w * .0055)), joint="curve")
    dib.line([(m, suelo), (m + ancho, suelo)], fill=TENUE,
             width=max(4, int(w * .006)))
    # Rayado del asfalto, para que se lea como suelo y no como borde
    for i in range(0, ancho, int(w * .045)):
        dib.line([(m + i, suelo + 2), (m + i + int(w * .022),
                                       suelo + int(w * .022))],
                 fill="#1A202A", width=3)

    # Las corrientes van DENTRO del canal, y donde se estrecha van más
    # juntas y en color de acento: ahí es donde el aire acelera.
    anchos = [canal(j / n) for j in range(n + 1)]
    a_min, a_max = min(anchos), max(anchos)
    rango = (a_max - a_min) or 1.0

    def _color(fx):
        """Frío donde el canal va ancho, caliente donde se estrecha."""
        t = 1 - (canal(fx) - a_min) / rango       # 1 = lo más estrecho
        c1 = (0x2F, 0xC4, 0xE0)
        c2 = (0xFF, 0x2D, 0x16)
        return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))

    k = max(2, min(6, int(flechas or 4)))
    grosor = max(3, int(w * .0045))
    for i in range(k):
        fy = (i + 1) / (k + 1)
        pts = [(m + ancho * (j / n), suelo - canal(j / n) * fy)
               for j in range(0, n + 1, 4)]
        # Tramo a tramo, porque el color cambia a lo largo de la corriente
        for a, b, j in zip(pts, pts[1:], range(0, n + 1, 4)):
            dib.line([a, b], fill=_color(j / n), width=grosor)
        _flecha(dib, pts[-2], pts[-1], _color(1.0), grosor=grosor,
                punta=int(w * .020))

    # Marca de la garganta: es el punto del que habla el guion
    fg = 0.45 if forma == "suelo" else 0.5
    gx = m + ancho * fg
    dib.line([(gx, suelo - canal(fg)), (gx, suelo)], fill=CALIDO, width=3)

    # Marcas numeradas sobre el dibujo, y la lista debajo alineada. Colgar
    # cada texto de su propia x hacía que el de la derecha se saliera.
    f_i = _fuente(int(w * 0.026), True)
    f_n = _fuente(int(w * 0.030), True)
    r = int(w * .020)
    for i, (frac, _t) in enumerate(notas):
        nx = m + ancho * max(0.0, min(1.0, float(frac)))
        cy_m = suelo + int(w * .034)
        dib.line([(nx, suelo), (nx, cy_m - r)], fill=CALIDO, width=2)
        dib.ellipse([nx - r, cy_m - r, nx + r, cy_m + r], fill=FONDO,
                    outline=CALIDO, width=3)
        _texto(dib, (nx, cy_m - int(w * .015)), str(i + 1), f_i, CALIDO,
               centro=True)

    yy = suelo + int(w * .085)
    for i, (_f, texto) in enumerate(notas):
        dib.ellipse([m, yy + int(w * .004), m + int(w * .030),
                     yy + int(w * .034)], fill=CALIDO)
        _texto(dib, (m + int(w * .015), yy + int(w * .008)), str(i + 1),
               f_i, FONDO, centro=True)
        _texto(dib, (m + int(w * .048), yy), str(texto), f_n, TINTA)
        yy += int(w * .052)

    _pie(img, dib, pie)
    return _guardar(img, salida)


def fases(salida, titulo, pasos, pie="", etiqueta="Sequence", tam=VERT):
    """Una secuencia en el tiempo. `pasos` = [{"nombre", "detalle"}].

    Para explicar frenada → entrada → vértice → salida, o las fases de
    una parada, o el ciclo de una vuelta de clasificación.
    """
    if not pasos:
        return None
    img, dib, y, y_fin = _marco(tam, titulo, etiqueta, pie)
    w, h = img.size
    m = int(w * 0.075)
    pasos = list(pasos)[:5]

    x_carril = m + int(w * .035)
    # Los pasos se reparten el hueco: dos pasos no deben quedar pegados
    # arriba con media pantalla vacía debajo.
    y0 = y + int(w * .04)
    alto_paso = max(int(w * .11),
                    (y_fin - y0 - int(w * .06)) // max(1, len(pasos) - 1)
                    if len(pasos) > 1 else int(w * .11))
    dib.line([(x_carril, y0), (x_carril, y0 + alto_paso * (len(pasos) - 1))],
             fill=LINEA, width=4)

    f_n = _fuente(int(w * 0.040), True)
    f_d = _fuente(int(w * 0.028), False)
    for i, paso in enumerate(pasos):
        py = y0 + alto_paso * i
        r = int(w * .022)
        col = ACENTO if i == 0 else TENUE
        dib.ellipse([x_carril - r, py - r, x_carril + r, py + r],
                    fill=FONDO, outline=col, width=4)
        f_i = _fuente(int(w * 0.024), True)
        _texto(dib, (x_carril, py - int(w * .012)), str(i + 1), f_i, col,
               centro=True)

        tx = x_carril + int(w * .055)
        dib.text((tx, py - int(w * .026)), str(paso.get("nombre", "")).upper(),
                 font=f_n, fill=TINTA)
        if paso.get("detalle"):
            yy = py + int(w * .026)
            for ln in _partir(dib, str(paso["detalle"]), f_d,
                              w - tx - m)[:2]:
                dib.text((tx, yy), ln, font=f_d, fill=APAGADO)
                yy += int(w * .038)

    _pie(img, dib, pie)
    return _guardar(img, salida)


PLANTILLAS = {
    "comparar": comparar,
    "tendencia": tendencia,
    "flujo": flujo,
    "fases": fases,
}


def dibujar(spec, salida, tam=VERT):
    """Dibuja desde una especificación {"plantilla": ..., ...}.

    Devuelve la ruta del PNG o None. None no es un fallo del canal: es
    que ese diagrama no se puede dibujar con los datos que hay, y en ese
    caso el short sigue con sus fotos en vez de con una imagen a medias.
    """
    if not isinstance(spec, dict):
        return None
    fn = PLANTILLAS.get((spec.get("plantilla") or "").strip().lower())
    if not fn or not hay_tipografia():
        return None
    args = {k: v for k, v in spec.items() if k != "plantilla"}
    args["tam"] = tam
    try:
        return fn(salida, **args)
    except Exception as e:
        log.info("Diagrama '%s' no se pudo dibujar (%s)",
                 spec.get("plantilla"), e)
        return None

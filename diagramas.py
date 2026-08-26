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

# ── Modo ESQUEMA ───────────────────────────────────────────────────────
# Un corte técnico dibujado como si fuera una lectura de instrumentos:
# rejilla, trazo de neón sobre negro y nada de relleno. Sirve para
# enseñar la DISPOSICIÓN de unas piezas cuando la única referencia
# disponible es la descripción escrita de alguien que sí la vio — que es
# el caso siempre que se habla de una pieza de un equipo concreto. El
# estilo es deliberadamente el opuesto a una ilustración técnica al uso,
# para que nadie confunda un esquema nuestro con el dibujo de otro.
ESQ_FONDO = "#05080A"
ESQ_REJILLA = "#0E2318"
ESQ_LINEA = "#39FF6A"
ESQ_TENUE = "#1C7A3C"
ESQ_FLUJO = "#42E8FF"
ESQ_MARCA = "#FFB020"

# La tipografía del canal primero, la del sistema como respaldo. Si las
# propias no llegaron a instalarse, todo se dibuja igual que antes.
try:
    import fuentes as _f
    _FUENTES_BOLD = _f.lista(negrita=True)
    _FUENTES_NORMAL = _f.lista(negrita=False)
except Exception:                        # pragma: no cover
    _f = None
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


def recargar_fuentes():
    """Vuelve a mirar qué hay instalado. Se llama tras `fuentes.asegurar()`,
    porque las listas se fijan al importar y en ese momento aún no se ha
    descargado nada."""
    global _FUENTES_BOLD, _FUENTES_NORMAL
    if _f is None:
        return
    _FUENTES_BOLD = _f.lista(negrita=True)
    _FUENTES_NORMAL = _f.lista(negrita=False)
    _cache_fuente.clear()


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


def _recortar(dib, texto, fnt, ancho_max, esp=0):
    """Corta un texto con puntos suspensivos hasta que quepa."""
    if _ancho(dib, texto, fnt, esp) <= ancho_max:
        return texto
    while texto and _ancho(dib, texto + "…", fnt, esp) > ancho_max:
        texto = texto[:-1]
    return texto + "…" if texto else ""


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


def _escala(tam):
    """La medida de referencia para TODO lo que ocupa alto: tipografías,
    separaciones verticales, radios.

    Las plantillas nacieron para el vertical de los shorts (1080x1920) y
    lo medían todo con el ancho, que ahí es el lado corto. En un lienzo
    apaisado el ancho pasa a ser el lado LARGO, así que esas mismas
    fracciones pedían mucho más alto del que hay: el dibujo se salía por
    abajo y los textos se pisaban unos a otros.

    Usando el lado corto, el vertical no cambia ni un píxel —ahí el lado
    corto ES el ancho— y el apaisado encaja.
    """
    return min(tam)


def _alto_pie(img, dib, texto):
    """Cuánto ocupa el pie, para que el dibujo sepa dónde termina."""
    if not texto:
        return int(img.size[1] * 0.055)
    w, h = img.size
    f = _fuente(int(w * (0.030 if h > w else 0.024)), False)
    n = len(_partir(dib, texto, f, w - 2 * int(w * 0.075))[:3])
    alto = int(w * (0.042 if h > w else 0.034))
    # El colchón bajo el pie se medía con el ancho: en apaisado son 64 px
    # robados al dibujo para nada. Con el lado corto son 36, y en vertical
    # no cambia (allí el lado corto ES el ancho).
    return int(h * 0.055) + alto * n + int(_escala((w, h)) * 0.05)


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
    esc = _escala(tam)
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
        f_n = _fuente(int(esc * 0.034), True)
        _texto(dib, (m, y), str(datos.get("nombre", "")).upper(), f_n,
               APAGADO, esp=int(esc * .004))
        y += int(esc * 0.05)

        f_v = _fuente(int(esc * 0.095), True)
        ancho_v = _texto(dib, (m, y), str(datos.get("valor", "")), f_v, TINTA)
        if datos.get("unidad"):
            f_u = _fuente(int(esc * 0.038), True)
            dib.text((m + ancho_v + int(esc * .014), y + int(esc * .052)),
                     str(datos["unidad"]), font=f_u, fill=TENUE)
        y += int(esc * 0.115)

        dib.rectangle([m, y, m + ancho, y + int(esc * .022)], fill=PANEL)
        dib.rectangle([m, y, m + int(ancho * frac), y + int(esc * .022)],
                      fill=color)
        y += int(esc * 0.045)

        if datos.get("nota"):
            f_no = _fuente(int(esc * 0.028), False)
            for ln in _partir(dib, str(datos["nota"]), f_no, ancho)[:2]:
                dib.text((m, y), ln, font=f_no, fill=TENUE)
                y += int(esc * 0.038)
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
    esc = _escala(tam)
    m = int(w * 0.075)

    # La acotación se dibuja ENCIMA de la caja, así que su alto se reserva
    # antes: si no, se sube sobre el título y lo tapa.
    reserva = int(esc * .075) if marca else 0
    caja_x = m + int(esc * .09)
    caja_y = y + reserva
    caja_w = w - caja_x - m
    # El alto lo manda el hueco real, no un mínimo: en apaisado ese mínimo
    # era mayor que el sitio disponible y la caja se salía por abajo.
    caja_h = max(int(h * .12), y_fin - caja_y - int(esc * .075))

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
    dib.line(pts, fill=ACENTO, width=max(4, int(esc * .006)), joint="curve")

    if marca and 0 <= marca.get("i", -1) < len(pts):
        mx, my = pts[marca["i"]]
        dib.line([(mx, caja_y), (mx, caja_y + caja_h)], fill=CALIDO, width=2)
        r = int(esc * .014)
        dib.ellipse([mx - r, my - r, mx + r, my + r], fill=CALIDO)
        if marca.get("texto"):
            f_m = _fuente(int(esc * 0.030), True)
            t = str(marca["texto"])
            tw = dib.textlength(t, font=f_m)
            bx = min(max(caja_x, mx - tw / 2 - int(esc * .02)),
                     caja_x + caja_w - tw - int(esc * .04))
            by = caja_y - int(esc * .062)
            dib.rectangle([bx, by, bx + tw + int(esc * .04),
                           by + int(esc * .052)], fill=PANEL, outline=CALIDO)
            dib.text((bx + int(esc * .02), by + int(esc * .011)), t,
                     font=f_m, fill=TINTA)

    f_e = _fuente(int(esc * 0.026), True)
    if eje_x:
        _texto(dib, (caja_x + caja_w / 2, caja_y + caja_h + int(esc * .022)),
               eje_x.upper(), f_e, TENUE, esp=int(esc * .004), centro=True)
    if eje_y:
        _texto(dib, (m, caja_y + caja_h / 2), eje_y.upper(), f_e, TENUE,
               esp=int(esc * .004))

    _pie(img, dib, pie)
    return _guardar(img, salida)


def _rgb(color):
    """'#RRGGBB' → (r, g, b), o None si no es un color legible."""
    c = str(color or "").strip().lstrip("#")
    if len(c) == 3:
        c = "".join(x * 2 for x in c)
    if len(c) != 6:
        return None
    try:
        return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None


def _mezclar(color, fondo, t):
    """`color` puesto sobre `fondo` con opacidad `t`.

    Pillow dibuja polígonos sin alfa, así que la transparencia se calcula
    a mano: es la única forma de que un relleno no tape la rejilla.
    """
    a = _rgb(color) or (242, 244, 248)
    b = _rgb(fondo) or (10, 12, 17)
    return tuple(int(round(b[i] + (a[i] - b[i]) * t)) for i in range(3))


def _percentil(ordenados, p):
    """Percentil por interpolación lineal sobre una lista YA ordenada."""
    if not ordenados:
        return 0.0
    if len(ordenados) == 1:
        return float(ordenados[0])
    i = (len(ordenados) - 1) * p
    lo = int(math.floor(i))
    hi = min(lo + 1, len(ordenados) - 1)
    return ordenados[lo] + (ordenados[hi] - ordenados[lo]) * (i - lo)


def _densidad(valores, rejilla, ancho_banda):
    """Densidad gaussiana de `valores` sobre `rejilla`, con el máximo en 1.

    Un histograma con veinte muestras por equipo sale a escalones y el
    ojo lee los escalones como si fueran datos. El núcleo gaussiano da la
    misma información sin inventarse bordes.
    """
    if ancho_banda <= 0:
        ancho_banda = 1e-6
    fuera = []
    for x in rejilla:
        s = 0.0
        for v in valores:
            u = (x - v) / ancho_banda
            if u * u < 50:               # más allá aporta ~0 y cuesta igual
                s += math.exp(-0.5 * u * u)
        fuera.append(s)
    tope = max(fuera) or 1.0
    return [v / tope for v in fuera]


def reparto(salida, titulo, series, eje_x="", unidad="", pie="",
            etiqueta="Measured", tam=HORIZ, decimales=0):
    """El REPARTO de una medida, una silueta por grupo.

    `series` = [{"nombre": "McLaren", "valores": [312.4, ...],
                 "color": "#FF8000", "nota": "58 laps"}]

    Una tabla de máximas dice quién marcó el pico una vez; esto dice
    dónde vive cada coche vuelta tras vuelta, que es lo que separa un
    coche rápido de uno que tuvo un rebufo. Cada fila es la densidad de
    sus muestras: ancha donde se repiten, estrecha donde casi no aparecen.

    Se ordena por mediana de mayor a menor, porque el orden ES parte de
    la lectura. La marca clara es la mediana y la barra fina el rango
    entre el 25% y el 75%.

    Devuelve None si no hay al menos un grupo con muestras suficientes:
    una silueta dibujada con cuatro números es un adorno, no un dato.

    A diferencia de las demás, esta plantilla NO se le ofrece al
    guionista (`_diagrama_kwargs` no la acepta): las otras admiten que un
    modelo rellene sus huecos porque son ilustraciones de una idea, pero
    aquí cada silueta afirma una medición. Los valores tienen que venir
    de la telemetría, nunca de un texto generado.
    """
    limpias = []
    for s in (series or []):
        vals = []
        for v in (s.get("valores") or []):
            try:
                f = float(v)
            except (TypeError, ValueError):
                continue
            if f == f and abs(f) != float("inf"):
                vals.append(f)
        if len(vals) >= 5:
            vals.sort()
            limpias.append({
                "nombre": str(s.get("nombre", "")),
                "valores": vals,
                "color": s.get("color") or ACENTO,
                "nota": s.get("nota") or "",
                "mediana": _percentil(vals, 0.5),
            })
    if not limpias:
        return None
    limpias.sort(key=lambda s: s["mediana"], reverse=True)
    # Más de doce filas no caben legibles. Se quedan las doce de arriba,
    # y el pie lo DICE: un gráfico recortado en silencio hace creer que
    # los que faltan no existen.
    if len(limpias) > 12:
        pie = (pie + " · " if pie else "") + \
            f"Top 12 of {len(limpias)} shown"
        limpias = limpias[:12]

    img, dib, y, y_fin = _marco(tam, titulo, etiqueta, pie)
    w, h = img.size
    esc = _escala(tam)
    m = int(w * 0.075)

    # El alto de fila manda sobre el tamaño de letra: con diez equipos en
    # apaisado hay 40 px por fila, y una tipografía pensada para el
    # vertical se come la fila de al lado.
    alto_eje = int(esc * (0.075 if eje_x else 0.045))
    hueco = y_fin - y - alto_eje - int(esc * .045)
    fila = hueco / max(1, len(limpias))
    con_nota = fila >= esc * .085 and any(s["nota"] for s in limpias)

    t_n = int(min(esc * 0.030, fila * (0.42 if con_nota else 0.62)))
    f_n = _fuente(max(11, t_n), True)
    # Y si el nombre más largo no cabe en su columna, la letra baja hasta
    # que quepa: un "RED BULL RA…" es peor que dos puntos de tipografía.
    tope_nombre = w * 0.28
    while t_n > 12 and max(_ancho(dib, s["nombre"].upper(), f_n,
                                  int(esc * .003))
                           for s in limpias) > tope_nombre:
        t_n -= 1
        f_n = _fuente(t_n, True)
    f_no = _fuente(max(9, int(t_n * 0.72)), False)
    f_v = _fuente(max(11, t_n), True)
    f_e = _fuente(int(esc * 0.023), True)

    fmt = "{:." + str(max(0, int(decimales))) + "f}"
    ancho_nombre = max(
        max(_ancho(dib, s["nombre"].upper(), f_n, int(esc * .003))
            for s in limpias),
        max((dib.textlength(s["nota"], font=f_no) for s in limpias
             if s["nota"]), default=0) if con_nota else 0,
    )
    # +2 de redondeo: sin ellos el nombre más largo —que es justo el que
    # fija el ancho— se recortaba por un píxel.
    gut_izq = int(math.ceil(min(ancho_nombre, w * 0.28))) + int(esc * .03) + 2
    gut_der = int(max(dib.textlength(fmt.format(s["mediana"]), font=f_v)
                      for s in limpias)) + int(esc * .03)

    caja_x = m + gut_izq
    caja_w = w - caja_x - m - gut_der
    caja_y = y
    caja_h = hueco
    if caja_w < esc * .2 or caja_h < esc * .12:
        return None

    todos = [v for s in limpias for v in s["valores"]]
    x0, x1 = min(todos), max(todos)
    margen = (x1 - x0) * 0.06 or 1.0
    x0 -= margen
    x1 += margen
    rx = (x1 - x0) or 1.0

    def px(v):
        return caja_x + (v - x0) / rx * caja_w

    # Rejilla vertical y sus cifras
    pasos = 5
    for i in range(pasos + 1):
        v = x0 + rx * i / pasos
        gx = px(v)
        dib.line([(gx, caja_y), (gx, caja_y + caja_h)],
                 fill=LINEA if i else TENUE, width=1)
        _texto(dib, (gx, caja_y + caja_h + int(esc * .012)),
               fmt.format(v), f_e, TENUE, centro=True)
    dib.line([(caja_x, caja_y + caja_h), (caja_x + caja_w, caja_y + caja_h)],
             fill=TENUE, width=2)

    medio = min(fila * 0.44, esc * 0.075)
    # Una banda común para todas: con una por equipo, el que menos varía
    # saldría igual de ancho que el que más y la comparación se perdería.
    # Se toma la mediana de los anchos de Silverman —no el mayor— porque
    # con el mayor un solo grupo irregular emborrona a todos los demás.
    anchos = sorted(
        0.9 * max((_percentil(s["valores"], .75)
                   - _percentil(s["valores"], .25)) / 1.349, 1e-6)
        * len(s["valores"]) ** -0.2 for s in limpias)
    banda = max(anchos[len(anchos) // 2], rx * 0.006)

    for i, s in enumerate(limpias):
        cy = caja_y + fila * (i + 0.5)
        # La silueta empieza en la muestra más lenta y acaba en la más
        # rápida. La cola de la gaussiana se prolonga más allá de lo que
        # nadie marcó, y dibujarla sería enseñar velocidades que no
        # existieron.
        vmin, vmax = s["valores"][0], s["valores"][-1]
        if vmax - vmin < rx * 1e-4:
            continue
        n_r = 120
        rejilla = [vmin + (vmax - vmin) * k / n_r for k in range(n_r + 1)]
        dens = _densidad(s["valores"], rejilla, banda)
        arriba, abajo = [], []
        for x, d in zip(rejilla, dens):
            arriba.append((px(x), cy - d * medio))
            abajo.append((px(x), cy + d * medio))
        if len(arriba) < 3:
            continue
        dib.polygon(arriba + abajo[::-1],
                    fill=_mezclar(s["color"], FONDO, 0.32),
                    outline=s["color"])

        q1, q3 = _percentil(s["valores"], .25), _percentil(s["valores"], .75)
        gr = max(2, int(esc * .005))
        dib.line([(px(q1), cy), (px(q3), cy)],
                 fill=_mezclar(s["color"], FONDO, 0.75), width=gr)
        # La marca de la mediana crece con la silueta: una raya de alto
        # fijo asoma por arriba y por abajo justo en los repartos anchos,
        # que son los que hay que mirar.
        k = min(range(len(rejilla)),
                key=lambda j: abs(rejilla[j] - s["mediana"]))
        alto_m = medio * max(0.55, dens[k]) * 1.06
        mx = px(s["mediana"])
        dib.line([(mx, cy - alto_m), (mx, cy + alto_m)],
                 fill=TINTA, width=max(2, int(esc * .004)))

        ancho_txt = gut_izq - int(esc * .03)
        ty = cy - (t_n * 1.05 if con_nota and s["nota"] else t_n * 0.62)
        _texto(dib, (m, ty),
               _recortar(dib, s["nombre"].upper(), f_n, ancho_txt,
                         int(esc * .003)),
               f_n, TINTA, esp=int(esc * .003))
        if con_nota and s["nota"]:
            dib.text((m, ty + t_n * 1.22),
                     _recortar(dib, s["nota"], f_no, ancho_txt), font=f_no,
                     fill=TENUE)
        _texto(dib, (w - m, cy - t_n * 0.62), fmt.format(s["mediana"]),
               f_v, s["color"], derecha=True)

    if eje_x:
        etiq = eje_x.upper() + (f" ({unidad})" if unidad else "")
        _texto(dib, (caja_x + caja_w / 2, caja_y + caja_h + int(esc * .048)),
               etiq, f_e, APAGADO, esp=int(esc * .004), centro=True)

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
    esc = _escala(tam)
    m = int(w * 0.075)
    ancho = w - 2 * m

    notas = list(notas)[:3]
    alto_notas = (int(esc * .052) * len(notas)
                  + (int(esc * .095) if notas else 0))
    # El dibujo tiene proporción propia: dejarlo estirarse a todo el alto
    # de un vertical lo deformaba hasta comerse la cabecera.
    #
    # Y el alto NUNCA puede pasar del hueco que queda: antes había un
    # mínimo fijo que en apaisado era el triple de lo disponible, y el
    # dibujo salía por debajo del lienzo llevándose los números con él.
    disp = y_fin - y - alto_notas
    alto = min(disp, max(int(esc * .34), min(int(esc * .62), disp)))
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
    dib.line(techo, fill=TINTA, width=max(4, int(esc * .0055)), joint="curve")
    dib.line([(m, suelo), (m + ancho, suelo)], fill=TENUE,
             width=max(4, int(esc * .006)))
    # Rayado del asfalto, para que se lea como suelo y no como borde
    for i in range(0, ancho, int(w * .045)):
        dib.line([(m + i, suelo + 2), (m + i + int(esc * .022),
                                       suelo + int(esc * .022))],
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
    grosor = max(3, int(esc * .0045))
    for i in range(k):
        fy = (i + 1) / (k + 1)
        pts = [(m + ancho * (j / n), suelo - canal(j / n) * fy)
               for j in range(0, n + 1, 4)]
        # Tramo a tramo, porque el color cambia a lo largo de la corriente
        for a, b, j in zip(pts, pts[1:], range(0, n + 1, 4)):
            dib.line([a, b], fill=_color(j / n), width=grosor)
        _flecha(dib, pts[-2], pts[-1], _color(1.0), grosor=grosor,
                punta=int(esc * .020))

    # Marca de la garganta: es el punto del que habla el guion
    fg = 0.45 if forma == "suelo" else 0.5
    gx = m + ancho * fg
    dib.line([(gx, suelo - canal(fg)), (gx, suelo)], fill=CALIDO, width=3)

    # Marcas numeradas sobre el dibujo, y la lista debajo alineada. Colgar
    # cada texto de su propia x hacía que el de la derecha se saliera.
    f_i = _fuente(int(esc * 0.026), True)
    f_n = _fuente(int(esc * 0.030), True)
    r = int(esc * .020)
    for i, (frac, _t) in enumerate(notas):
        nx = m + ancho * max(0.0, min(1.0, float(frac)))
        cy_m = suelo + int(esc * .034)
        dib.line([(nx, suelo), (nx, cy_m - r)], fill=CALIDO, width=2)
        dib.ellipse([nx - r, cy_m - r, nx + r, cy_m + r], fill=FONDO,
                    outline=CALIDO, width=3)
        _texto(dib, (nx, cy_m - int(esc * .015)), str(i + 1), f_i, CALIDO,
               centro=True)

    yy = suelo + int(esc * .085)
    for i, (_f, texto) in enumerate(notas):
        dib.ellipse([m, yy + int(esc * .004), m + int(esc * .030),
                     yy + int(esc * .034)], fill=CALIDO)
        _texto(dib, (m + int(esc * .015), yy + int(esc * .008)), str(i + 1),
               f_i, FONDO, centro=True)
        _texto(dib, (m + int(esc * .048), yy), str(texto), f_n, TINTA)
        yy += int(esc * .052)

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
    esc = _escala(tam)
    m = int(w * 0.075)
    pasos = list(pasos)[:5]

    x_carril = m + int(esc * .035)
    # Los pasos se reparten el hueco: dos pasos no deben quedar pegados
    # arriba con media pantalla vacía debajo.
    y0 = y + int(esc * .04)
    alto_paso = max(int(esc * .11),
                    (y_fin - y0 - int(esc * .06)) // max(1, len(pasos) - 1)
                    if len(pasos) > 1 else int(esc * .11))
    dib.line([(x_carril, y0), (x_carril, y0 + alto_paso * (len(pasos) - 1))],
             fill=LINEA, width=4)

    f_n = _fuente(int(esc * 0.040), True)
    f_d = _fuente(int(esc * 0.028), False)
    for i, paso in enumerate(pasos):
        py = y0 + alto_paso * i
        r = int(esc * .022)
        col = ACENTO if i == 0 else TENUE
        dib.ellipse([x_carril - r, py - r, x_carril + r, py + r],
                    fill=FONDO, outline=col, width=4)
        f_i = _fuente(int(esc * 0.024), True)
        _texto(dib, (x_carril, py - int(esc * .012)), str(i + 1), f_i, col,
               centro=True)

        tx = x_carril + int(esc * .055)
        dib.text((tx, py - int(esc * .026)), str(paso.get("nombre", "")).upper(),
                 font=f_n, fill=TINTA)
        if paso.get("detalle"):
            yy = py + int(esc * .026)
            for ln in _partir(dib, str(paso["detalle"]), f_d,
                              w - tx - m)[:2]:
                dib.text((tx, yy), ln, font=f_d, fill=APAGADO)
                yy += int(esc * .038)

    _pie(img, dib, pie)
    return _guardar(img, salida)


def esquema(salida, titulo, piezas, flujo_lineas=(), notas=(), pie="",
            etiqueta="Schematic", tam=VERT, aspecto=3.0):
    """Un corte técnico en trazo de neón sobre rejilla.

    `piezas` = [{"puntos": [[x, y], ...], "nombre": str, "clave": bool}]
    con x e y en 0..1 sobre el área de dibujo. `clave=True` la resalta.
    `flujo_lineas` = [[[x, y], ...], ...] recorridos de aire.
    `notas` = [(x, y, texto)] llamadas numeradas sobre el dibujo.
    `aspecto` = ancho/alto que tiene el dibujo POR SÍ MISMO. Un corte
    lateral de un coche mide como tres de ancho por uno de alto; sin
    declararlo, las coordenadas 0..1 se estiran a la caja que toque y en
    vertical el coche sale deformado en un bulto.

    Por qué existe: para hablar de la pieza de un equipo hace falta
    enseñar cómo está dispuesta, y la única fuente legítima es la
    DESCRIPCIÓN publicada, no la lámina de quien la dibujó. Esto dibuja
    desde esa descripción, con geometría propia y en un estilo que no se
    parece a ninguna ilustración técnica del ramo.
    """
    if not piezas:
        return None
    from PIL import Image, ImageDraw, ImageFilter
    w, h = tam
    esc = _escala(tam)
    img = Image.new("RGB", (w, h), ESQ_FONDO)
    dib = ImageDraw.Draw(img)

    # Rejilla de fondo: es lo que lo hace leerse como una pantalla.
    paso = max(24, int(esc * .045))
    for x in range(0, w, paso):
        dib.line([(x, 0), (x, h)], fill=ESQ_REJILLA, width=1)
    for y in range(0, h, paso):
        dib.line([(0, y), (w, y)], fill=ESQ_REJILLA, width=1)

    m = int(w * 0.075)
    y = int(h * (0.075 if h > w else 0.07))
    if etiqueta:
        f_et = _fuente(int(esc * (0.026 if h > w else 0.020)), True)
        dib.rectangle([m, y + int(esc * .012), m + int(esc * .038),
                       y + int(esc * .017)], fill=ESQ_LINEA)
        _texto(dib, (m + int(esc * .055), y), etiqueta.upper(), f_et,
               ESQ_LINEA, esp=int(esc * .006))
        y += int(esc * (0.052 if h > w else 0.042))
    if titulo:
        f_tit = _fuente(int(esc * (0.062 if h > w else 0.048)), True)
        for ln in _partir(dib, titulo, f_tit, w - 2 * m)[:3]:
            dib.text((m, y), ln, font=f_tit, fill="#DFFFE9")
            y += int(esc * (0.072 if h > w else 0.056))
        y += int(esc * 0.03)

    alto_notas = int(esc * .052) * len(notas) + (int(esc * .05) if notas else 0)
    y_fin = h - _alto_pie(img, dib, pie) - alto_notas
    hueco = (m, y, w - m, max(y + int(esc * .2), y_fin))
    hw, hh = hueco[2] - hueco[0], hueco[3] - hueco[1]
    # El dibujo conserva SU proporción dentro del hueco, centrado: se
    # queda con el ancho o con el alto, el que se agote antes.
    asp = max(0.2, float(aspecto or 3.0))
    if hw / hh > asp:
        ch = hh
        cw = hh * asp
    else:
        cw = hw
        ch = hw / asp
    cx0 = hueco[0] + (hw - cw) / 2
    cy0 = hueco[1] + (hh - ch) / 2
    caja = (cx0, cy0, cx0 + cw, cy0 + ch)
    X = lambda fx: caja[0] + cw * max(0.0, min(1.0, float(fx)))
    Y = lambda fy: caja[1] + ch * max(0.0, min(1.0, float(fy)))

    # El resplandor va en su propia capa: dibujar y desenfocar sobre la
    # imagen final emborronaría también la rejilla y el título.
    halo = Image.new("RGB", (w, h), "#000000")
    dhalo = ImageDraw.Draw(halo)
    for pz in piezas:
        pts = [(X(a), Y(b)) for a, b in pz.get("puntos", [])]
        if len(pts) < 2:
            continue
        col = ESQ_LINEA if pz.get("clave") else ESQ_TENUE
        dhalo.line(pts, fill=col, width=max(5, int(esc * .010)),
                   joint="curve")
    for ruta in flujo_lineas:
        pts = [(X(a), Y(b)) for a, b in ruta]
        if len(pts) >= 2:
            dhalo.line(pts, fill=ESQ_FLUJO, width=max(4, int(esc * .007)),
                       joint="curve")
    halo = halo.filter(ImageFilter.GaussianBlur(max(4, int(esc * .012))))
    # Se SUMA, no se mezcla: mezclando, el resplandor apagaría la rejilla
    # allí donde pasa por encima, y lo que se quiere es que la ilumine.
    from PIL import ImageChops
    img = ImageChops.add(img, halo)
    dib = ImageDraw.Draw(img)

    # Y encima el trazo limpio
    for pz in piezas:
        pts = [(X(a), Y(b)) for a, b in pz.get("puntos", [])]
        if len(pts) < 2:
            continue
        col = ESQ_LINEA if pz.get("clave") else ESQ_TENUE
        dib.line(pts, fill=col, width=max(2, int(esc * .004)), joint="curve")
    for ruta in flujo_lineas:
        pts = [(X(a), Y(b)) for a, b in ruta]
        if len(pts) < 2:
            continue
        dib.line(pts, fill=ESQ_FLUJO, width=max(2, int(esc * .003)),
                 joint="curve")
        _flecha(dib, pts[-2], pts[-1], ESQ_FLUJO,
                grosor=max(2, int(esc * .003)), punta=int(esc * .018))

    # Llamadas numeradas sobre el dibujo
    f_i = _fuente(int(esc * 0.026), True)
    r = int(esc * .020)
    for i, nota in enumerate(notas):
        nx, ny = X(nota[0]), Y(nota[1])
        dib.ellipse([nx - r, ny - r, nx + r, ny + r], fill=ESQ_FONDO,
                    outline=ESQ_MARCA, width=3)
        _texto(dib, (nx, ny - int(esc * .015)), str(i + 1), f_i, ESQ_MARCA,
               centro=True)

    # Y la lista debajo
    f_n = _fuente(int(esc * 0.030), True)
    yy = hueco[3] + int(esc * .03)
    for i, nota in enumerate(notas):
        dib.ellipse([m, yy + int(esc * .004), m + int(esc * .030),
                     yy + int(esc * .034)], fill=ESQ_MARCA)
        _texto(dib, (m + int(esc * .015), yy + int(esc * .008)), str(i + 1),
               f_i, ESQ_FONDO, centro=True)
        _texto(dib, (m + int(esc * .048), yy), str(nota[2]), f_n, "#CFF7DC")
        yy += int(esc * .052)

    if pie:
        f_p = _fuente(int(esc * (0.030 if h > w else 0.024)), False)
        lineas = _partir(dib, pie, f_p, w - 2 * m)[:3]
        alto = int(esc * (0.042 if h > w else 0.034))
        yp = h - int(h * 0.055) - alto * len(lineas)
        dib.line([(m, yp - int(esc * .035)), (w - m, yp - int(esc * .035))],
                 fill=ESQ_TENUE, width=2)
        for ln in lineas:
            dib.text((m, yp), ln, font=f_p, fill=ESQ_TENUE)
            yp += alto
    return _guardar(img, salida)


PLANTILLAS = {
    "comparar": comparar,
    "tendencia": tendencia,
    "reparto": reparto,
    "flujo": flujo,
    "fases": fases,
    "esquema": esquema,
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

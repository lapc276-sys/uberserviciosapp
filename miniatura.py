#!/usr/bin/env python3
"""Miniatura para el directo de YouTube.

Una miniatura se decide a 168x94 píxeles: ese es el tamaño al que YouTube
la enseña en el móvil, y es donde se gana o se pierde el clic. De ahí
todo lo que hace esto — dos palabras enormes, contraste alto y nada que
no se lea a ese tamaño.

La primera versión era 100% tipografía sobre fondo abstracto. Un canal
de motor compitiendo con clics vive de la fotografía — coche, pista,
acción — y una miniatura sin ninguna se queda corta contra cualquier
canal que sí la use. Ahora hay una FOTO real, de archivo con licencia
libre (Pexels), en una tarjeta a la derecha; si no hay clave de Pexels o
falla la búsqueda, cae sola al diseño abstracto de siempre — nunca se
rompe la miniatura por no tener foto.

Nunca fotos de pilotos con la cara reconocible ni de coches con la
librea de un equipo real: eso son derechos de imagen y de marca ajenos.
Las búsquedas piden coche/pista/casco genéricos, no "Formula 1".

Uso:

    python3 miniatura.py "Dutch GP" --circuito Zandvoort
    python3 miniatura.py "Italian GP" --circuito Monza --salida monza.jpg
    python3 miniatura.py "Dutch GP" --sesion QUALIFYING
    python3 miniatura.py "Dutch GP" --foto mi_foto.jpg      # foto propia
    python3 miniatura.py "Dutch GP" --sin-foto               # fuerza el
                                                               # diseño de siempre

Sale un JPG de 1280x720 por debajo de 2 MB, que es lo que admite OBS.
Necesita PEXELS_API_KEY en el entorno para buscar la foto sola; gratis
en https://www.pexels.com/api/.
"""

import argparse
import io
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import diagramas as D                                          # noqa: E402

W, H = 1280, 720

PEXELS_API_KEY = os.environ.get("PEXELS_API_KEY", "")

# Consultas genéricas, en este orden: nunca "Formula 1" ni el nombre de un
# piloto o equipo — coche, pista, casco, sin más. Con eso se evita traer
# una librea real o una cara reconocible, y de paso Pexels devuelve más
# resultados (lo específico tiene menos archivo que lo genérico).
_BUSQUEDAS_FOTO = [
    "race car track action",
    "motorsport wheel close up",
    "racing helmet driver",
    "race track asphalt sunset",
    "pit lane motorsport",
]


def _buscar_foto(consultas, ancho_min=900):
    """Primera foto de Pexels que sirva, o None.

    Sin PEXELS_API_KEY, o sin red, o sin resultados: None, sin más — el
    llamador cae al diseño de siempre. Nunca lanza.
    """
    if not PEXELS_API_KEY:
        return None
    import httpx
    from PIL import Image
    with httpx.Client(timeout=12) as cliente:
        for q in consultas:
            try:
                r = cliente.get(
                    "https://api.pexels.com/v1/search",
                    params={"query": q, "orientation": "landscape",
                           "size": "large", "per_page": 8},
                    headers={"Authorization": PEXELS_API_KEY})
                r.raise_for_status()
                fotos = r.json().get("photos") or []
            except Exception:
                continue
            for f in fotos:
                src = f.get("src") or {}
                url = src.get("large2x") or src.get("large") or src.get(
                    "original")
                if not url or f.get("width", 0) < ancho_min:
                    continue
                try:
                    rf = cliente.get(url)
                    rf.raise_for_status()
                    img = Image.open(io.BytesIO(rf.content)).convert("RGB")
                except Exception:
                    continue
                return img
    return None


def _cubrir(img, w, h):
    """Recorta y escala una foto para que cubra exactamente w×h, centrada.

    Es el "cover" de CSS: nada de bordes vacíos ni foto deformada."""
    from PIL import Image
    ir = img.width / img.height
    if ir > w / h:
        nh = h
        nw = int(h * ir)
    else:
        nw = w
        nh = int(w / ir)
    img = img.resize((nw, nh), Image.LANCZOS)
    x0, y0 = (nw - w) // 2, (nh - h) // 2
    return img.crop((x0, y0, x0 + w, y0 + h))


def _redondear(img, radio):
    """Recorta una imagen a esquinas redondeadas, con máscara alfa."""
    from PIL import Image, ImageDraw
    mascara = Image.new("L", img.size, 0)
    ImageDraw.Draw(mascara).rounded_rectangle(
        [0, 0, img.width, img.height], radius=radio, fill=255)
    salida = img.convert("RGBA")
    salida.putalpha(mascara)
    return salida


def _degradado(dib, w, h):
    """Fondo con un rescoldo rojo abajo a la izquierda.

    Plano queda muerto; un degradado entero distrae del texto. Un solo
    foco de luz da profundidad y deja el resto oscuro para que las letras
    blancas destaquen.
    """
    cx, cy, r = w * 0.12, h * 1.05, w * 0.78
    for i in range(60, 0, -1):
        f = i / 60
        rad = r * f
        a = int(26 * (1 - f) ** 1.6)
        if a <= 0:
            continue
        dib.ellipse([cx - rad, cy - rad, cx + rad, cy + rad],
                    fill=(10 + a, 12 + a // 3, 16 + a // 4))


def _trazado_cacheado(circuito):
    """El trazado REAL del circuito, si el canal ya lo tiene guardado.

    Se guarda en cache/trazados/<circuito>.json cuando la app dibuja el
    mapa de una sesión, así que en el servidor del canal suele estar. Es
    GPS de una vuelta de verdad: para la miniatura de un Gran Premio
    concreto, la silueta auténtica dice mucho más que una forma bonita.
    """
    import json as _json
    import re as _re
    clave = _re.sub(r"[^a-z0-9]+", "", (circuito or "").lower())
    if not clave:
        return None
    ruta = os.path.join("cache", "trazados", f"{clave}.json")
    try:
        with open(ruta, encoding="utf-8") as f:
            d = _json.load(f)
        pts = [(float(p["x"]), float(p["y"])) for p in d
               if isinstance(p, dict) and p.get("x") is not None
               and p.get("y") is not None]
        return pts if len(pts) > 40 else None
    except Exception:
        return None


def _traza_real(dib, w, h, pts):
    """Dibuja el trazado de verdad, encuadrado como la silueta genérica.

    Mismo sitio y mismo tono apagado: es fondo, no protagonista. Lo único
    que cambia es que la forma existe.
    """
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    ancho = (max(xs) - min(xs)) or 1.0
    alto = (max(ys) - min(ys)) or 1.0
    # Cabe en la mitad derecha, que es donde no hay texto.
    esc = min(w * 0.42 / ancho, h * 0.78 / alto)
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    p = [(w * 0.75 + (x - cx) * esc, h * 0.46 - (y - cy) * esc)
         for x, y in pts]
    dib.line(p + [p[0]], fill="#171E28", width=26, joint="curve")
    dib.line(p + [p[0]], fill="#1E2735", width=6, joint="curve")


def _coche(dib, x, y, largo, color):
    """Silueta de F1 vista desde arriba, dibujada por nosotros.

    Genérica a propósito: sin librea, sin números y sin logotipos. El
    color es el del equipo y nada más — la decoración real de un coche es
    marca ajena.

    Dos intentos antes de que se leyera. El primero salía como una
    MANCUERNA (los dos alerones igual de anchos y el cuerpo estrecho en
    medio). El segundo tenía las ruedas separadas del chasis, flotando
    como cuadrados sueltos. Lo que hace que se lea "coche" es que las
    ruedas TOQUEN el cuerpo y sobresalgan poco, y que el alerón trasero
    sea más ancho que el delantero.
    """
    L = largo
    def R(x0, y0, x1, y1, col):
        ax, bx_ = sorted((x + x0 * L, x + x1 * L))
        ay, by_ = sorted((y + y0 * L, y + y1 * L))
        dib.rectangle([ax, ay, bx_, by_], fill=col)
    def P(pts, col):
        dib.polygon([(x + a * L, y + b * L) for a, b in pts], fill=col)

    rueda = "#12161C"
    # Ruedas: pegadas al cuerpo (empiezan en 0.09, que es su medio ancho)
    # y sobresaliendo poco. Van primero para que el chasis las remate.
    for rx in (-0.34, 0.14):
        for ry in (-1, 1):
            R(rx, ry * 0.09, rx + 0.19, ry * 0.21, rueda)
    # Alerón delantero
    R(-0.50, -0.21, -0.43, 0.21, color)
    # Chasis: morro afilado que se ensancha suavemente hacia atrás. Sin
    # cintura: una silueta de coche no se estrecha en el medio.
    P([(-0.43, -0.035), (-0.16, -0.075), (0.10, -0.10), (0.36, -0.10),
       (0.42, -0.07), (0.42, 0.07), (0.36, 0.10), (0.10, 0.10),
       (-0.16, 0.075), (-0.43, 0.035)], color)
    # Alerón trasero: más ancho que el delantero
    R(0.40, -0.27, 0.50, 0.27, color)
    # Cabina
    dib.ellipse([x - 0.09 * L, y - 0.045 * L, x + 0.03 * L, y + 0.045 * L],
                fill="#0B0E13")


def _podio(dib, x, y, ancho, filas, fuente_pos, fuente_acr):
    """Los tres primeros, en una tira. `filas` = [(pos, acr, color)].

    Va con el color de equipo en una pastilla, no con el nombre completo:
    a 168 píxeles de ancho —que es donde se decide el clic— un apellido
    largo no se lee y tres acrónimos sí.
    """
    alto = 52
    for i, (pos, acr, color) in enumerate(filas[:3]):
        yy = y + i * (alto + 8)
        # Pastilla de posición
        dib.rounded_rectangle([x, yy, x + 46, yy + alto], radius=10,
                              fill="#" + color.lstrip("#"))
        w = dib.textlength(str(pos), font=fuente_pos)
        dib.text((x + 23 - w / 2, yy + 6), str(pos), font=fuente_pos,
                 fill="#0B0E13")
        dib.text((x + 60, yy + 4), acr, font=fuente_acr, fill="#FFFFFF")


def _traza(dib, w, h):
    """Silueta de circuito al fondo, muy apagada: da contexto sin robar
    atención. No es ningún circuito real — es una forma genérica."""
    pts = []
    for i in range(200):
        t = i / 200 * math.tau
        rr = 1 + 0.36 * math.sin(3 * t) + 0.16 * math.cos(5 * t)
        pts.append((w * 0.78 + w * 0.20 * rr * math.cos(t),
                    h * 0.46 + h * 0.34 * rr * math.sin(t)))
    dib.line(pts + [pts[0]], fill="#171E28", width=26, joint="curve")
    dib.line(pts + [pts[0]], fill="#1E2735", width=6, joint="curve")


def crear(nombre, circuito="", sesion="LIVE", salida="miniatura.jpg",
          año="", foto=None, sin_foto=False, trazado=None):
    """foto: ruta a una imagen propia (se usa tal cual, recortada a la
    tarjeta). None y sin_foto=False → se intenta buscar sola en Pexels.
    sin_foto=True → fuerza el diseño abstracto aunque haya clave.

    trazado: lista [(x, y)] del circuito real. Si no se pasa, se busca en
    el caché del canal por el nombre de `circuito`; y si tampoco está, se
    dibuja la silueta genérica de siempre. Una miniatura del GP de Monza
    con la forma REAL de Monza vale más que una con una curva bonita."""
    from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
    img = Image.new("RGB", (W, H), "#08090C")
    dib = ImageDraw.Draw(img)
    _degradado(dib, W, H)

    foto_img = None
    if not sin_foto:
        if foto:
            try:
                foto_img = Image.open(foto).convert("RGB")
            except Exception as e:
                print(f"⚠️  No pude abrir {foto} ({e}) — sigo sin foto")
        else:
            consultas = ([f"{circuito} race track"] if circuito else
                        []) + _BUSQUEDAS_FOTO
            foto_img = _buscar_foto(consultas)

    # ── Tarjeta de foto, a la derecha ──
    # Mismo hueco que antes ocupaba la silueta abstracta del circuito.
    # Con foto: contraste y saturación un pelín arriba (una foto de stock
    # sin retocar se ve plana al lado de las letras), un marco fino y un
    # resplandor rojo detrás para que no quede pegada al fondo. Sin foto
    # (no hay clave, falló la búsqueda, o se pidió --sin-foto): la
    # silueta genérica de siempre — la miniatura nunca se queda coja.
    # La tarjeta se queda CLARA de los otros tres elementos fijos: la
    # marca (arriba a la derecha, hasta ~el 30% del alto), la fila de
    # LIVE/tagline (desde el 71%) y el título (que ocupa la izquierda,
    # con `util` ya recortado para no llegar hasta aquí). Antes la
    # tarjeta subía hasta el 10% del alto y se comía la marca, y bajaba
    # hasta el 86% y se comía el título en nombres largos.
    cx0, cy0 = int(W * 0.655), int(H * 0.30)
    cx1, cy1 = int(W * 0.965), int(H * 0.60)
    if foto_img:
        tarjeta = _cubrir(foto_img, cx1 - cx0, cy1 - cy0)
        tarjeta = ImageEnhance.Contrast(tarjeta).enhance(1.12)
        tarjeta = ImageEnhance.Color(tarjeta).enhance(1.18)
        tarjeta = ImageEnhance.Brightness(tarjeta).enhance(0.92)
        # Resplandor: la misma silueta, agrandada y desenfocada, detrás
        halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(halo).rounded_rectangle(
            [cx0 - 14, cy0 - 14, cx1 + 14, cy1 + 14], radius=32,
            fill=(255, 45, 22, 130))
        halo = halo.filter(ImageFilter.GaussianBlur(22))
        img.paste(halo, (0, 0), halo)
        img.paste(_redondear(tarjeta, 22), (cx0, cy0),
                  _redondear(tarjeta, 22))
        dib = ImageDraw.Draw(img)
        dib.rounded_rectangle([cx0, cy0, cx1, cy1], radius=22,
                              outline="#FF2D16", width=3)
    else:
        # El trazado REAL si lo hay (pasado o en el caché del canal), y si
        # no la silueta genérica. Nunca se queda sin fondo.
        pts = trazado if trazado else _trazado_cacheado(circuito)
        if pts:
            _traza_real(dib, W, H, pts)
        else:
            _traza(dib, W, H)

    # Franja roja inclinada a la izquierda: ancla la vista y separa el
    # texto del fondo sin necesidad de una caja.
    dib.polygon([(0, 0), (128, 0), (56, H), (0, H)], fill="#FF2D16")
    dib.polygon([(128, 0), (150, 0), (78, H), (56, H)], fill="#0A0C11")

    m = 190
    # ── El nombre, que es el 90% de la miniatura ──
    palabras = nombre.upper().split()
    if len(palabras) >= 3:
        mitad = (len(palabras) + 1) // 2
        lineas = [" ".join(palabras[:mitad]), " ".join(palabras[mitad:])]
    elif len(palabras) == 2:
        lineas = palabras
    else:
        lineas = palabras
    # Se busca el cuerpo más grande que quepa: un nombre largo no debe
    # salirse, y uno corto tiene que llenar.
    # El ancho útil descuenta lo que haya a la derecha: la esquina del
    # logo sin foto, o el borde de la tarjeta con foto — sin esto un
    # nombre largo como "Abu Dhabi Grand Prix" se metía por debajo.
    util = W - m - ((W - cx0 + 26) if foto_img else 300)
    tam = 200
    while tam > 54:
        f = D._fuente(tam, True)
        if max(dib.textlength(l, font=f) for l in lineas) <= util:
            break
        tam -= 5
    f_gp = D._fuente(tam, True)
    alto_linea = int(tam * 1.02)
    y = int(H * 0.30) - (alto_linea * len(lineas)) // 2
    for i, l in enumerate(lineas):
        # Sombra dura: garantiza el contraste aunque el fondo cambie
        dib.text((m + 5, y + 5), l, font=f_gp, fill="#000000")
        dib.text((m, y), l, font=f_gp, fill="#FFFFFF" if i == 0 else "#FF2D16")
        y += alto_linea

    # ── Circuito ──
    if circuito:
        f_c = D._fuente(40, True)
        D._texto(dib, (m + 4, y + 14), circuito.upper(), f_c, "#8892A3",
                 esp=7)
        y += 74

    # ── Insignia LIVE ──
    f_l = D._fuente(38, True)
    et = (sesion or "LIVE").upper()
    ancho_et = D._ancho(dib, et, f_l, 8) + 92
    bx, by = m, int(H * 0.71)
    dib.rectangle([bx, by, bx + ancho_et, by + 66], fill="#FF2D16")
    dib.ellipse([bx + 28, by + 25, bx + 44, by + 41], fill="#FFFFFF")
    D._texto(dib, (bx + 60, by + 14), et, f_l, "#FFFFFF", esp=8)

    # ── Lo que de verdad ofreces: sin esto parece un canal pirata ──
    # El mismo "encoger hasta que quepa" que el título: con una sesión
    # larga ("QUALIFYING") la insignia ocupa más sitio y a 30px la frase
    # se salía del lienzo por la derecha — "COMMENTARY" cortado a media
    # letra en el borde. Con LIVE (lo normal) esto no cambia nada.
    disponible = W - (bx + ancho_et + 34) - 24
    tag = "TIMING · STRATEGY · COMMENTARY"
    tam_s, f_s = 30, D._fuente(30, True)
    while tam_s > 18:
        f_s = D._fuente(tam_s, True)
        if D._ancho(dib, tag, f_s, esp=4) <= disponible:
            break
        tam_s -= 2
    # Con una sesión larga ("SPRINT QUALIFYING") la insignia por sí sola ya
    # ocupa más de medio lienzo: por debajo de 18px la frase no se lee ni
    # en el móvil, así que directamente no se pone — mejor sin ella que
    # apretada e ilegible.
    if D._ancho(dib, tag, f_s, esp=4) <= disponible:
        D._texto(dib, (bx + ancho_et + 34, by + 20 + (30 - tam_s) // 2),
                 tag, f_s, "#C9D0DB", esp=4)

    # ── Marca del canal ──
    f_m = D._fuente(46, True)
    D._texto(dib, (W - 54, 44), "APEX", f_m, "#FFFFFF", esp=3, derecha=True)
    for i, (dx, op) in enumerate(((0, "#FF2D16"), (14, "#B32410"),
                                  (28, "#6E1809"))):
        dib.polygon([(W - 150 + dx, 108 + i * 15), (W - 90 + dx, 108 + i * 15),
                     (W - 104 + dx, 126 + i * 15), (W - 164 + dx, 126 + i * 15)],
                    fill=op)
    if año:
        f_a = D._fuente(34, True)
        D._texto(dib, (W - 54, 168), str(año), f_a, "#8892A3", esp=6,
                 derecha=True)

    # JPG de calidad alta: muy por debajo de los 2 MB que admite OBS y sin
    # los halos que deja un JPG apretado alrededor de las letras.
    img.save(salida, "JPEG", quality=92, optimize=True)
    return salida


def crear_podio(titular, podio, circuito="", sesion="RACE", subtitulo="",
                salida="miniatura.jpg", trazado=None):
    """Miniatura con GANCHO: un titular grande, los tres primeros y coches.

    La otra variante dice qué Gran Premio es. Esta dice QUÉ PASÓ, que es
    lo que hace que alguien pulse: "GASLY" y "POLE" cuentan una historia;
    "ITALIAN GP" cuenta un calendario.

    `podio` = [(pos, acrónimo, color de equipo)]. Los acrónimos y no los
    apellidos porque la miniatura se decide a 168 píxeles de ancho, y ahí
    un apellido largo no se lee.
    """
    import diagramas as D
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (W, H), "#08090C")
    dib = ImageDraw.Draw(img)
    _degradado(dib, W, H)

    # Fondo: el circuito, muy apagado.
    pts = trazado if trazado else _trazado_cacheado(circuito)
    if pts:
        _traza_real(dib, W, H, pts)
    else:
        _traza(dib, W, H)

    # Los coches, en fila y en diagonal, como saliendo de la parrilla.
    # De mayor a menor: el primero manda y los otros dos le siguen.
    for i, (_pos, _acr, color) in enumerate(podio[:3]):
        largo = 300 - i * 62
        x = W * 0.615 + i * 128
        y = H * 0.30 + i * 148
        _coche(dib, x, y, largo, "#" + color.lstrip("#"))

    # La franja roja llega hasta x=150, así que el texto NO puede empezar
    # en el margen de siempre: en el primer intento "GASLY" y "POLE"
    # arrancaban por debajo de ella y salían cortados por la izquierda.
    dib.polygon([(0, 0), (128, 0), (56, H), (0, H)], fill="#FF2D16")
    dib.polygon([(128, 0), (150, 0), (78, H), (56, H)], fill="#0A0C11")

    m = 172
    util = W * 0.44        # la mitad derecha es de los coches

    # ── El titular, lo más grande que quepa ──
    palabras = titular.upper().split()
    lineas = ([" ".join(palabras[:1]), " ".join(palabras[1:])]
              if len(palabras) > 1 else palabras)
    tam = 150
    while tam > 52:
        f = D._fuente(tam, True)
        if max(dib.textlength(l, font=f) for l in lineas) <= util:
            break
        tam -= 5
    f_t = D._fuente(tam, True)
    alto = int(tam * 1.02)
    y = 48
    for i, l in enumerate(lineas):
        dib.text((m + 5, y + 5), l, font=f_t, fill="#000000")
        dib.text((m, y), l, font=f_t, fill="#FFFFFF" if i == 0 else "#FF2D16")
        y += alto

    if subtitulo:
        f_s = D._fuente(30, True)
        D._texto(dib, (m + 4, y + 6), subtitulo.upper(), f_s, "#8892A3",
                 esp=6)
        y += 54

    # ── Los tres primeros, debajo del titular y nunca encima ──
    y = max(y + 16, int(H * 0.50))
    f_pos = D._fuente(30, True)
    f_acr = D._fuente(38, True)
    _podio(dib, m, y, 300, podio, f_pos, f_acr)

    # ── Insignia y marca ──
    f_l = D._fuente(30, True)
    et = (sesion or "LIVE").upper()
    ancho_et = D._ancho(dib, et, f_l, 8) + 78
    bx, by = m, H - 78
    dib.rectangle([bx, by, bx + ancho_et, by + 52], fill="#FF2D16")
    dib.ellipse([bx + 24, by + 19, bx + 38, by + 33], fill="#FFFFFF")
    D._texto(dib, (bx + 50, by + 11), et, f_l, "#FFFFFF", esp=8)
    if circuito:
        f_c = D._fuente(28, True)
        D._texto(dib, (bx + ancho_et + 26, by + 14), circuito.upper(), f_c,
                 "#C9D0DB", esp=6)
    f_m = D._fuente(44, True)
    D._texto(dib, (W - 54, 40), "APEX", f_m, "#FFFFFF", esp=3, derecha=True)

    img.save(salida, "JPEG", quality=88, optimize=True)
    return salida


def _leer_trazado_json(ruta):
    import json as _json
    with open(ruta, encoding="utf-8") as f:
        d = _json.load(f)
    return [(float(p["x"]), float(p["y"])) for p in d
            if isinstance(p, dict) and p.get("x") is not None]


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("nombre", help='Nombre del GP, p.ej. "Dutch GP"')
    p.add_argument("--circuito", default="", help="Zandvoort, Monza…")
    p.add_argument("--sesion", default="LIVE",
                   help="LIVE, QUALIFYING, SPRINT…")
    p.add_argument("--año", default="", help="2026")
    p.add_argument("--salida", default="miniatura.jpg")
    p.add_argument("--foto", default="",
                   help="Ruta a una foto propia (si no, se busca sola)")
    p.add_argument("--sin-foto", action="store_true",
                   help="Fuerza el diseño abstracto, sin buscar foto")
    p.add_argument("--podio", default="",
                   help='Los 3 primeros: "1:GASLY:0093CC,2:RUSSELL:27F4D2,'
                        '3:PIASTRI:FF8000". Activa el diseño con coches.')
    p.add_argument("--titular", default="",
                   help='Gancho grande, p.ej. "Gasly Pole" (con --podio)')
    p.add_argument("--sub", default="", help="Línea pequeña bajo el titular")
    p.add_argument("--trazado", default="",
                   help="JSON del trazado real. Si no se pasa, se busca en "
                        "cache/trazados/<circuito>.json")
    a = p.parse_args()
    pts = None
    if a.trazado:
        try:
            pts = _leer_trazado_json(a.trazado)
        except Exception as e:
            print(f"⚠️  No pude leer {a.trazado} ({e}) — sigo sin trazado")
    if a.podio:
        filas = []
        for trozo in a.podio.split(","):
            partes = [x.strip() for x in trozo.split(":")]
            if len(partes) == 3:
                filas.append((partes[0], partes[1].upper(), partes[2]))
        ruta = crear_podio(a.titular or a.nombre, filas, a.circuito,
                           a.sesion, a.sub, a.salida, pts)
    else:
        ruta = crear(a.nombre, a.circuito, a.sesion, a.salida, a.año,
                    foto=a.foto or None, sin_foto=a.sin_foto, trazado=pts)
    kb = os.path.getsize(ruta) // 1024
    print(f"✅ {ruta} — 1280x720, {kb} KB (OBS admite hasta 2048 KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

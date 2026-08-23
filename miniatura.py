#!/usr/bin/env python3
"""Miniatura para el directo de YouTube.

Una miniatura se decide a 168x94 píxeles: ese es el tamaño al que YouTube
la enseña en el móvil, y es donde se gana o se pierde el clic. De ahí
todo lo que hace esto — dos palabras enormes, contraste alto y nada que
no se lea a ese tamaño.

Uso:

    python3 miniatura.py "Dutch GP" --circuito Zandvoort
    python3 miniatura.py "Italian GP" --circuito Monza --salida monza.jpg
    python3 miniatura.py "Dutch GP" --sesion QUALIFYING

Sale un JPG de 1280x720 por debajo de 2 MB, que es lo que admite OBS.
"""

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import diagramas as D                                          # noqa: E402

W, H = 1280, 720


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
          año=""):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (W, H), "#08090C")
    dib = ImageDraw.Draw(img)
    _degradado(dib, W, H)
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
    # El ancho útil descuenta la esquina del logo: sin eso, un nombre
    # largo como "Abu Dhabi Grand Prix" se metía por debajo de la marca.
    util = W - m - 300
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
    f_s = D._fuente(30, True)
    D._texto(dib, (bx + ancho_et + 34, by + 20),
             "TIMING · STRATEGY · COMMENTARY", f_s, "#C9D0DB", esp=4)

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


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("nombre", help='Nombre del GP, p.ej. "Dutch GP"')
    p.add_argument("--circuito", default="", help="Zandvoort, Monza…")
    p.add_argument("--sesion", default="LIVE",
                   help="LIVE, QUALIFYING, SPRINT…")
    p.add_argument("--año", default="", help="2026")
    p.add_argument("--salida", default="miniatura.jpg")
    a = p.parse_args()
    ruta = crear(a.nombre, a.circuito, a.sesion, a.salida, a.año)
    kb = os.path.getsize(ruta) // 1024
    print(f"✅ {ruta} — 1280x720, {kb} KB (OBS admite hasta 2048 KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

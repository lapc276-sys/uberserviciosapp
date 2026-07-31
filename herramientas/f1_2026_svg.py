"""Esquema técnico vectorial del monoplaza 2026 — vista superior y lateral.

Todo se dibuja EN MILÍMETROS REALES y se escala al final, así que las
proporciones no son "a ojo": salen de las cotas del reglamento, que están
todas arriba como constantes. Cambia una cota y el dibujo se ajusta solo.

Diseño propio del canal: silueta genérica conforme al reglamento, sin
decoración, logos ni referencias a ningún equipo.
"""
import math

# ─────────────────── COTAS DEL REGLAMENTO 2026 (mm) ───────────────────
BATALLA = 3400            # distancia entre ejes (era 3600)
ANCHO_TOTAL = 1900        # 100 menos que 2022-25
LARGO_TOTAL = 5000
ANCHO_SUELO = 1450        # 150 menos que 2022-25
ALTO_TOTAL = 950

ALA_DEL_ANCHO = 1800      # 100 menos; endplates curvados hacia dentro
ALA_TRAS_ANCHO = 1000
# Neumáticos: llanta 18", gomas más estrechas
GOMA_DEL = 280            # -25 mm
GOMA_TRAS = 375           # -30 mm
DIAM_DEL = 720
DIAM_TRAS = 750
LLANTA = 457              # 18 pulgadas

# Posiciones a lo largo del coche (x=0 en la punta del morro)
X_EJE_DEL = 1150
X_EJE_TRAS = X_EJE_DEL + BATALLA          # 4550
X_ALA_DEL = 60
X_ALA_TRAS = 4870

# ─────────────────────────── ESTILO ───────────────────────────
FONDO = "#080b12"
REJILLA = "#131a26"
LINEA = "#e8eef8"          # trazo principal
RELLENO = "#182233"        # carrocería
RELLENO2 = "#101825"       # piezas secundarias
CIAN = "#00e5ff"           # flujo limpio / cotas
MAGENTA = "#ff2d78"        # elementos activos (aero móvil)
AMBAR = "#ffc400"
GRIS = "#5d6b82"


def _p(pts):
    return " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)


def _suave(pts, cierre=False):
    """Camino con curvas suaves (Catmull-Rom → Bézier cúbica)."""
    if len(pts) < 3:
        return "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in pts)
    d = [f"M {pts[0][0]:.1f} {pts[0][1]:.1f}"]
    ext = ([pts[-2]] + pts + [pts[1]]) if cierre else \
          ([pts[0]] + pts + [pts[-1]])
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append(f"C {c1[0]:.1f} {c1[1]:.1f} {c2[0]:.1f} {c2[1]:.1f} "
                 f"{p2[0]:.1f} {p2[1]:.1f}")
    if cierre:
        d.append("Z")
    return " ".join(d)


def _cota(x1, y1, x2, y2, texto, desp=90, color=CIAN, vertical=False):
    """Línea de cota con topes y etiqueta."""
    o = []
    if vertical:
        xc = x1 + desp
        o.append(f'<path d="M {x1} {y1} L {xc} {y1} M {x2} {y2} L {xc} {y2}" '
                 f'stroke="{color}" stroke-width="3" opacity=".45"/>')
        o.append(f'<path d="M {xc} {y1} L {xc} {y2}" stroke="{color}" '
                 f'stroke-width="3.5"/>')
        for yy in (y1, y2):
            o.append(f'<path d="M {xc-14} {yy} L {xc+14} {yy}" '
                     f'stroke="{color}" stroke-width="4"/>')
        o.append(f'<text x="{xc+26}" y="{(y1+y2)/2+12}" fill="{color}" '
                 f'font-size="60" font-family="DejaVu Sans, sans-serif" '
                 f'font-weight="700">{texto}</text>')
    else:
        yc = y1 + desp
        o.append(f'<path d="M {x1} {y1} L {x1} {yc} M {x2} {y2} L {x2} {yc}" '
                 f'stroke="{color}" stroke-width="3" opacity=".45"/>')
        o.append(f'<path d="M {x1} {yc} L {x2} {yc}" stroke="{color}" '
                 f'stroke-width="3.5"/>')
        for xx in (x1, x2):
            o.append(f'<path d="M {xx} {yc-14} L {xx} {yc+14}" '
                     f'stroke="{color}" stroke-width="4"/>')
        o.append(f'<text x="{(x1+x2)/2}" y="{yc-24}" fill="{color}" '
                 f'font-size="60" text-anchor="middle" '
                 f'font-family="DejaVu Sans, sans-serif" '
                 f'font-weight="700">{texto}</text>')
    return "\n".join(o)


def _etiqueta(x, y, texto, color=AMBAR, ancla="start"):
    return (f'<text x="{x}" y="{y}" fill="{color}" font-size="52" '
            f'text-anchor="{ancla}" font-family="DejaVu Sans, sans-serif" '
            f'font-weight="700" letter-spacing="2">{texto}</text>')


# ───────────────────────── VISTA SUPERIOR ─────────────────────────

def vista_superior():
    """Planta. y=0 es el eje longitudinal; +y a la derecha."""
    o = []
    hw = ANCHO_TOTAL / 2

    # — Silueta del cuerpo: morro fino, pontones anchos, cintura coca-cola —
    perfil = [
        (X_ALA_DEL + 40, 60),        # punta del morro
        (700, 105),
        (1150, 150),                 # a la altura del eje delantero
        (1500, 300),                 # entrada de pontón: se ensancha rápido
        (1750, 430),
        (2250, 460),                 # máximo ancho de pontón
        (2900, 380),                 # empieza el downwash
        (3500, 250),
        (4000, 170),                 # cintura coca-cola, muy estrecha
        (4400, 150),
        (4750, 175),
    ]
    izq = [(x, -y) for x, y in perfil]
    o.append(f'<path d="{_suave(perfil)}" fill="none" stroke="{LINEA}" '
             f'stroke-width="7" stroke-linejoin="round"/>')
    o.append(f'<path d="{_suave(izq)}" fill="none" stroke="{LINEA}" '
             f'stroke-width="7" stroke-linejoin="round"/>')
    cuerpo = _suave(perfil)[1:] + " L " + " L ".join(
        f"{x:.1f} {y:.1f}" for x, y in reversed(izq)) + " Z"
    o.append(f'<path d="M{cuerpo}" fill="{RELLENO}" opacity=".92"/>')

    # — Suelo: 150 mm más estrecho, parcialmente plano —
    hs = ANCHO_SUELO / 2
    o.append(f'<path d="M {1500} {-hs} L {4450} {-hs} L {4450} {hs} '
             f'L {1500} {hs} Z" fill="none" stroke="{GRIS}" '
             f'stroke-width="5" stroke-dasharray="26 18" opacity=".85"/>')
    o.append(_etiqueta(2980, hs - 40, "FLOOR −150 mm · PARTIALLY FLAT",
                       GRIS, "middle"))

    # — Alerón delantero: 1800 mm de envergadura, endplates hacia DENTRO —
    ha = ALA_DEL_ANCHO / 2
    # Plano principal: cruza todo el ancho del alerón
    o.append(f'<path d="M {X_ALA_DEL} {-ha} L {X_ALA_DEL+250} {-ha} '
             f'Q {X_ALA_DEL+330} 0 {X_ALA_DEL+250} {ha} '
             f'L {X_ALA_DEL} {ha} Q {X_ALA_DEL+80} 0 {X_ALA_DEL} {-ha} Z" '
             f'fill="{RELLENO2}" stroke="{LINEA}" stroke-width="7"/>')
    # Dos flaps móviles (aero activa), en magenta
    for dx, op in ((90, 1.0), (185, 0.7)):
        o.append(f'<path d="M {X_ALA_DEL+dx} {-ha+25} Q {X_ALA_DEL+dx+70} 0 '
                 f'{X_ALA_DEL+dx} {ha-25}" fill="none" stroke="{MAGENTA}" '
                 f'stroke-width="10" opacity="{op}" stroke-linecap="round"/>')
    # Endplates CURVADOS HACIA DENTRO: la firma anti-outwash de 2026
    for s_ in (1, -1):
        o.append(f'<path d="M {X_ALA_DEL-30} {s_*ha} '
                 f'C {X_ALA_DEL+240} {s_*ha} {X_ALA_DEL+430} {s_*ha} '
                 f'{X_ALA_DEL+620} {s_*(ha-230)}" fill="none" '
                 f'stroke="{CIAN}" stroke-width="11" stroke-linecap="round"/>')
    o.append(_etiqueta(X_ALA_DEL + 760, -ha - 70,
                       "2-ELEMENT ACTIVE FLAPS", MAGENTA))
    o.append(_etiqueta(X_ALA_DEL + 760, ha + 120,
                       "IN-CURVED ENDPLATES · NO OUTWASH", CIAN))

    # — Placas de control de estela a la entrada del pontón —
    for s in (1, -1):
        o.append(f'<path d="M {1480} {s*520} Q {1700} {s*560} {1900} '
                 f'{s*470}" fill="none" stroke="{AMBAR}" stroke-width="10" '
                 f'stroke-linecap="round"/>')
    o.append(_etiqueta(1560, -640, "IN-WASH WAKE CONTROL BOARDS", AMBAR))

    # — Ruedas: sin tapacubos ni arcos (eliminados en 2026) —
    for x, ancho, diam in ((X_EJE_DEL, GOMA_DEL, DIAM_DEL),
                           (X_EJE_TRAS, GOMA_TRAS, DIAM_TRAS)):
        for s in (1, -1):
            y0 = s * (hw - ancho)
            o.append(f'<rect x="{x-diam/2}" y="{min(y0, y0-s*ancho)}" '
                     f'width="{diam}" height="{ancho}" rx="22" '
                     f'fill="{RELLENO2}" stroke="{LINEA}" stroke-width="6"/>')
            o.append(f'<rect x="{x-LLANTA/2}" y="{min(y0, y0-s*ancho)+28}" '
                     f'width="{LLANTA}" height="{ancho-56}" rx="14" '
                     f'fill="none" stroke="{GRIS}" stroke-width="4"/>')

    # — Alerón trasero: 3 elementos, endplates simplificados —
    hr = ALA_TRAS_ANCHO / 2
    for i, dx in enumerate((0, 105, 210)):
        o.append(f'<path d="M {X_ALA_TRAS+dx} {-hr} L {X_ALA_TRAS+dx} {hr}" '
                 f'stroke="{MAGENTA if i == 2 else LINEA}" '
                 f'stroke-width="{13 if i == 2 else 9}" '
                 f'stroke-linecap="round"/>')
    for s in (1, -1):
        o.append(f'<path d="M {X_ALA_TRAS-60} {s*hr} L {X_ALA_TRAS+270} '
                 f'{s*hr}" stroke="{LINEA}" stroke-width="7"/>')
    o.append(_etiqueta(X_ALA_TRAS + 330, -hr + 20, "3-ELEMENT", LINEA))
    o.append(_etiqueta(X_ALA_TRAS + 330, -hr + 90, "ACTIVE PLANE", MAGENTA))

    # — Líneas de flujo: hacia DENTRO, que es la filosofía de 2026 —
    for s in (1, -1):
        for k, y0 in enumerate((760, 900, 1040)):
            o.append(
                f'<path d="M {-260} {s*y0} C {900} {s*y0} {1700} '
                f'{s*(y0-90)} {2600} {s*(y0-190-k*40)} S {4200} '
                f'{s*(y0-330-k*60)} {5400} {s*(y0-380-k*70)}" fill="none" '
                f'stroke="{CIAN}" stroke-width="5" opacity=".5"/>')
    return "\n".join(o)


# ───────────────────────── VISTA LATERAL ─────────────────────────

def vista_lateral(modo="Z"):
    """Alzado. y=0 es el suelo; hacia arriba es -y."""
    o = []
    suelo = 0

    o.append(f'<path d="M {-400} {suelo} L {5600} {suelo}" stroke="{GRIS}" '
             f'stroke-width="6" opacity=".7"/>')

    # — Silueta lateral: morro bajo, cockpit, airbox, cola caída —
    silueta = [
        (X_ALA_DEL + 60, -150),      # punta del morro
        (900, -230),
        (1500, -300),
        (2000, -430),                # subida al habitáculo
        (2350, -560),                # borde del cockpit
        (2750, -700),                # airbox
        (3050, -690),
        (3700, -520),                # caída agresiva (downwash)
        (4300, -400),
        (4700, -330),
    ]
    o.append(f'<path d="{_suave(silueta)}" fill="none" stroke="{LINEA}" '
             f'stroke-width="7"/>')
    cuerpo = (_suave(silueta)[1:] +
              f" L 4700 {-170} L {X_ALA_DEL+60} {-120} Z")
    o.append(f'<path d="M{cuerpo}" fill="{RELLENO}" opacity=".92"/>')

    # — Suelo plano y difusor —
    o.append(f'<path d="M {1450} {-105} L {4350} {-105} L {4650} {-260}" '
             f'fill="none" stroke="{GRIS}" stroke-width="6"/>')
    o.append(_etiqueta(2900, -60, "FLAT FLOOR", GRIS, "middle"))

    # — Halo —
    o.append(f'<path d="M {2050} {-480} Q {2380} {-800} {2720} {-620}" '
             f'fill="none" stroke="{GRIS}" stroke-width="16" '
             f'stroke-linecap="round" opacity=".9"/>')

    # — Ruedas SIN arcos ni tapacubos —
    for x, diam in ((X_EJE_DEL, DIAM_DEL), (X_EJE_TRAS, DIAM_TRAS)):
        cy = -diam / 2
        o.append(f'<circle cx="{x}" cy="{cy}" r="{diam/2}" '
                 f'fill="{RELLENO2}" stroke="{LINEA}" stroke-width="7"/>')
        o.append(f'<circle cx="{x}" cy="{cy}" r="{LLANTA/2}" fill="none" '
                 f'stroke="{GRIS}" stroke-width="5"/>')
        for k in range(8):
            a = math.pi * k / 4
            o.append(f'<path d="M {x+LLANTA/2*0.28*math.cos(a):.0f} '
                     f'{cy+LLANTA/2*0.28*math.sin(a):.0f} '
                     f'L {x+LLANTA/2*0.92*math.cos(a):.0f} '
                     f'{cy+LLANTA/2*0.92*math.sin(a):.0f}" stroke="{GRIS}" '
                     f'stroke-width="3.5" opacity=".8"/>')
    o.append(_etiqueta(X_EJE_DEL, 110, "NO WHEEL COVERS / ARCHES",
                       AMBAR, "middle"))

    # — Alerón delantero: 2 elementos móviles —
    o.append(f'<path d="M {X_ALA_DEL-20} {-90} Q {X_ALA_DEL+300} {-140} '
             f'{X_ALA_DEL+660} {-155}" fill="none" stroke="{LINEA}" '
             f'stroke-width="14" stroke-linecap="round"/>')
    ang = -175 if modo == "Z" else -140
    o.append(f'<path d="M {X_ALA_DEL+60} {ang} Q {X_ALA_DEL+280} {ang-45} '
             f'{X_ALA_DEL+520} {ang-20}" fill="none" stroke="{MAGENTA}" '
             f'stroke-width="12" stroke-linecap="round"/>')

    # — Alerón trasero: 3 elementos, SIN beam wing —
    if modo == "Z":                      # alta carga: flaps muy inclinados
        elems = [(-700, -790), (-810, -880), (-905, -960)]
    else:                                # X-Mode: planos, baja resistencia
        elems = [(-760, -800), (-870, -890), (-975, -985)]
    for i, (y0, y1) in enumerate(elems):
        col = MAGENTA if i == 2 else LINEA
        o.append(f'<path d="M {X_ALA_TRAS} {y0} L {X_ALA_TRAS+300} {y1}" '
                 f'stroke="{col}" stroke-width="{15 if i == 2 else 12}" '
                 f'stroke-linecap="round"/>')
    # Endplate simplificado (sin cortes pronunciados) y pilón de anclaje
    o.append(f'<path d="M {X_ALA_TRAS-40} {-620} L {X_ALA_TRAS+340} {-620} '
             f'L {X_ALA_TRAS+340} {-1010} L {X_ALA_TRAS-40} {-1010} Z" '
             f'fill="none" stroke="{GRIS}" stroke-width="6" opacity=".75"/>')
    o.append(f'<path d="M {X_ALA_TRAS+60} {-620} L {X_ALA_TRAS+120} {-330} '
             f'L {X_ALA_TRAS-60} {-320} L {4700} {-330}" fill="none" '
             f'stroke="{LINEA}" stroke-width="8" stroke-linejoin="round"/>')
    o.append(_etiqueta(X_ALA_TRAS + 380, -1000,
                       f"{modo}-MODE · 3 ELEMENTS", MAGENTA))
    # Donde ANTES iba el beam wing, ahora no hay nada
    o.append(f'<path d="M {X_ALA_TRAS-20} {-430} L {X_ALA_TRAS+300} {-430}" '
             f'stroke="{MAGENTA}" stroke-width="5" stroke-dasharray="20 20" '
             f'opacity=".55"/>')
    o.append(_etiqueta(X_ALA_TRAS + 380, -420, "NO BEAM WING", MAGENTA))

    # — Flujo aerodinámico por encima y por debajo —
    for k, y0 in enumerate((-820, -940, -1060)):
        o.append(f'<path d="M {-350} {y0} C {1200} {y0} {2000} {y0+40} '
                 f'{2700} {y0-60} S {4300} {y0-40} {5500} {y0+30}" '
                 f'fill="none" stroke="{CIAN}" stroke-width="5" '
                 f'opacity=".45"/>')
    o.append(f'<path d="M {-350} {-60} L {1400} {-60} C {2600} {-60} {3400} '
             f'{-80} {4400} {-200} S {5100} {-330} {5500} {-360}" '
             f'fill="none" stroke="{CIAN}" stroke-width="6" opacity=".7"/>')
    return "\n".join(o)


# ───────────────────────── DOCUMENTO ─────────────────────────

def svg(modo="Z", ancho=1600):
    esc = 0.235                      # mm → unidades del lienzo
    W = 6600
    H = 5400
    alto = int(ancho * H / W)
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
         f'width="{ancho}" height="{alto}" '
         f'preserveAspectRatio="xMidYMid meet" '
         f'font-family="DejaVu Sans, sans-serif">']
    o.append(f'<rect width="{W}" height="{H}" fill="{FONDO}"/>')
    # Rejilla técnica de fondo
    for gx in range(0, W, 150):
        o.append(f'<path d="M {gx} 0 L {gx} {H}" stroke="{REJILLA}" '
                 f'stroke-width="2"/>')
    for gy in range(0, H, 150):
        o.append(f'<path d="M 0 {gy} L {W} {gy}" stroke="{REJILLA}" '
                 f'stroke-width="2"/>')
    o.append(f'<rect width="{W}" height="14" fill="#e10600"/>')

    o.append('<text x="150" y="230" fill="#ffffff" font-size="130" '
             'font-weight="800" letter-spacing="4">'
             'F1 2026 · AGILE CAR CONCEPT</text>')
    o.append(f'<text x="150" y="330" fill="{GRIS}" font-size="62" '
             f'letter-spacing="3">TECHNICAL SCHEMATIC · '
             f'WHEELBASE {BATALLA} mm · WIDTH {ANCHO_TOTAL} mm · '
             f'RATIO {BATALLA/ANCHO_TOTAL:.2f}:1</text>')

    # Vista superior
    o.append(f'<text x="150" y="620" fill="{CIAN}" font-size="76" '
             f'font-weight="800" letter-spacing="6">TOP VIEW</text>')
    o.append(f'<g transform="translate(900 1560) scale(0.96)">')
    o.append(vista_superior())
    o.append(_cota(X_EJE_DEL, 1250, X_EJE_TRAS, 1250,
                   f"WHEELBASE {BATALLA} mm", desp=170))
    o.append(_cota(-330, -ANCHO_TOTAL/2, -330, ANCHO_TOTAL/2,
                   f"{ANCHO_TOTAL} mm", desp=-260, vertical=True))
    o.append('</g>')

    # Vista lateral
    o.append(f'<text x="150" y="3450" fill="{CIAN}" font-size="76" '
             f'font-weight="800" letter-spacing="6">SIDE VIEW · '
             f'{modo}-MODE</text>')
    o.append('<g transform="translate(760 4720) scale(0.96)">')
    o.append(vista_lateral(modo))
    o.append('</g>')

    # Pie con las cotas de neumático
    o.append(f'<text x="150" y="{H-110}" fill="{GRIS}" font-size="56" '
             f'letter-spacing="2">18" RIMS · FRONT TYRE {GOMA_DEL} mm '
             f'(−25) · REAR TYRE {GOMA_TRAS} mm (−30) · '
             f'FLOOR −150 mm · NO BEAM WING</text>')
    o.append('</svg>')
    return "\n".join(o)


if __name__ == "__main__":
    import os
    AQUI = os.path.dirname(os.path.abspath(__file__))
    for modo in ("Z", "X"):
        ruta = os.path.join(AQUI, f"f1_2026_{modo.lower()}mode.svg")
        with open(ruta, "w", encoding="utf-8") as f:
            f.write(svg(modo))
        print("escrito:", ruta)

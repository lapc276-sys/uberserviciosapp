"""Variantes del esquema 2026: reglaje de carga y daño en pieza.

Todo sale del MISMO coche base (f1_2026_svg.py, cotas del reglamento). Lo
único que cambia entre variantes es el reglaje aerodinámico o el estado de
una pieza — igual que en la realidad.

Regla de la casa, decidida con el canal: aquí se dibujan configuraciones
GENÉRICAS y física, nunca "el pontón del equipo X". No conocemos la
geometría real de ningún equipo, y dibujarla como si la supiéramos sería
inventar. Cuando haya que hablar de un equipo concreto, el dato lo pone la
telemetría medida, no el dibujo.

Formato vertical 1080x1920 pensado para Shorts.
"""
import math
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import f1_2026_svg as base  # noqa: E402

ROJO_AVISO = "#ff3b30"

# ─────────────────────────── VARIANTES ───────────────────────────
# ala_del / ala_tras: incidencia relativa (1.0 = máxima carga)
# dano: None, o el lado y la pieza afectada
VARIANTES = {
    "alta_carga": {
        "titulo": "MAXIMUM DOWNFORCE",
        "sub": "Monaco-style setup",
        "ala_del": 1.00, "ala_tras": 1.00, "dano": None,
        "notas": ["Wings at full angle", "More grip in corners",
                  "Slower on the straights"],
    },
    "baja_carga": {
        "titulo": "MINIMUM DOWNFORCE",
        "sub": "Monza-style setup",
        "ala_del": 0.35, "ala_tras": 0.30, "dano": None,
        "notas": ["Wings flattened out", "Top speed maximised",
                  "Far less grip in corners"],
    },
    "ala_rota": {
        "titulo": "BROKEN FRONT WING",
        "sub": "What the car does next",
        "ala_del": 0.85, "ala_tras": 0.95,
        "dano": {"lado": 1, "pieza": "FRONT WING ENDPLATE"},
        "notas": ["Downforce lost on one side only",
                  "The car pulls wide in corners",
                  "Debris can block the radiators"],
    },
    "suelo_roto": {
        "titulo": "DAMAGED FLOOR",
        "sub": "The damage nobody sees",
        "ala_del": 0.90, "ala_tras": 0.90,
        "dano": {"lado": -1, "pieza": "FLOOR EDGE"},
        "notas": ["The floor makes most of the downforce",
                  "A small tear costs whole seconds a lap",
                  "Nothing looks broken from outside"],
    },
    "drs_abierto": {
        "titulo": "ACTIVE AERO OPEN",
        "sub": "X-Mode on the straight",
        "ala_del": 0.30, "ala_tras": 0.20, "dano": None,
        "notas": ["The flap lies almost flat", "Drag drops, speed climbs",
                  "In 2026 both wings move, not just the rear"],
    },
    "aire_sucio": {
        "titulo": "DIRTY AIR",
        "sub": "Why following is so hard",
        "ala_del": 0.95, "ala_tras": 0.95, "dano": None, "estela": True,
        "notas": ["The car ahead leaves churned air",
                  "The chaser loses front downforce",
                  "2026 aims the wake upward, not sideways"],
    },
}


def _flujo_planta(cfg, o):
    """Líneas de flujo en planta.

    Con daño, el lado roto se desordena desde el alerón. Con `estela`, el
    aire sale limpio por delante y se rompe DETRÁS del coche — que es lo
    que se encuentra el que viene persiguiendo.
    """
    dano = cfg.get("dano")
    if cfg.get("estela"):
        for s in (1, -1):
            for k, y0 in enumerate((520, 700, 880)):
                d = [f"M -260 {s*y0}"]
                x, y = -260.0, float(s * y0)
                for i in range(26):
                    x += 220
                    # Limpio hasta pasar el coche; a partir de ahí, revuelto
                    if x < 4400:
                        y += s * 6
                        col_x = x
                    else:
                        y += math.sin(i * 1.5 + k * 2) * 70 + s * 22
                    d.append(f"L {x:.0f} {y:.0f}")
                trazo = " ".join(d)
                o.append(f'<path d="{trazo}" fill="none" stroke="{base.CIAN}" '
                         f'stroke-width="5" opacity=".45"/>')
        # Zona de estela marcada
        o.append(f'<rect x="4500" y="-1150" width="1600" height="2300" '
                 f'fill="{ROJO_AVISO}" opacity=".07"/>')
        o.append(base._etiqueta(4600, -1240, "TURBULENT WAKE", ROJO_AVISO))
        return
    for s in (1, -1):
        roto = bool(dano) and dano["lado"] == s
        for k, y0 in enumerate((760, 900, 1040)):
            if not roto:
                # 2026: el aire se recoge hacia dentro (in-wash)
                o.append(
                    f'<path d="M -260 {s*y0} C 900 {s*y0} 1700 {s*(y0-90)} '
                    f'2600 {s*(y0-190-k*40)} S 4200 {s*(y0-330-k*60)} '
                    f'5400 {s*(y0-380-k*70)}" fill="none" '
                    f'stroke="{base.CIAN}" stroke-width="5" opacity=".5"/>')
            else:
                # Sin endplate el flujo se abre y se vuelve turbulento
                d = [f"M -260 {s*y0}"]
                x, y = -260.0, float(s * y0)
                for i in range(26):
                    x += 220
                    y += s * (12 + k * 4) + math.sin(i * 1.25 + k) * (
                        46 if x > 900 else 5)
                    d.append(f"L {x:.0f} {y:.0f}")
                o.append(f'<path d="{" ".join(d)}" fill="none" '
                         f'stroke="{ROJO_AVISO}" stroke-width="5" '
                         f'opacity=".62"/>')


def vista_superior(cfg):
    """Planta, con el reglaje y el daño aplicados."""
    o = []
    hw = base.ANCHO_TOTAL / 2
    dano = cfg.get("dano")

    perfil = [(base.X_ALA_DEL + 40, 60), (700, 105), (1150, 150),
              (1500, 300), (1750, 430), (2250, 460), (2900, 380),
              (3500, 250), (4000, 170), (4400, 150), (4750, 175)]
    izq = [(x, -y) for x, y in perfil]
    cuerpo = base._suave(perfil)[1:] + " L " + " L ".join(
        f"{x:.1f} {y:.1f}" for x, y in reversed(izq)) + " Z"
    o.append(f'<path d="M{cuerpo}" fill="{base.RELLENO}" opacity=".92"/>')
    for p in (perfil, izq):
        o.append(f'<path d="{base._suave(p)}" fill="none" '
                 f'stroke="{base.LINEA}" stroke-width="7"/>')

    # Alerón delantero
    ha = base.ALA_DEL_ANCHO / 2
    o.append(f'<path d="M {base.X_ALA_DEL} {-ha} L {base.X_ALA_DEL+250} {-ha} '
             f'Q {base.X_ALA_DEL+330} 0 {base.X_ALA_DEL+250} {ha} '
             f'L {base.X_ALA_DEL} {ha} Q {base.X_ALA_DEL+80} 0 '
             f'{base.X_ALA_DEL} {-ha} Z" fill="{base.RELLENO2}" '
             f'stroke="{base.LINEA}" stroke-width="7"/>')
    # Flaps: su curvatura refleja el ángulo del reglaje
    comba = 40 + 90 * cfg["ala_del"]
    for dx, op in ((90, 1.0), (185, 0.7)):
        o.append(f'<path d="M {base.X_ALA_DEL+dx} {-ha+25} '
                 f'Q {base.X_ALA_DEL+dx+comba} 0 {base.X_ALA_DEL+dx} {ha-25}" '
                 f'fill="none" stroke="{base.MAGENTA}" stroke-width="10" '
                 f'opacity="{op}" stroke-linecap="round"/>')
    # Endplates: el del lado dañado, ausente
    for s_ in (1, -1):
        if dano and dano["lado"] == s_ and "FLOOR" in dano["pieza"]:
            o.append(f'<path d="M 2600 {s_*430} L 3600 {s_*250}" '
                     f'fill="none" stroke="{ROJO_AVISO}" stroke-width="14" '
                     f'stroke-dasharray="46 30" stroke-linecap="round"/>')
            o.append(f'<circle cx="3100" cy="{s_*340}" r="230" fill="none" '
                     f'stroke="{ROJO_AVISO}" stroke-width="8" '
                     f'stroke-dasharray="30 22"/>')
        elif dano and dano["lado"] == s_:
            o.append(f'<path d="M {base.X_ALA_DEL-30} {s_*ha} '
                     f'L {base.X_ALA_DEL+150} {s_*(ha-40)}" fill="none" '
                     f'stroke="{ROJO_AVISO}" stroke-width="11" '
                     f'stroke-linecap="round"/>')
            o.append(f'<circle cx="{base.X_ALA_DEL+330}" cy="{s_*(ha-60)}" '
                     f'r="130" fill="none" stroke="{ROJO_AVISO}" '
                     f'stroke-width="8" stroke-dasharray="30 22"/>')
            continue
        o.append(f'<path d="M {base.X_ALA_DEL-30} {s_*ha} '
                 f'C {base.X_ALA_DEL+240} {s_*ha} {base.X_ALA_DEL+430} '
                 f'{s_*ha} {base.X_ALA_DEL+620} {s_*(ha-230)}" fill="none" '
                 f'stroke="{base.CIAN}" stroke-width="11" '
                 f'stroke-linecap="round"/>')

    # Ruedas
    for x, ancho, diam in ((base.X_EJE_DEL, base.GOMA_DEL, base.DIAM_DEL),
                           (base.X_EJE_TRAS, base.GOMA_TRAS, base.DIAM_TRAS)):
        for s in (1, -1):
            y0 = s * (hw - ancho)
            o.append(f'<rect x="{x-diam/2}" y="{min(y0, y0-s*ancho)}" '
                     f'width="{diam}" height="{ancho}" rx="22" '
                     f'fill="{base.RELLENO2}" stroke="{base.LINEA}" '
                     f'stroke-width="6"/>')

    # Alerón trasero (3 elementos)
    hr = base.ALA_TRAS_ANCHO / 2
    for i, dx in enumerate((0, 105, 210)):
        o.append(f'<path d="M {base.X_ALA_TRAS+dx} {-hr} '
                 f'L {base.X_ALA_TRAS+dx} {hr}" '
                 f'stroke="{base.MAGENTA if i == 2 else base.LINEA}" '
                 f'stroke-width="{13 if i == 2 else 9}" '
                 f'stroke-linecap="round"/>')

    _flujo_planta(cfg, o)
    if dano:
        o.append(base._etiqueta(base.X_ALA_DEL + 780, -ha - 90,
                                f"{dano['pieza']} GONE", ROJO_AVISO))
        o.append(base._etiqueta(2700, -1240,
                                "TURBULENT AIR — DOWNFORCE LOST THIS SIDE",
                                ROJO_AVISO))
    return "\n".join(o)


def vista_lateral(cfg):
    """Alzado, con el ángulo de los alerones según el reglaje."""
    o = []
    o.append(f'<path d="M -400 0 L 5600 0" stroke="{base.GRIS}" '
             f'stroke-width="6" opacity=".7"/>')
    silueta = [(base.X_ALA_DEL + 60, -150), (900, -230), (1500, -300),
               (2000, -430), (2350, -560), (2750, -700), (3050, -690),
               (3700, -520), (4300, -400), (4700, -330)]
    cuerpo = (base._suave(silueta)[1:] +
              f" L 4700 -170 L {base.X_ALA_DEL+60} -120 Z")
    o.append(f'<path d="M{cuerpo}" fill="{base.RELLENO}" opacity=".92"/>')
    o.append(f'<path d="{base._suave(silueta)}" fill="none" '
             f'stroke="{base.LINEA}" stroke-width="7"/>')
    o.append(f'<path d="M 1450 -105 L 4350 -105 L 4650 -260" fill="none" '
             f'stroke="{base.GRIS}" stroke-width="6"/>')
    o.append(f'<path d="M 2050 -480 Q 2380 -800 2720 -620" fill="none" '
             f'stroke="{base.GRIS}" stroke-width="16" stroke-linecap="round" '
             f'opacity=".9"/>')
    for x, diam in ((base.X_EJE_DEL, base.DIAM_DEL),
                    (base.X_EJE_TRAS, base.DIAM_TRAS)):
        o.append(f'<circle cx="{x}" cy="{-diam/2}" r="{diam/2}" '
                 f'fill="{base.RELLENO2}" stroke="{base.LINEA}" '
                 f'stroke-width="7"/>')
        o.append(f'<circle cx="{x}" cy="{-diam/2}" r="{base.LLANTA/2}" '
                 f'fill="none" stroke="{base.GRIS}" stroke-width="5"/>')

    # Alerón delantero: más carga = más inclinado. Roto = caído.
    dano = cfg.get("dano")
    caida = 95 if dano else 0
    ang = -95 - 130 * cfg["ala_del"]
    col_del = ROJO_AVISO if dano else base.MAGENTA
    o.append(f'<path d="M {base.X_ALA_DEL-20} {-90+caida} Q '
             f'{base.X_ALA_DEL+300} {-140+caida} {base.X_ALA_DEL+660} '
             f'{-155+caida}" fill="none" stroke="{base.LINEA}" '
             f'stroke-width="14" stroke-linecap="round"/>')
    o.append(f'<path d="M {base.X_ALA_DEL+60} {ang+caida} Q '
             f'{base.X_ALA_DEL+280} {ang-45+caida} {base.X_ALA_DEL+520} '
             f'{ang-20+caida}" fill="none" stroke="{col_del}" '
             f'stroke-width="12" stroke-linecap="round"/>')

    # Alerón trasero: la inclinación de los 3 planos sale del reglaje
    k = cfg["ala_tras"]
    for i in range(3):
        y0 = -700 - i * 105
        y1 = y0 - int(165 * k) - 10
        col = base.MAGENTA if i == 2 else base.LINEA
        o.append(f'<path d="M {base.X_ALA_TRAS} {y0} '
                 f'L {base.X_ALA_TRAS+300} {y1}" stroke="{col}" '
                 f'stroke-width="{15 if i == 2 else 12}" '
                 f'stroke-linecap="round"/>')
    o.append(f'<path d="M {base.X_ALA_TRAS+60} -620 L {base.X_ALA_TRAS+120} '
             f'-330 L {base.X_ALA_TRAS-60} -320 L 4700 -330" fill="none" '
             f'stroke="{base.LINEA}" stroke-width="8"/>')

    # Flujo por encima
    for j, y0 in enumerate((-820, -940, -1060)):
        o.append(f'<path d="M -350 {y0} C 1200 {y0} 2000 {y0+40} 2700 '
                 f'{y0-60} S 4300 {y0-40} 5500 {y0+30}" fill="none" '
                 f'stroke="{base.CIAN}" stroke-width="5" opacity=".45"/>')
    return "\n".join(o)


def svg_vertical(clave, ancho=1080):
    """Lámina 1080x1920 para Shorts: planta arriba, alzado abajo."""
    cfg = VARIANTES[clave]
    W, H = 4320, 7680                     # 1080x1920 ×4
    alto = int(ancho * H / W)
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
         f'width="{ancho}" height="{alto}" '
         f'preserveAspectRatio="xMidYMid meet" '
         f'font-family="DejaVu Sans, sans-serif">']
    o.append(f'<rect width="{W}" height="{H}" fill="{base.FONDO}"/>')
    o.append(f'<defs>'
             f'<clipPath id="cTop"><rect x="0" y="980" width="{W}" '
             f'height="2500"/></clipPath>'
             f'<clipPath id="cSide"><rect x="0" y="3780" width="{W}" '
             f'height="2000"/></clipPath></defs>')
    for g in range(0, W, 160):
        o.append(f'<path d="M {g} 0 L {g} {H}" stroke="{base.REJILLA}" '
                 f'stroke-width="2"/>')
    for g in range(0, H, 160):
        o.append(f'<path d="M 0 {g} L {W} {g}" stroke="{base.REJILLA}" '
                 f'stroke-width="2"/>')
    o.append(f'<rect width="{W}" height="24" fill="#e10600"/>')

    acento = ROJO_AVISO if cfg.get("dano") else base.CIAN
    o.append(f'<text x="200" y="360" fill="#ffffff" font-size="200" '
             f'font-weight="800" letter-spacing="4">{cfg["titulo"]}</text>')
    o.append(f'<text x="200" y="500" fill="{acento}" font-size="105" '
             f'letter-spacing="4">{cfg["sub"].upper()}</text>')

    o.append(f'<text x="200" y="900" fill="{base.CIAN}" font-size="96" '
             f'font-weight="800" letter-spacing="8">TOP VIEW</text>')
    o.append('<g clip-path="url(#cTop)">'
             '<g transform="translate(170 2180) scale(0.70)">')
    o.append(vista_superior(cfg))
    o.append('</g></g>')

    o.append(f'<text x="200" y="3980" fill="{base.CIAN}" font-size="96" '
             f'font-weight="800" letter-spacing="8">SIDE VIEW</text>')
    o.append('<g clip-path="url(#cSide)">'
             '<g transform="translate(170 5450) scale(0.70)">')
    o.append(vista_lateral(cfg))
    o.append('</g></g>')

    # Notas: el "por qué" en tres líneas
    y = 6250
    for nota in cfg["notas"]:
        o.append(f'<circle cx="240" cy="{y-28}" r="20" fill="{acento}"/>')
        o.append(f'<text x="320" y="{y}" fill="#dce4f2" font-size="104">'
                 f'{nota}</text>')
        y += 190
    o.append(f'<text x="200" y="{H-140}" fill="{base.GRIS}" font-size="76" '
             f'letter-spacing="3">GENERIC 2026-SPEC CAR · OWN DIAGRAM</text>')
    o.append('</svg>')
    return "\n".join(o)


if __name__ == "__main__":
    for clave in VARIANTES:
        ruta = os.path.join(AQUI, f"var_{clave}.svg")
        with open(ruta, "w", encoding="utf-8") as f:
            f.write(svg_vertical(clave))
        print("escrito:", os.path.basename(ruta))

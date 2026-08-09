"""Micro-shorts de 8 segundos: un clip potente + dos datos en pantalla.

Por qué existen, aparte de por gusto: un short de 40 s se abandona a la
mitad, mientras que uno de 8 s se ve ENTERO y a menudo se repite — y cada
repetición cuenta como visualización. Un clip visto tres veces da 300 % de
retención, que es de lo que más premia el algoritmo de Shorts.

Qué los separa de un clip de IA cualquiera: el DATO. La imagen engancha,
pero lo que se lee tiene que ser verdad. Por eso el catálogo está escrito a
mano con cifras verificables y NO lo genera un modelo: inventarse un número
es el único error que este canal no se puede permitir.

Sin voz. Solo imagen, dos tarjetas y (si está configurada) la música de
fondo del canal.
"""

import contextlib
import logging
import os
import subprocess

log = logging.getLogger("microshorts")

ANCHO, ALTO = 1080, 1920
FPS = 30
DUR = 8.0
# Estilo de las tarjetas: 1 caja oscura, 2 texto limpio con sombra,
# 3 caja con líneas. El dueño eligió el 2 (el que menos tapa el clip).
ESTILO = int(os.environ.get("MICRO_ESTILO", "2") or 2)

_TEXTO = (255, 255, 255)
_ACENTO = (0, 205, 215)
_TENUE = (158, 170, 194)

# ── Catálogo ─────────────────────────────────────────────────────────────
# Cada entrada: etiquetas para buscar el clip (en biblioteca/ o en el stock)
# y DOS tarjetas. La primera engancha; la segunda da el motivo para volver a
# verlo, que es justo de lo que vive este formato.
#
# Las cifras van con "up to" / "around" cuando varían entre coches o
# circuitos: es preferible una frase honesta a un número redondo falso.
CATALOGO = [
    {"id": "m01", "etiquetas": "braking brake disc",
     "titulo": "F1 brakes pull 5G #Shorts #F1",
     "tarjetas": [("BRAKING FORCE", "5", "G"),
                  ("300 TO 80 KM/H", "IN 2.6", "s")]},
    {"id": "m02", "etiquetas": "brake disc glowing carbon",
     "titulo": "F1 brake discs glow at 1000C #Shorts #F1",
     "tarjetas": [("DISC TEMPERATURE", "1000", "°C"),
                  ("BELOW 400 °C", "NO GRIP", "")]},
    {"id": "m03", "etiquetas": "pit stop wheel crew",
     "titulo": "A pit stop takes under 2 seconds #Shorts #F1",
     "tarjetas": [("FOUR WHEELS CHANGED", "1.8", "s"),
                  ("PEOPLE INVOLVED", "20", "")]},
    {"id": "m04", "etiquetas": "downforce cornering aero wing",
     "titulo": "An F1 car could drive upside down #Shorts #F1",
     "tarjetas": [("DOWNFORCE AT SPEED", "MORE THAN", "its own weight"),
                  ("IT COULD DRIVE", "UPSIDE", "down")]},
    {"id": "m05", "etiquetas": "wet rain spray tyre",
     "titulo": "A wet F1 tyre clears 65 litres a second #Shorts #F1",
     "tarjetas": [("WATER CLEARED", "65", "litres/s"),
                  ("THE CAR BEHIND", "SEES", "nothing")]},
    {"id": "m06", "etiquetas": "engine power unit turbo",
     "titulo": "An F1 engine revs to 15000 rpm #Shorts #F1",
     "tarjetas": [("MAXIMUM REVS", "15 000", "rpm"),
                  ("YOUR ROAD CAR", "6 500", "rpm")]},
    {"id": "m07", "etiquetas": "tyre slick compound grip",
     "titulo": "F1 tyres only work when they are hot #Shorts #F1",
     "tarjetas": [("WORKING TEMPERATURE", "100", "°C"),
                  ("TOO COLD", "NO", "grip")]},
    {"id": "m08", "etiquetas": "cornering lateral corner apex",
     "titulo": "F1 corners pull 6G sideways #Shorts #F1",
     "tarjetas": [("LATERAL FORCE", "6", "G"),
                  ("YOUR HEAD WEIGHS", "30", "kg")]},
]

DESCRIPCION = (
    "Real numbers from Formula 1, one fact at a time.\n\n"
    "Watch it twice — there are two.\n\n"
    "#F1 #Formula1 #Shorts #Motorsport #Engineering")


def _fuente(tam):
    with contextlib.suppress(Exception):
        import youtube_subir
        f = youtube_subir._fuente_tam(int(tam))
        if f is not None:
            return f
    from PIL import ImageFont
    with contextlib.suppress(Exception):
        return ImageFont.load_default(size=int(tam))
    return ImageFont.load_default()


def tarjeta_png(etiqueta, valor, unidad, destino, y=0.755, estilo=None):
    """PNG TRANSPARENTE 1080x1920 con el dato abajo. Ruta, o None.

    Va abajo y ocupa poco: el clip es lo que hay que ver, el dato solo lo
    explica.
    """
    estilo = ESTILO if estilo is None else estilo
    try:
        from PIL import Image, ImageDraw
        capa = Image.new("RGBA", (ANCHO, ALTO), (0, 0, 0, 0))
        d = ImageDraw.Draw(capa)
        fl, fv, fu = _fuente(40), _fuente(126), _fuente(50)
        lab = (etiqueta or "").upper()
        wl = d.textlength(lab, font=fl)
        wv = d.textlength(valor, font=fv)
        wu = d.textlength(unidad, font=fu) if unidad else 0
        pad, bh = 44, 250
        bw = int(max(wl, wv + wu + 16) + pad * 2)
        bx, by = (ANCHO - bw) // 2, int(ALTO * y)

        if estilo == 1:
            d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=20,
                                fill=(10, 12, 18, 240))
            d.rectangle([bx, by, bx + 8, by + bh], fill=(*_ACENTO, 240))
        elif estilo == 3:
            d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=4,
                                fill=(8, 10, 16, 170))
            d.rectangle([bx, by, bx + bw, by + 5], fill=(*_ACENTO, 240))
            d.rectangle([bx, by + bh - 5, bx + bw, by + bh],
                        fill=(*_ACENTO, 240))

        tx = bx + pad
        if estilo == 2:      # sin caja: el contorno es lo que lo hace legible
            for o in ((3, 3), (-3, 3), (3, -3), (-3, -3)):
                d.text((tx + o[0], by + 24 + o[1]), lab, font=fl,
                       fill=(0, 0, 0, 230))
            for o in ((5, 5), (-5, 5), (5, -5), (-5, -5)):
                d.text((tx + o[0], by + 76 + o[1]), valor, font=fv,
                       fill=(0, 0, 0, 240))
        d.text((tx, by + 24), lab, font=fl, fill=(*_ACENTO, 240))
        d.text((tx, by + 76), valor, font=fv, fill=(*_TEXTO, 245))
        if unidad:
            d.text((tx + wv + 16, by + 140), unidad, font=fu,
                   fill=(*_TENUE, 235))
        capa.save(destino)
        return destino
    except Exception as e:
        log.info("No se pudo crear la tarjeta (%s)", e)
        return None


def _tiempos(dur=DUR):
    """Cuándo entra y sale cada tarjeta.

    Medio segundo de clip limpio al principio (que entre la imagen sola,
    si no parece una diapositiva) y el relevo a mitad, para que el segundo
    dato sea el motivo de volver a verlo.
    """
    return [(0.5, dur / 2 - 0.15), (dur / 2 + 0.15, dur - 0.2)]


def construir_args(clip, pngs, salida, musica=None, dur=DUR):
    """Argumentos de ffmpeg: clip recortado a `dur`, mudo, con las tarjetas
    apareciendo en su momento. Se devuelve la lista para poder probarla sin
    ejecutar nada."""
    import youtube_subir
    args = [youtube_subir._ffmpeg(), "-y",
            "-stream_loop", "-1", "-i", clip]
    for p in pngs:
        args += ["-loop", "1", "-framerate", str(FPS), "-i", p]
    if musica:
        args += ["-stream_loop", "-1", "-i", musica]

    cadena = (f"[0:v]scale={ANCHO}:{ALTO}:force_original_aspect_ratio="
              f"increase,crop={ANCHO}:{ALTO},setsar=1,fps={FPS}[v0]")
    partes = [cadena]
    prev = "v0"
    for i, (t0, t1) in enumerate(_tiempos(dur)[:len(pngs)], start=1):
        partes.append(f"[{prev}][{i}:v]overlay=0:0:"
                      f"enable='between(t,{t0:.2f},{t1:.2f})'[v{i}]")
        prev = f"v{i}"
    args += ["-filter_complex", ";".join(partes), "-map", f"[{prev}]"]
    if musica:
        args += ["-map", f"{len(pngs) + 1}:a", "-af", "volume=0.35",
                 "-c:a", "aac", "-b:a", "128k"]
    else:
        args += ["-an"]
    args += ["-t", f"{dur:.2f}", "-c:v", "libx264", "-preset", "veryfast",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", salida]
    return args


def armar(clip, entrada, salida, tmp, musica=None, dur=DUR):
    """Monta el micro-short. True si quedó el archivo."""
    import youtube_subir
    if not youtube_subir.ffmpeg_disponible():
        return False
    pngs = []
    for i, (lab, val, uni) in enumerate(entrada["tarjetas"][:2]):
        p = tarjeta_png(lab, val, uni, os.path.join(tmp, f"t{i}.png"))
        if p:
            pngs.append(p)
    if not pngs:
        return False
    args = construir_args(clip, pngs, salida, musica=musica, dur=dur)
    try:
        r = subprocess.run(args, capture_output=True, timeout=300)
        if r.returncode == 0 and os.path.exists(salida) \
                and os.path.getsize(salida) > 0:
            return True
        log.warning("ffmpeg no pudo montar el micro-short: %s",
                    (r.stderr or b"")[-300:].decode("utf-8", "ignore"))
    except Exception as e:
        log.warning("Micro-short: %s", e)
    return False

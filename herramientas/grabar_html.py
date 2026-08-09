#!/usr/bin/env python3
"""Convierte una animación HTML en un MP4 vertical listo para publicar.

Los despieces animados (motor en corte, suspensión, aerodinámica) se
escriben en HTML+SVG porque es mucho más rápido que dibujarlos a mano en
código: la cámara, las líneas guía y las tarjetas salen gratis con CSS. Lo
que falta es convertirlos en vídeo, y eso es lo que hace esto: abre la
página en un Chromium sin ventana, la graba mientras se reproduce sola y
entrega el MP4.

Se ejecuta en TU MAC, no en el Repl: ahí sí cargan las tipografías de
Google que usan los diseños, y el resultado se ve como se diseñó.

Instalación (una sola vez):

    pip3 install playwright imageio-ffmpeg
    python3 -m playwright install chromium

Uso:

    python3 herramientas/grabar_html.py motor_v10.html
    python3 herramientas/grabar_html.py motor_v10.html --segundos 32
    python3 herramientas/grabar_html.py *.html --salida ~/clips

El MP4 sale al lado del HTML (o en --salida), con el mismo nombre.
"""

import argparse
import glob
import os
import shutil
import subprocess
import sys
import time

ANCHO, ALTO = 1080, 1920
# Margen sobre la duración pedida: si se corta justo, se pierde la tarjeta
# final de datos, que suele ser lo mejor del clip.
COLA_S = 2.0


def _ffmpeg():
    """El ffmpeg del sistema o, si no está, el que trae imageio-ffmpeg."""
    ruta = shutil.which("ffmpeg")
    if ruta:
        return ruta
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def _chromium(p):
    """El Chromium de Playwright; si el entorno trae uno propio, ese."""
    propio = os.environ.get("CHROMIUM_BIN")
    if propio and os.path.exists(propio):
        return p.chromium.launch(executable_path=propio)
    return p.chromium.launch()


def grabar(html, destino, segundos, ancho=ANCHO, alto=ALTO):
    """Graba la animación. Devuelve la ruta del MP4, o None."""
    from playwright.sync_api import sync_playwright
    ffmpeg = _ffmpeg()
    if not ffmpeg:
        print("❌ Falta ffmpeg. Instala:  pip3 install imageio-ffmpeg")
        return None

    tmp = destino + ".grabacion"
    os.makedirs(tmp, exist_ok=True)
    try:
        with sync_playwright() as p:
            navegador = _chromium(p)
            ctx = navegador.new_context(
                viewport={"width": ancho, "height": alto},
                record_video_dir=tmp,
                record_video_size={"width": ancho, "height": alto})
            pg = ctx.new_page()
            pg.goto("file://" + os.path.abspath(html))
            # Las tipografías tardan: sin esperarlas, los primeros segundos
            # salen con la fuente de respaldo y se ve el cambio en el vídeo.
            with_fonts = "document.fonts ? document.fonts.ready : null"
            pg.wait_for_timeout(1200)
            pg.evaluate(f"({with_fonts})")
            # `rec` es la clase que estos diseños usan para ocultar los
            # botones de control; si no existe, no pasa nada.
            pg.evaluate("document.body.classList.add('rec')")
            pg.wait_for_timeout(400)
            # Reinicia la animación desde el principio, ya en modo grabación
            pg.evaluate("""(() => {
                const b = document.getElementById('btnPlay');
                if (b) b.click();
            })()""")
            time.sleep(segundos + COLA_S)
            ctx.close()
            navegador.close()

        webm = next((os.path.join(tmp, f) for f in os.listdir(tmp)
                     if f.endswith(".webm")), None)
        if not webm:
            print("❌ El navegador no devolvió vídeo.")
            return None
        args = [ffmpeg, "-y", "-loglevel", "error", "-i", webm,
                "-vf", (f"scale={ancho}:{alto}:force_original_aspect_ratio="
                        f"increase,crop={ancho}:{alto},fps=30"),
                "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                "-an", destino]
        r = subprocess.run(args, capture_output=True, timeout=900)
        if r.returncode != 0 or not os.path.exists(destino):
            print("❌ ffmpeg falló:",
                  (r.stderr or b"")[-300:].decode("utf-8", "ignore"))
            return None
        return destino
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("html", nargs="+", help="archivo(s) .html a grabar")
    p.add_argument("--segundos", type=float, default=32.0,
                   help="cuánto dura la animación (por defecto 32)")
    p.add_argument("--salida", default=None,
                   help="carpeta de destino (por defecto, junto al HTML)")
    p.add_argument("--ancho", type=int, default=ANCHO)
    p.add_argument("--alto", type=int, default=ALTO)
    args = p.parse_args()

    try:
        import playwright  # noqa: F401
    except ImportError:
        print("❌ Falta Playwright. Copia y pega:\n")
        print("   pip3 install playwright imageio-ffmpeg")
        print("   python3 -m playwright install chromium")
        return 1

    archivos = [f for patron in args.html for f in sorted(glob.glob(patron))]
    if not archivos:
        print("No encontré ningún HTML con eso.")
        return 1

    hechos = 0
    for html in archivos:
        base = os.path.splitext(os.path.basename(html))[0] + ".mp4"
        destino = os.path.join(args.salida or os.path.dirname(
            os.path.abspath(html)), base)
        os.makedirs(os.path.dirname(destino) or ".", exist_ok=True)
        print(f"🎬 Grabando {os.path.basename(html)} "
              f"({args.segundos:.0f} s)…")
        r = grabar(html, destino, args.segundos, args.ancho, args.alto)
        if r:
            mb = os.path.getsize(r) / 1048576
            print(f"✅ {r}  ({mb:.1f} MB)")
            hechos += 1
    if hechos:
        print(f"\nListo. Renombra el MP4 con palabras del tema en INGLÉS "
              f"y súbelo a biblioteca/ — el canal lo colocará donde el "
              f"guion hable de eso.")
    return 0 if hechos else 1


if __name__ == "__main__":
    raise SystemExit(main())

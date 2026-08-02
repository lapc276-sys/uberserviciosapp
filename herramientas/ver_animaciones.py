#!/usr/bin/env python3
"""Exporta cada animación del catálogo como GIF para poder MIRARLAS.

Los clips que se publican son MP4 y necesitan ffmpeg. Esto no: dibuja los
mismos fotogramas con Pillow y los guarda en un GIF pequeño, así que se
puede revisar el estilo en cualquier ordenador, sin ffmpeg y sin subir nada.

Uso:
    python3 herramientas/ver_animaciones.py                  # todas
    python3 herramientas/ver_animaciones.py freno neumatico  # solo esas
    python3 herramientas/ver_animaciones.py --salida /tmp/gifs --escala 0.3

Los GIF salen en `previsualizaciones/` por defecto.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import animaciones as A  # noqa: E402

# Nombre del GIF → (función de fotograma, parámetros). Es a propósito una
# lista más amplia que el catálogo de producción: aquí interesa ver TODAS
# las variantes de cada generador para elegir cuáles merecen publicarse.
TOMAS = {
    "aero_ala":         (A.fotograma_flujo, {"drs": False, "suelo": False}),
    "aero_suelo":       (A.fotograma_flujo, {"drs": False, "suelo": True}),
    "aero_drs":         (A.fotograma_flujo, {"drs": True, "suelo": True}),
    "freno_caliente":   (A.fotograma_freno, {"ventilado": True}),
    "freno_frio":       (A.fotograma_freno, {"ventilado": True,
                                             "frio": True}),
    "neumatico_slick":  (A.fotograma_neumatico, {}),
    "neumatico_mojado": (A.fotograma_neumatico, {"mojado": True}),
    "neumatico_gastado": (A.fotograma_neumatico, {"desgastado": True}),
    "ers_deploy":       (A.fotograma_ers, {"desplegando": True}),
    "ers_harvest":      (A.fotograma_ers, {"desplegando": False}),
    "carga_frenada":    (A.fotograma_carga, {"maniobra": "brake"}),
    "carga_acelera":    (A.fotograma_carga, {"maniobra": "accel"}),
    "carga_curva":      (A.fotograma_carga, {"maniobra": "corner"}),
    "trazada":          (A.fotograma_trazada, {"mala": False}),
    "trazada_mala":     (A.fotograma_trazada, {"mala": True}),
    "degradacion":      (A.fotograma_degradacion, {}),
    "degradacion_pit":  (A.fotograma_degradacion, {"parada_temprana": True}),
}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("tomas", nargs="*", help="nombres (o trozos) a exportar")
    p.add_argument("--salida", default="previsualizaciones")
    p.add_argument("--escala", type=float, default=0.28)
    p.add_argument("--fotogramas", type=int, default=30)
    args = p.parse_args()

    elegidas = {k: v for k, v in TOMAS.items()
                if not args.tomas or any(t in k for t in args.tomas)}
    if not elegidas:
        print("Ninguna toma coincide. Disponibles:")
        for k in TOMAS:
            print("  ", k)
        return 1

    os.makedirs(args.salida, exist_ok=True)
    for nombre, (fn, params) in elegidas.items():
        destino = os.path.join(args.salida, f"{nombre}.gif")
        A.previsualizar(fn, params, destino, n=args.fotogramas,
                        escala=args.escala)
        kb = os.path.getsize(destino) // 1024
        print(f"✅ {destino}  ({kb} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

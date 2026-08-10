#!/usr/bin/env python3
"""Qué hay en biblioteca/ y qué falta, dicho en dos columnas.

Los archivos que se suben a Replit a mano no están en git, así que desde
fuera no se pueden ver. Esto se corre EN EL REPL y contesta a las dos
preguntas que se hacen de verdad: ¿subí bien los clips?, ¿cuáles me faltan
para que salgan los micro-shorts?

Uso, en el Shell de Replit:

    python3 biblioteca_estado.py
"""

import os
import sys

BIB = "biblioteca"
VIDEO = (".mp4", ".mov", ".webm", ".m4v", ".mpg", ".mpeg", ".avi",
         ".ogv", ".ogg")
IMAGEN = (".jpg", ".jpeg", ".png", ".webp")


def main():
    if not os.path.isdir(BIB):
        print(f"No existe la carpeta {BIB}/. ¿Estás en la carpeta del "
              f"proyecto?")
        return 1

    archivos = sorted(os.listdir(BIB))
    videos = [a for a in archivos if a.lower().endswith(VIDEO)]
    # Los g_* son los esquemas técnicos generados, no fotos aprobadas
    esquemas = [a for a in archivos
                if a.lower().endswith(IMAGEN) and a.startswith("g_")]
    fotos = [a for a in archivos
             if a.lower().endswith(IMAGEN) and not a.startswith("g_")]

    print("=" * 54)
    print(" BIBLIOTECA")
    print("=" * 54)
    print(f"\n🎞️  Clips de vídeo: {len(videos)}")
    for a in videos:
        mb = os.path.getsize(os.path.join(BIB, a)) / 1048576
        print(f"     {a}  ({mb:.1f} MB)")
    if not videos:
        print("     (ninguno todavía)")
    print(f"\n🖼️  Fotos aprobadas: {len(fotos)}")
    for a in fotos:
        print(f"     {a}")
    if not fotos:
        print("     (ninguna)")
    print(f"\n📐 Esquemas técnicos: {len(esquemas)}")

    # ¿Qué micro-shorts pueden salir ya?
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import microshorts
        import main as canal
    except Exception as e:
        print(f"\n(No pude comprobar los micro-shorts: {e})")
        return 0

    print("\n" + "=" * 54)
    print(" MICRO-SHORTS DE 8 SEGUNDOS")
    print("=" * 54)
    listos = faltan = 0
    for e in microshorts.CATALOGO:
        halla = [r for r in canal.fotos_biblioteca(e["etiquetas"], 6)
                 if str(r).lower().endswith(VIDEO)
                 and canal.coincidencias_biblioteca(r, e["etiquetas"]) >= 2]
        if halla:
            print(f"  ✅ {e['id']}  {os.path.basename(halla[0])}")
            listos += 1
        else:
            print(f"  ⬜ {e['id']}  falta un clip con: {e['etiquetas']}")
            faltan += 1
    print(f"\n  {listos} listos · {faltan} esperando clip")
    if faltan:
        print("\n  Los que faltan tiran del metraje de stock si lo hay;")
        print("  con tu propio clip quedan mucho mejor.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

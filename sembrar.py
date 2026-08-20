#!/usr/bin/env python3
"""Pone temas en la COLA PRIORITARIA de los shorts.

El canal sortea sus temas de un pozo de conceptos técnicos, y eso está bien
para el día a día pero es lento cuando pasa algo: una noticia importante
sale hoy y hay que hablar de ella HOY, no cuando el sorteo quiera.

Esta cola se consume antes que el pozo (la lee `_tema_prioritario`), así
que lo que se siembre aquí es lo próximo que se publique.

Uso, en el Shell de Replit:

    python3 sembrar.py                      # los temas de ACTUALIDAD de abajo
    python3 sembrar.py --ver                # ver qué hay en cola, sin tocar
    python3 sembrar.py --limpiar            # vaciar la cola
    python3 sembrar.py --tema "Aero" "Why the 2026 floor is different" \
                             "formula 1 2026 car floor"

Después: reinicia el canal (o espera al siguiente ciclo) y saldrán.

OJO con el ritmo: OLA_PROPORCION (0.5 por defecto) hace que solo la mitad
de los shorts salgan de esta cola, para que el canal no pase dos días
hablando de lo mismo. Con una noticia caliente puedes subirlo a 0.8 por
unos días con el Secret OLA_PROPORCION.
"""

import argparse
import contextlib
import json
import os
import sys

ARCHIVO = "shorts_ola.json"

# ── Temas de ACTUALIDAD de esta semana ───────────────────────────────────
# Formato: (categoría, tema del short, búsqueda de imágenes en inglés)
#
# La regla de la casa también manda aquí: el ángulo es TÉCNICO aunque el
# gancho sea la noticia. Un short de "fulano renueva" muere en 48 horas;
# uno que explica POR QUÉ el reglamento le incomodaba sigue explicando el
# reglamento dentro de un año. Y los hechos tienen que ser verificables:
# nada de cifras de contrato ni de declaraciones inventadas.
ACTUALIDAD = [
    ("Motor",
     "Verstappen just signed with Red Bull until 2030 after doubting the "
     "2026 cars — here is what actually changed in the power unit",
     "formula 1 2026 hybrid power unit engine"),
    ("Motor",
     "Why the 2026 rules split power almost evenly between engine and "
     "battery, and what that does to a driver's job",
     "formula 1 hybrid battery energy recovery"),
    ("Estrategia",
     "Managing battery energy lap by lap is the new skill in 2026 — why "
     "some drivers hate it",
     "formula 1 2026 car cockpit steering wheel"),
    ("Aero",
     "Zandvoort's banked corners explained: why this circuit punishes a "
     "car that is not planted",
     "Zandvoort circuit banking corner"),
    ("Aero",
     "The banking at Zandvoort lets cars run side by side — the geometry "
     "that makes it work",
     "Zandvoort circuit aerial track"),
    ("Neumáticos",
     "Why banked corners load the tyres differently, and what teams change "
     "for it",
     "formula 1 tyre loaded cornering"),
]


def cargar():
    with contextlib.suppress(Exception):
        with open(ARCHIVO) as f:
            d = json.load(f)
        if isinstance(d, dict):
            return d
    return {"gp": "", "temas": []}


def guardar(d):
    with open(ARCHIVO, "w") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)


def ver(d):
    temas = d.get("temas") or []
    print(f"Cola prioritaria: {len(temas)} tema(s)"
          + (f"  ·  ola de {d['gp']}" if d.get("gp") else ""))
    for i, t in enumerate(temas, 1):
        cat = t[0] if len(t) > 0 else "?"
        txt = t[1] if len(t) > 1 else "?"
        print(f"  {i:2}. [{cat}] {txt[:88]}")
    if not temas:
        print("  (vacía — los shorts saldrán del pozo de temas técnicos)")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ver", action="store_true", help="solo mostrar la cola")
    p.add_argument("--limpiar", action="store_true", help="vaciar la cola")
    p.add_argument("--tema", nargs=3, metavar=("CATEGORIA", "TEMA", "IMAGENES"),
                   action="append", help="añadir un tema suelto")
    p.add_argument("--al-final", action="store_true",
                   help="añadir al final en vez de al principio")
    args = p.parse_args()

    d = cargar()
    if args.ver:
        ver(d)
        return 0
    if args.limpiar:
        d["temas"] = []
        guardar(d)
        print("Cola vaciada.")
        return 0

    nuevos = [list(t) for t in (args.tema or ACTUALIDAD)]
    # Al PRINCIPIO por defecto: lo de actualidad pierde valor cada hora que
    # pasa, así que se cuela delante de lo que ya hubiera en cola.
    d["temas"] = (d.get("temas", []) + nuevos if args.al_final
                  else nuevos + d.get("temas", []))
    guardar(d)
    print(f"✅ {len(nuevos)} tema(s) al {'final' if args.al_final else 'principio'}"
          f" de la cola.\n")
    ver(d)
    print("\nReinicia el canal (o espera al siguiente ciclo) y saldrán.")
    print("Si quieres que salgan MÁS seguidos, sube el Secret "
          "OLA_PROPORCION a 0.8 unos días.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

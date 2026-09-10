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
# OJO con la tercera columna: es la BÚSQUEDA DE IMÁGENES, y si el short
# habla de una persona hay que NOMBRARLA ahí. La primera versión de estos
# temas buscaba solo "hybrid power unit engine" para un short cuyo gancho
# era Verstappen: salieron motores y coches de calle, y ni una foto suya.
# ── Semana del GP de España en el Madring (debut, 13 sep 2026) ──────────
#
# Un circuito que estrena es el caso raro en el que NO tener archivo juega
# a favor. No hay vídeos de carreras anteriores porque no ha habido
# ninguna: nadie tiene metraje que este canal no tenga. Lo que sí hay son
# las cifras que el propio circuito ha publicado, y con esas se puede
# explicar de verdad — están en hechos.CIRCUITOS["madring"] y se le pasan
# solas al guionista durante toda la semana.
#
# El ángulo sigue siendo TÉCNICO, no turístico. "Mira qué circuito nuevo"
# se muere el lunes; "por qué un peralte del 24% cambia lo que el coche
# necesita" sigue explicando peraltes dentro de un año, y encima se puede
# comprobar en pantalla el domingo.
#
# Y el límite, escrito para que no se cruce: de este trazado NO se puede
# decir una vuelta rápida, una velocidad punta ni una elección de
# neumático, porque nadie ha rodado aquí todavía. Todo eso son
# PREDICCIONES y se dicen como predicciones. Publicar un tiempo de vuelta
# inventado de un circuito que estrena es de las pocas cosas que un canal
# no puede deshacer.
ACTUALIDAD = [
    ("Aero",
     "F1's newest corner is banked at 24% and lasts six seconds — what "
     "that does to the car, and to the driver's neck",
     "formula 1 banked corner cornering car"),
    ("Aero",
     "Madrid's Monumental is a banked corner shaped like a bullring. "
     "Banking adds grip without adding wing — here is the geometry",
     "banked race track corner aerial"),
    ("Neumáticos",
     "A banked corner presses the tyre into the road instead of sliding "
     "it sideways. Why that changes how long a tyre lasts",
     "formula 1 tyre loaded cornering close up"),
    ("Motor",
     "837 metres flat out into a heavy braking zone: what the 2026 power "
     "unit is doing with its battery down a straight that long",
     "formula 1 2026 car straight speed"),
    ("Estrategia",
     "Nobody has ever raced here. How teams actually build a setup for a "
     "circuit with zero data — and what they get wrong on debut weekends",
     "formula 1 engineers garage laptops"),
    ("Estrategia",
     "Two DRS zones and a street section: why the first race at a new "
     "track is usually decided by track position, not tyres",
     "formula 1 cars overtaking street circuit"),
    ("Aero",
     "Street corners then two tunnels then a fast permanent loop — a "
     "hybrid lap forces one wing level to do two jobs. Which one wins",
     "formula 1 rear wing detail"),
    ("Motor",
     "A tunnel is the one place on a lap where the car cannot breathe "
     "clean air the way it does everywhere else — what changes",
     "race car tunnel circuit"),
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

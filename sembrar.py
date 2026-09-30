#!/usr/bin/env python3
"""Pone temas en la COLA PRIORITARIA de los shorts.

El canal sortea sus temas de un pozo de conceptos técnicos, y eso está bien
para el día a día pero es lento cuando pasa algo: una noticia importante
sale hoy y hay que hablar de ella HOY, no cuando el sorteo quiera.

Esta cola se consume antes que el pozo (la lee `_tema_prioritario`), así
que lo que se siembre aquí es lo próximo que se publique.

Uso, en el Shell de Replit:

    python3 sembrar.py                      # los temas de ACTUALIDAD de abajo
    python3 sembrar.py --serie electronica  # sensores/materiales/proveedores
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


# ── Serie: SENSORES, ELECTRÓNICA, MATERIALES Y PROVEEDORES ──────────────
# `python3 sembrar.py --serie electronica` pone los SHORTS de abajo al
# principio de la cola prioritaria y los EPISODIOS LARGOS al principio de
# temas_cola.json. Los datos que el guionista puede decir están en
# hechos.py (Electronics / Materials / Suppliers) y le llegan solos por la
# categoría: cantidad de cable, precio del volante o gigas por carrera NO
# están, porque no hay fuente firme, y por eso no se dicen.
SERIE_ELECTRONICA_SHORTS = [
    ("Electronics", "Every F1 team uses the SAME computer brain — the "
     "standard ECU, and how it killed traction control",
     "formula 1 electronics steering wheel"),
    ("Electronics", "Around 300 sensors on one car: what they measure and "
     "why engineers can read them but not touch the car",
     "formula 1 pit wall telemetry screens"),
    ("Electronics", "Those metal grids on Friday practice cars are aero "
     "rakes — pressure sensors that let teams see the air",
     "formula 1 aero rake practice"),
    ("Electronics", "Brake-by-wire: when the driver presses the pedal, a "
     "computer decides how the car actually stops",
     "formula 1 brakes glowing disc"),
    ("Electronics", "The black box every F1 car carries, and the biometric "
     "gloves that send the driver's pulse to the doctors",
     "formula 1 driver gloves helmet"),
    ("Materials", "The halo is titanium and must hold about 12 tonnes — "
     "the test it has to pass", "formula 1 halo cockpit"),
    ("Materials", "A plank of wood-based composite under the car got two "
     "drivers disqualified in Austin 2023 — here is why",
     "formula 1 car underside floor plank"),
    ("Materials", "Carbon-carbon brakes are useless cold and brilliant at "
     "1000 °C", "formula 1 carbon brake disc glowing"),
    ("Materials", "Why the first carbon-fibre chassis in 1981 changed F1 "
     "safety forever", "McLaren MP4/1 carbon fibre"),
    ("Suppliers", "The only parts every team MUST buy from the same "
     "company: tyres, ECU and wheels", "formula 1 pirelli tyres wheels"),
    ("Suppliers", "Five engine makers, eleven teams in 2026 — who buys "
     "their engine from whom, and why that matters",
     "formula 1 2026 power unit"),
]

SERIE_ELECTRONICA_LARGOS = [
    ("Electronics",
     "The Nervous System of an F1 Car: Sensors, ECU and Telemetry",
     "An F1 car talks to its engineers every second of every lap. We "
     "follow the signal from the sensors on the car, through the standard "
     "ECU every team shares, to the screens on the pit wall — and explain "
     "why engineers can read everything but touch nothing.",
     "formula 1 telemetry pit wall engineers screens"),
    ("Electronics",
     "How F1 Teams See the Air: Aero Rakes, Flow-Vis and Pressure Sensors",
     "Air is invisible, and the whole car is designed around it. Here is "
     "how teams measure what the airflow is doing on track — the sensor "
     "grids, the fluorescent paint, and what they are looking for on a "
     "Friday.", "formula 1 aero rake flow vis paint"),
    ("Materials",
     "What an F1 Car Is Made Of: Carbon Fibre, Titanium and Magnesium",
     "Carbon fibre chassis, a titanium halo, forged magnesium wheels and "
     "brakes that only work red hot. A tour of the materials that make a "
     "Formula 1 car — and the ones the rules have banned.",
     "carbon fiber composite formula 1 chassis"),
    ("Materials",
     "The Safety Materials That Keep F1 Drivers Alive",
     "The halo, the carbon survival cell and the black box that records "
     "every crash. How materials and sensors turned the most dangerous "
     "sport into one where drivers walk away from huge accidents.",
     "formula 1 halo crash safety"),
    ("Suppliers",
     "Who Really Builds an F1 Car? Standard Parts and Secret Suppliers",
     "Every team uses the same tyres, the same ECU and the same wheels — "
     "and almost everything else is a closely guarded secret. Inside the "
     "Formula 1 supply chain: what is shared, what is bought and what is "
     "never revealed.", "formula 1 factory production composites"),
    ("Electronics",
     "Brake-by-Wire Explained: How an F1 Car Decides How to Stop",
     "The driver presses the pedal, but a computer splits the braking "
     "between carbon discs and an electric motor that harvests energy. "
     "How brake-by-wire works, and why it made braking harder to master.",
     "formula 1 braking brake disc glowing"),
]

TEMAS_COLA = "temas_cola.json"


def sembrar_largos(serie):
    """Pone los episodios largos de la serie al PRINCIPIO de la cola de
    temas, para que sean los siguientes en producirse."""
    cola = {"temas": []}
    with contextlib.suppress(Exception):
        with open(TEMAS_COLA) as f:
            cola = json.load(f)
    temas = cola.get("temas", [])
    hechos_ya = {t.get("titulo", "").lower() for t in temas}
    nuevos = []
    for i, (cat, titulo, intro, consulta) in enumerate(serie):
        if titulo.lower() in hechos_ya:
            continue
        nuevos.append({"id": f"elec{i + 1:02d}", "titulo": titulo,
                       "intro": intro, "consulta": consulta,
                       "categoria": cat, "estado": "pendiente"})
    cola["temas"] = nuevos + temas
    with open(TEMAS_COLA, "w") as f:
        json.dump(cola, f, ensure_ascii=False, indent=1)
    print(f"🎓 {len(nuevos)} episodio(s) largo(s) al principio de "
          f"{TEMAS_COLA}:")
    for t in nuevos:
        print(f"   · [{t['categoria']}] {t['titulo']}")


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
    p.add_argument("--serie", choices=["electronica"],
                   help="sembrar una serie completa (shorts + largos)")
    args = p.parse_args()

    d = cargar()
    if args.serie == "electronica":
        # Sin duplicar si se ejecuta dos veces
        ya = {tuple(t[:2]) for t in d.get("temas", [])}
        args.tema = [list(t) for t in SERIE_ELECTRONICA_SHORTS
                     if tuple(t[:2]) not in ya]
        sembrar_largos(SERIE_ELECTRONICA_LARGOS)
        print()
    if args.ver:
        ver(d)
        return 0
    if args.limpiar:
        d["temas"] = []
        guardar(d)
        print("Cola vaciada.")
        return 0

    nuevos = [list(t) for t in (args.tema if args.tema is not None
                                else ACTUALIDAD)]
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

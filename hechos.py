"""hechos.py — Datos públicos y verificables para los guiones.

El problema que resuelve, dicho con nombre y apellido
─────────────────────────────────────────────────────
Un espectador dejó este comentario en un short del canal:

    "Inane... teaches absolutely NOTHING"

Y tenía razón. El short se titulaba "Forget V12 power — smaller engines
just got faster", que promete una revelación, y el guion no podía
entregarla — porque la instrucción que recibe el guionista dice, con
buen criterio, que NUNCA invente cifras, y añadía: "habla en términos
generales exactos".

Ese "en términos generales" es el fallo. En cuarenta y cinco palabras,
hablar en general es no decir nada. La regla de no inventar es correcta
y no se toca; lo que faltaba era darle al guionista datos REALES con los
que sí puede ser concreto.

Eso es este archivo: cifras públicas, de reglamento o de manual, cada
una con su fuente. El guionista puede decirlas porque son ciertas y
están escritas aquí, no porque se las imagine.

Reglas de esta lista
────────────────────
1. Solo datos PÚBLICOS y estables: reglamento, especificación oficial,
   física de manual. Nada de telemetría de un equipo ni de rumores.
2. Cada uno con su fuente. Si no se puede citar, no entra.
3. Se revisan cuando cambia el reglamento. Los de 2026 llevan el año en
   el texto para que se note cuándo envejecen.
4. Ante la duda, fuera. Una lista corta y cierta vale más que una larga
   con dos errores — al canal lo hunde el segundo, no le salva el largo.
"""

import logging
import random
import re

log = logging.getLogger("hechos")

#: Por categoría de tema (las mismas que usa _TEMAS_TECNICOS en main.py).
#: `dato` es la frase que el guionista puede decir tal cual; `fuente`
#: es de dónde sale, para poder defenderla si alguien la discute.
HECHOS = {
    "Engine": [
        {"dato": "From 2026 the MGU-K puts out 350 kW, up from 120 kW — "
                 "nearly three times the electrical power of the previous "
                 "generation.",
         "fuente": "FIA 2026 power unit regulations"},
        {"dato": "The 2026 power unit splits its output roughly 50/50 "
                 "between the combustion engine and the electric side. "
                 "Before, it was about 80/20.",
         "fuente": "FIA 2026 power unit regulations"},
        {"dato": "The MGU-H is gone for 2026. It was the most complex part "
                 "of the old power unit and the hardest for a new "
                 "manufacturer to copy.",
         "fuente": "FIA 2026 power unit regulations"},
        {"dato": "The combustion engine is a 1.6-litre V6 turbo — smaller "
                 "than the engine in many road saloons.",
         "fuente": "FIA technical regulations"},
        {"dato": "From 2026 the cars run on 100% sustainable fuel.",
         "fuente": "FIA 2026 regulations"},
        {"dato": "A modern F1 combustion engine converts over 50% of the "
                 "energy in its fuel into motion. A good road car engine "
                 "manages around 30%.",
         "fuente": "Manufacturer published thermal efficiency figures"},
        {"dato": "Combined peak output of the 2026 power unit is around "
                 "700 kW — roughly 940 horsepower.",
         "fuente": "FIA 2026 power unit regulations"},
    ],
    "Aero": [
        {"dato": "Most of a modern F1 car's downforce comes from the floor, "
                 "not the wings.",
         "fuente": "Ground-effect regulations, 2022 onwards"},
        {"dato": "Downforce grows with the square of speed: double the "
                 "speed and you get four times the load.",
         "fuente": "Standard aerodynamics"},
        {"dato": "Induced drag grows with the square of downforce. Asking "
                 "for twice the load costs four times that share of the "
                 "drag.",
         "fuente": "Lifting-line theory — and our own computed sweep"},
        {"dato": "An elliptical load distribution across the span is the "
                 "one that pays the least induced drag possible. Nothing "
                 "beats it.",
         "fuente": "Prandtl lifting-line theory, confirmed by our own solver"},
        {"dato": "2026 cars have active aerodynamics: the wings themselves "
                 "change between a low-drag and a high-downforce mode.",
         "fuente": "FIA 2026 technical regulations"},
    ],
    "Tyres": [
        {"dato": "F1 tyres work in a temperature window. Below it there is "
                 "no grip; above it the surface starts to give up.",
         "fuente": "Pirelli published operating guidance"},
        {"dato": "A driver's out-lap is mostly about getting heat INTO the "
                 "tyre. The lap that counts comes after it.",
         "fuente": "Standard practice, visible in any qualifying session"},
        {"dato": "Tyre degradation is measurable from lap times alone: fit "
                 "a line through the clean laps of a stint and the slope is "
                 "the loss per lap.",
         "fuente": "The method this channel uses on its own timing data"},
    ],
    "Strategy": [
        {"dato": "A pit stop costs roughly 20 seconds of race time — the "
                 "stationary part is only about two of those.",
         "fuente": "Measured by this channel from its own timing data"},
        {"dato": "The undercut works because fresh tyres are fastest on "
                 "their first flying lap, before the car ahead has stopped.",
         "fuente": "Standard strategy practice"},
    ],
    "Banned tech": [
        {"dato": "The 1978 Lotus 79 used sliding skirts to seal the floor "
                 "to the ground. Sealing the floor is what makes ground "
                 "effect work — and it was banned for 1981.",
         "fuente": "FIA regulation history"},
        {"dato": "The Brabham BT46B fan car won the only race it entered, "
                 "in 1978, and was withdrawn immediately afterwards.",
         "fuente": "Swedish Grand Prix 1978, race record"},
        {"dato": "Six-wheeled cars were legal until 1983, when the rules "
                 "fixed the number of wheels at four.",
         "fuente": "FIA regulation history"},
    ],
    "Tech history": [
        {"dato": "Ground effect was understood in F1 by the late 1970s, "
                 "banned in 1983, and brought back deliberately in 2022 to "
                 "let cars follow each other more closely.",
         "fuente": "FIA regulation history"},
    ],
}


# ── Circuitos: las cifras publicadas de la pista de esta semana ───────
#
# Por qué esto va aparte de HECHOS
# ─────────────────────────────────
# Un circuito que estrena no tiene nada de lo que el canal vive: ni
# carreras anteriores, ni telemetría guardada, ni degradación medida, ni
# archivo de fotos. La primera vez que Madrid aparezca en los datos será
# la FP1 del viernes. Antes de eso, todo lo que el canal puede decir con
# fundamento es lo que el circuito ha publicado de sí mismo.
#
# Y resulta que eso es bastante, y que además NADIE MÁS lo tiene contado
# todavía. Un trazado que nadie ha corrido no tiene vídeos de archivo con
# los que competir: los datos publicados son, esta semana, la única
# ventaja que hay.
#
# Regla igual de estricta que arriba, y una más
# ──────────────────────────────────────────────
# Cuando dos fuentes se contradicen, se dice la cifra con la PRECISIÓN
# que de verdad se tiene, no la más bonita. La longitud de vuelta de
# Madrid aparece publicada como 5,416 km en unos sitios y 5,474 en otros,
# y la distancia de carrera oficial (308,524 km en 57 vueltas) sale a
# 5,413. Así que aquí se dice "5,4 km", que es verdad en las tres
# lecturas, y no se elige una al azar para sonar preciso. Lo que sí se
# dice exacto es lo que está cruzado por varias fuentes.
CIRCUITOS = {
    "madring": [
        {"dato": "Turn 12, La Monumental, is a banked right-hander about "
                 "550 metres long with 24% banking — drivers are in that "
                 "one corner for roughly six seconds.",
         "fuente": "Circuit specification published by MADRING / IFEMA"},
        {"dato": "La Monumental is shaped after a bullring, which is where "
                 "the name comes from.",
         "fuente": "MADRING / Formula 1 circuit guide"},
        {"dato": "The longest straight, Ribera del Sena, runs 837 metres, "
                 "with cars going past 300 km/h at the end of it.",
         "fuente": "Circuit specification published by MADRING / IFEMA"},
        {"dato": "The Madring is a hybrid: temporary street sections around "
                 "the IFEMA exhibition halls, then two short tunnels into a "
                 "permanent, faster part of the lap.",
         "fuente": "Circuit specification published by MADRING / IFEMA"},
        {"dato": "The lap has 22 corners in about 5.4 kilometres, and two "
                 "DRS zones.",
         "fuente": "Circuit specification published by MADRING / IFEMA"},
        {"dato": "The Spanish Grand Prix at the Madring runs to 57 laps, a "
                 "race distance of 308.524 km.",
         "fuente": "Formula 1 official race specification"},
        {"dato": "The Madring is the first brand-new circuit to join the "
                 "Formula 1 calendar since Las Vegas in 2023, and the 81st "
                 "track to have held a World Championship Grand Prix.",
         "fuente": "Formula 1 calendar record"},
        {"dato": "No driver on the grid has a race lap of this circuit to "
                 "look back on. The first competitive laps anyone has ever "
                 "run here are this weekend's.",
         "fuente": "It is the circuit's debut — 2026 F1 calendar"},
    ],
}

#: El mismo tema escrito de las dos maneras. La cola de temas se siembra a
#: mano y a veces en castellano ("Motor", "Neumáticos"), mientras que estas
#: tablas están en inglés. Sin esta traducción, `bloque("Motor")` no
#: encontraba nada y devolvía cadena vacía — y el guion salía SIN cifras
#: justo en los shorts sembrados, que son los de actualidad y los que más
#: se ven. El fallo no se veía por ninguna parte: no hay error, solo un
#: guion más vago.
ALIAS_CATEGORIA = {
    "motor": "Engine", "engine": "Engine",
    "neumaticos": "Tyres", "neumáticos": "Tyres", "tyres": "Tyres",
    "estrategia": "Strategy", "strategy": "Strategy",
    "aero": "Aero", "aerodinamica": "Aero", "aerodinámica": "Aero",
    "historia": "Tech history", "tech history": "Tech history",
    "prohibida": "Banned tech", "banned tech": "Banned tech",
}

#: Lo que hace falta para que un short ENSEÑE algo, en vez de afirmarlo.
#: Va al guionista tal cual.
MECANISMO = (
    "Teach a MECHANISM, not a claim. The script must contain a chain the "
    "viewer can follow: BECAUSE this happens, THAT follows, WHICH IS WHY "
    "the thing they can see on television looks the way it does. A script "
    "that states something is surprising without explaining what causes it "
    "has taught nothing, and viewers say so in the comments."
)


def para(categoria, n=2, semilla=None):
    """`n` hechos de esa categoría, o [] si no hay ninguno.

    Se barajan para que dos shorts de la misma categoría no salgan con
    la misma cifra: repetir el mismo dato es la otra forma de no enseñar
    nada.
    """
    pozo = list(HECHOS.get(categoria) or [])
    if not pozo:
        # Segunda oportunidad por el nombre traducido, antes de rendirse.
        equiv = ALIAS_CATEGORIA.get((categoria or "").strip().lower())
        pozo = list(HECHOS.get(equiv) or []) if equiv else []
    if not pozo:
        return []
    r = random.Random(semilla) if semilla is not None else random
    r.shuffle(pozo)
    return pozo[:max(1, n)]


def bloque(categoria, n=2, semilla=None):
    """Los hechos ya redactados para meter en el prompt. "" si no hay."""
    hs = para(categoria, n, semilla)
    if not hs:
        return ""
    lineas = "\n".join(f"- {h['dato']}" for h in hs)
    return ("\n\nThese facts are TRUE and published — you may state them, "
            "and you should use at least one to make the explanation "
            "concrete:\n" + lineas
            + "\nDo not invent any other figure. If you need a number that "
            "is not on this list, explain the mechanism without it.")


#: El mismo circuito llega con nombres distintos según de dónde venga: el
#: Secret GP_ACTUAL lo escribe el dueño a mano, y el calendario lo llama
#: como quiera. NO se mete aquí "spain": el Gran Premio de España lo ha
#: corrido Barcelona durante años, y colgarle a Barcelona la ficha de
#: Madrid sería exactamente el error que estas tablas existen para evitar.
ALIAS_CIRCUITO = {
    "madrid": "madring", "ifema": "madring", "ifemamadrid": "madring",
    "madridring": "madring",
}


def _clave_circuito(nombre):
    """El nombre del circuito reducido a la clave de la tabla."""
    n = re.sub(r"[^a-z0-9]+", "", (nombre or "").strip().lower())
    if not n:
        return ""
    if n in CIRCUITOS:
        return n
    if n in ALIAS_CIRCUITO:
        return ALIAS_CIRCUITO[n]
    # "Madrid", "MADRING", "Madring Circuit" → madring. Se acepta solo si
    # encaja UNA, para no acabar dando los datos de un circuito por otro.
    posibles = [c for c in CIRCUITOS if c in n or n in c]
    return posibles[0] if len(posibles) == 1 else ""


def circuito(nombre, n=2, semilla=None):
    """`n` datos publicados de ese circuito, o [] si no hay ficha."""
    clave = _clave_circuito(nombre)
    pozo = list(CIRCUITOS.get(clave) or [])
    if not pozo:
        return []
    r = random.Random(semilla) if semilla is not None else random
    r.shuffle(pozo)
    return pozo[:max(1, n)]


def bloque_circuito(nombre, n=2, semilla=None):
    """Los datos del circuito de esta semana, listos para el prompt.

    Va aparte del bloque temático porque responden a preguntas distintas:
    uno dice de qué trata el short, y este dice DÓNDE se corre el domingo.
    Un short de neumáticos en semana de Madrid es mejor short si puede
    nombrar el peralte del 24% que carga esos neumáticos.
    """
    hs = circuito(nombre, n, semilla)
    if not hs:
        return ""
    lineas = "\n".join(f"- {h['dato']}" for h in hs)
    return ("\n\nThis weekend's circuit. These are PUBLISHED figures and "
            "you may state them — but only these, and do not invent a lap "
            "time, a top speed or a tyre choice for a track nobody has "
            "raced yet:\n" + lineas)


def circuitos():
    return sorted(CIRCUITOS)


def categorias():
    return sorted(HECHOS)


def total():
    return sum(len(v) for v in HECHOS.values())

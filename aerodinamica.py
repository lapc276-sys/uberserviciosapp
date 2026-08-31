"""aerodinamica.py — Los mecanismos de aire de un F1, con su dibujo.

La columna vertebral de un episodio técnico largo sobre aerodinámica: una
lista cerrada de mecanismos REALES, públicos y de manual, cada uno con el
diagrama que lo explica ya especificado.

Por qué una lista escrita a mano y no generada
──────────────────────────────────────────────
Un modelo al que se le pide "veinte mecanismos aerodinámicos" produce una
lista distinta cada vez, con alguno inventado y varios repetidos con otro
nombre. Estos veinte son física publicada —efecto suelo, vórtice Y250,
capa límite, desprendimiento, rebufo, marsopeo— y están escritos una vez,
revisados, y no cambian entre episodios. Lo que sí escribe el modelo es
la NARRACIÓN de cada uno, que es donde aporta.

Sobre las fotos de coches reales
────────────────────────────────
Aquí no hay ninguna, y es a propósito. Una comparación del ala delantera
de tres equipos concretos necesitaría fotos de prensa de esos coches, que
tienen derechos de agencia, y medidas que nadie ha publicado. El canal no
usa ni lo uno ni lo otro. Lo que se enseña es el MECANISMO dibujado por
nosotros, que es lo que de verdad explica la diferencia entre dos
filosofías de ala — y que además es material propio, sin depender de
nadie.

Cada entrada trae la especificación PLANA de diagrama, la misma forma que
devuelve el guionista de shorts, para que pase por `_diagrama_kwargs` de
main.py y se valide igual que todo lo demás.

Todo el texto va en inglés: es contenido del canal.
"""

#: Los veinte, en orden de explicación: primero de dónde sale la carga,
#: luego cómo se dirige el aire, luego qué la destruye, y al final el
#: compromiso que gobierna todo el diseño.
MECANISMOS = [
    {
        "nombre": "Ground effect",
        "resumen": "The floor makes most of the downforce. Air accelerating "
                   "through the narrowing channel under the car drops in "
                   "pressure and pulls the car onto the road.",
        "diagrama": dict(
            plantilla="flujo", titulo="Ground effect under the floor",
            etiqueta="Airflow", pie="Simplified section through the floor",
            forma="suelo", notas=[
                {"en": 0.45, "texto": "Throat: air is fastest, pressure lowest"},
                {"en": 0.8, "texto": "Diffuser opens, pressure recovers"}]),
    },
    {
        "nombre": "The Y250 vortex",
        "resumen": "Where the front wing's inboard section ends, a strong "
                   "vortex is shed. It is used as an air fence that keeps "
                   "messy tyre wake away from the floor's leading edge.",
        "diagrama": dict(
            plantilla="flujo", titulo="A vortex used as a fence",
            etiqueta="Airflow", pie="The inboard wing sheds a rotating core",
            forma="ala", notas=[
                {"en": 0.25, "texto": "Pressure difference rolls the air up"},
                {"en": 0.65, "texto": "The core travels back and shields the floor"}]),
    },
    {
        "nombre": "Outwash",
        "resumen": "The front wing pushes air outwards, around the front "
                   "tyre, so the tyre's turbulent wake is thrown wide "
                   "instead of down the side of the car.",
        "diagrama": dict(
            plantilla="flujo", titulo="Pushing air around the front tyre",
            etiqueta="Airflow", pie="Seen from above",
            forma="cuerpo", notas=[
                {"en": 0.3, "texto": "Wing turns the flow outboard"},
                {"en": 0.7, "texto": "Tyre wake is thrown clear of the floor"}]),
    },
    {
        "nombre": "Tyre squirt",
        "resumen": "The contact patch squeezes air sideways out of the "
                   "bottom of the rotating tyre. That jet fires straight at "
                   "the floor edge and has to be controlled.",
        "diagrama": dict(
            plantilla="flujo", titulo="Air squeezed out by the contact patch",
            etiqueta="Airflow", pie="Rear tyre, seen from behind",
            forma="cuerpo", notas=[
                {"en": 0.4, "texto": "Rotating tyre pumps air sideways"},
                {"en": 0.75, "texto": "The jet disturbs the diffuser edge"}]),
    },
    {
        "nombre": "The boundary layer",
        "resumen": "Right against every surface, air is slowed by friction. "
                   "That thin, sluggish layer is where aerodynamics is won "
                   "and lost.",
        "diagrama": dict(
            plantilla="tendencia", titulo="Speed near a surface",
            etiqueta="Principle", pie="Shape of the profile, not measured values",
            puntos_y=[0.0, 0.18, 0.42, 0.68, 0.86, 0.95, 0.99, 1.0],
            eje_x="Distance from the surface", eje_y="Air speed",
            marca_i=2, marca_texto="Slow, vulnerable air"),
    },
    {
        "nombre": "Flow separation and stall",
        "resumen": "Ask a wing for too much and the flow lets go of the "
                   "surface. Downforce collapses in an instant rather than "
                   "tailing off.",
        "diagrama": dict(
            plantilla="tendencia", titulo="Downforce against wing angle",
            etiqueta="Principle", pie="The shape is real; the numbers illustrate it",
            puntos_y=[0.2, 0.45, 0.7, 0.9, 1.0, 0.55, 0.4],
            eje_x="Wing angle", eje_y="Downforce",
            marca_i=4, marca_texto="Stall"),
    },
    {
        "nombre": "Vortex generators",
        "resumen": "Small vanes deliberately stir fast air down into the "
                   "tired boundary layer, giving it the energy to stay "
                   "attached further back.",
        "diagrama": dict(
            plantilla="flujo", titulo="Re-energising tired air",
            etiqueta="Airflow", pie="Vanes mix fast air downwards",
            forma="cuerpo", notas=[
                {"en": 0.35, "texto": "Vane spins fast air into the slow layer"},
                {"en": 0.75, "texto": "Flow stays attached further back"}]),
    },
    {
        "nombre": "The diffuser",
        "resumen": "The floor's exit ramp. Expanding the channel slows the "
                   "air back to ambient pressure, and how gently that "
                   "happens sets how much suction the whole floor can hold.",
        "diagrama": dict(
            plantilla="flujo", titulo="The floor's exit ramp",
            etiqueta="Airflow", pie="Expansion has to be gradual",
            forma="suelo", notas=[
                {"en": 0.55, "texto": "Channel begins to open"},
                {"en": 0.9, "texto": "Too steep and the flow separates"}]),
    },
    {
        "nombre": "Downwash to feed the floor",
        "resumen": "The front wing is not only a downforce device. Its main "
                   "job is aiming clean, fast air at the leading edge of the "
                   "floor behind it.",
        "diagrama": dict(
            plantilla="flujo", titulo="Aiming air at the floor",
            etiqueta="Airflow", pie="The wing sets up everything behind it",
            forma="ala", notas=[
                {"en": 0.3, "texto": "Flow is turned downwards"},
                {"en": 0.8, "texto": "Arrives clean at the floor edge"}]),
    },
    {
        "nombre": "Endplate vortices",
        "resumen": "At every wing tip, high pressure above spills into low "
                   "pressure below and rolls into a trailing vortex. It "
                   "costs drag, so it is shaped rather than fought.",
        "diagrama": dict(
            plantilla="flujo", titulo="Where pressure spills round a tip",
            etiqueta="Airflow", pie="The tip vortex is shaped, not removed",
            forma="ala", notas=[
                {"en": 0.5, "texto": "Pressure spills around the endplate"},
                {"en": 0.85, "texto": "It rolls into a trailing core"}]),
    },
    {
        "nombre": "The beam wing",
        "resumen": "A small wing low at the back, coupling the diffuser to "
                   "the rear wing so the two pull air through as one system "
                   "instead of two.",
        "diagrama": dict(
            plantilla="flujo", titulo="Coupling diffuser and rear wing",
            etiqueta="Airflow", pie="The two work as one system",
            forma="ala", notas=[
                {"en": 0.35, "texto": "Beam wing pulls on the diffuser exit"},
                {"en": 0.8, "texto": "Upwash feeds the rear wing"}]),
    },
    {
        "nombre": "The Coanda effect",
        "resumen": "A jet of air will follow a surface that curves gently "
                   "away from it. Bodywork is shaped to lead flow exactly "
                   "where it is wanted.",
        "diagrama": dict(
            plantilla="flujo", titulo="Air follows a curving surface",
            etiqueta="Airflow", pie="Bodywork leads the flow",
            forma="cuerpo", notas=[
                {"en": 0.4, "texto": "The jet stays attached to the curve"},
                {"en": 0.8, "texto": "Curve too sharp and it lets go"}]),
    },
    {
        "nombre": "Rake angle",
        "resumen": "Running the car nose-down tilts the whole floor into a "
                   "bigger expansion. Powerful, and unstable if the front "
                   "gets too close to the ground.",
        "diagrama": dict(
            plantilla="tendencia", titulo="Downforce against rake",
            etiqueta="Principle", pie="The shape is real; the numbers illustrate it",
            puntos_y=[0.35, 0.55, 0.75, 0.92, 1.0, 0.78],
            eje_x="Nose-down angle", eje_y="Floor downforce",
            marca_i=4, marca_texto="Best before instability"),
    },
    {
        "nombre": "Porpoising",
        "resumen": "Ground effect pulls the car down, the floor gets close "
                   "enough to choke, suction collapses, the car springs up, "
                   "and the cycle repeats several times a second.",
        "diagrama": dict(
            plantilla="fases", titulo="Anatomy of porpoising",
            etiqueta="Sequence", pie="A cycle, several times a second",
            pasos=[
                {"nombre": "Suction", "detalle": "Downforce pulls the floor down"},
                {"nombre": "Choke", "detalle": "The channel closes and stalls"},
                {"nombre": "Release", "detalle": "Suction collapses, springs lift the car"},
                {"nombre": "Repeat", "detalle": "Flow reattaches and it starts again"}]),
    },
    {
        "nombre": "Dirty air",
        "resumen": "Behind a car the air is slow, turbulent and tilted. A "
                   "following car's wings are fed rubbish, and it loses the "
                   "downforce exactly when it needs it most.",
        "diagrama": dict(
            plantilla="tendencia", titulo="Downforce lost when following",
            etiqueta="Principle", pie="The shape is real; the numbers illustrate it",
            puntos_y=[1.0, 0.92, 0.8, 0.66, 0.5, 0.38],
            eje_x="Closer to the car ahead", eje_y="Downforce remaining",
            marca_i=4, marca_texto="Inside a second"),
    },
    {
        "nombre": "The slipstream",
        "resumen": "The same wake that ruins cornering is a gift on a "
                   "straight: the hole punched in the air costs the "
                   "following car far less drag.",
        "diagrama": dict(
            plantilla="comparar", titulo="Drag in clean air and in a tow",
            etiqueta="Principle", pie="Illustrative, not measured",
            izq_nombre="Clean air", izq_valor="100", izq_unidad="%",
            izq_nota="Full drag, full downforce",
            der_nombre="In the tow", der_valor="80", der_unidad="%",
            der_nota="Less drag, but less downforce too"),
    },
    {
        "nombre": "The drag reduction system",
        "resumen": "A flap is opened to stall the rear wing on purpose. "
                   "Downforce is thrown away deliberately to buy straight "
                   "line speed where it cannot hurt.",
        "diagrama": dict(
            plantilla="comparar", titulo="Rear wing, closed and open",
            etiqueta="Principle", pie="Illustrative, not measured",
            izq_nombre="Flap closed", izq_valor="Full", izq_unidad="downforce",
            izq_nota="Needed through the corner",
            der_nombre="Flap open", der_valor="Less", der_unidad="drag",
            der_nota="Thrown away on the straight"),
    },
    {
        "nombre": "Cooling drag",
        "resumen": "Every hole that lets air in to cool the engine also "
                   "swallows momentum. Bodywork is closed as tightly as the "
                   "temperatures of the day allow.",
        "diagrama": dict(
            plantilla="comparar", titulo="Cooling opening against drag",
            etiqueta="Principle", pie="Illustrative, not measured",
            izq_nombre="Tight bodywork", izq_valor="Low", izq_unidad="drag",
            izq_nota="Risky on a hot day",
            der_nombre="Open bodywork", der_valor="Safe", der_unidad="temps",
            der_nota="Paid for in straight line speed"),
    },
    {
        "nombre": "Induced drag",
        "resumen": "Downforce is never free. The same pressure difference "
                   "that presses the car down also drags it backwards, and "
                   "the penalty grows faster than the reward.",
        "diagrama": dict(
            plantilla="tendencia", titulo="Drag against downforce",
            etiqueta="Principle", pie="The shape is real; the numbers illustrate it",
            puntos_y=[0.1, 0.18, 0.32, 0.55, 0.85, 1.0],
            eje_x="Downforce", eje_y="Drag",
            marca_i=4, marca_texto="Cost accelerates"),
    },
    {
        "nombre": "The efficiency compromise",
        "resumen": "Every circuit asks a different question. The whole "
                   "season's aerodynamic work is choosing where on this "
                   "curve to sit, weekend by weekend.",
        "diagrama": dict(
            plantilla="comparar", titulo="Two answers to the same question",
            etiqueta="Principle", pie="Illustrative, not measured",
            izq_nombre="High downforce", izq_valor="Corners",
            izq_unidad="won", izq_nota="Slow on the straights",
            der_nombre="Low drag", der_valor="Straights", der_unidad="won",
            der_nota="Gives the lap time back in the corners"),
    },
]


# ── El vocabulario ────────────────────────────────────────────────────
# Los términos con los que se habla de esto de verdad, cada uno con la
# frase que lo explica en una línea. No es un adorno: un canal técnico
# que dice "el aire de detrás" en vez de "la estela" suena a alguien
# contando de oídas, y el que sabe se va.
#
# La regla de uso, y es la que importa: UN término por short, dicho y
# explicado. Un guion que suelta seis tecnicismos seguidos no enseña
# nada — enseña que quien lo escribió se sabe la lista.
#
# `visual` dice con qué se ilustra:
#   "calculado:<caso>"  → lo resuelve flujo_calculado.py (líneas de
#                          corriente de verdad, no un dibujo)
#   "<nombre>"           → el diagrama de ese mecanismo de MECANISMOS
#   ""                   → todavía no tiene imagen propia
GLOSARIO = [
    {"termino": "Boundary layer",
     "definicion": "The thin skin of air dragged along by the car's own "
                   "surface, from zero speed at the paint to full speed a "
                   "few millimetres out. Almost every aerodynamic problem "
                   "on a car is a problem with this layer.",
     "visual": "The boundary layer"},
    {"termino": "Laminar flow",
     "definicion": "Air moving in clean parallel sheets. It costs the least "
                   "friction — and it is the first to peel away from a "
                   "surface when the going gets difficult.",
     "visual": "The boundary layer"},
    {"termino": "Turbulent flow",
     "definicion": "Air churning as it moves. It costs more friction, but "
                   "it carries far more energy close to the surface, so it "
                   "stays attached where laminar flow would have let go.",
     "visual": "The boundary layer"},
    {"termino": "Flow separation",
     "definicion": "The moment the air stops following the surface and "
                   "breaks away. The low pressure that was holding the car "
                   "down disappears with it.",
     "visual": "Flow separation and stall"},
    {"termino": "Stall",
     "definicion": "Separation gone total. Ask a wing for more angle than "
                   "it can hold and the downforce does not tail off — it "
                   "falls off a cliff, and the drag arrives instead.",
     "visual": "Flow separation and stall"},
    {"termino": "Angle of attack",
     "definicion": "How steeply a wing is tilted into the oncoming air. "
                   "More angle means more downforce, right up until the "
                   "moment it means none at all.",
     "visual": "calculado:angulo"},
    {"termino": "Stagnation point",
     "definicion": "The single spot on the nose of a wing where the air "
                   "comes to a complete stop. Everything that happens "
                   "further back starts from where this point sits.",
     "visual": "calculado:estancamiento"},
    {"termino": "Ground effect",
     "definicion": "The floor is close enough to the road that the air "
                   "squeezed underneath accelerates hard, pressure drops, "
                   "and the whole car is sucked down. It is the cheapest "
                   "downforce there is — it costs almost no drag.",
     "visual": "Ground effect"},
    {"termino": "Diffuser",
     "definicion": "The upswept ramp at the back of the floor. It lets the "
                   "fast air underneath slow down gradually on its way out, "
                   "and that controlled exit is what keeps the suction "
                   "working all the way along the floor.",
     "visual": "The diffuser"},
    {"termino": "Diffuser choke",
     "definicion": "Push the floor too low or too hard and the air "
                   "underneath hits its limit and cannot get out fast "
                   "enough. The suction stops building — and then it "
                   "collapses.",
     "visual": "Porpoising"},
    {"termino": "Porpoising",
     "definicion": "The floor sucks the car down, the car gets low enough "
                   "to stall its own floor, the downforce vanishes, the car "
                   "springs back up — and it all starts again, several "
                   "times a second.",
     "visual": "Porpoising"},
    {"termino": "Vortex",
     "definicion": "A spinning core of air. It is low pressure in the "
                   "middle and it holds together for a long way downstream, "
                   "which is exactly why designers use them as invisible "
                   "fences to steer other air around.",
     "visual": "The Y250 vortex"},
    {"termino": "Wingtip vortices",
     "definicion": "At the open end of any wing, the high pressure on one "
                   "side rolls around into the low pressure on the other. "
                   "That roll-up is a vortex, and it is a wing paying for "
                   "its own downforce.",
     "visual": "Endplate vortices"},
    {"termino": "Von Karman vortex street",
     "definicion": "Behind a blunt body — a wheel, a roll hoop — vortices "
                   "shed alternately, first one side then the other, in a "
                   "regular procession. That procession is a good part of "
                   "what a following car has to drive through.",
     "visual": "calculado:calle"},
    {"termino": "Wake",
     "definicion": "The trail of disturbed, slower, spinning air a car "
                   "leaves behind it. From inside the following car it has "
                   "a simpler name: dirty air.",
     "visual": "Dirty air"},
    {"termino": "Downforce",
     "definicion": "Aerodynamic load pressing the car onto the road. It is "
                   "grip that costs no weight — the faster you go, the more "
                   "of it you get.",
     "visual": "calculado:ala"},
    {"termino": "Drag",
     "definicion": "The price. Every shape that pushes the car down is also "
                   "holding it back, and the whole job is choosing how much "
                   "of one to buy with the other.",
     "visual": "The efficiency compromise"},
    {"termino": "Induced drag",
     "definicion": "The share of drag that exists only because the wing is "
                   "making downforce. Stop making downforce and this part "
                   "goes away — which is precisely what DRS does.",
     "visual": "Induced drag"},
    {"termino": "Aerodynamic balance",
     "definicion": "Where the downforce sits, front to rear. Get it forward "
                   "and the car bites into corners but the rear goes light; "
                   "get it back and the car is stable and will not turn.",
     "visual": ""},
    {"termino": "Yaw angle",
     "definicion": "The angle between where the car points and where the "
                   "air is actually coming from. In a corner, or in a "
                   "crosswind, a car spends its time aerodynamically "
                   "sideways — and it was designed pointing straight.",
     "visual": ""},
    {"termino": "Coanda effect",
     "definicion": "A moving stream of air will follow a curved surface "
                   "rather than carry straight on. It is how flow is bent "
                   "around a sidepod towards where it is wanted.",
     "visual": "The Coanda effect"},
    {"termino": "Reynolds number",
     "definicion": "The single number that says how a flow will behave: "
                   "size times speed against the stickiness of the air. Two "
                   "flows with the same Reynolds number behave the same "
                   "way — which is the only reason a scale model in a "
                   "tunnel tells you anything about the real car.",
     "visual": ""},
    {"termino": "Wind tunnel",
     "definicion": "A controlled room where a model meets moving air at a "
                   "matched Reynolds number, and the forces on it are "
                   "measured directly. Slow, expensive, and rationed by the "
                   "rules — which is why teams guard their hours.",
     "visual": ""},
    {"termino": "CFD",
     "definicion": "Solving the equations of the flow on a computer instead "
                   "of building the part. It shows you things no tunnel can "
                   "show, and it is only as good as the assumptions fed "
                   "into it — which is why the tunnel never went away.",
     "visual": ""},
]


def glosario_indice():
    """Los términos, para ofrecérselos al guionista."""
    return [g["termino"] for g in GLOSARIO]


def termino(nombre):
    """Una entrada del glosario por su término, o None."""
    n = (nombre or "").strip().lower()
    return next((g for g in GLOSARIO if g["termino"].lower() == n), None)


def sin_visual():
    """Los términos que todavía no tienen imagen propia.

    Es la lista de lo que falta por dibujar, no un error: un término se
    puede explicar hablando, y es mejor eso que ilustrarlo con un
    diagrama que no le corresponde.
    """
    return [g["termino"] for g in GLOSARIO if not g["visual"]]


def por_nombre(nombre):
    """Un mecanismo por su nombre, o None."""
    n = (nombre or "").strip().lower()
    return next((m for m in MECANISMOS if m["nombre"].lower() == n), None)


def indice():
    """Los nombres, en orden — para que el guionista sepa qué hay."""
    return [m["nombre"] for m in MECANISMOS]

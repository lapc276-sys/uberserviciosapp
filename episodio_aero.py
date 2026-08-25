"""episodio_aero.py — "The Invisible War for the Air", episodio técnico.

Un episodio de ~5 minutos sobre la aerodinámica activa de 2026 y las tres
interpretaciones de los equipos de cabeza. Estructura fija: cada segmento
trae su narración, su diagrama y —lo importante— la SEPARACIÓN entre lo
que es hecho publicado y lo que es lectura nuestra.

Por qué cada afirmación lleva fuente
────────────────────────────────────
Este episodio es el primero que habla de coches concretos y de una
temporada en curso. Todo lo demás que emite el canal se apoya en algo
medido por nosotros —degradación, coste de parada, adelantamientos
contados— y eso se puede defender solo. Aquí no: aquí hay afirmaciones
sobre el diseño de un equipo, y una afirmación sobre el diseño de otro
sin fuente es un rumor con voz de documental.

Así que cada hecho lleva de dónde sale, y lo que es interpretación va
marcado como interpretación y se narra como tal ("parece", "apunta a"),
nunca como cifra.

Lo que este episodio NO lleva
─────────────────────────────
Fotos de los coches. Ni de prensa ni renderizadas a partir de ellos: la
librea de un equipo y los logos de sus patrocinadores son marcas ajenas,
y un plano de un coche real es de la agencia que lo hizo. Todo lo que se
ve en pantalla lo dibujamos nosotros.

Y ninguna cifra de rendimiento por equipo. Nadie publica cuánta carga
gana un coche respecto al año anterior; ponerlo en pantalla con un
decimal sería inventarlo. Lo que sí se puede decir es QUÉ hace cada
arquitectura y POR QUÉ, que además es lo interesante.

Todo el texto va en inglés: es contenido del canal.
"""

#: Ritmo de narración del canal, para calcular duración desde las palabras.
PALABRAS_POR_MINUTO = 150

#: De dónde sale cada hecho. Consultado el 24 de agosto de 2026.
FUENTES = {
    "clasificacion": "https://racingnews365.com/2026-f1-championship-standings-after-dutch-grand-prix",
    "w17_ala": "https://www.formula1.com/en/latest/article/tech-analysis-have-mercedes-pioneered-a-left-field-solution-with-their-new.6fpytwTL29cap2mrQuAEdc",
    "w17_motorsport": "https://www.motorsport.com/f1/news/mercedes-surprise-unique-2026-f1-front-wing-design-revealed/10793256/",
    "aero_activa": "https://www.formula1.com/en/latest/article/the-beginners-guide-to-the-2026-regulations.6j0tS0hrHG2T01tpmK6XYz",
    "modos": "https://f1chronicle.com/2026-f1-aerodynamics-explained/",
}

SEGMENTOS = [
    {
        "id": "hook",
        "desde": 0, "hasta": 30,
        "titulo": "Two worlds, one wing",
        "narracion": (
            "In twenty twenty-six, a wing no longer has one job. It has to "
            "be right in two different worlds: a corner, and a straight. In "
            "the corner the car needs load. On the straight it needs speed. "
            "And the fight to have both is happening millimetre by "
            "millimetre, in the geometry of the air. Mercedes lead. Ferrari "
            "are behind them. McLaren are third. All three are solving the "
            "same problem in very different ways."),
        "hechos": [
            {"afirmacion": "Constructors after the Dutch GP: Mercedes 425, "
                           "Ferrari 338, McLaren 263.",
             "fuente": "clasificacion",
             "en_pantalla": True},
            {"afirmacion": "From 2026 both front and rear wings change "
                           "configuration depending on where the car is on "
                           "the circuit.",
             "fuente": "aero_activa"},
        ],
        "diagrama": dict(
            plantilla="comparar", titulo="One wing, two jobs",
            etiqueta="Principle", pie="What the wing is asked for changes",
            izq_nombre="In the corner", izq_valor="Load", izq_unidad="wanted",
            izq_nota="Grip decides the lap time",
            der_nombre="On the straight", der_valor="Drag",
            der_unidad="unwanted", der_nota="Speed decides the lap time"),
    },
    {
        "id": "que_cambio",
        "desde": 30, "hasta": 65,
        "titulo": "What actually changed",
        "narracion": (
            "Two quantities govern everything. Lift, and drag. Both scale "
            "with air density, with the square of speed, and with a "
            "coefficient the designer controls. The problem has always been "
            "that asking for more load brings more drag. What the rules now "
            "allow is for the car to change that compromise while it is "
            "moving. In the corner: more incidence, more load. On the "
            "straight: less incidence, more speed. The goal is no longer one "
            "perfect wing. It is a wing that is right in two "
            "configurations."),
        "hechos": [
            {"afirmacion": "Two modes at predetermined points on the track: "
                           "a low-drag mode for the straights and a "
                           "high-downforce mode as the default for corners.",
             "fuente": "modos"},
            {"afirmacion": "Unlike DRS, it does not depend on following "
                           "another car within a second.",
             "fuente": "aero_activa"},
        ],
        "diagrama": dict(
            plantilla="tendencia", titulo="Drag against downforce",
            etiqueta="Principle",
            pie="The shape is real; the numbers illustrate it",
            puntos_y=[0.1, 0.18, 0.32, 0.55, 0.85, 1.0],
            eje_x="Downforce", eje_y="Drag",
            marca_i=4, marca_texto="The cost accelerates"),
    },
    {
        "id": "mercedes",
        "desde": 65, "hasta": 114,
        "titulo": "Mercedes: buying architecture",
        "narracion": (
            "Mercedes did something noticed immediately. The pylons joining "
            "the nose to the front wing are mounted on the second element, "
            "where every other car mounts them on the mainplane. The wing "
            "makes its peak load around that second element, so anchoring "
            "there stiffens it against the twisting the flaps induce. It "
            "also leaves only the uppermost element free to move, where "
            "most teams move two. And it opens a channel in the lower nose, "
            "feeding air towards the T-tray and on to the floor. Which "
            "points at something fundamental. The front wing does not only "
            "make load on the front axle. It is the first flow-management "
            "device on the car. Change what the underfloor is fed, and you "
            "change nearly everything."),
        "hechos": [
            {"afirmacion": "On the W17 the front wing pylons are attached to "
                           "the second element; on every other car seen so "
                           "far they are on the mainplane.",
             "fuente": "w17_motorsport"},
            {"afirmacion": "Only the uppermost front wing element moves, "
                           "where most teams move two.",
             "fuente": "w17_ala"},
            {"afirmacion": "The mounting creates a channel in the lower nose "
                           "directing airflow towards the T-tray and floor.",
             "fuente": "w17_ala"},
            {"afirmacion": "Mounting there stiffens the wing against the "
                           "torsion the flaps induce, since peak load is "
                           "around the second element.",
             "fuente": "w17_motorsport"},
        ],
        # Lo que NO es un hecho publicado y por eso se narra como lectura.
        "interpretacion": (
            "Whether Mercedes are trading away drag-reduction potential to "
            "buy flow architecture is a READING of the design, not a "
            "published figure. Nobody has published what that architecture "
            "costs or gains. Say 'appears to', 'points to', never a number."),
        "diagrama": dict(
            plantilla="flujo", titulo="A channel that feeds the floor",
            etiqueta="Airflow",
            pie="Our own schematic of the reported layout",
            forma="suelo", notas=[
                {"en": 0.2, "texto": "Channel opens under the nose"},
                {"en": 0.6, "texto": "Air is led towards the T-tray"},
                {"en": 0.85, "texto": "The floor is fed with cleaner flow"}]),
    },
    {
        "id": "ferrari",
        "desde": 114, "hasta": 153,
        "titulo": "Ferrari: the balance question",
        "narracion": (
            "Ferrari took the other route, using the adjustable regions the "
            "rules allow rather than tying one down. That buys freedom to "
            "shed incidence in low-drag mode. But a second variable matters "
            "more than drag: balance. Take too much load off the front axle "
            "and the centre of pressure moves rearward, and an unbalanced "
            "car is a problem on entry, under braking, through a change of "
            "direction. Front and rear active aero are not two wings. They "
            "are one system. The question is not how much drag we can "
            "remove. It is how much without destroying the balance."),
        "hechos": [
            {"afirmacion": "The regulations permit moveable elements on both "
                           "front and rear wings within defined rotation, "
                           "speed and force limits.",
             "fuente": "aero_activa"},
        ],
        "interpretacion": (
            "Ferrari's specific choice of how much front load to retain is "
            "not published. Describe the TRADE-OFF, which is real physics, "
            "not a Ferrari setting figure."),
        "diagrama": dict(
            plantilla="comparar", titulo="Shedding drag without losing balance",
            etiqueta="Principle", pie="The trade-off, not a team's setting",
            izq_nombre="Keep front load", izq_valor="Balance",
            izq_unidad="held", izq_nota="Stable into the corner",
            der_nombre="Shed front load", der_valor="Speed", der_unidad="won",
            der_nota="Centre of pressure moves rearward"),
    },
    {
        "id": "mclaren",
        "desde": 153, "hasta": 195,
        "titulo": "McLaren: usable load",
        "narracion": (
            "McLaren did not need a mechanical revolution to be competitive. "
            "Their work reads as integration: how each update changes the "
            "conversation between the front axle, the floor and the "
            "diffuser. And that distinction matters. A gain is not judged "
            "by the downforce the part makes, but by the performance the "
            "whole car makes. A wing can make more load in simulation and "
            "be slower on track — it adds drag, it spoils the floor, it is "
            "too sensitive in yaw, or it only works in a ride-height window "
            "too narrow to race in. The battle is not more load. It is "
            "usable load."),
        "hechos": [],
        "interpretacion": (
            "This segment is about a PRINCIPLE — component gain versus car "
            "gain — illustrated by McLaren's approach. Do not attribute "
            "specific parts or figures to McLaren."),
        "diagrama": dict(
            plantilla="tendencia", titulo="More load is not always more speed",
            etiqueta="Principle",
            pie="The shape is real; the numbers illustrate it",
            puntos_y=[0.3, 0.55, 0.8, 1.0, 0.82, 0.6],
            eje_x="Downforce added", eje_y="Lap time gained",
            marca_i=3, marca_texto="Past here it costs more than it gives"),
    },
    {
        "id": "suelo",
        "desde": 195, "hasta": 244,
        "titulo": "The real monster is the floor",
        "narracion": (
            "But the front wing is only the beginning. The real load factory "
            "is underneath. The floor accelerates air through a narrowing "
            "channel to hold a region of low pressure. Faster air, lower "
            "pressure — though the honest picture is not one clean "
            "equation. It is a three-dimensional viscous flow, with "
            "gradients, a boundary layer, and pressure recovery in the "
            "diffuser. And there is an enemy. When the adverse gradient "
            "beats the boundary layer, the flow separates and the load "
            "falls away. Too high and you lose the expansion. Too low and "
            "the channel chokes. And when the car turns, left and right no "
            "longer get the same conditions. Which is why two cars with "
            "wings that look alike can behave nothing alike."),
        "hechos": [],
        "diagrama": dict(
            plantilla="flujo", titulo="Where the load is actually made",
            etiqueta="Airflow", pie="Simplified section through the floor",
            forma="suelo", notas=[
                {"en": 0.45, "texto": "Throat: fastest air, lowest pressure"},
                {"en": 0.8, "texto": "Diffuser: pressure recovers, gently"}]),
    },
    {
        "id": "validacion",
        "desde": 244, "hasta": 276,
        "titulo": "How the tenths are found",
        "narracion": (
            "Then the part the viewer never sees. An idea starts as "
            "geometry, goes into simulation, then to the wind tunnel — where "
            "the rules bite hard, capping scale, speed and how much a team "
            "may do. And the point is not a beautiful picture. The point is "
            "correlation. If the computer says one thing and the tunnel says "
            "another, it is not ready. Aerodynamics is not designing a part. "
            "It is building a model that survives the real world."),
        "hechos": [],
        "interpretacion": (
            "Wind tunnel and CFD limits are capped by the regulations and "
            "the figures change between revisions. Speak about the CAPS "
            "existing, not about a specific scale, speed or run count, "
            "unless the current figure has been checked against the FIA "
            "Sporting Regulations for this season."),
        "diagrama": dict(
            plantilla="fases", titulo="From idea to lap time",
            etiqueta="Sequence", pie="Every stage can kill the idea",
            pasos=[
                {"nombre": "Geometry", "detalle": "The shape is drawn"},
                {"nombre": "Simulation", "detalle": "Pressure, velocity, vorticity"},
                {"nombre": "Wind tunnel", "detalle": "Scale model, capped by rule"},
                {"nombre": "Correlation", "detalle": "Do the two agree?"},
                {"nombre": "Track", "detalle": "Yaw, bumps, heat, real air"}]),
    },
    {
        "id": "cierre",
        "desde": 276, "hasta": 303,
        "titulo": "The war is in the air",
        "narracion": (
            "Three cars obeying the same laws. The same air. The same "
            "equations. And yet small differences in geometry change the "
            "whole flow field. In Formula One the tenth is not always in "
            "the engine. Sometimes it is in a millimetre. In a vortex. In a "
            "boundary layer that stays attached — or lets go. The war is "
            "not only on the asphalt. It is in the air."),
        "hechos": [
            {"afirmacion": "Constructors after the Dutch GP: Mercedes 425, "
                           "Ferrari 338, McLaren 263.",
             "fuente": "clasificacion",
             "en_pantalla": True},
        ],
        "diagrama": dict(
            plantilla="comparar", titulo="Same air, different answers",
            etiqueta="Principle", pie="Three readings of one rule set",
            izq_nombre="Structure first", izq_valor="Flow",
            izq_unidad="architecture", izq_nota="Fewer moving parts, more control",
            der_nombre="Adaptability first", der_valor="Range",
            der_unidad="of settings", der_nota="More freedom, more to balance"),
    },
]


def palabras():
    """Cuántas palabras narra el episodio entero."""
    return sum(len(s["narracion"].split()) for s in SEGMENTOS)


def duracion_estimada():
    """Minutos de narración a nuestro ritmo, sin contar pausas."""
    return palabras() / PALABRAS_POR_MINUTO


def cuadra():
    """Comprueba que cada segmento CABE en su ventana de tiempo.

    El primer montaje del guion sumaba mil cuarenta palabras, casi siete
    minutos, contra una ventana de cuatro cincuenta y cinco: dos minutos
    de más que en video se traducen en narración pisando el corte, o en
    un final recortado a media frase. Se comprueba aquí para que se vea
    antes de grabar, no después.

    Devuelve [] si todo cuadra, o la lista de segmentos que se pasan.
    """
    malos = []
    for s in SEGMENTOS:
        dur = s["hasta"] - s["desde"]
        caben = int(dur / 60 * PALABRAS_POR_MINUTO)
        pal = len(s["narracion"].split())
        if pal > caben:
            malos.append({"segmento": s["id"], "palabras": pal,
                          "caben": caben, "sobran": pal - caben})
    return malos


def hechos_con_fuente():
    """Cada afirmación factual del episodio con su URL. Es lo que hace
    defendible un episodio que habla de coches concretos."""
    out = []
    for s in SEGMENTOS:
        for h in s.get("hechos", []):
            out.append({"segmento": s["id"], "afirmacion": h["afirmacion"],
                        "url": FUENTES.get(h["fuente"], "")})
    return out

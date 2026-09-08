"""actuacion.py — La partitura vocal: no QUÉ se dice, sino CÓMO se dice.

El problema
───────────
El guion ya sale bien: el dúo dice cosas ciertas y en el momento justo.
Lo que sale plano es la ENTREGA. Un adelantamiento por el liderato y una
explicación de degradación de neumáticos se leen con exactamente la misma
voz, la misma velocidad y la misma energía. En una retransmisión de
verdad eso no pasa nunca: el comentarista sube, se acelera, se calla medio
segundo antes de decir el nombre, y luego baja.

Así que hace falta una segunda pista además del texto: la actuación.

Lo que NO se puede hacer (y por qué este archivo existe)
────────────────────────────────────────────────────────
La tentación es escribir las marcas dentro del texto: "[SHOUT] LECLERC!".
Eso NO funciona con los motores que usa el canal, y el fallo es de los
caros porque sale al aire:

• eleven_multilingual_v2 —el modelo que usamos— entiende la etiqueta SSML
  <break time="0.5s" /> y nada más. Un "[SHOUT]" en el texto se LEE en voz
  alta: "corchete shout". Las etiquetas entre corchetes tipo [excited] solo
  las interpreta eleven_v3, que es otro modelo.
• gpt-4o-mini-tts (el respaldo de OpenAI) tampoco lee corchetes como
  instrucciones — pero tiene un campo aparte, `instructions`, donde la
  dirección de actuación se escribe en lenguaje normal.

O sea: las marcas sirven para PENSAR y para que el guionista las escriba,
pero tienen que quedarse fuera del audio. Este archivo es el traductor:
recibe el texto marcado y devuelve tres cosas separadas —el texto limpio
para el subtítulo, el texto para el motor de voz, y los parámetros de
entrega— de modo que ninguna marca llegue nunca al micrófono ni a la
pantalla.

Y la parte que no se le pide al modelo
───────────────────────────────────────
La intensidad máxima hay que ganársela. Si se le dice a Claude "sé
emocionante" contesta con un 5 en todo, y treinta segundos a tope no son
emocionantes: son ruido, y además dejan sin sitio al momento que sí
importaba. Por eso el techo de energía NO lo decide el guionista: lo
calcula `Curva` con lo MEDIDO —a cuánto va el duelo, por qué posición,
cuántas vueltas quedan, si hay safety car— y luego se recorta lo que el
modelo haya devuelto. El grito se reserva para cuando los datos dicen que
hay algo por lo que gritar.
"""

import re

# ── Motores y lo que cada uno entiende de verdad ──────────────────────
#: Etiquetas SSML de pausa: eleven_multilingual_v2, flash_v2 y flash_v2.5.
#: Es la ÚNICA marca dentro del texto que estos modelos interpretan.
MOTOR_ELEVEN = "eleven"
#: OpenAI: los corchetes se leen en voz alta, pero hay campo instructions.
MOTOR_OPENAI = "openai"

#: Modelos de ElevenLabs que sí interpretan etiquetas de emoción entre
#: corchetes ([excited], [whispers]…). Si el Secret ELEVENLABS_MODELO se
#: cambia a uno de estos, las etiquetas emocionales pasan al audio en vez
#: de descartarse. Mientras tanto viven solo en los parámetros.
MODELOS_CON_ETIQUETAS = ("eleven_v3",)

#: Pausa máxima que acepta la etiqueta break de ElevenLabs.
PAUSA_MAX = 3.0
#: Y la mínima que se nota; por debajo no vale la llamada.
PAUSA_MIN = 0.15


# ── La leyenda que ve el guionista ────────────────────────────────────
# Va en inglés porque todo lo que toca la antena va en inglés: el modelo
# escribe el guion en inglés y estas marcas viajan pegadas a él.
LEYENDA = """VOCAL PERFORMANCE
Every line carries HOW it should be said, not just what it says. A real
commentator does not hold one energy for thirty seconds: calm observation
becomes anticipation, anticipation accelerates, it peaks on one word, and
then it releases. Write that shape.

For each line set two numbers:
  SPEED     1 slow/analytical · 2 conversational · 3 normal commentary
            · 4 fast · 5 extremely rapid climax
  INTENSITY 1 calm · 2 controlled · 3 excited · 4 intense · 5 explosive

And optionally an EMOTION: calm, anticipation, tension, excitement,
urgency, disbelief, relief, triumph, concern.

Inside the text you may use ONLY these marks:
  [PAUSE 0.4]  a real silence, in seconds (0.15 to 3.0). Use it before a
               decisive word, never at random.
  [BREATH]     a beat to breathe. Before an acceleration, or after a long
               rapid burst. NEVER in the middle of the key phrase — a
               breath between "PEREZ" and "IS THROUGH" kills the moment.
  CAPITALS     emphasis on that word. Only whole words of four letters or
               more, and never on a driver code or an acronym: the voice
               would spell it out letter by letter on air.

Nothing else in brackets. Any other bracket is spoken out loud as a word.

INFORMATION DENSITY follows the intensity. At 1-2 write complete
sentences. At 3 shorten them. At 4 use fragments. At 5 one or two words
are stronger than a sentence — "LECLERC!" beats "Leclerc has held the
position on the inside". After the peak, drop to 2 and explain what just
happened.

A line at 5 must be EARNED by what is happening on track. If nothing is
happening, 2 is the honest answer, and a segment that goes 2-3-4-5-2 is
worth more than five lines at 5."""


# ── Reparto de la marca ───────────────────────────────────────────────
_RE_PAUSA = re.compile(r"\[\s*PAUSE\s+([0-9]*\.?[0-9]+)\s*\]", re.I)
_RE_ALIENTO = re.compile(r"\[\s*(?:DEEP\s+)?BREATH\s*\]", re.I)
#: Cualquier otro corchete. Se BORRA sin piedad: si llega al motor se lee
#: en voz alta, y "corchete build" en mitad de un adelantamiento es
#: exactamente el ridículo que este archivo existe para evitar.
_RE_SOBRA = re.compile(r"\[[^\]]{0,40}\]")

#: Las etiquetas de emoción que eleven_v3 sí interpreta. La lista es
#: corta a propósito: con v3 el criterio NO es "deja pasar los corchetes",
#: es "deja pasar ESTOS". Un corchete que no esté aquí es una errata del
#: guion, no una intención, y una errata no sale al aire.
ETIQUETAS_V3 = frozenset((
    "excited", "whispers", "laughs", "sighs", "shouts", "shouting",
    "sarcastically", "curious", "nervous", "relieved", "serious",
))
_RE_ETIQUETA = re.compile(r"\[\s*([A-Za-z ]{1,20}?)\s*\]")


def _filtrar_v3(texto):
    """Deja solo las etiquetas que eleven_v3 entiende; borra el resto."""
    return _RE_ETIQUETA.sub(
        lambda m: (f"[{m.group(1).strip().lower()}]"
                   if m.group(1).strip().lower() in ETIQUETAS_V3 else " "),
        texto)


def _pausa_valida(s):
    try:
        return max(PAUSA_MIN, min(PAUSA_MAX, float(s)))
    except (TypeError, ValueError):
        return None


def separar(texto, motor, modelo=""):
    """Del texto marcado saca (subtítulo, texto para el motor).

    El subtítulo va SIEMPRE limpio: en pantalla un "[PAUSE 0.4]" es un
    fallo visible, y el espectador lo ve aunque la voz no lo diga.
    """
    texto = (texto or "").strip()
    if not texto:
        return "", ""

    # 1) El subtítulo: fuera todas las marcas, y cuidando que al quitarlas
    #    no queden dos espacios ni un espacio antes de la coma.
    limpio = _RE_SOBRA.sub(" ", texto)
    limpio = re.sub(r"\s+([,.;:!?…])", r"\1", limpio)
    limpio = re.sub(r"\s{2,}", " ", limpio).strip()

    # 2) La voz, según lo que ESE motor entienda de verdad.
    if motor == MOTOR_ELEVEN:
        voz = _RE_PAUSA.sub(
            lambda m: (f'<break time="{_pausa_valida(m.group(1)) or 0.3}s" />'
                       if _pausa_valida(m.group(1)) else " "), texto)
        # Un aliento es una pausa corta. Ninguno de los dos motores sabe
        # inhalar a la orden, así que se aproxima con silencio: en antena
        # un respiro suena a respiro aunque no haya aire de verdad.
        voz = _RE_ALIENTO.sub('<break time="0.3s" />', voz)
        # Fuera lo que quede. Aquí cae también el "[PAUSE cuatro]" mal
        # escrito: no casó con la pausa de arriba porque no lleva número,
        # y sin este barrido se leería tal cual en antena.
        voz = (_filtrar_v3(voz)
               if any(modelo.startswith(m) for m in MODELOS_CON_ETIQUETAS)
               else _RE_SOBRA.sub(" ", voz))
    else:
        # OpenAI no tiene etiqueta de pausa. Los puntos suspensivos sí
        # frenan la lectura, que es lo más cerca que se llega sin cortar
        # y recomponer el MP3 (y eso, en directo, cuesta más de lo que da).
        voz = _RE_PAUSA.sub(
            lambda m: "… " if (_pausa_valida(m.group(1)) or 0) < 0.6
            else "…… ", texto)
        voz = _RE_ALIENTO.sub("… ", voz)
        voz = _RE_SOBRA.sub(" ", voz)
        # Una frase que ya terminaba en "..." más los puntos de la pausa
        # deja "Leclerc...…", y el motor tropieza leyéndolo. Se colapsa
        # todo el racimo en una sola elipsis.
        voz = re.sub(r"[.…][.…\s]*…", "… ", voz)

    voz = re.sub(r"\s+([,.;:!?…])", r"\1", voz)
    voz = re.sub(r"\s{2,}", " ", voz).strip()
    return limpio, voz


def limpiar(texto):
    """Solo lo que ve el espectador: el texto sin ninguna marca.

    Lo usan el subtítulo, el diario del dúo y la grabación del VOD. Un
    "[PAUSE 0.4]" en pantalla es un fallo que se ve aunque no se oiga.
    """
    return separar(texto, MOTOR_OPENAI)[0]


# ── De los números a los mandos del motor ─────────────────────────────
def _nivel(x, por_defecto=3):
    try:
        return max(1, min(5, int(round(float(x)))))
    except (TypeError, ValueError):
        return por_defecto


#: Cuánto se estira o encoge la velocidad base de la voz en cada nivel.
#: Es un FACTOR y no un valor absoluto para que el mando VOZ_VELOCIDAD
#: siga mandando: quien lo baje porque su voz corre, se lo baja todo.
FACTOR_VELOCIDAD = {1: 0.88, 2: 0.96, 3: 1.0, 4: 1.10, 5: 1.20}


def ajustes_eleven(base, velocidad, intensidad, velocidad_base=1.0):
    """Los voice_settings de ElevenLabs para esta línea concreta.

    stability BAJA = más rango emocional y más variación; alta = plana y
    previsible. Así que la intensidad la mueve hacia abajo. Pero no se
    deja caer por debajo de 0.25: ahí la voz deja de ser expresiva y
    empieza a ser inestable —cambios de timbre, palabras arrastradas— y
    eso no suena a emoción, suena a avería.
    """
    if velocidad is None and intensidad is None:
        # Sin partitura no se toca nada: los caminos que no se han tocado
        # (documentales, shorts, respaldo de visión) suenan exactamente
        # igual que antes de que este archivo existiera.
        return {**base, "speed": velocidad_base}
    v, i = _nivel(velocidad), _nivel(intensidad)
    est = float(base.get("stability", 0.5)) - (i - 3) * 0.09
    est = max(0.25, min(0.80, est))
    style = float(base.get("style", 0.4)) + (i - 3) * 0.10
    style = max(0.0, min(0.85, style))
    # El rango que acepta la API es 0.7–1.2; fuera de ahí la rechaza.
    vel = max(0.7, min(1.2, velocidad_base * FACTOR_VELOCIDAD[v]))
    return {**base, "stability": round(est, 3), "style": round(style, 3),
            "speed": round(vel, 3)}


_PALABRA_VELOCIDAD = {
    1: "slow and analytical, giving each word room",
    2: "conversational, unhurried",
    3: "normal race-commentary pace",
    4: "fast, pressing forward",
    5: "extremely rapid, words tumbling out",
}
_PALABRA_INTENSIDAD = {
    1: "calm and quiet",
    2: "controlled, level",
    3: "excited, lifted",
    4: "intense, projecting hard",
    5: "explosive — a full-voiced shout, the loudest moment of the race",
}


def instrucciones_openai(base, velocidad, intensidad, emocion=""):
    """La dirección de actuación para el campo `instructions` de OpenAI.

    Se AÑADE a la instrucción de personaje en vez de sustituirla: lo que
    define quién es la voz (británica, cálida, de estudio) no cambia
    porque suba la emoción, igual que un comentarista no se convierte en
    otra persona cuando grita.
    """
    if velocidad is None and intensidad is None and not emocion:
        return base            # sin partitura, la instrucción de siempre
    v, i = _nivel(velocidad), _nivel(intensidad)
    partes = [f"DELIVERY OF THIS LINE — pace: {_PALABRA_VELOCIDAD[v]}; "
              f"energy: {_PALABRA_INTENSIDAD[i]}."]
    if emocion:
        partes.append(f"The feeling is {emocion}.")
    if i >= 4:
        partes.append("Let the pitch rise and the voice strain a little; "
                      "this is a moment, not a sentence.")
    elif i <= 2:
        partes.append("Stay off the accelerator. Silence between phrases "
                      "is welcome.")
    # Sin esto, el motor deletrea las mayúsculas. "L-E-C-L-E-R-C" al aire.
    partes.append("Words in capitals are EMPHASIS: hit them harder, and "
                  "never spell them out letter by letter.")
    return f"{base} {' '.join(partes)}"


def firma(velocidad, intensidad, emocion=""):
    """Etiqueta corta de la entrega, para la clave del caché de audio.

    Sin esto, la misma frase dicha a intensidad 2 y a intensidad 5
    devolvería el mismo MP3 guardado: el caché serviría el tranquilo
    justo en el momento del grito.

    Devuelve VACÍO cuando no hay partitura (o es la neutra), y eso es
    deliberado: así la clave del caché queda igual que antes de que este
    archivo existiera y los audios ya pagados —todos los documentales—
    se siguen encontrando.
    """
    if velocidad is None and intensidad is None and not emocion:
        return ""
    v, i = _nivel(velocidad), _nivel(intensidad)
    if v == 3 and i == 3 and not emocion:
        return ""
    return f"v{v}i{i}{(emocion or '')[:12]}"


# ── La curva de tensión, calculada con lo medido ──────────────────────
class Curva:
    """Cuánta energía se AUTORIZA ahora mismo, y por qué.

    Dos trabajos:

    1. Poner el techo con datos, no con adjetivos. Un adelantamiento por
       el liderato a tres vueltas del final no vale lo mismo que uno por
       la decimocuarta plaza en la vuelta 6, y el guionista no tiene forma
       de saber la diferencia si no se le dice con cifras.

    2. Gastar el 5 con cuentagotas. Después de dos intervenciones a tope
       la siguiente baja aunque siga habiendo movimiento: si todo es
       clímax, no hay clímax. Solo un evento NUEVO vuelve a abrir el
       techo, y por eso se recuerda cuál fue el último.
    """

    def __init__(self):
        self.altos = 0          # intervenciones seguidas a intensidad ≥4
        self.ultimo_motivo = ""  # para no cobrar dos veces el mismo evento

    def objetivo(self, *, eventos=None, situacion="", duelo=None,
                 vuelta=0, total_vueltas=0, prerace=False, postsesion=False):
        """Devuelve {"velocidad", "intensidad", "motivo"}."""
        texto = " ".join(eventos or []).upper()
        motivo, vel, ints = "steady racing", 3, 2

        if prerace:
            motivo, vel, ints = "pre-race build-up", 2, 2
        elif postsesion:
            # El análisis de después de la meta es conversación, no
            # retransmisión. Aquí gritar suena a que no se ha enterado de
            # que la carrera terminó.
            motivo, vel, ints = "post-race analysis", 2, 2
        elif "RED FLAG" in texto:
            motivo, vel, ints = "red flag", 3, 4
        elif any(p in texto for p in ("CRASH", "ACCIDENT", "SAFETY CAR")):
            motivo, vel, ints = "incident / safety car", 4, 4
        elif any(p in texto for p in ("OVERTAKE", "PASSES", "TAKES P")):
            # Por dónde va el adelantamiento decide cuánto vale.
            pos = _primera_posicion(texto)
            if pos and pos <= 3:
                motivo, vel, ints = f"overtake for P{pos}", 5, 5
            elif pos and pos <= 10:
                motivo, vel, ints = f"overtake for P{pos}", 4, 4
            else:
                motivo, vel, ints = "overtake down the order", 4, 3
        elif duelo and duelo.get("gap") is not None:
            gap = duelo["gap"]
            pos = (duelo.get("delante") or {}).get("pos") or 99
            if gap < 0.5 and pos <= 5:
                motivo, vel, ints = f"under DRS for P{pos}", 4, 4
            elif gap < 1.0:
                motivo, vel, ints = f"a car length apart for P{pos}", 3, 3
            else:
                motivo, vel, ints = "a gap closing", 3, 2
        elif "PIT" in texto or "STOP" in texto:
            motivo, vel, ints = "pit stop", 3, 3

        # Últimas vueltas con algo abierto: sube un escalón. Es la única
        # subida que da el reloj, y se la ha ganado.
        if (total_vueltas and vuelta and vuelta >= total_vueltas - 2
                and not postsesion and ints >= 3):
            vel, ints = min(5, vel + 1), min(5, ints + 1)
            motivo += ", final laps"
        if "RAIN" in texto or "WET" in situacion.upper():
            ints = max(ints, 3)

        # El freno: dos veces arriba y la tercera baja, salvo que lo que
        # esté pasando sea OTRA cosa distinta de la que ya se celebró.
        if ints >= 4 and self.altos >= 2 and motivo == self.ultimo_motivo:
            vel, ints = min(vel, 3), 3
            motivo += " (already at peak — coming back down)"
        return {"velocidad": vel, "intensidad": ints, "motivo": motivo}

    def registrar(self, intensidad, motivo=""):
        """Apunta lo que de verdad salió al aire."""
        if _nivel(intensidad) >= 4:
            self.altos += 1
        else:
            self.altos = 0
        self.ultimo_motivo = motivo

    def techo(self, objetivo):
        """Lo máximo que se le acepta al guionista para este segmento.

        Se le deja UN escalón por encima del objetivo: el guionista ve el
        texto que ha escrito y el director no, así que puede tener razón
        en que esa frase concreta pide más. Dos escalones ya sería que no
        está mirando los datos.
        """
        return min(5, _nivel(objetivo.get("intensidad", 3)) + 1)


_RE_POS = re.compile(r"\bP(\d{1,2})\b")


def _primera_posicion(texto):
    """La posición en disputa que aparezca en el evento, si aparece."""
    m = _RE_POS.search(texto or "")
    if not m:
        return None
    try:
        return max(1, min(20, int(m.group(1))))
    except ValueError:
        return None


def normalizar(linea, objetivo, curva):
    """Deja una línea del modelo con velocidad e intensidad utilizables.

    Aquí se recorta lo que venga pasado de vueltas. El modelo tiende a
    contestar 5 en todo cuando se le habla de emoción; el recorte es lo
    que convierte la leyenda en una curva de verdad.
    """
    tope = curva.techo(objetivo)
    v = min(_nivel(linea.get("velocidad"), objetivo["velocidad"]), 5)
    i = min(_nivel(linea.get("intensidad"), objetivo["intensidad"]), tope)
    # Velocidad e intensidad no son independientes: nadie susurra a toda
    # prisa ni grita despacio. Se permite un escalón de diferencia.
    v = max(i - 1, min(i + 1, v))
    return {**linea, "velocidad": v, "intensidad": i,
            "emocion": (linea.get("emocion") or "").strip()[:24]}

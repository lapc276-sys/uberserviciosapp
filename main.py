#!/usr/bin/env python3
"""
main.py — Backend para Replit que recibe los frames de captura_mac.py.

Endpoints:
  WS  /ws/frames   — la Mac envía frames JPEG (binario); el backend le
                     devuelve mensajes JSON {"tipo": "narracion", "texto": ...}
  GET /            — visor web: muestra el último frame y la última narración
  GET /frame.jpg   — último frame recibido
  GET /narracion   — última narración en JSON

Narración con Claude (visión):
  Si la variable de entorno ANTHROPIC_API_KEY está definida, cada
  INTERVALO_NARRACION segundos se envía el frame más reciente a Claude
  para generar una narración corta en español, que se difunde a la Mac
  y queda disponible en /narracion. Sin API key, el servidor funciona
  igual pero sin narración.

Ejecutar localmente:  python3 main.py   (puerto 8080 o $PORT)
"""

import asyncio
import base64
import contextlib
import json
import logging
import os
import time

import anthropic
import httpx
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, Response

import telemetria

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("f1tv-backend")

INTERVALO_NARRACION = 10   # segundos entre narraciones con eventos
RELLENO_SEGUNDOS = 90      # sin eventos, cada cuánto considerar rellenar
MODELO = "claude-opus-4-8"

# Telemetría: "replay" reproduce la última carrera disputada desde OpenF1;
# "off" desactiva y se narra solo por visión (frames de la Mac).
MODO_TELEMETRIA = os.environ.get("MODO_TELEMETRIA", "replay")
SESSION_KEY = os.environ.get("SESSION_KEY", "latest")
VELOCIDAD_REPLAY = float(os.environ.get("VELOCIDAD_REPLAY", "1"))

# Idioma del dúo de comentaristas: "en" (canal) o "es" (pruebas locales)
IDIOMA = os.environ.get("IDIOMA", "en")

# El dúo: narrador (play-by-play) y analista (color commentator).
# "Sam" funciona con voz masculina o femenina, según lo que haya instalado.
NARRADOR = "Alex"
ANALISTA = "Sam"

# Voces naturales (opcional): con OPENAI_API_KEY definida, cada línea se
# sintetiza con el TTS de OpenAI y la Mac la reproduce tal cual. Sin la
# clave, la Mac usa sus voces del sistema (say).
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
TTS_MODELO = os.environ.get("TTS_MODELO", "gpt-4o-mini-tts")
TTS_VOCES = {
    "narrador": {
        "voice": "ash",
        "instructions": ("Warm, conversational sports commentator — like a "
                         "passionate friend telling you the race, never a "
                         "stiff formal news announcer. Naturally "
                         "enthusiastic, sometimes playful or ironic. "
                         "Variable tempo: quick and agile when narrating "
                         "action, easing off with deliberate pauses when "
                         "explaining. Intonation rises with genuine "
                         "excitement at key moments. Emphasize driver "
                         "names, key numbers and emotions. Medium-high "
                         "projection but with the intimate texture of a "
                         "studio microphone. Breathes naturally at commas "
                         "and periods; a spontaneous light chuckle when "
                         "the script hints at it."),
    },
    "analista": {
        "voice": "onyx",
        "instructions": ("Calm, seasoned Formula 1 color commentator. "
                         "Relaxed pace, thoughtful, slightly dry humor. "
                         "Conversational, like chatting in the booth."),
    },
}


# ElevenLabs (opcional, prioridad sobre OpenAI si está la clave).
# Los voice IDs por defecto son voces prediseñadas públicas; se cambian
# eligiendo otra voz en la Voice Library y copiando su ID en el Secret.
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
ELEVENLABS_MODELO = os.environ.get("ELEVENLABS_MODELO",
                                   "eleven_multilingual_v2")
ELEVENLABS_VOCES = {
    # Alex: Jamie (alternativa elegida por el dueño: Jude
    # Yg7C1g7suzNt5TisIqkZ)
    "narrador": os.environ.get("ELEVENLABS_VOZ_NARRADOR",
                               "llNlEi50DSCIEuoOIaH7"),  # Jamie (británico)
    # Sam: Lucie (británica)
    "analista": os.environ.get("ELEVENLABS_VOZ_ANALISTA",
                               "GPTk4QbvF7snDhImF5UF"),  # Lucie (británica)
}
# Expresividad por personaje: el narrador más variable/emocional, el
# analista más estable y pausado (pero no plano).
ELEVENLABS_AJUSTES = {
    "narrador": {"stability": 0.35, "similarity_boost": 0.75, "style": 0.65},
    "analista": {"stability": 0.55, "similarity_boost": 0.75, "style": 0.45},
}


async def _tts_elevenlabs(quien, texto):
    voz = ELEVENLABS_VOCES.get(quien, ELEVENLABS_VOCES["narrador"])
    ajustes = ELEVENLABS_AJUSTES.get(quien, ELEVENLABS_AJUSTES["narrador"])
    async with httpx.AsyncClient() as cliente:
        r = await cliente.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voz}",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": ELEVENLABS_API_KEY},
            json={"text": texto, "model_id": ELEVENLABS_MODELO,
                  "voice_settings": ajustes},
            timeout=60,
        )
        r.raise_for_status()
        return r.content


async def _tts_openai(quien, texto):
    cfg = TTS_VOCES.get(quien, TTS_VOCES["narrador"])
    async with httpx.AsyncClient() as cliente:
        r = await cliente.post(
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={"model": TTS_MODELO, "voice": cfg["voice"],
                  "instructions": cfg["instructions"],
                  "input": texto, "response_format": "mp3"},
            timeout=60,
        )
        r.raise_for_status()
        return r.content


async def sintetizar(quien, texto):
    """Convierte una línea en MP3: ElevenLabs > OpenAI > None (voz Mac)."""
    if ELEVENLABS_API_KEY:
        try:
            return await _tts_elevenlabs(quien, texto)
        except Exception as e:
            log.error("ElevenLabs falló (%s) — probando OpenAI", e)
    if OPENAI_API_KEY:
        try:
            return await _tts_openai(quien, texto)
        except Exception as e:
            log.error("OpenAI TTS falló (%s) — la Mac usará su voz", e)
    return None


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    if ELEVENLABS_API_KEY:
        log.info("Voces naturales activadas (ElevenLabs %s)",
                 ELEVENLABS_MODELO)
    elif OPENAI_API_KEY:
        log.info("Voces naturales activadas (OpenAI %s)", TTS_MODELO)
    else:
        log.warning("Sin clave de TTS (ELEVENLABS_API_KEY / OPENAI_API_KEY) "
                    "— la Mac usará sus voces del sistema (robóticas)")
    tareas = [asyncio.create_task(bucle_telemetria()),
              asyncio.create_task(bucle_narracion()),
              asyncio.create_task(bucle_ambiente())]
    yield
    for t in tareas:
        t.cancel()


app = FastAPI(title="F1TV frames backend", lifespan=lifespan)


class Estado:
    """Último frame, narración y telemetría, compartidos entre endpoints."""

    def __init__(self):
        self.frame: bytes | None = None
        self.frame_ts: float = 0.0
        self.narracion: str = ""
        self.narracion_ts: float = 0.0
        self.clientes_mac: set[WebSocket] = set()
        self.tele: telemetria.Telemetria | None = None
        self.tele_cargando: bool = False
        self.eventos: list[str] = []   # eventos de telemetría sin narrar
        self.diario: list[str] = []    # memoria: últimas líneas dichas
        self.lineas: list[dict] = []   # último segmento de diálogo
        self.ambiente_b64: str | None = None  # loop de sonido de motores
        self.ambiente_activo: bool = False


estado = Estado()


@app.websocket("/ws/frames")
async def ws_frames(ws: WebSocket):
    await ws.accept()
    estado.clientes_mac.add(ws)
    log.info("Mac conectada (%d cliente(s))", len(estado.clientes_mac))
    if estado.ambiente_activo and estado.ambiente_b64:
        try:
            await _enviar_ambiente(ws, "start")
        except Exception:
            pass
    try:
        while True:
            frame = await ws.receive_bytes()
            estado.frame = frame
            estado.frame_ts = time.time()
    except WebSocketDisconnect:
        pass
    finally:
        estado.clientes_mac.discard(ws)
        log.info("Mac desconectada (%d cliente(s))", len(estado.clientes_mac))


@app.get("/frame.jpg")
async def frame_jpg():
    if estado.frame is None:
        return Response(status_code=404, content=b"Sin frames todavia")
    return Response(content=estado.frame, media_type="image/jpeg")


@app.get("/apex")
async def apex():
    """Datos en vivo para la pantalla de transmisión Project Apex."""
    t = estado.tele
    return JSONResponse({
        "en_vivo": t is not None,
        "gp": (t.sesion.get("country_name", "") if t else ""),
        "circuito": (t.sesion.get("circuit_short_name", "") if t else ""),
        "vuelta": t.vuelta if t else 0,
        "total_vueltas": t.total_vueltas if t else 0,
        "leaderboard": t.tabla() if t else [],
        "incidentes": list(reversed(t.incidentes)) if t else [],
        "lineas": [{**l, "nombre": _nombre_de(l["quien"])}
                   for l in estado.lineas],
        "idioma": IDIOMA,
        "hay_frame": estado.frame is not None,
    })


@app.get("/narracion")
async def narracion():
    return JSONResponse({
        "texto": estado.narracion,
        "lineas": [{**l, "nombre": _nombre_de(l["quien"])}
                   for l in estado.lineas],
        "idioma": IDIOMA,
        "hace_segundos": round(time.time() - estado.narracion_ts)
        if estado.narracion_ts else None,
    })


@app.get("/", response_class=HTMLResponse)
async def visor():
    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>APEX — Live Race Intelligence</title>
<style>
  :root {
    --bg: #0B0D12; --panel: #151922; --line: #232936;
    --txt: #FFFFFF; --dim: #9AA3B2; --accent: #E10600;
    --up: #2ECC71; --down: #E10600; --amber: #FFB020;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--txt); min-height: 100vh;
         font-family: Inter, -apple-system, "SF Pro Display",
                      "IBM Plex Sans", "Segoe UI", sans-serif; }
  header { display: flex; align-items: center; gap: 14px;
           padding: 14px 22px; border-bottom: 1px solid var(--line); }
  .dot { width: 10px; height: 10px; border-radius: 50%;
         background: var(--accent); animation: pulse 1.6s infinite; }
  @keyframes pulse { 50% { opacity: .35; } }
  .live { font-weight: 700; letter-spacing: .12em; font-size: .8rem; }
  #gp { font-weight: 600; font-size: 1rem; letter-spacing: .04em;
        text-transform: uppercase; }
  #lap { margin-left: auto; color: var(--dim); font-variant-numeric:
         tabular-nums; font-size: .9rem; letter-spacing: .08em; }
  main { display: grid; grid-template-columns: 230px 1fr 290px;
         gap: 14px; padding: 14px 22px; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  .panel { background: var(--panel); border: 1px solid var(--line);
           border-radius: 12px; padding: 14px 16px; }
  .panel h3 { font-size: .68rem; letter-spacing: .18em; color: var(--dim);
              text-transform: uppercase; margin-bottom: 10px; }
  /* Leaderboard */
  #board .row { display: flex; align-items: center; gap: 10px;
                padding: 6px 4px; border-bottom: 1px solid var(--line);
                font-variant-numeric: tabular-nums; }
  #board .row:last-child { border-bottom: none; }
  .p { color: var(--dim); width: 1.4em; font-size: .85rem; }
  .acr { font-weight: 700; letter-spacing: .06em; }
  .delta { margin-left: auto; font-size: .8rem; width: 1.2em;
           text-align: right; transition: opacity .6s; opacity: 0; }
  .delta.up   { color: var(--up); opacity: 1; }
  .delta.down { color: var(--down); opacity: 1; }
  /* Centro */
  #centro { display: flex; flex-direction: column; gap: 14px; }
  #framebox { display: none; }
  #framebox img { width: 100%; border-radius: 12px; display: block; }
  #dialogo { display: flex; flex-direction: column; gap: 12px; }
  .card { background: var(--panel); border: 1px solid var(--line);
          border-radius: 12px; padding: 14px 18px; }
  .card .quien { font-size: .68rem; letter-spacing: .18em;
                 text-transform: uppercase; margin-bottom: 6px; }
  .card.narrador .quien { color: var(--accent); }
  .card.analista .quien { color: var(--dim); }
  .card .texto { font-size: 1.05rem; line-height: 1.5; }
  #offair { color: var(--dim); text-align: center; padding: 40px 0;
            letter-spacing: .1em; font-size: .85rem; }
  /* Incidentes */
  #incidentes .inc { display: flex; gap: 8px; padding: 7px 0;
                     border-bottom: 1px solid var(--line);
                     font-size: .82rem; color: var(--dim); }
  #incidentes .inc:last-child { border-bottom: none; }
  .inc .lapn { color: var(--amber); white-space: nowrap; }
  /* Voz */
  #voz { margin: 0 22px 20px; padding: 9px 16px; font-size: .85rem;
         border: 1px solid var(--line); border-radius: 8px;
         cursor: pointer; background: var(--panel); color: var(--dim); }
  #voz.on { border-color: var(--up); color: var(--up); }
</style>
</head>
<body>
<header>
  <span class="dot" id="dot"></span><span class="live" id="livetxt">LIVE</span>
  <span id="gp">—</span>
  <span id="lap"></span>
</header>
<main>
  <section class="panel"><h3>Leaderboard</h3><div id="board"></div></section>
  <section id="centro">
    <div id="framebox"><img id="frame" alt=""></div>
    <div id="dialogo"><div id="offair">WAITING FOR SESSION…</div></div>
  </section>
  <section class="panel"><h3>Race Control</h3><div id="incidentes"></div></section>
</main>
<button id="voz">VOICE OFF — click to enable browser voice</button>
<script>
let vozActiva = false, ultimoDialogo = '', posPrevias = {};
const btn = document.getElementById('voz');
btn.onclick = () => {
  vozActiva = !vozActiva;
  btn.classList.toggle('on', vozActiva);
  btn.textContent = vozActiva ? 'VOICE ON — click to mute'
                              : 'VOICE OFF — click to enable browser voice';
  if (vozActiva) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
};
function hablar(lineas, idioma) {
  for (const l of lineas) {
    const u = new SpeechSynthesisUtterance(l.texto);
    u.lang = idioma === 'es' ? 'es-ES' : 'en-GB';
    const voces = speechSynthesis.getVoices()
      .filter(v => v.lang.toLowerCase().startsWith(idioma === 'es' ? 'es' : 'en'));
    if (voces.length) u.voice = l.quien === 'narrador'
      ? voces[0] : voces[voces.length - 1];
    u.rate = l.quien === 'narrador' ? 1.1 : 0.97;
    u.pitch = l.quien === 'narrador' ? 1.1 : 0.9;
    speechSynthesis.speak(u);
  }
}
async function tick() {
  const d = await (await fetch('/apex')).json();
  document.getElementById('gp').textContent =
    d.en_vivo ? (d.gp + ' — ' + d.circuito) : 'NO LIVE SESSION';
  document.getElementById('lap').textContent =
    d.en_vivo && d.vuelta ? 'LAP ' + d.vuelta +
      (d.total_vueltas ? ' / ' + d.total_vueltas : '') : '';
  document.getElementById('dot').style.display = d.en_vivo ? '' : 'none';
  document.getElementById('livetxt').style.display = d.en_vivo ? '' : 'none';
  // leaderboard con flechas 2s
  const board = document.getElementById('board');
  board.innerHTML = '';
  for (const f of d.leaderboard) {
    const row = document.createElement('div'); row.className = 'row';
    const prev = posPrevias[f.acr];
    let flecha = '', cls = '';
    if (prev !== undefined && prev !== f.pos) {
      flecha = f.pos < prev ? '\\u25B2' : '\\u25BC';
      cls = f.pos < prev ? 'up' : 'down';
      setTimeout(() => { const el = row.querySelector('.delta');
                         if (el) el.className = 'delta'; }, 2000);
    }
    posPrevias[f.acr] = f.pos;
    row.innerHTML = '<span class="p">' + f.pos + '</span>' +
      '<span class="acr">' + f.acr + '</span>' +
      '<span class="delta ' + cls + '">' + flecha + '</span>';
    board.appendChild(row);
  }
  // incidentes
  const inc = document.getElementById('incidentes');
  inc.innerHTML = '';
  for (const i of d.incidentes) {
    const el = document.createElement('div'); el.className = 'inc';
    el.innerHTML = '<span class="lapn">L' + i.vuelta + '</span><span>' +
      i.texto + '</span>';
    inc.appendChild(el);
  }
  // frame de la Mac (solo si existe)
  const fb = document.getElementById('framebox');
  if (d.hay_frame) {
    fb.style.display = '';
    document.getElementById('frame').src = '/frame.jpg?t=' + Date.now();
  } else { fb.style.display = 'none'; }
  // diálogo como tarjetas
  const clave = JSON.stringify(d.lineas);
  if (d.lineas.length && clave !== ultimoDialogo) {
    ultimoDialogo = clave;
    const dl = document.getElementById('dialogo');
    dl.innerHTML = '';
    for (const l of d.lineas) {
      const c = document.createElement('div');
      c.className = 'card ' + l.quien;
      const q = document.createElement('div');
      q.className = 'quien'; q.textContent = l.nombre;
      const t = document.createElement('div');
      t.className = 'texto'; t.textContent = l.texto;
      c.appendChild(q); c.appendChild(t); dl.appendChild(c);
    }
    if (vozActiva) hablar(d.lineas, d.idioma);
  }
}
tick(); setInterval(tick, 2000);
</script>
</body>
</html>"""


async def narrar_frame(client: anthropic.AsyncAnthropic, frame: bytes,
                       anterior: str) -> str:
    """Envía el frame a Claude y devuelve una narración corta en español."""
    contexto = (f'La narración anterior fue: "{anterior}". No la repitas; '
                "narra solo lo nuevo." if anterior else "")
    response = await client.messages.create(
        model=MODELO,
        max_tokens=300,
        system=(f"You are a Formula 1 race narrator speaking "
                f"{IDIOMA_NOMBRE}. You receive one frame of the broadcast "
                "and narrate in ONE sentence (two short ones max) the most "
                "relevant thing: positions, overtakes, flags, pit stops. "
                "Be direct, radio style. Your text will be read aloud by "
                "text-to-speech, so write for the ear: numbers as words "
                "('one point two seconds', 'lap twenty-eight', 'third "
                "place'), no abbreviations or symbols like 'P3' or '1.2s', "
                "no parentheses. If the image is black or shows no racing, "
                "say so briefly."),
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": base64.standard_b64encode(frame).decode(),
                    },
                },
                {"type": "text", "text": f"Narra este momento. {contexto}"},
            ],
        }],
    )
    if response.stop_reason == "refusal":
        return ""
    return next((b.text for b in response.content if b.type == "text"), "").strip()


IDIOMA_NOMBRE = {"en": "English", "es": "Spanish"}.get(IDIOMA, "English")

SYSTEM_DUO = f"""You are the scriptwriter for a live Formula 1 commentary \
duo. You write BOTH voices of one continuous conversation, in {IDIOMA_NOMBRE}.

THE DUO:
- {NARRADOR} (narrador): play-by-play commentator, but NOT a formal \
broadcaster — he sounds like a passionate friend telling you the race. \
Warm, conversational, enthusiastic, sometimes ironic. Colloquial language, \
short direct phrases, the occasional spontaneous laugh (write it: "Haha," \
or "Oh man,"). Fast and agile when the action heats up; eases off and \
breathes when explaining. Lives for the big moments and for the drivers' \
emotions.
- {ANALISTA} (analista): color commentator, a woman with deep technical \
knowledge. Calm, sharp, explains strategy in simple terms, dry humor, \
corrects {NARRADOR} when needed and teases him when he gets carried away.

CONVERSATION RULES:
- Write 1 to 4 SHORT lines per segment. Not every segment needs both \
voices — sometimes one line from one of them is perfect.
- Each line is SHORT: one or two brief sentences, never a paragraph. \
If a thought is long, split it across an exchange between the two.
- Show real emotion: they laugh ("Haha!"), they get annoyed at a bad \
strategy call ("Oh come on, why would they box him NOW?"), they gasp, \
they tease each other. Everyday colloquial language, not polished prose.
- {ANALISTA} is proactive: she may interrupt mid-thought ("Wait — look at \
the gap."). Use an em dash to cut a line short when interrupted.
- Add insight, don't just describe: tyre strategy, likely undercuts, what \
a move forces rivals to do.
- They sometimes disagree, with arguments. Gentle tension is good.
- Use the MEMORY of what they already said: callbacks like "remember when \
we said he was saving his tyres? Here's the payoff" make it feel human. \
Never repeat previous lines.
- Ground EVERYTHING in the provided data. Never invent lap times, \
positions, gaps or causes that are not in the data. General F1 knowledge \
(circuit history, how tyres behave) is welcome for quiet moments.
- MATCH THE ENERGY TO THE RACE SITUATION. Safety car or red flag: \
urgent, focused, explaining what it changes. Crash or retirement: \
concerned first, analysis second. Battle for the lead: maximum \
intensity, short punchy lines. Final laps: building excitement, \
counting down. Quiet mid-race stint: relaxed, conversational, lower \
gear. The situation is given in the context — use it.
- SILENCE IS PROFESSIONAL. If asked to fill a quiet moment and you have \
nothing genuinely interesting left (memory shows recent filler already \
covered strategy, history, tyres), return an EMPTY lineas array instead \
of forcing chatter. Real broadcasters let the race breathe.

WRITTEN FOR THE EAR (text-to-speech will read it):
- Numbers as words: "one point two seconds", "lap twenty-eight", "third \
place". No abbreviations or symbols: no "P3", "1.2s", "T4", no parentheses.
- Write like people actually SPEAK, not like a script being read. \
Punctuation is your breathing: commas for short breaths, periods for full \
stops, "..." for hesitation or built-up tension, exclamation marks for \
excitement, questions for real questions.
- Short sentences. Vary the rhythm: a quick burst, then a longer thought. \
Interjections are welcome: "Oh!", "Wow,", "Right,", "Hang on...".
- Never write a long unbroken sentence — the voice needs to breathe."""


DUO_SCHEMA = {
    "type": "object",
    "properties": {
        "lineas": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "quien": {"type": "string",
                              "enum": ["narrador", "analista"]},
                    "texto": {"type": "string"},
                },
                "required": ["quien", "texto"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["lineas"],
    "additionalProperties": False,
}


def _nombre_de(quien):
    return NARRADOR if quien == "narrador" else ANALISTA


def _situacion(eventos):
    """Clasifica el momento de carrera para calibrar la energía del dúo."""
    texto = " ".join(eventos or []).upper()
    tele = estado.tele
    if "SAFETY CAR" in texto or "RED FLAG" in texto:
        return "SAFETY CAR / RED FLAG deployed — urgent, explain the impact"
    if any(p in texto for p in ("YELLOW", "INCIDENT", "ACCIDENT", "CRASH")):
        return "incident on track — concerned first, then analysis"
    if (tele and tele.total_vueltas and tele.vuelta
            and tele.vuelta >= tele.total_vueltas - 3):
        return "FINAL LAPS — building excitement, counting down"
    if texto and "ADELANTAMIENTO" in texto:
        return "overtaking happening — high energy"
    if eventos:
        return "normal racing — engaged"
    return "quiet stint — relaxed, low gear"


async def narrar_datos(client: anthropic.AsyncAnthropic, eventos):
    """Genera el siguiente segmento de conversación del dúo.

    Con eventos=None produce relleno (contexto, estrategia, historia) —
    o silencio, si el guionista decide que no hay nada que aportar.
    Devuelve una lista de líneas [{"quien", "texto"}].
    """
    contexto = estado.tele.resumen() if estado.tele else ""
    situacion = _situacion(eventos)
    memoria = "\n".join(estado.diario[-10:]) or "(nothing said yet)"
    if eventos:
        pedido = "NEW EVENTS (from live telemetry):\n" + "\n".join(eventos)
    else:
        pedido = ("No new events right now. You MAY fill the quiet moment "
                  "(strategy, circuit history, tyres, a prediction, a stat "
                  "— without inventing figures), but if the memory shows "
                  "you've already covered the interesting angles recently, "
                  "return an empty lineas array and let the race breathe.")
    response = await client.messages.create(
        model=MODELO,
        max_tokens=500,
        system=SYSTEM_DUO,
        output_config={"format": {"type": "json_schema",
                                  "schema": DUO_SCHEMA}},
        messages=[{
            "role": "user",
            "content": (f"RACE CONTEXT: {contexto}\n"
                        f"SITUATION: {situacion}\n\n"
                        f"WHAT THE DUO ALREADY SAID (memory):\n{memoria}\n\n"
                        f"{pedido}\n\n"
                        "Write the next segment of the conversation."),
        }],
    )
    if response.stop_reason == "refusal":
        return []
    texto = next((b.text for b in response.content if b.type == "text"), "")
    try:
        return json.loads(texto).get("lineas", [])
    except json.JSONDecodeError:
        log.error("Respuesta del dúo no parseable: %.200s", texto)
        return []


AMBIENTE_ARCHIVO = "ambiente_f1.mp3"


async def generar_ambiente():
    """Loop de sonido de motores: lo genera ElevenLabs una vez y se cachea."""
    if os.path.exists(AMBIENTE_ARCHIVO):
        with open(AMBIENTE_ARCHIVO, "rb") as f:
            return base64.standard_b64encode(f.read()).decode()
    if not ELEVENLABS_API_KEY:
        return None
    try:
        async with httpx.AsyncClient() as cliente:
            r = await cliente.post(
                "https://api.elevenlabs.io/v1/sound-generation",
                headers={"xi-api-key": ELEVENLABS_API_KEY},
                json={"text": ("Formula 1 race ambience: high-pitched V6 "
                               "engines roaring past at full speed with "
                               "doppler effect, distant crowd, seamless "
                               "loop"),
                      "duration_seconds": 18,
                      "prompt_influence": 0.35},
                timeout=120,
            )
            r.raise_for_status()
        with open(AMBIENTE_ARCHIVO, "wb") as f:
            f.write(r.content)
        log.info("Sonido ambiente generado (%d KB)", len(r.content) // 1024)
        return base64.standard_b64encode(r.content).decode()
    except Exception as e:
        log.warning("No se pudo generar el sonido ambiente (%s). ¿La clave "
                    "de ElevenLabs tiene permiso de Efectos de sonido?", e)
        return None


async def _enviar_ambiente(ws, accion):
    mensaje = {"tipo": "ambiente", "accion": accion}
    if accion == "start":
        mensaje["audio"] = estado.ambiente_b64
    await ws.send_text(json.dumps(mensaje))


async def bucle_ambiente():
    """Enciende los motores de fondo cuando arranca la carrera del replay."""
    while True:
        await asyncio.sleep(5)
        corriendo = estado.tele is not None and estado.tele.vuelta >= 1
        if corriendo and not estado.ambiente_activo:
            estado.ambiente_b64 = (estado.ambiente_b64
                                   or await generar_ambiente())
            if not estado.ambiente_b64:
                continue
            estado.ambiente_activo = True
            log.info("🔊 Sonido de motores encendido")
            for ws in list(estado.clientes_mac):
                try:
                    await _enviar_ambiente(ws, "start")
                except Exception:
                    pass
        elif not corriendo and estado.ambiente_activo:
            estado.ambiente_activo = False
            log.info("🔇 Sonido de motores apagado")
            for ws in list(estado.clientes_mac):
                try:
                    await _enviar_ambiente(ws, "stop")
                except Exception:
                    pass


async def bucle_telemetria():
    """Carga OpenF1 y alimenta estado.eventos durante el replay."""
    if MODO_TELEMETRIA == "off":
        log.info("Telemetría desactivada (MODO_TELEMETRIA=off)")
        return
    estado.tele_cargando = True
    try:
        tele = telemetria.Telemetria(SESSION_KEY, VELOCIDAD_REPLAY)
        await tele.cargar()
        estado.tele = tele

        def al_evento(texto):
            estado.eventos.append(texto)
            del estado.eventos[:-30]  # no acumular backlog infinito
            log.info("📊 %s", texto)

        await tele.correr(al_evento)
    except Exception as e:
        log.error("Telemetría no disponible (%s) — se narrará por visión", e)
    finally:
        estado.tele = None
        estado.tele_cargando = False


async def difundir(lineas):
    """Publica un segmento de diálogo a la Mac y al visor."""
    if isinstance(lineas, str):  # ruta de visión: una sola voz
        lineas = [{"quien": "narrador", "texto": lineas}]
    lineas = [l for l in lineas if l.get("texto", "").strip()]
    if not lineas:
        return
    estado.lineas = lineas
    estado.narracion = " / ".join(
        f"{_nombre_de(l['quien'])}: {l['texto']}" for l in lineas)
    estado.narracion_ts = time.time()
    for l in lineas:
        estado.diario.append(f"{_nombre_de(l['quien'])}: {l['texto']}")
        log.info("🎙️  %s: %s", _nombre_de(l["quien"]), l["texto"])
    del estado.diario[:-24]
    lineas_ws = []
    for l in lineas:
        audio = await sintetizar(l["quien"], l["texto"])
        if audio:
            lineas_ws.append(
                {**l, "audio": base64.standard_b64encode(audio).decode()})
        else:
            lineas_ws.append(l)
    mensaje = json.dumps({"tipo": "dialogo", "idioma": IDIOMA,
                          "lineas": lineas_ws})
    for ws in list(estado.clientes_mac):
        try:
            await ws.send_text(mensaje)
        except Exception:
            estado.clientes_mac.discard(ws)


async def bucle_narracion():
    """Narra por telemetría (eventos) y por visión como respaldo."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        log.warning("ANTHROPIC_API_KEY no definida — narración desactivada")
        return
    client = anthropic.AsyncAnthropic()
    log.info("Narración activada (modelo %s, eventos cada %ds, "
             "relleno cada %ds)", MODELO, INTERVALO_NARRACION,
             RELLENO_SEGUNDOS)
    ultimo_frame_narrado = 0.0
    ultimo_relleno = 0.0
    while True:
        await asyncio.sleep(2)
        ahora = time.time()
        desde_ultima = ahora - estado.narracion_ts
        try:
            if estado.tele is not None:
                if estado.eventos and desde_ultima >= INTERVALO_NARRACION:
                    lote = estado.eventos[:6]
                    del estado.eventos[:6]
                    texto = await narrar_datos(client, lote)
                elif (desde_ultima >= RELLENO_SEGUNDOS
                        and ahora - ultimo_relleno >= RELLENO_SEGUNDOS):
                    # Si eligió callar, no volver a preguntar enseguida
                    ultimo_relleno = ahora
                    texto = await narrar_datos(client, None)
                else:
                    continue
            else:
                # Respaldo por visión: frame nuevo cada INTERVALO_NARRACION
                # (y nunca mientras la telemetría todavía está cargando)
                if (estado.tele_cargando
                        or estado.frame is None
                        or estado.frame_ts <= ultimo_frame_narrado
                        or desde_ultima < INTERVALO_NARRACION):
                    continue
                ultimo_frame_narrado = estado.frame_ts
                texto = await narrar_frame(client, estado.frame,
                                           estado.narracion)
        except anthropic.APIError as e:
            log.error("Error de la API de Anthropic: %s", e)
            continue
        if texto:
            await difundir(texto)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))

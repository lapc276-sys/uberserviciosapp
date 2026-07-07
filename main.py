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
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, Response

import telemetria

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("f1tv-backend")

INTERVALO_NARRACION = 10   # segundos entre narraciones con eventos
RELLENO_SEGUNDOS = 45      # sin eventos, cada cuánto rellenar con contexto
MODELO = "claude-opus-4-8"

# Telemetría: "replay" reproduce la última carrera disputada desde OpenF1;
# "off" desactiva y se narra solo por visión (frames de la Mac).
MODO_TELEMETRIA = os.environ.get("MODO_TELEMETRIA", "replay")
SESSION_KEY = os.environ.get("SESSION_KEY", "latest")
VELOCIDAD_REPLAY = float(os.environ.get("VELOCIDAD_REPLAY", "1"))

# Idioma del dúo de comentaristas: "en" (canal) o "es" (pruebas locales)
IDIOMA = os.environ.get("IDIOMA", "en")

# El dúo: narrador (play-by-play) y analista (color commentator)
NARRADOR = "Alex"
ANALISTA = "Marcus"


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    tareas = [asyncio.create_task(bucle_telemetria()),
              asyncio.create_task(bucle_narracion())]
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
        self.eventos: list[str] = []   # eventos de telemetría sin narrar
        self.diario: list[str] = []    # memoria: últimas líneas dichas
        self.lineas: list[dict] = []   # último segmento de diálogo


estado = Estado()


@app.websocket("/ws/frames")
async def ws_frames(ws: WebSocket):
    await ws.accept()
    estado.clientes_mac.add(ws)
    log.info("Mac conectada (%d cliente(s))", len(estado.clientes_mac))
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
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visor F1TV</title>
<style>
  body { font-family: sans-serif; background: #111; color: #eee;
         margin: 0; padding: 1rem; text-align: center; }
  img  { max-width: 100%; border-radius: 8px; }
  #dialogo { margin-top: 1rem; font-size: 1.15rem; min-height: 3em;
             text-align: left; max-width: 720px; margin-left: auto;
             margin-right: auto; }
  .narrador { color: #ffd166; }
  .analista { color: #7fd3ff; }
  .nombre   { font-weight: bold; }
  #voz { margin-top: .5rem; padding: .5rem 1rem; font-size: 1rem;
         border: none; border-radius: 6px; cursor: pointer;
         background: #333; color: #eee; }
  #voz.on { background: #1a7f37; }
</style>
</head>
<body>
<h1>Visor F1TV</h1>
<img id="frame" src="/frame.jpg" alt="Esperando frames...">
<div id="dialogo"></div>
<button id="voz">🔇 Voz desactivada — pulsa para activar</button>
<script>
let vozActiva = false;
let ultimoTexto = '';
const btn = document.getElementById('voz');
btn.onclick = () => {
  vozActiva = !vozActiva;
  btn.classList.toggle('on', vozActiva);
  btn.textContent = vozActiva
    ? '🔊 Voz activada — pulsa para silenciar'
    : '🔇 Voz desactivada — pulsa para activar';
  if (vozActiva) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
};
function vozPara(quien, idioma) {
  const pref = idioma === 'es' ? 'es' : 'en';
  const voces = speechSynthesis.getVoices()
    .filter(v => v.lang.toLowerCase().startsWith(pref));
  if (!voces.length) return null;
  return quien === 'narrador' ? voces[0] : voces[voces.length - 1];
}
function hablar(lineas, idioma) {
  for (const l of lineas) {
    const u = new SpeechSynthesisUtterance(l.texto);
    u.lang = idioma === 'es' ? 'es-ES' : 'en-GB';
    const v = vozPara(l.quien, idioma);
    if (v) u.voice = v;
    u.rate  = l.quien === 'narrador' ? 1.12 : 0.98;
    u.pitch = l.quien === 'narrador' ? 1.15 : 0.85;
    speechSynthesis.speak(u);  // se encolan solas, no se pisan
  }
}
setInterval(() => {
  document.getElementById('frame').src = '/frame.jpg?t=' + Date.now();
}, 1000);
setInterval(async () => {
  const r = await fetch('/narracion');
  const d = await r.json();
  if (d.texto && d.texto !== ultimoTexto) {
    ultimoTexto = d.texto;
    const div = document.getElementById('dialogo');
    div.innerHTML = '';
    for (const l of (d.lineas || [])) {
      const p = document.createElement('p');
      p.className = l.quien;
      const b = document.createElement('span');
      b.className = 'nombre';
      b.textContent = (l.quien === 'narrador' ? '🎙️ ' : '🧠 ')
                      + l.nombre + ': ';
      p.appendChild(b);
      p.appendChild(document.createTextNode(l.texto));
      div.appendChild(p);
    }
    if (vozActiva) hablar(d.lineas || [], d.idioma);
  }
}, 2000);
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
- {NARRADOR} (narrador): play-by-play announcer. Emotional, fast, \
passionate, lives the moment. Raises intensity on overtakes and incidents.
- {ANALISTA} (analista): color commentator. Calm, technical, explains \
strategy in simple terms, dry humor, corrects {NARRADOR} when needed.

CONVERSATION RULES:
- Write 1 to 4 SHORT lines per segment. Not every segment needs both \
voices — sometimes one line from one of them is perfect.
- {ANALISTA} is proactive: he may interrupt mid-thought ("Wait — look at \
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

WRITTEN FOR THE EAR (text-to-speech will read it):
- Numbers as words: "one point two seconds", "lap twenty-eight", "third \
place". No abbreviations or symbols: no "P3", "1.2s", "T4", no parentheses.
- Short sentences. Natural spoken rhythm."""


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


async def narrar_datos(client: anthropic.AsyncAnthropic, eventos):
    """Genera el siguiente segmento de conversación del dúo.

    Con eventos=None produce relleno (contexto, estrategia, historia).
    Devuelve una lista de líneas [{"quien", "texto"}].
    """
    contexto = estado.tele.resumen() if estado.tele else ""
    memoria = "\n".join(estado.diario[-10:]) or "(nothing said yet)"
    if eventos:
        pedido = "NEW EVENTS (from live telemetry):\n" + "\n".join(eventos)
    else:
        pedido = ("No new events right now. Fill the quiet moment: race "
                  "situation, possible strategy, circuit history, how the "
                  "tyres evolve, a prediction, or a stat — without "
                  "inventing specific figures.")
    response = await client.messages.create(
        model=MODELO,
        max_tokens=500,
        system=SYSTEM_DUO,
        output_config={"format": {"type": "json_schema",
                                  "schema": DUO_SCHEMA}},
        messages=[{
            "role": "user",
            "content": (f"RACE CONTEXT: {contexto}\n\n"
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


async def bucle_telemetria():
    """Carga OpenF1 y alimenta estado.eventos durante el replay."""
    if MODO_TELEMETRIA == "off":
        log.info("Telemetría desactivada (MODO_TELEMETRIA=off)")
        return
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
    mensaje = json.dumps({"tipo": "dialogo", "idioma": IDIOMA,
                          "lineas": lineas})
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
                elif desde_ultima >= RELLENO_SEGUNDOS:
                    texto = await narrar_datos(client, None)
                else:
                    continue
            else:
                # Respaldo por visión: frame nuevo cada INTERVALO_NARRACION
                if (estado.frame is None
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

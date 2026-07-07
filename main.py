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
        self.diario: list[str] = []    # memoria: últimas narraciones dichas


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
  #narracion { margin-top: 1rem; font-size: 1.2rem; min-height: 2em; }
  #voz { margin-top: .5rem; padding: .5rem 1rem; font-size: 1rem;
         border: none; border-radius: 6px; cursor: pointer;
         background: #333; color: #eee; }
  #voz.on { background: #1a7f37; }
</style>
</head>
<body>
<h1>Visor F1TV</h1>
<img id="frame" src="/frame.jpg" alt="Esperando frames...">
<p id="narracion"></p>
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
function hablar(texto) {
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'es-ES';
  speechSynthesis.speak(u);
}
setInterval(() => {
  document.getElementById('frame').src = '/frame.jpg?t=' + Date.now();
}, 1000);
setInterval(async () => {
  const r = await fetch('/narracion');
  const d = await r.json();
  if (d.texto && d.texto !== ultimoTexto) {
    ultimoTexto = d.texto;
    document.getElementById('narracion').textContent = '🎙️ ' + d.texto;
    if (vozActiva) hablar(d.texto);
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
        system=("Eres un narrador de Fórmula 1 en español. Recibes un "
                "fotograma de la transmisión y narras en UNA frase (máximo "
                "dos cortas) lo más relevante: posiciones, adelantamientos, "
                "banderas, boxes. Sé directo, como un comentarista de radio. "
                "Tu texto será leído en voz alta por un sintetizador, así "
                "que escribe para el oído: los números en palabras ('uno "
                "coma dos segundos', 'vuelta veintiocho', 'tercera "
                "posición'), sin abreviaturas ni símbolos (nada de 'P3', "
                "'1.2s', 'T4' ni paréntesis). Si la imagen está negra o no "
                "se ve la carrera, dilo en pocas palabras."),
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


SYSTEM_NARRADOR_DATOS = (
    "Eres un narrador de Fórmula 1 en español, estilo radio: directo y con "
    "energía. Recibes eventos reales de telemetría de la carrera y el "
    "contexto actual. Narra en UNA frase (máximo dos cortas) lo más "
    "relevante de los eventos. Usa SOLO los datos proporcionados: no "
    "inventes tiempos, posiciones ni causas que no estén en los datos. Tu "
    "texto será leído en voz alta por un sintetizador: escribe para el "
    "oído, con los números en palabras ('uno coma dos segundos', 'vuelta "
    "veintiocho', 'tercera posición'), sin abreviaturas ni símbolos. "
    "Recibes también tus narraciones anteriores: no las repitas y puedes "
    "referirte a ellas para dar continuidad."
)


async def narrar_datos(client: anthropic.AsyncAnthropic, eventos):
    """Narra desde telemetría. Con eventos=None genera relleno de contexto."""
    contexto = estado.tele.resumen() if estado.tele else ""
    memoria = "\n".join(estado.diario[-6:]) or "(aún no has dicho nada)"
    if eventos:
        pedido = "EVENTOS NUEVOS:\n" + "\n".join(eventos)
    else:
        pedido = ("No hay eventos nuevos. Haz un comentario breve de "
                  "relleno con el contexto: situación de la carrera, "
                  "estrategia posible o dato del circuito. Sin inventar "
                  "cifras específicas.")
    response = await client.messages.create(
        model=MODELO,
        max_tokens=250,
        system=SYSTEM_NARRADOR_DATOS,
        messages=[{
            "role": "user",
            "content": (f"CONTEXTO: {contexto}\n\n"
                        f"TUS NARRACIONES ANTERIORES:\n{memoria}\n\n"
                        f"{pedido}"),
        }],
    )
    if response.stop_reason == "refusal":
        return ""
    return next((b.text for b in response.content if b.type == "text"),
                "").strip()


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


async def difundir(texto):
    """Publica una narración a la Mac y al visor."""
    estado.narracion = texto
    estado.narracion_ts = time.time()
    estado.diario.append(texto)
    del estado.diario[:-20]
    log.info("🎙️  %s", texto)
    mensaje = json.dumps({"tipo": "narracion", "texto": texto})
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

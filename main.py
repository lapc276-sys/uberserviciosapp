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

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("f1tv-backend")

INTERVALO_NARRACION = 10  # segundos entre narraciones
MODELO = "claude-opus-4-8"


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    tarea = asyncio.create_task(bucle_narracion())
    yield
    tarea.cancel()


app = FastAPI(title="F1TV frames backend", lifespan=lifespan)


class Estado:
    """Último frame y última narración, compartidos entre endpoints."""

    def __init__(self):
        self.frame: bytes | None = None
        self.frame_ts: float = 0.0
        self.narracion: str = ""
        self.narracion_ts: float = 0.0
        self.clientes_mac: set[WebSocket] = set()


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
                "fotograma de la transmisión de F1TV y describes en una o "
                "dos frases lo que está pasando: posiciones, adelantamientos, "
                "banderas, boxes, gráficos en pantalla. Sé breve y directo, "
                "como un comentarista de radio. Si la imagen está negra o no "
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


async def bucle_narracion():
    """Cada INTERVALO_NARRACION segundos narra el frame más reciente."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        log.warning("ANTHROPIC_API_KEY no definida — narración desactivada")
        return
    client = anthropic.AsyncAnthropic()
    log.info("Narración activada (modelo %s, cada %ds)", MODELO,
             INTERVALO_NARRACION)
    ultimo_ts_narrado = 0.0
    while True:
        await asyncio.sleep(INTERVALO_NARRACION)
        frame = estado.frame
        # Solo narrar si hay un frame nuevo desde la última narración
        if frame is None or estado.frame_ts <= ultimo_ts_narrado:
            continue
        ultimo_ts_narrado = estado.frame_ts
        try:
            texto = await narrar_frame(client, frame, estado.narracion)
        except anthropic.APIError as e:
            log.error("Error de la API de Anthropic: %s", e)
            continue
        if not texto:
            continue
        estado.narracion = texto
        estado.narracion_ts = time.time()
        log.info("🎙️  %s", texto)
        mensaje = json.dumps({"tipo": "narracion", "texto": texto})
        for ws in list(estado.clientes_mac):
            try:
                await ws.send_text(mensaje)
            except Exception:
                estado.clientes_mac.discard(ws)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))

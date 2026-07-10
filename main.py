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
import datetime as dt
import json
import logging
import os
import random
import time
from zoneinfo import ZoneInfo

import anthropic
import httpx
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, Response

import telemetria

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("f1tv-backend")

INTERVALO_NARRACION = 10   # segundos entre narraciones con eventos
# Sin eventos, cada cuánto considerar rellenar (configurable por Secret)
RELLENO_SEGUNDOS = float(os.environ.get("RELLENO_SEGUNDOS", "90"))
# Fuera de vivo: cada cuánto anuncia el dúo la próxima sesión (segundos)
ANUNCIO_SEGUNDOS = float(os.environ.get("ANUNCIO_SEGUNDOS", "600"))

# Zonas horarias para el calendario (par de etiqueta, zona IANA)
ZONAS_CALENDARIO = [("UTC", "UTC"), ("ET", "America/New_York"),
                    ("Madrid", "Europe/Madrid"),
                    ("CDMX", "America/Mexico_City")]

# Programa en demostración: "historia" muestra un modo fijo (sin
# telemetría) para probar el motor de pantalla. Vacío = canal normal.
DEMO_PROGRAMA = os.environ.get("DEMO_PROGRAMA", "")
INTERVALO_PROGRAMA = 30  # segundos entre segmentos de un programa

# Director de programación automático: rota los shows de PLAYLIST sin
# intervención manual. PROGRAMAS_AUTO=on lo activa.
PROGRAMAS_AUTO = os.environ.get("PROGRAMAS_AUTO", "")
PLAYLIST = [p.strip() for p in
            os.environ.get("PLAYLIST",
                           "historia,interludio,tech,interludio").split(",")
            if p.strip()]
ROTACION_MINUTOS = float(os.environ.get("ROTACION_MINUTOS", "8"))
# Música de fondo para interludios (opcional). Solo música LIBRE / CC —
# un enlace directo .mp3 de una librería libre (Pixabay, YouTube Audio
# Library descargada, etc.). Vacío = interludio sin música.
MUSICA_URL = os.environ.get("MUSICA_URL", "")
# Circuitos de reserva para el interludio cuando no hay próxima carrera
CIRCUITOS_RESERVA = ["Silverstone Circuit", "Monza Circuit",
                     "Circuit de Spa-Francorchamps", "Suzuka Circuit",
                     "Interlagos", "Circuit de Monaco"]
INTERLUDIO_MINUTOS = float(os.environ.get("INTERLUDIO_MINUTOS", "2"))

# Parrilla automática: el director sigue el calendario real de carreras y
# pone cada sesión al aire a su hora; entre carreras, rota los programas.
# PROGRAMACION_AUTO=on lo activa (toma el control total del canal).
PROGRAMACION_AUTO = os.environ.get("PROGRAMACION_AUTO", "")
PRESHOW_MINUTOS = float(os.environ.get("PRESHOW_MINUTOS", "30"))
INTERVALO_PARRILLA = float(os.environ.get("INTERVALO_PARRILLA", "15"))
# Modo ahorro automático: el canal usa el modelo caro (máxima calidad)
# SOLO durante una carrera en vivo de la parrilla; el resto del día
# (maratón de clásicas, historia, tech, calendario) usa un modelo barato.
# Así el canal puede estar 24/7 sin quemar dinero.
#   - MODELO_VIVO   : carrera en vivo real (default Opus, máxima calidad)
#   - MODELO_AHORRO : todo lo demás       (default Haiku, ~10x más barato)
#   - MODELO_NARRADOR (opcional): si se define, fuerza ESE modelo siempre
#     (mantiene el control manual de antes; apaga el ahorro automático).
_forzado = os.environ.get("MODELO_NARRADOR", "")
MODELO_VIVO = _forzado or os.environ.get("MODELO_VIVO", "claude-opus-4-8")
MODELO_AHORRO = _forzado or os.environ.get("MODELO_AHORRO",
                                           "claude-haiku-4-5-20251001")


def modelo_actual():
    """Modelo del guionista según el momento: caro solo en carrera en
    vivo real (parrilla), barato el resto del tiempo."""
    return MODELO_VIVO if estado.carrera_en_vivo else MODELO_AHORRO

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
    "historiador": {
        "voice": "fable",
        "instructions": ("Warm British storyteller narrating a Formula 1 "
                         "documentary. Measured, evocative, unhurried."),
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
    # Historiador: una sola voz británica de cuentacuentos (documental).
    # Cambiar con el Secret ELEVENLABS_VOZ_HISTORIA (Voice ID de la
    # Voice Library — busca "British storyteller"/"documentary narrator").
    "historiador": os.environ.get("ELEVENLABS_VOZ_HISTORIA",
                                  "JBFqnCBsd6RMkjVDRZzb"),  # George
}
# Expresividad por personaje: el narrador más variable/emocional, el
# analista más estable y pausado (pero no plano).
ELEVENLABS_AJUSTES = {
    "narrador": {"stability": 0.35, "similarity_boost": 0.75, "style": 0.65},
    "analista": {"stability": 0.55, "similarity_boost": 0.75, "style": 0.45},
    "historiador": {"stability": 0.55, "similarity_boost": 0.8, "style": 0.35},
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
    estado.director_auto = bool(PROGRAMAS_AUTO)
    if DEMO_PROGRAMA == "historia":
        poner_al_aire("historia")
        log.info("Modo demo: programa de Historia (sin telemetría)")
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
              asyncio.create_task(bucle_ambiente()),
              asyncio.create_task(bucle_calendario()),
              asyncio.create_task(bucle_director()),
              asyncio.create_task(bucle_programacion())]
    yield
    for t in tareas:
        t.cancel()


app = FastAPI(title="F1TV frames backend", lifespan=lifespan)


@app.middleware("http")
async def sin_cache(request, call_next):
    """El navegador nunca debe guardar versiones viejas de la pantalla."""
    respuesta = await call_next(request)
    respuesta.headers["Cache-Control"] = "no-store"
    return respuesta


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
        self.calendario: list[dict] = []  # próximas sesiones (datos reales)
        self.ultimo_anuncio: float = 0.0
        self.programa: dict | None = None  # {"tipo","titulo","fondo"} o None
        self.director_auto: bool = False   # el director rota shows solo
        self.horario: list[dict] = []      # sesiones programables (reales)
        self.sesion_actual = None          # clave de la sesión al aire
        self.carrera_en_vivo: bool = False # True solo en carrera real (parrilla)
        self.segmento_id: int = 0      # id del último segmento con audio
        self.audios: list = []         # mp3 por línea del último segmento


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


def foco_director(t):
    """Decide qué panel protagoniza la pantalla ahora mismo (dirección
    automática, Fase 4.5): bandera/incidente > pelea > pit stop reciente
    > últimas vueltas > nada. Devuelve {"etiqueta", "panel"} o None."""
    if t is None:
        return None
    if t.incidentes:
        ultimo = t.incidentes[-1]
        if ultimo["vuelta"] >= t.vuelta - 1:
            msg = ultimo["texto"].upper()
            if any(k in msg for k in ("SAFETY CAR", "RED FLAG")):
                return {"etiqueta": "SAFETY CAR", "panel": "incidentes"}
            if any(k in msg for k in ("YELLOW", "INCIDENT", "ACCIDENT",
                                      "CRASH")):
                return {"etiqueta": "INCIDENT ON TRACK",
                       "panel": "incidentes"}
    duelos = t.battle_scores()
    if duelos and duelos[0]["score"] >= 40:
        top = duelos[0]
        base = ("BATTLE FOR THE LEAD" if top["pos_delante"] == 1
               else f"BATTLE FOR P{top['pos_delante']}")
        return {"etiqueta": f"{base} — {top['score']}", "panel": "board"}
    if t.ultimo_pit and t.ultimo_pit["vuelta"] >= t.vuelta - 1:
        return {"etiqueta": f"PIT STOP — {t.ultimo_pit['nombre'].upper()}",
               "panel": "board"}
    if (t.total_vueltas and t.vuelta
            and t.vuelta >= t.total_vueltas - 3):
        return {"etiqueta": f"FINAL LAPS — {t.total_vueltas - t.vuelta} TO GO",
               "panel": "board"}
    return None


@app.get("/control/estado")
async def control_estado():
    """Estado actual para el panel de botones."""
    prox = None
    if estado.horario:
        futuras = [s for s in estado.horario
                   if s["inicio"] > dt.datetime.now(dt.timezone.utc)]
        if futuras:
            s = min(futuras, key=lambda s: s["inicio"])
            prox = f"{s['sesion']} — {s['pais']} ({_horarios(s['inicio'].isoformat())[1]})"
    return JSONResponse({
        "programa": estado.programa,
        "director_auto": estado.director_auto,
        "parrilla_auto": bool(PROGRAMACION_AUTO),
        "proxima_sesion": prox,
        "shows": ([{"tipo": k, "titulo": v["titulo"]}
                   for k, v in PROGRAMAS.items()]
                  + [{"tipo": "interludio",
                      "titulo": "INTERLUDE · PHOTO + MUSIC"}]),
    })


@app.post("/control/show/{tipo}")
async def control_show(tipo: str):
    """Pone un show en pantalla ahora (apaga el automático)."""
    if tipo == "interludio":
        estado.director_auto = False
        await poner_interludio()
        log.info("🕹️  Panel: al aire INTERLUDIO (%s)",
                 estado.programa["titulo"])
        return JSONResponse({"ok": True})
    if tipo not in PROGRAMAS:
        return JSONResponse({"ok": False, "error": "show desconocido"},
                            status_code=404)
    estado.director_auto = False
    poner_al_aire(tipo)
    log.info("🕹️  Panel: al aire %s", PROGRAMAS[tipo]["titulo"])
    return JSONResponse({"ok": True})


@app.post("/control/carrera")
async def control_carrera():
    """Vuelve al modo carrera/leaderboard (apaga el automático)."""
    estado.director_auto = False
    poner_al_aire(None)
    log.info("🕹️  Panel: modo carrera")
    return JSONResponse({"ok": True})


@app.post("/control/auto/{valor}")
async def control_auto(valor: str):
    """Prende o apaga el director automático (rotación de shows)."""
    estado.director_auto = (valor == "on")
    log.info("🕹️  Panel: director automático %s",
             "ON" if estado.director_auto else "OFF")
    return JSONResponse({"ok": True, "director_auto": estado.director_auto})


@app.get("/panel", response_class=HTMLResponse)
async def panel():
    return """<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Panel — Control del canal</title>
<style>
  :root { --bg:#0B0D12; --panel:#151922; --line:#232936; --txt:#fff;
          --dim:#9AA3B2; --accent:#E10600; --on:#2ECC71; }
  * { box-sizing:border-box; } body { margin:0; background:var(--bg);
    color:var(--txt); font-family:Inter,-apple-system,"Segoe UI",sans-serif;
    padding:22px; max-width:640px; margin:0 auto; }
  h1 { font-size:1.1rem; letter-spacing:.1em; text-transform:uppercase; }
  .estado { background:var(--panel); border:1px solid var(--line);
    border-radius:12px; padding:14px 16px; margin:14px 0; }
  .estado b { color:var(--accent); }
  h2 { font-size:.72rem; letter-spacing:.16em; color:var(--dim);
    text-transform:uppercase; margin:20px 0 8px; }
  button { display:block; width:100%; text-align:left; margin:8px 0;
    padding:14px 18px; font-size:1rem; border:1px solid var(--line);
    border-radius:10px; background:var(--panel); color:var(--txt);
    cursor:pointer; transition:border-color .2s; }
  button:hover { border-color:var(--accent); }
  button.auto { border-color:var(--on); color:var(--on); }
  .row { display:flex; gap:10px; } .row button { flex:1; }
  a { color:var(--dim); font-size:.8rem; }
</style></head><body>
<h1>🕹️ Control del canal</h1>
<div class="estado" id="estado">Cargando…</div>

<h2>Programación automática</h2>
<div class="row">
  <button class="auto" onclick="post('/control/auto/on')">▶ Automático ON</button>
  <button onclick="post('/control/auto/off')">⏸ Automático OFF</button>
</div>

<h2>Poner un programa ahora</h2>
<div id="shows"></div>
<button onclick="post('/control/carrera')">🏁 Modo carrera / leaderboard</button>

<p><a href="/" target="_blank">Abrir la pantalla del canal ↗</a></p>
<script>
async function post(u){ await fetch(u,{method:'POST'}); refrescar(); }
async function refrescar(){
  const d = await (await fetch('/control/estado')).json();
  const prog = d.programa ? d.programa.titulo : 'Carrera / Leaderboard';
  let html = 'Al aire: <b>' + prog + '</b><br>Director automático: <b>' +
    (d.director_auto ? 'ON' : 'OFF') + '</b>';
  if (d.parrilla_auto) html += '<br>Parrilla automática: <b>ON</b>';
  if (d.proxima_sesion) html += '<br>Próxima carrera: <b>' +
    d.proxima_sesion + '</b>';
  document.getElementById('estado').innerHTML = html;
  const cont = document.getElementById('shows');
  if (!cont.dataset.built) {
    for (const s of d.shows) {
      const b = document.createElement('button');
      b.textContent = '▶ ' + s.titulo;
      b.onclick = () => post('/control/show/' + s.tipo);
      cont.appendChild(b);
    }
    cont.dataset.built = '1';
  }
}
refrescar(); setInterval(refrescar, 3000);
</script></body></html>"""


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
        "clima": t.clima if t else {},
        "foco": foco_director(t),
        "duelos": t.battle_scores()[:4] if t else [],
        "pit": t.perdida_pit() if t else None,
        "alertas": t.alertas() if t else [],
        "calendario": estado.calendario,
        "programa": estado.programa,
        "leaderboard": t.tabla() if t else [],
        "incidentes": list(reversed(t.incidentes)) if t else [],
        "lineas": [{**l, "nombre": _nombre_de(l["quien"])}
                   for l in estado.lineas],
        "segmento": estado.segmento_id,
        "idioma": IDIOMA,
        "hay_frame": estado.frame is not None,
        "ambiente": estado.ambiente_activo,
    })


@app.get("/ambiente.mp3")
async def ambiente_mp3():
    """Loop de motores para el visor web."""
    if not estado.ambiente_b64:
        return Response(status_code=404)
    return Response(content=base64.b64decode(estado.ambiente_b64),
                    media_type="audio/mpeg")


@app.get("/audio/{seg}/{idx}")
async def audio_linea(seg: int, idx: int):
    """MP3 de una línea del segmento actual (para el visor web)."""
    if (seg != estado.segmento_id or idx < 0
            or idx >= len(estado.audios) or not estado.audios[idx]):
        return Response(status_code=404)
    return Response(content=estado.audios[idx], media_type="audio/mpeg")


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
  #clima { color: var(--dim); font-size: .78rem; font-variant-numeric:
           tabular-nums; letter-spacing: .04em; }
  main { display: grid; grid-template-columns: 230px 1fr 290px;
         gap: 14px; padding: 14px 22px; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  .panel { background: var(--panel); border: 1px solid var(--line);
           border-radius: 12px; padding: 14px 16px;
           transition: border-color .3s, box-shadow .3s; }
  .panel h3 { font-size: .68rem; letter-spacing: .18em; color: var(--dim);
              text-transform: uppercase; margin-bottom: 10px; }
  @keyframes focoPulse {
    0%, 100% { box-shadow: 0 0 0 1px var(--accent) inset,
                          0 0 14px rgba(225,6,0,.25); }
    50% { box-shadow: 0 0 0 1px var(--accent) inset,
                     0 0 22px rgba(225,6,0,.5); }
  }
  .panel.foco { border-color: var(--accent);
               animation: focoPulse 1.4s infinite; }
  #director { text-align: center; padding: 5px 0;
             font-size: .75rem; font-weight: 700; letter-spacing: .16em;
             color: var(--accent); text-transform: uppercase;
             opacity: 0; transition: opacity .3s; }
  #director.on { opacity: 1; }
  /* Ticker de Alerta IA: banda de "información privilegiada" medida */
  #ticker { display: none; align-items: center; gap: 12px;
            margin: 2px 22px 0; padding: 7px 14px; border-radius: 8px;
            background: linear-gradient(90deg, rgba(21,25,34,.95),
                        rgba(21,25,34,.6));
            border: 1px solid var(--line); overflow: hidden; }
  #ticker.show { display: flex; }
  #ticker .badge { flex: none; display: flex; align-items: center; gap: 6px;
                   font-size: .6rem; font-weight: 800; letter-spacing: .18em;
                   color: var(--accent); text-transform: uppercase; }
  #ticker .badge::before { content: ""; width: 7px; height: 7px;
                   border-radius: 50%; background: var(--accent);
                   box-shadow: 0 0 8px var(--accent);
                   animation: aiPulse 1.1s infinite; }
  @keyframes aiPulse { 0%,100% { opacity: 1; } 50% { opacity: .25; } }
  #ticker .sep { flex: none; width: 1px; height: 14px;
                 background: var(--line); }
  #ticker .txt { font-size: .82rem; font-weight: 600; letter-spacing: .02em;
                 white-space: nowrap; overflow: hidden;
                 text-overflow: ellipsis;
                 font-variant-numeric: tabular-nums;
                 transition: opacity .35s; }
  #ticker .txt.hot { color: var(--txt); }
  #ticker .txt.warn { color: var(--amber); }
  #ticker .txt.info { color: var(--dim); }
  /* Modos de programa (Historia, etc.): fondo a pantalla completa */
  #fondo { position: fixed; inset: 0; z-index: -1; background: var(--bg);
           background-size: cover; background-position: center;
           opacity: 0; transition: opacity .6s; }
  #fondo.on { opacity: 1; }
  #fondo.historia {
    background:
      radial-gradient(120% 80% at 70% 15%, rgba(225,6,0,.20), transparent 60%),
      radial-gradient(90% 70% at 15% 90%, rgba(40,60,90,.35), transparent 55%),
      linear-gradient(160deg, #0B0D12 20%, #10141c 100%); }
  #fondo.tech {
    background:
      radial-gradient(110% 75% at 20% 15%, rgba(40,120,200,.25), transparent 60%),
      radial-gradient(90% 70% at 85% 85%, rgba(20,180,160,.18), transparent 55%),
      linear-gradient(160deg, #0B0D12 20%, #0d1420 100%); }
  #fondo.interludio {
    background:
      radial-gradient(120% 90% at 50% 100%, rgba(225,6,0,.16), transparent 55%),
      linear-gradient(160deg, #0B0D12 25%, #141a26 100%); }
  /* Interludio: tarjeta de continuidad — foto + música, sin paneles */
  #inter { position: fixed; inset: 0; z-index: 1; display: none;
           align-items: flex-end; justify-content: center;
           padding-bottom: 11vh; text-align: center;
           background: linear-gradient(180deg, rgba(11,13,18,.10) 40%,
                                       rgba(11,13,18,.86) 100%); }
  body.interludio #inter { display: flex; }
  body.interludio main, body.interludio header,
  body.interludio #director, body.interludio #progtitle {
    visibility: hidden; }
  body.interludio #voz { opacity: .18; }
  #inter .t { font-size: 2.7rem; font-weight: 800; letter-spacing: .18em;
              text-transform: uppercase;
              text-shadow: 0 2px 18px rgba(0,0,0,.7); }
  #inter .s { margin-top: 12px; color: #C9D1DE; font-size: .92rem;
              letter-spacing: .3em; text-transform: uppercase;
              text-shadow: 0 1px 10px rgba(0,0,0,.8); }
  #inter .m { margin-top: 24px; color: var(--dim); font-size: .8rem;
              letter-spacing: .24em; opacity: .75; }
  #progtitle { text-align: center; padding: 8px 0 2px;
               font-size: 1rem; font-weight: 700; letter-spacing: .22em;
               color: var(--accent); text-transform: uppercase;
               display: none; }
  body.programa main { grid-template-columns: 1fr; }
  body.programa #panel-board,
  body.programa #right-col { display: none; }
  body.programa #centro { max-width: 820px; margin: 0 auto;
                          min-height: 62vh; justify-content: center; }
  body.programa .card { background: rgba(21,25,34,.72);
                        backdrop-filter: blur(4px); }
  .card.historiador .quien { color: var(--dim); }
  #credito { position: fixed; right: 12px; bottom: 10px; z-index: 2;
             font-size: .62rem; color: var(--dim); opacity: .7;
             letter-spacing: .04em; display: none; }
  /* Leaderboard */
  #board .row { display: flex; align-items: center; gap: 8px;
                padding: 6px 4px; border-bottom: 1px solid var(--line);
                font-variant-numeric: tabular-nums; }
  #board .row:last-child { border-bottom: none; }
  .p { color: var(--dim); width: 1.4em; font-size: .85rem; }
  .chip { width: 4px; height: 15px; border-radius: 2px;
          background: var(--line); flex: none; }
  .acr { font-weight: 700; letter-spacing: .06em; }
  .tyre { font-size: .68rem; font-weight: 700; color: var(--dim);
          border: 1px solid var(--line); border-radius: 4px;
          width: 1.3em; text-align: center; flex: none; }
  .tyre.S { color: var(--down); border-color: var(--down); }
  .tyre.M { color: var(--amber); border-color: var(--amber); }
  .tyre.H { color: var(--txt); border-color: var(--dim); }
  .gap { margin-left: auto; color: var(--dim); font-size: .78rem; }
  .delta { font-size: .8rem; width: 1.1em; text-align: right;
           transition: opacity .6s; opacity: 0; }
  .delta.up   { color: var(--up); opacity: 1; }
  .delta.down { color: var(--down); opacity: 1; }
  @keyframes lucha {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(3px); }
    45% { transform: translateX(-2px); }
    70% { transform: translateX(2px); }
  }
  #board .row.pelea { animation: lucha .55s infinite; }
  #board .row.pelea .gap { color: var(--amber); font-weight: 600; }
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
  #right-col { display: flex; flex-direction: column; gap: 14px; }
  #intel .duelo { padding: 7px 0; border-bottom: 1px solid var(--line); }
  #intel .duelo:last-child { border-bottom: none; }
  #intel .top { display: flex; justify-content: space-between;
               font-size: .82rem; font-weight: 700; }
  #intel .score.high { color: var(--accent); }
  #intel .score.mid { color: var(--amber); }
  #intel .score.low { color: var(--dim); }
  .razon { color: var(--dim); font-size: .68rem; margin-top: 2px; }
  .estr { color: var(--amber); font-size: .68rem; margin-top: 3px; }
  #pitloss { margin-top: 8px; padding-top: 7px;
             border-top: 1px solid var(--line); font-size: .7rem;
             color: var(--txt); letter-spacing: .04em; display: none; }
  #pitloss b { color: var(--amber); }
  .vacio { color: var(--dim); font-size: .78rem; }
  /* Voz */
  #voz { margin: 0 22px 20px; padding: 9px 16px; font-size: .85rem;
         border: 1px solid var(--line); border-radius: 8px;
         cursor: pointer; background: var(--panel); color: var(--dim); }
  #voz.on { border-color: var(--up); color: var(--up); }
</style>
</head>
<body>
<div id="fondo"></div>
<div id="credito"></div>
<header>
  <span class="dot" id="dot"></span><span class="live" id="livetxt">LIVE</span>
  <span id="gp">—</span>
  <span id="clima"></span>
  <span id="lap"></span>
</header>
<div id="ticker">
  <span class="badge">◉ AI READ</span><span class="sep"></span>
  <span class="txt" id="ticker-txt"></span>
</div>
<div id="director"></div>
<div id="progtitle"></div>
<div id="inter"><div>
  <div class="t" id="inter-t"></div>
  <div class="s" id="inter-s"></div>
  <div class="m" id="inter-m"></div>
</div></div>
<audio id="musica" loop></audio>
<main>
  <section class="panel" id="panel-board"><h3 id="board-title">Leaderboard</h3><div id="board"></div></section>
  <section id="centro">
    <div id="framebox"><img id="frame" alt=""></div>
    <div id="dialogo"><div id="offair">WAITING FOR SESSION…</div></div>
  </section>
  <div id="right-col">
    <section class="panel" id="panel-incidentes"><h3>Race Control</h3><div id="incidentes"></div></section>
    <section class="panel"><h3>Race Intelligence</h3><div id="intel"></div><div id="pitloss"></div></section>
  </div>
</main>
<button id="voz">VOICE OFF — click to enable browser voice</button>
<script>
let vozActiva = false, ultimoSegmento = -1, posPrevias = {};
let reproduciendo = false, pendiente = null, amb = null;
// Ticker de Alerta IA: rota entre las lecturas medidas cada pocos segundos
let alertas = [], alertaIdx = 0;
function pintarAlerta() {
  const t = document.getElementById('ticker');
  const txt = document.getElementById('ticker-txt');
  if (!alertas.length) { t.classList.remove('show'); return; }
  t.classList.add('show');
  alertaIdx = alertaIdx % alertas.length;
  const a = alertas[alertaIdx];
  txt.style.opacity = 0;
  setTimeout(() => {
    txt.textContent = a.txt;
    txt.className = 'txt ' + (a.nivel || 'info');
    txt.style.opacity = 1;
  }, 180);
}
function rotarAlerta() { alertaIdx++; pintarAlerta(); }
setInterval(rotarAlerta, 5000);
const btn = document.getElementById('voz');
btn.onclick = () => {
  vozActiva = !vozActiva;
  btn.classList.toggle('on', vozActiva);
  btn.textContent = vozActiva ? 'VOICE ON — click to mute'
                              : 'VOICE OFF — click to enable voice';
};
function reproducirLinea(seg, i) {
  return new Promise(res => {
    const a = new Audio('/audio/' + seg + '/' + i);
    a.onended = () => res(true);
    a.onerror = () => res(false);
    a.play().catch(() => res(false));
  });
}
function fallbackTTS(l, idioma) {
  const u = new SpeechSynthesisUtterance(l.texto);
  u.lang = idioma === 'es' ? 'es-ES' : 'en-GB';
  speechSynthesis.speak(u);
}
async function reproducirSegmento(seg, lineas, idioma) {
  pendiente = { seg, lineas, idioma };  // si ya habla, gana el más nuevo
  if (reproduciendo) return;
  reproduciendo = true;
  while (pendiente) {
    const t = pendiente; pendiente = null;
    for (let i = 0; i < t.lineas.length; i++) {
      const ok = await reproducirLinea(t.seg, i);
      if (!ok) fallbackTTS(t.lineas[i], t.idioma);
    }
  }
  reproduciendo = false;
}
function aplicarPrograma(p) {
  const fondo = document.getElementById('fondo');
  const titulo = document.getElementById('progtitle');
  const credito = document.getElementById('credito');
  const inter = !!(p && p.tipo === 'interludio');
  document.body.classList.toggle('interludio', inter);
  if (inter) {
    document.getElementById('inter-t').textContent = p.titulo || '';
    document.getElementById('inter-s').textContent = p.subtitulo || '';
    document.getElementById('inter-m').textContent =
      p.musica ? '♪ MUSIC' : '';
  }
  const musica = document.getElementById('musica');
  if (inter && p.musica && vozActiva) {
    if (musica.getAttribute('src') !== p.musica) musica.src = p.musica;
    if (musica.paused) { musica.volume = 0.35;
                         musica.play().catch(() => {}); }
  } else if (!musica.paused) {
    musica.pause();
  }
  if (p && p.tipo && p.tipo !== 'carrera') {
    document.body.classList.add('programa');
    const esImg = p.fondo && (p.fondo.startsWith('http') ||
                              p.fondo.startsWith('data:'));
    fondo.className = 'on ' + (esImg ? 'historia' : (p.fondo || ''));
    fondo.style.backgroundImage = esImg ? 'url(' + p.fondo + ')' : '';
    titulo.textContent = p.titulo || '';
    titulo.style.display = 'block';
    if (p.credito) { credito.textContent = p.credito;
                     credito.style.display = 'block'; }
    else credito.style.display = 'none';
  } else {
    document.body.classList.remove('programa');
    fondo.className = '';
    titulo.style.display = 'none';
    credito.style.display = 'none';
  }
}
async function tick() {
  const d = await (await fetch('/apex')).json();
  aplicarPrograma(d.programa);
  document.getElementById('gp').textContent =
    d.en_vivo ? (d.gp + ' — ' + d.circuito) : 'NO LIVE SESSION';
  document.getElementById('lap').textContent =
    d.en_vivo && d.vuelta ? 'LAP ' + d.vuelta +
      (d.total_vueltas ? ' / ' + d.total_vueltas : '') : '';
  const c = d.clima || {};
  document.getElementById('clima').textContent =
    (c.aire != null ? 'AIR ' + Math.round(c.aire) + '°C  ' : '') +
    (c.pista != null ? 'TRACK ' + Math.round(c.pista) + '°C' : '');
  document.getElementById('dot').style.display = d.en_vivo ? '' : 'none';
  document.getElementById('livetxt').style.display = d.en_vivo ? '' : 'none';
  // dirección automática: resalta el panel protagonista del momento
  const dir = document.getElementById('director');
  document.getElementById('panel-board').classList.remove('foco');
  document.getElementById('panel-incidentes').classList.remove('foco');
  if (d.foco) {
    dir.textContent = '● ' + d.foco.etiqueta;
    dir.classList.add('on');
    const el = document.getElementById('panel-' + d.foco.panel);
    if (el) el.classList.add('foco');
  } else {
    dir.classList.remove('on');
  }
  // Ticker de Alerta IA: refresca la lista; si cambió, repinta al vuelo
  const nuevas = d.en_vivo ? (d.alertas || []) : [];
  const cambio = nuevas.length !== alertas.length ||
    nuevas.some((a, i) => !alertas[i] || a.txt !== alertas[i].txt);
  if (cambio) {
    const antes = alertas.length;
    alertas = nuevas;
    if (!antes || alertaIdx >= alertas.length) alertaIdx = 0;
    pintarAlerta();
  }
  // leaderboard en vivo, o calendario de próximas sesiones si no hay carrera
  const board = document.getElementById('board');
  const boardTitle = document.getElementById('board-title');
  board.innerHTML = '';
  if (d.en_vivo) {
    boardTitle.textContent = 'Leaderboard';
    for (const f of d.leaderboard) {
      const row = document.createElement('div');
      row.className = 'row' + (f.pelea ? ' pelea' : '');
      const prev = posPrevias[f.acr];
      let flecha = '', cls = '';
      if (prev !== undefined && prev !== f.pos) {
        flecha = f.pos < prev ? '\\u25B2' : '\\u25BC';
        cls = f.pos < prev ? 'up' : 'down';
        setTimeout(() => { const el = row.querySelector('.delta');
                           if (el) el.className = 'delta'; }, 2000);
      }
      posPrevias[f.acr] = f.pos;
      const color = f.color ? '#' + f.color : 'var(--line)';
      const tyre = f.neumatico
        ? '<span class="tyre ' + f.neumatico + '">' + f.neumatico + '</span>'
        : '<span class="tyre"></span>';
      row.innerHTML = '<span class="p">' + f.pos + '</span>' +
        '<span class="chip" style="background:' + color + '"></span>' +
        '<span class="acr">' + f.acr + '</span>' + tyre +
        '<span class="gap">' + (f.gap || '') + '</span>' +
        '<span class="delta ' + cls + '">' + flecha + '</span>';
      board.appendChild(row);
    }
  } else if ((d.calendario || []).length) {
    boardTitle.textContent = 'Upcoming Sessions';
    for (const s of d.calendario) {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = '<span class="acr">' + s.sesion.toUpperCase() +
        '</span><span class="gap">' + s.pais + '</span>';
      board.appendChild(row);
      const sub = document.createElement('div');
      sub.className = 'razon'; sub.style.padding = '0 2px 8px 2px';
      sub.textContent = s.horarios.join('   ·   ');
      board.appendChild(sub);
    }
  } else {
    boardTitle.textContent = 'Leaderboard';
    board.innerHTML = '<div class="vacio">No live session</div>';
  }
  // Race Intelligence: duelos con puntaje y su porqué (nunca un número
  // sin explicación — regla de oro de métricas honestas)
  const intel = document.getElementById('intel');
  intel.innerHTML = '';
  const duelos = d.duelos || [];
  if (!duelos.length) {
    intel.innerHTML = '<div class="vacio">No close battles right now</div>';
  }
  for (const dl of duelos) {
    const row = document.createElement('div'); row.className = 'duelo';
    const cls = dl.score >= 70 ? 'high' : dl.score >= 40 ? 'mid' : 'low';
    const top = document.createElement('div'); top.className = 'top';
    top.innerHTML = '<span>' + dl.entre + '</span><span class="score ' +
      cls + '">' + dl.score + '</span>';
    const razon = document.createElement('div'); razon.className = 'razon';
    razon.textContent = dl.razon;
    row.appendChild(top); row.appendChild(razon);
    if (dl.estrategia) {
      const estr = document.createElement('div'); estr.className = 'estr';
      estr.textContent = dl.estrategia;
      row.appendChild(estr);
    }
    intel.appendChild(row);
  }
  // Coste de parada medido de las paradas reales de ESTA carrera
  const pitloss = document.getElementById('pitloss');
  if (d.pit) {
    pitloss.innerHTML = 'PIT LOSS <b>~' + d.pit.segundos.toFixed(1) +
      's</b> — median of ' + d.pit.muestras + ' measured stop' +
      (d.pit.muestras > 1 ? 's' : '') + ' this race';
    pitloss.style.display = 'block';
  } else {
    pitloss.style.display = 'none';
  }
  // sonido de pista de fondo (con la voz activada)
  if (vozActiva && d.ambiente && !amb) {
    amb = new Audio('/ambiente.mp3');
    amb.loop = true; amb.volume = 0.15;
    amb.play().catch(() => { amb = null; });
  } else if (amb && (!d.ambiente || !vozActiva)) {
    amb.pause(); amb = null;
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
  if (d.lineas.length && d.segmento !== ultimoSegmento) {
    const esPrimeraCarga = ultimoSegmento === -1;
    ultimoSegmento = d.segmento;
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
    if (vozActiva && !esPrimeraCarga) {
      reproducirSegmento(d.segmento, d.lineas, d.idioma);
    }
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
        model=modelo_actual(),
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
- VARY LENGTH WILDLY. They ask each other questions, and some answers \
are just "Yes.", "No chance.", "Every single time." A one-word reply \
after a long thought sounds human. Same rhythm every time sounds robotic.
- PEAK MOMENTS ARE THEATRE. On a big overtake or crash, {NARRADOR} \
explodes: "OHHH my word — around the OUTSIDE! That is the move of a \
CHAMPION!" Stretch words in the heat ("Hamiltooon hangs it out wide!"). \
{ANALISTA} rides the wave for a beat, then brings it back to earth.
- INTERRUPT LIKE LIVE TV. When action bursts in mid-thought: "—sorry, \
hold that thought, THERE'S CONTACT at turn four!" ... and once it \
settles: "okay, phew... go on, you were saying." Use the em dash to cut \
a line short.
- BREATHE. In wheel-to-wheel battles they sound breathless: "...phew.", \
"my heart, honestly...", a gasp before the words come out. After a big \
shout, a short recovery line.
- LAUGH LIKE HUMANS, never as a written token. No "Haha," as a word. \
Real laughter breaks into the sentence: "oh— hahaha no way,", "pfff—", \
"hah! fair enough." It should read like it escaped, not like a line read.
- They get annoyed at bad strategy ("Oh come on, why would they box him \
NOW?"), they tease each other. Everyday colloquial language.
- {ANALISTA} is proactive: she may interrupt mid-thought ("Wait — look at \
the gap.").
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
    if quien == "historiador":
        return "Narrator"
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
        return "OVERTAKE HAPPENING — explosive, this is the theatre moment"
    if tele and tele.vuelta >= 1 and tele.hay_pelea():
        return ("wheel-to-wheel BATTLE under way — breathless, urgent, "
                "hearts racing")
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
    if estado.tele:
        estrategia = estado.tele.estrategia_resumen()
        if estrategia:
            contexto += (f"\nMEASURED STRATEGY DATA (real, quotable): "
                         f"{estrategia}")
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
        model=modelo_actual(),
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


def _horarios(fecha_iso):
    """Convierte una fecha ISO (UTC) a texto legible en varias zonas."""
    base = dt.datetime.fromisoformat(fecha_iso.replace("Z", "+00:00"))
    return [f"{etq} {base.astimezone(ZoneInfo(zona)):%a %d %b %H:%M}"
            for etq, zona in ZONAS_CALENDARIO]


async def bucle_calendario():
    """Refresca cada 30 min el calendario real (OpenF1): el de pantalla
    (próximas sesiones) y el horario que usa la parrilla automática."""
    while True:
        try:
            sesiones = await telemetria.proximas_sesiones(5)
            estado.calendario = [{
                "pais": s.get("country_name", "?"),
                "sesion": s.get("session_name", "?"),
                "circuito": s.get("circuit_short_name", "?"),
                "horarios": _horarios(s["date_start"]),
            } for s in sesiones]
        except Exception as e:
            log.warning("Calendario no disponible (%s)", e)
        try:
            estado.horario = await telemetria.sesiones_programables()
        except Exception as e:
            log.warning("Horario de parrilla no disponible (%s)", e)
        await asyncio.sleep(1800)


SYSTEM_CALENDARIO = f"""You are the scriptwriter for {NARRADOR} and \
{ANALISTA}, a Formula 1 commentary duo, currently OFF AIR between \
sessions. Write ONE short segment (1 to 3 short lines) in \
{IDIOMA_NOMBRE} announcing the upcoming schedule so viewers know when \
to come back. Use ONLY the real schedule data given below — never \
invent dates, times, or session names. Warm, inviting channel-promo \
tone. Natural to remind viewers to subscribe so they don't miss it — \
brief and friendly, never pushy or repetitive with previous mentions."""


async def narrar_calendario(client: anthropic.AsyncAnthropic):
    if not estado.calendario:
        return []
    lineas_cal = "\n".join(
        f"{s['pais']} — {s['sesion']} ({s['circuito']}): "
        f"{' / '.join(s['horarios'])}"
        for s in estado.calendario[:3])
    memoria = "\n".join(estado.diario[-6:]) or "(nothing said yet)"
    response = await client.messages.create(
        model=modelo_actual(), max_tokens=300, system=SYSTEM_CALENDARIO,
        output_config={"format": {"type": "json_schema",
                                  "schema": DUO_SCHEMA}},
        messages=[{
            "role": "user",
            "content": (f"UPCOMING SCHEDULE (real data):\n{lineas_cal}\n\n"
                        f"RECENTLY SAID (avoid repeating):\n{memoria}"),
        }],
    )
    if response.stop_reason == "refusal":
        return []
    texto = next((b.text for b in response.content if b.type == "text"), "")
    try:
        return json.loads(texto).get("lineas", [])
    except json.JSONDecodeError:
        return []


# Catálogo de programas (shows sin telemetría). Cada uno: título en
# pantalla, fondo (gradiente con nombre), y las instrucciones del guion.
def _sys_show(rol):
    return (f"You are the scriptwriter for {NARRADOR} and {ANALISTA}, a "
            f"Formula 1 commentary duo hosting a segment (no live race), "
            f"in {IDIOMA_NOMBRE}. {rol} Write ONE short segment (2 to 4 "
            "short lines), conversational and warm, alternating both "
            "voices. Only real, widely-documented facts — if unsure of a "
            "specific number, speak generally rather than inventing it. "
            "Vary the topic from what was recently said.")


PROGRAMAS = {
    "historia": {
        "titulo": "F1 HISTORY", "fondo": "historia",
        "sys": _sys_show("Tell a genuine, well-known piece of Formula 1 "
                        "history — a legendary race, driver, rivalry, car "
                        "or circuit moment; storyteller tone."),
        "pedido": "Tell the next short piece of F1 history.",
    },
    "tech": {
        "titulo": "TECH & PHYSICS", "fondo": "tech",
        "sys": _sys_show("Explain one Formula 1 technical or physics "
                        "concept in simple, vivid terms — aerodynamics, "
                        "tyres, ERS, DRS, ground effect, braking, fuel."),
        "pedido": "Explain the next tech concept simply.",
    },
}


HISTORIA_SCHEMA = {
    "type": "object",
    "properties": {
        "titulo": {"type": "string"},
        "tema": {"type": "string"},
        "lineas": {"type": "array", "items": {
            "type": "object",
            "properties": {"texto": {"type": "string"}},
            "required": ["texto"], "additionalProperties": False}},
    },
    "required": ["titulo", "tema", "lineas"],
    "additionalProperties": False,
}

SYSTEM_HISTORIA_SOLO = (
    f"You are a single British storyteller narrating a Formula 1 history "
    f"documentary in {IDIOMA_NOMBRE}. Write ONE short segment as 2 to 4 "
    "narration lines — SINGLE VOICE, no dialogue, no two speakers. Cover "
    "a real, well-documented F1 story. Produce three fields:\n"
    "- titulo: a broadcast title in UPPERCASE with the era, team, driver "
    "and circuit where relevant, separated by ' · ' (e.g. "
    "'AYRTON SENNA · McLAREN-HONDA · 1988 · SUZUKA').\n"
    "- tema: the single best subject to show a photo of — a real driver's "
    "full name, a car, or a circuit that has an English Wikipedia page "
    "(e.g. 'Ayrton Senna' or 'Suzuka Circuit'). Just the name.\n"
    "- lineas: the narration, written for the ear (numbers as words). "
    "Only real, widely-documented facts; if unsure of a figure, speak "
    "generally rather than inventing it.")


async def imagen_wikimedia(query):
    """Foto de libre uso desde Wikipedia/Wikimedia Commons para un tema
    (piloto, auto o circuito). Devuelve URL o None. Nota: las imágenes
    principales de Wikipedia para pilotos/autos/circuitos provienen casi
    siempre de Commons (licencia libre); se muestra crédito en pantalla."""
    if not query:
        return None
    try:
        async with httpx.AsyncClient() as c:
            r = await c.get("https://en.wikipedia.org/w/api.php", params={
                "action": "query", "prop": "pageimages",
                "piprop": "original", "format": "json",
                "titles": query, "redirects": 1}, timeout=20,
                headers={"User-Agent": "F1FanChannel/1.0 (fan project)"})
            r.raise_for_status()
            for p in r.json().get("query", {}).get("pages", {}).values():
                url = p.get("original", {}).get("source")
                if url:
                    return url
    except Exception as e:
        log.info("Sin imagen de Wikimedia para '%s' (%s)", query, e)
    return None


async def segmento_historia(client: anthropic.AsyncAnthropic):
    """Genera un segmento de Historia: un solo narrador + título
    descriptivo + foto de fondo de libre uso del tema."""
    memoria = "\n".join(estado.diario[-8:]) or "(nothing said yet)"
    response = await client.messages.create(
        model=modelo_actual(), max_tokens=500, system=SYSTEM_HISTORIA_SOLO,
        output_config={"format": {"type": "json_schema",
                                  "schema": HISTORIA_SCHEMA}},
        messages=[{
            "role": "user",
            "content": ("Tell the next piece of F1 history. Avoid "
                        f"repeating these recent ones:\n{memoria}"),
        }],
    )
    if response.stop_reason == "refusal":
        return []
    texto = next((b.text for b in response.content if b.type == "text"), "")
    try:
        data = json.loads(texto)
    except json.JSONDecodeError:
        return []
    imagen = await imagen_wikimedia(data.get("tema", ""))
    estado.programa = {
        "tipo": "historia",
        "titulo": data.get("titulo", "F1 HISTORY"),
        "fondo": imagen or "historia",
        "credito": "Image: Wikimedia Commons" if imagen else "",
    }
    return [{"quien": "historiador", "texto": l["texto"]}
            for l in data.get("lineas", []) if l.get("texto")]


async def narrar_programa(client: anthropic.AsyncAnthropic, tipo):
    prog = PROGRAMAS.get(tipo)
    if not prog:
        return []
    memoria = "\n".join(estado.diario[-8:]) or "(nothing said yet)"
    response = await client.messages.create(
        model=modelo_actual(), max_tokens=350, system=prog["sys"],
        output_config={"format": {"type": "json_schema",
                                  "schema": DUO_SCHEMA}},
        messages=[{
            "role": "user",
            "content": (f"{prog['pedido']} Avoid repeating these "
                        f"recent ones:\n{memoria}"),
        }],
    )
    if response.stop_reason == "refusal":
        return []
    texto = next((b.text for b in response.content if b.type == "text"), "")
    try:
        return json.loads(texto).get("lineas", [])
    except json.JSONDecodeError:
        return []


def poner_al_aire(tipo):
    """Pone un show en pantalla (o None = volver a carrera/leaderboard)."""
    if tipo is None:
        estado.programa = None
        return
    prog = PROGRAMAS.get(tipo)
    if prog:
        estado.programa = {"tipo": tipo, "titulo": prog["titulo"],
                          "fondo": prog["fondo"]}
        estado.ultimo_anuncio = 0.0  # contenido nuevo cuanto antes


async def poner_interludio():
    """Interludio entre programas (estilo tarjeta de continuidad de TV):
    foto de un circuito a pantalla completa + música libre opcional +
    aviso de la próxima carrera. Nadie habla durante el interludio."""
    circuito, subtitulo = None, ""
    ahora = dt.datetime.now(dt.timezone.utc)
    futuras = [s for s in estado.horario if s["inicio"] > ahora]
    if futuras:
        s = min(futuras, key=lambda s: s["inicio"])
        circuito = s["circuito"]
        hora_local = _horarios(s["inicio"].isoformat())
        subtitulo = (f"UP NEXT · {s['sesion']} — {s['pais']} · "
                     f"{hora_local[0] if hora_local else ''}").upper()
    if not circuito or circuito == "?":
        circuito = random.choice(CIRCUITOS_RESERVA)
    consulta = (circuito if "circuit" in circuito.lower()
                else f"{circuito} Circuit")
    imagen = await imagen_wikimedia(consulta)
    if not imagen and consulta != circuito:
        imagen = await imagen_wikimedia(circuito)
    estado.programa = {
        "tipo": "interludio",
        "titulo": circuito.upper(),
        "subtitulo": subtitulo,
        "fondo": imagen or "interludio",
        "credito": "Image: Wikimedia Commons" if imagen else "",
        "musica": MUSICA_URL,
    }


async def bucle_director():
    """Director de programación: cuando está en automático, rota los shows
    de PLAYLIST solo, sin que nadie toque nada. Se puede prender/apagar y
    saltar de show desde el panel de botones (sin Secrets)."""
    if PROGRAMACION_AUTO:
        return  # la parrilla automática toma el control
    playlist = ([p for p in PLAYLIST if p in PROGRAMAS or p == "interludio"]
                or ["historia"])
    i = 0
    while True:
        if estado.director_auto:
            minutos = await _rotar_show(playlist[i % len(playlist)])
            log.info("🎬 Ahora al aire: %s", estado.programa["titulo"])
            i += 1
            await asyncio.sleep(minutos * 60)
        else:
            await asyncio.sleep(2)


async def _rotar_show(tipo):
    """Pone el siguiente ítem de la playlist al aire y devuelve cuántos
    minutos debe durar (los interludios son más cortos que los shows)."""
    if tipo == "interludio":
        await poner_interludio()
        return INTERLUDIO_MINUTOS
    poner_al_aire(tipo)
    return ROTACION_MINUTOS


def sesion_en_ventana(ahora, sesiones, antes_min=30):
    """Decisión pura: ¿qué sesión debería estar al aire ahora? Devuelve la
    sesión (o None). La ventana va desde `antes_min` antes del inicio (pre-
    show) hasta el fin estimado. Todo en UTC → correcto ante cambios de
    hora (DST) en cualquier país."""
    ventana = dt.timedelta(minutes=antes_min)
    for s in sorted(sesiones, key=lambda s: s["inicio"]):
        if s["inicio"] - ventana <= ahora <= s["fin"]:
            return s
    return None


async def _correr_sesion(clave):
    """Carga y reproduce una sesión concreta (usado por la parrilla)."""
    estado.tele_cargando = True
    try:
        tele = telemetria.Telemetria(clave, VELOCIDAD_REPLAY)
        await tele.cargar()
        estado.tele = tele
        estado.programa = None
        # Carrera de la parrilla = evento en vivo real → calidad máxima
        estado.carrera_en_vivo = True
        log.info("📺 Al aire (parrilla, calidad %s): %s",
                 MODELO_VIVO, tele.descripcion())

        def al_evento(texto):
            estado.eventos.append(texto)
            del estado.eventos[:-30]
            log.info("📊 %s", texto)

        await tele.correr(al_evento)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        log.error("Sesión de parrilla '%s' no disponible (%s)", clave, e)
    finally:
        estado.tele = None
        estado.tele_cargando = False
        estado.carrera_en_vivo = False


async def bucle_programacion():
    """Parrilla automática (Fase 8): sigue el calendario real. Cuando toca
    una carrera, la pone al aire a su hora (con pre-show); entre carreras,
    rota los programas. Un solo cerebro para todo el canal."""
    if not PROGRAMACION_AUTO:
        return
    playlist = ([p for p in PLAYLIST if p in PROGRAMAS or p == "interludio"]
                or ["historia"])
    log.info("🗓️  Parrilla automática activa (pre-show %g min antes)",
             PRESHOW_MINUTOS)
    idx = 0
    prox_rotacion = 0.0
    tarea_carrera = None
    while True:
        ahora = dt.datetime.now(dt.timezone.utc)
        s = sesion_en_ventana(ahora, estado.horario, PRESHOW_MINUTOS)
        if s:
            # Toca una carrera: ponerla al aire si no está ya
            if estado.sesion_actual != s["session_key"]:
                if tarea_carrera:
                    tarea_carrera.cancel()
                estado.sesion_actual = s["session_key"]
                log.info("🗓️  Es hora de %s en %s → al aire",
                        s["sesion"], s["pais"])
                tarea_carrera = asyncio.create_task(
                    _correr_sesion(s["session_key"]))
        else:
            # Sin carrera: cerrar cualquier carrera y rotar programas
            if estado.sesion_actual is not None:
                if tarea_carrera:
                    tarea_carrera.cancel()
                    tarea_carrera = None
                estado.tele = None
                estado.sesion_actual = None
                prox_rotacion = 0.0  # empezar programa de inmediato
            if time.time() >= prox_rotacion:
                minutos = await _rotar_show(playlist[idx % len(playlist)])
                log.info("🎬 Ahora al aire: %s", estado.programa["titulo"])
                idx += 1
                prox_rotacion = time.time() + minutos * 60
        await asyncio.sleep(INTERVALO_PARRILLA)


async def bucle_telemetria():
    """Programación continua: la sesión configurada primero, y luego un
    maratón infinito de carreras clásicas reales (nunca queda "al aire
    en blanco" si hay datos disponibles)."""
    if (MODO_TELEMETRIA == "off" or DEMO_PROGRAMA or PROGRAMAS_AUTO
            or PROGRAMACION_AUTO):
        log.info("Telemetría en pausa (modo programa/parrilla/off)")
        return
    cola = [SESSION_KEY]
    while True:
        clave = cola.pop(0)
        estado.tele_cargando = True
        try:
            tele = telemetria.Telemetria(clave, VELOCIDAD_REPLAY)
            await tele.cargar()
            estado.tele = tele
            log.info("📺 Al aire: %s", tele.descripcion())

            def al_evento(texto):
                estado.eventos.append(texto)
                del estado.eventos[:-30]
                log.info("📊 %s", texto)

            await tele.correr(al_evento)
        except Exception as e:
            log.error("Sesión '%s' no disponible (%s)", clave, e)
        finally:
            estado.tele = None
            estado.tele_cargando = False

        if not cola:
            try:
                clasicas = await telemetria.carreras_clasicas(15)
                cola = [c["session_key"] for c in clasicas]
                for c in clasicas[:3]:
                    log.info("📺 En cola: %s %s",
                            c.get("country_name"), c.get("year"))
            except Exception as e:
                log.warning("No se pudo armar el maratón de clásicos (%s)",
                           e)
        if not cola:
            await asyncio.sleep(60)  # sin candidatas: reintentar más tarde
            cola = [SESSION_KEY]


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
    audios = []
    for l in lineas:
        audio = await sintetizar(l["quien"], l["texto"])
        audios.append(audio)
        if audio:
            lineas_ws.append(
                {**l, "audio": base64.standard_b64encode(audio).decode()})
        else:
            lineas_ws.append(l)
    estado.audios = audios
    estado.segmento_id += 1
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
    if MODELO_VIVO == MODELO_AHORRO:
        log.info("Narración activada (modelo fijo %s, eventos cada %ds, "
                 "relleno cada %ds)", MODELO_VIVO, INTERVALO_NARRACION,
                 RELLENO_SEGUNDOS)
    else:
        log.info("Narración activada — modo ahorro: carrera en vivo %s, "
                 "resto %s (eventos cada %ds, relleno cada %ds)",
                 MODELO_VIVO, MODELO_AHORRO, INTERVALO_NARRACION,
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
            elif (estado.programa
                    and estado.programa.get("tipo") == "interludio"):
                # Interludio: solo foto y música — nadie habla
                continue
            elif estado.frame is not None:
                # Respaldo por visión: frame nuevo cada INTERVALO_NARRACION
                if (estado.tele_cargando
                        or estado.frame_ts <= ultimo_frame_narrado
                        or desde_ultima < INTERVALO_NARRACION):
                    continue
                ultimo_frame_narrado = estado.frame_ts
                texto = await narrar_frame(client, estado.frame,
                                           estado.narracion)
            elif (estado.programa
                    and estado.programa.get("tipo") in PROGRAMAS):
                # Programa sin telemetría (Historia, Tech...): el dúo
                # genera contenido del show que el director puso al aire
                if ahora - estado.ultimo_anuncio >= INTERVALO_PROGRAMA:
                    estado.ultimo_anuncio = ahora
                    if estado.programa["tipo"] == "historia":
                        texto = await segmento_historia(client)
                    else:
                        texto = await narrar_programa(
                            client, estado.programa["tipo"])
                else:
                    continue
            elif (not estado.tele_cargando and estado.calendario
                    and ahora - estado.ultimo_anuncio >= ANUNCIO_SEGUNDOS):
                # Verdadero fuera de vivo: sin carrera y sin frame de la Mac
                estado.ultimo_anuncio = ahora
                texto = await narrar_calendario(client)
            else:
                continue
        except anthropic.APIError as e:
            log.error("Error de la API de Anthropic: %s", e)
            continue
        if texto:
            await difundir(texto)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))

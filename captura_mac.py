#!/usr/bin/env python3
"""
captura_mac.py — Captura la pantalla de la Mac (ventana con F1TV)
y envía 1 frame por segundo al backend de Replit por WebSocket.

USO:
  1. pip3 install mss pillow websockets
  2. Edita REPLIT_WS_URL con la URL de tu Repl
  3. Primera vez: python3 captura_mac.py --calibrar
     (te muestra una captura numerada para elegir la zona de pantalla)
  4. Después: python3 captura_mac.py
  5. macOS te pedirá permiso de "Grabación de pantalla" para
     Terminal la primera vez → Ajustes > Privacidad y seguridad

NOTA DRM: si los frames salen negros, F1TV está bloqueando la
captura en ese navegador. Prueba con Chrome (desactivando
aceleración por hardware en chrome://settings/system) o con
Firefox antes de rendirte y pasar a la capturadora HDMI.
"""

import asyncio
import io
import json
import re
import subprocess
import sys
import time

import mss
import websockets
from PIL import Image

# ============ CONFIGURACIÓN ============
REPLIT_WS_URL = ("wss://0208909a-afe2-4c7c-8435-db2dcf9288a7-00-3v3zicx335uw3"
                 ".kirk.replit.dev/ws/frames")
FPS = 1  # frames por segundo (1 es suficiente para el filtro)
JPEG_CALIDAD = 80
ANCHO_MAX = 1280  # se redimensiona para no gastar ancho de banda

# Zona de captura: None = pantalla completa.
# Tras calibrar, pon aquí el dict que te imprima el script, ej:
# ZONA = {"left": 100, "top": 80, "width": 1600, "height": 900}
ZONA = None

VOZ_ACTIVADA = True  # leer las narraciones en voz alta (comando `say` de macOS)
# =======================================


def elegir_voz_espanola():
    """Busca una voz en español instalada en macOS para el comando `say`."""
    try:
        salida = subprocess.run(["say", "-v", "?"], capture_output=True,
                                text=True, timeout=10).stdout
        for linea in salida.splitlines():
            m = re.match(r"^(.+?)\s+es[_-]", linea)
            if m:
                return m.group(1).strip()
    except Exception:
        pass
    return None


VOZ = elegir_voz_espanola() if VOZ_ACTIVADA else None
VOZ_VELOCIDAD = "175"  # palabras por minuto del comando `say`

_hablando = None   # lock creado dentro del event loop
_pendiente = None  # última narración en espera (solo se guarda la más nueva)


async def hablar(texto):
    """Lee las narraciones una a la vez, sin solaparse.

    Si llega una narración nueva mientras la voz sigue ocupada, se guarda
    solo la más reciente y se lee al terminar la actual (en vivo no tiene
    sentido acumular retraso leyendo narraciones viejas).
    """
    global _hablando, _pendiente
    if not VOZ_ACTIVADA or not texto:
        return
    if _hablando is None:
        _hablando = asyncio.Lock()
    _pendiente = texto
    if _hablando.locked():
        return
    async with _hablando:
        while _pendiente:
            siguiente, _pendiente = _pendiente, None
            cmd = (["say", "-r", VOZ_VELOCIDAD]
                   + (["-v", VOZ] if VOZ else []) + [siguiente])
            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd, stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL)
                await proc.wait()
            except Exception:
                return


def capturar_frame(sct, zona):
    """Captura la zona indicada y devuelve bytes JPEG."""
    monitor = zona if zona else sct.monitors[1]  # monitor principal
    shot = sct.grab(monitor)
    img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")

    # Redimensionar si es muy grande
    if img.width > ANCHO_MAX:
        alto = int(img.height * ANCHO_MAX / img.width)
        img = img.resize((ANCHO_MAX, alto), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_CALIDAD)
    return buf.getvalue()


def modo_calibrar():
    """Guarda una captura completa para que elijas la zona del video."""
    with mss.mss() as sct:
        monitor = sct.monitors[1]
        shot = sct.grab(monitor)
        img = Image.frombytes("RGB", shot.size, shot.bgra, "raw", "BGRX")
        img.save("calibracion.png")
    print(f"Captura guardada en calibracion.png ({img.width}x{img.height})")
    print("Ábrela, identifica el rectángulo donde se ve el video de F1TV")
    print("y edita la variable ZONA en este script, por ejemplo:")
    print('ZONA = {"left": 100, "top": 80, "width": 1600, "height": 900}')
    print("(left/top = esquina superior izquierda del video en píxeles)")


async def enviar_frames():
    reintento = 3
    while True:
        try:
            print(f"Conectando a {REPLIT_WS_URL} ...")
            async with websockets.connect(
                REPLIT_WS_URL, max_size=10 * 1024 * 1024
            ) as ws:
                print("✅ Conectado. Capturando... (Ctrl+C para parar)")
                with mss.mss() as sct:
                    contador = 0
                    while True:
                        inicio = time.time()
                        frame = capturar_frame(sct, ZONA)

                        # Detección rápida de frame negro (DRM)
                        if len(frame) < 5000 and contador % 10 == 0:
                            print("⚠️  Frame sospechosamente pequeño — "
                                  "posible pantalla negra por DRM")

                        await ws.send(frame)
                        contador += 1
                        if contador % 30 == 0:
                            print(f"  {contador} frames enviados "
                                  f"({len(frame)//1024} KB el último)")

                        # Escuchar mensajes del backend sin bloquear
                        try:
                            msg = await asyncio.wait_for(
                                ws.recv(), timeout=0.05
                            )
                            data = json.loads(msg)
                            if data.get("tipo") == "narracion":
                                texto = data.get("texto", "")
                                print(f"🎙️  {texto}")
                                asyncio.ensure_future(hablar(texto))
                        except asyncio.TimeoutError:
                            pass

                        # Mantener el ritmo de FPS
                        restante = (1.0 / FPS) - (time.time() - inicio)
                        if restante > 0:
                            await asyncio.sleep(restante)

        except (websockets.WebSocketException, OSError) as e:
            print(f"❌ Conexión perdida ({e}). "
                  f"Reintentando en {reintento}s...")
            await asyncio.sleep(reintento)
        except KeyboardInterrupt:
            print("\nDetenido por el usuario.")
            return


if __name__ == "__main__":
    if "--calibrar" in sys.argv:
        modo_calibrar()
    else:
        if "TU-REPL" in REPLIT_WS_URL:
            print("⚠️  Edita primero REPLIT_WS_URL con la URL de tu Repl")
            sys.exit(1)
        asyncio.run(enviar_frames())

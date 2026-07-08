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
import base64
import io
import json
import os
import re
import subprocess
import sys
import tempfile
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

# Voces preferidas por idioma para cada personaje: [narrador, analista]
VOCES_PREFERIDAS = {
    "en": [["Daniel", "Alex", "Fred", "Oliver", "Tom"],
           ["Samantha", "Karen", "Moira", "Tessa", "Kate"]],
    "es": [["Jorge", "Diego", "Carlos", "Juan"],
           ["Mónica", "Paulina", "Marisol", "Angélica"]],
}
# Velocidad (palabras/minuto): el narrador habla más rápido que el analista
VELOCIDADES = {"narrador": "195", "analista": "170"}


def voces_instaladas():
    """Nombres de las voces disponibles en macOS (`say -v ?`)."""
    try:
        salida = subprocess.run(["say", "-v", "?"], capture_output=True,
                                text=True, timeout=10).stdout
        nombres = set()
        for linea in salida.splitlines():
            m = re.match(r"^(.+?)\s{2,}[a-zA-Z]{2}[_-]", linea)
            if m:
                nombres.add(m.group(1).strip())
        return nombres
    except Exception:
        return set()


_INSTALADAS = voces_instaladas() if VOZ_ACTIVADA else set()


def elegir_voz(quien, idioma):
    """Elige una voz instalada para el personaje, o None (voz por defecto)."""
    indice = 0 if quien == "narrador" else 1
    preferencias = VOCES_PREFERIDAS.get(idioma, VOCES_PREFERIDAS["en"])
    for nombre in preferencias[indice]:
        if nombre in _INSTALADAS:
            return nombre
    return None


_hablando = None   # lock creado dentro del event loop
_pendiente = None  # último segmento en espera (solo se guarda el más nuevo)


async def hablar(lineas, idioma="en"):
    """Lee un segmento de diálogo, línea por línea, sin solaparse.

    Cada personaje usa su propia voz. Si llega un segmento nuevo mientras
    la voz sigue ocupada, se guarda solo el más reciente y se lee al
    terminar el actual (en vivo no tiene sentido acumular retraso).
    """
    global _hablando, _pendiente
    if not VOZ_ACTIVADA or not lineas:
        return
    if _hablando is None:
        _hablando = asyncio.Lock()
    _pendiente = (lineas, idioma)
    if _hablando.locked():
        return
    async with _hablando:
        while _pendiente:
            (segmento, idi), _pendiente = _pendiente, None
            for linea in segmento:
                await _reproducir_linea(linea, idi)


async def _reproducir_linea(linea, idioma):
    """Reproduce una línea: audio natural si viene, si no la voz del sistema."""
    quien = linea.get("quien", "narrador")
    texto = linea.get("texto", "")
    audio_b64 = linea.get("audio")
    if audio_b64:
        ruta = None
        try:
            datos = base64.b64decode(audio_b64)
            with tempfile.NamedTemporaryFile(suffix=".mp3",
                                             delete=False) as f:
                f.write(datos)
                ruta = f.name
            proc = await asyncio.create_subprocess_exec(
                "afplay", ruta, stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL)
            await proc.wait()
            return
        except Exception:
            pass  # si el audio falla, caer a la voz del sistema
        finally:
            if ruta:
                try:
                    os.unlink(ruta)
                except OSError:
                    pass
    if not texto:
        return
    voz = elegir_voz(quien, idioma)
    cmd = (["say", "-r", VELOCIDADES.get(quien, "175")]
           + (["-v", voz] if voz else []) + [texto])
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        await proc.wait()
    except Exception:
        pass


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
                            if data.get("tipo") == "dialogo":
                                lineas = data.get("lineas", [])
                                for l in lineas:
                                    icono = ("🎙️" if l.get("quien") ==
                                             "narrador" else "🧠")
                                    print(f"{icono}  {l.get('texto', '')}")
                                asyncio.ensure_future(
                                    hablar(lineas, data.get("idioma", "en")))
                            elif data.get("tipo") == "narracion":
                                # compatibilidad con el formato antiguo
                                texto = data.get("texto", "")
                                print(f"🎙️  {texto}")
                                asyncio.ensure_future(hablar(
                                    [{"quien": "narrador", "texto": texto}],
                                    data.get("idioma", "es")))
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

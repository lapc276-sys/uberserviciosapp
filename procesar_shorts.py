#!/usr/bin/env python3
"""
Procesador de shorts: genera audio y metadata listos para video.

Uso:
  python3 procesar_shorts.py          # Procesa todos los shorts sin audio
  python3 procesar_shorts.py 20260715_1800  # Procesa un short específico
  python3 procesar_shorts.py --limpiar     # Borra todos los shorts
"""

import asyncio
import json
import os
import sys
import glob
from datetime import datetime

import anthropic
import httpx

# Importar configuración del main
sys.path.insert(0, ".")
from main import (
    sintetizar, imagenes_wikimedia, ELEVENLABS_API_KEY, OPENAI_API_KEY,
    MODELO_AHORRO
)


async def procesar_short(short_id):
    """Procesa un short: genera audio y busca fotos."""
    ruta = f"shorts/short_{short_id}.json"
    if not os.path.exists(ruta):
        print(f"❌ Short {short_id} no encontrado")
        return False

    with open(ruta, "r") as f:
        short = json.load(f)

    guion = short.get("guion", "")
    if not guion:
        print(f"❌ Short {short_id} sin guión")
        return False

    # Generar audio
    print(f"🎙️ Generando audio para {short_id}...", end=" ", flush=True)
    audio = await sintetizar("narrador", guion)
    if audio:
        audio_ruta = f"shorts/short_{short_id}.mp3"
        with open(audio_ruta, "wb") as f:
            f.write(audio)
        short["audio_path"] = audio_ruta
        print("✓")
    else:
        print("❌ Falló TTS")
        return False

    # Buscar fotos relacionadas
    print(f"📸 Buscando fotos para {short_id}...", end=" ", flush=True)
    tema = short.get("tema") or (
        "Formula 1" if "F1" in guion.upper() else "motor racing"
    )
    fotos = await imagenes_wikimedia(tema)
    if fotos:
        short["fotos"] = fotos
        print(f"✓ ({len(fotos)} fotos)")
    else:
        print("(ninguna)")

    # Metadata para YouTube
    ahora = datetime.fromisoformat(short["timestamp"])
    short["metadata_youtube"] = {
        "titulo": f"F1 {short['tipo'].upper()} — {ahora.strftime('%Y-%m-%d')}",
        "descripcion": (
            f"{guion}\n\n"
            f"#F1 #Formula1 #MotorRacing #Shorts\n"
            f"Generado automáticamente • {ahora.isoformat()}"
        ),
        "tags": ["F1", "Formula1", "Racing", "MotorSports", "Shorts"],
        "duracion_segundos": short.get("duracion_segundos", 30),
        "audio_path": short.get("audio_path"),
        "fotos": short.get("fotos", []),
    }

    # Guardar
    with open(ruta, "w") as f:
        json.dump(short, f, indent=2, ensure_ascii=False)
    print(f"✅ Short {short_id} listo")
    return True


async def procesar_todos():
    """Procesa todos los shorts sin audio."""
    archivos = glob.glob("shorts/short_*.json")
    pendientes = []

    for archivo in archivos:
        short_id = os.path.basename(archivo).replace("short_", "").replace(
            ".json", ""
        )
        with open(archivo, "r") as f:
            short = json.load(f)
        if not short.get("audio_path"):
            pendientes.append(short_id)

    if not pendientes:
        print("✅ Todos los shorts tienen audio ya")
        return

    print(f"📹 Procesando {len(pendientes)} shorts sin audio...\n")
    for short_id in pendientes:
        await procesar_short(short_id)
    print(f"\n✅ Listo. {len(pendientes)} shorts procesados.")


async def listar_shorts():
    """Lista todos los shorts disponibles."""
    archivos = sorted(glob.glob("shorts/short_*.json"), reverse=True)
    if not archivos:
        print("Sin shorts generados aún")
        return

    print(f"📹 {len(archivos)} shorts disponibles:\n")
    for archivo in archivos[:10]:
        with open(archivo, "r") as f:
            short = json.load(f)
        short_id = short["id"]
        tipo = short["tipo"].upper()
        duracion = short.get("duracion_segundos", "?")
        audio = "🎙️ " if short.get("audio_path") else "⏳"
        print(f"{audio} {short_id}  ({tipo}, {duracion}s)")
    if len(archivos) > 10:
        print(f"\n... y {len(archivos) - 10} más")


async def main():
    if len(sys.argv) > 1:
        if sys.argv[1] == "--limpiar":
            import shutil
            if os.path.exists("shorts"):
                shutil.rmtree("shorts")
            os.makedirs("shorts")
            print("✅ Shorts limpios")
            return
        elif sys.argv[1] == "--listar":
            await listar_shorts()
            return
        else:
            # Procesar short específico
            await procesar_short(sys.argv[1])
            return

    # Por defecto: procesar todos
    await procesar_todos()


if __name__ == "__main__":
    if not (ELEVENLABS_API_KEY or OPENAI_API_KEY):
        print("❌ ELEVENLABS_API_KEY o OPENAI_API_KEY no definida")
        print("Sin voces naturales, no se puede generar audio")
        sys.exit(1)

    asyncio.run(main())

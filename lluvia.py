#!/usr/bin/env python3
"""¿Está lloviendo en el circuito AHORA? Lo dice la estación de OpenF1.

OpenF1 publica la estación meteorológica de la pista más o menos cada
minuto: lluvia (sí/no), humedad, temperatura del aire y del asfalto,
viento. Es el mismo dato que usa el narrador — si aquí sale LLUVIA, en
el directo el guionista ya lo sabe.

Pistas para adelantarse a la lluvia antes de que el sensor la marque:
la humedad sube y la temperatura del asfalto cae de golpe varios grados
en pocos minutos.

Uso, en la Shell de Replit:

    python3 lluvia.py              # la sesión más reciente
    python3 lluvia.py --vigilar     # repite cada 60 s (Ctrl+C para salir)
"""

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import httpx                                                   # noqa: E402
import telemetria                                              # noqa: E402

BASE = "https://api.openf1.org/v1"


async def parte(c, cab):
    r = await c.get(BASE + "/weather", params={"session_key": "latest"},
                    headers=cab, timeout=30)
    r.raise_for_status()
    filas = sorted(r.json(), key=lambda f: f.get("date") or "")
    if not filas:
        print("⚠️  Sin lecturas todavía para la sesión más reciente.")
        return
    u = filas[-1]
    hace = filas[-11] if len(filas) > 10 else filas[0]   # ~10 min antes
    lluvia = bool(u.get("rainfall"))
    print(("🌧️  LLUEVE EN LA PISTA" if lluvia else "☀️  Seco (sin lluvia)")
          + f"   ·  lectura {str(u.get('date', ''))[11:19]} UTC")
    print(f"   Aire {u.get('air_temperature')}°C  ·  Asfalto "
          f"{u.get('track_temperature')}°C  ·  Humedad {u.get('humidity')}%"
          f"  ·  Viento {u.get('wind_speed')} m/s")
    try:
        caida = float(hace["track_temperature"]) - float(u["track_temperature"])
        sube = float(u["humidity"]) - float(hace["humidity"])
        if not lluvia and (caida >= 3 or sube >= 8):
            print(f"   ⚠️  Ojo: en ~10 min el asfalto bajó {caida:.1f}°C y la "
                  f"humedad subió {sube:.0f} puntos — puede venir lluvia.")
    except (KeyError, TypeError, ValueError):
        pass


async def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--vigilar", action="store_true", help="repetir cada 60 s")
    a = p.parse_args()
    async with httpx.AsyncClient() as c:
        while True:
            cab = await telemetria._auth_headers(c)
            try:
                await parte(c, cab)
            except Exception as e:
                print(f"❌ OpenF1 no respondió ({e})")
            if not a.vigilar:
                return 0
            print()
            await asyncio.sleep(60)


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        pass

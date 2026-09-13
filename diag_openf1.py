#!/usr/bin/env python3
"""Qué datos de OpenF1 llegan y cuáles no.

Por qué hace falta
───────────────────
El canal cuelga de OpenF1 para casi todo lo que se ve: los coches del
mapa, la tabla de pilotos, los datos que narra el dúo, la tarjeta de
pelea y el resumen del que sale el video-reseña. Cuando falla, esas
cinco cosas se caen a la vez y desde la pantalla parecen cinco averías
distintas.

Y no falla "OpenF1" en bloque: tiene endpoints GRATIS (el calendario, los
pilotos) y endpoints de TIEMPO REAL que ahora piden cuenta de pago. Un
200 en el calendario no dice nada sobre si habrá telemetría en carrera,
y por eso comprobarlo con una sola llamada engaña.

Esto los prueba UNO POR UNO contra la sesión que se le diga, y dice qué
parte del canal se queda sin datos con cada uno.

Uso:

    python3 diag_openf1.py                    # la última sesión de este año
    python3 diag_openf1.py --pais Spain       # la última de un país
    python3 diag_openf1.py --clave 9999       # una session_key concreta
"""

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import httpx                                                   # noqa: E402
import telemetria                                              # noqa: E402

BASE = "https://api.openf1.org/v1"

#: Endpoint → qué se queda sin datos si falla. El texto importa: es la
#: traducción de "404 en /location" a "no habrá coches en el mapa".
QUE_ROMPE = [
    ("drivers", "los nombres, dorsales y colores de equipo"),
    ("session_result", "el resultado final y el podio"),
    ("laps", "la tabla de tiempos y la mejor vuelta"),
    ("position", "el orden de la clasificación en vivo"),
    ("intervals", "los huecos entre coches y la tarjeta de pelea"),
    ("stints", "los neumáticos y su edad"),
    ("weather", "el parte de pista (lluvia, temperatura)"),
    ("race_control", "banderas, safety car e incidentes"),
    ("car_data", "velocidad y acelerador — la telemetría de la tarjeta"),
    ("location", "las coordenadas: SIN ESTO NO HAY COCHES EN EL MAPA"),
]


async def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--pais", default="", help='p.ej. "Spain"')
    p.add_argument("--clave", type=int, default=0, help="session_key")
    p.add_argument("--anio", type=int, default=2026)
    a = p.parse_args()

    con_cuenta = bool(os.environ.get("OPENF1_USERNAME")
                      and os.environ.get("OPENF1_PASSWORD"))
    print("CUENTA OPENF1:", "configurada (Secrets presentes)" if con_cuenta
          else "NO configurada — modo gratis")
    print()

    async with httpx.AsyncClient() as c:
        cab = await telemetria._auth_headers(c)
        if con_cuenta:
            print("TOKEN:", "obtenido" if cab.get("Authorization")
                  else "NO se pudo obtener — revisa usuario y contraseña")
            print()

        clave = a.clave
        nombre = ""
        if not clave:
            params = {"year": a.anio}
            if a.pais:
                params["country_name"] = a.pais
            try:
                r = await c.get(BASE + "/sessions", params=params,
                                headers=cab, timeout=30)
                r.raise_for_status()
                ses = r.json()
            except Exception as e:
                print(f"❌ /sessions falló ({e}).")
                print("   Sin esto el canal no sabe qué sesión toca y NO se")
                print("   pone al aire: se queda en la parrilla de programas.")
                return 1
            if not ses:
                print("⚠️  /sessions responde pero devuelve CERO sesiones.")
                return 1
            ses.sort(key=lambda s: s.get("date_start") or "")
            u = ses[-1]
            clave = u.get("session_key")
            nombre = (f"{u.get('session_name')} — {u.get('country_name')} "
                      f"({u.get('circuit_short_name')}) {u.get('date_start')}")
            print(f"✅ /sessions: {len(ses)} sesiones. La última:")
            print(f"   {nombre}  [session_key={clave}]")
            print()

        print(f"ENDPOINTS PARA session_key={clave}")
        rotos = []
        for ep, rompe in QUE_ROMPE:
            params = {"session_key": clave}
            if ep in ("car_data", "location"):
                # Estos dos son enormes: se pide UN piloto y nada más, que
                # es bastante para saber si el permiso está o no está.
                params["driver_number"] = 1
            try:
                r = await c.get(f"{BASE}/{ep}", params=params, headers=cab,
                                timeout=45)
                if r.status_code == 200:
                    n = len(r.json())
                    if n:
                        print(f"  ✅ {ep:15} {n:>7} filas")
                    else:
                        print(f"  ⚠️  {ep:15} 200 pero VACÍO → {rompe}")
                        rotos.append((ep, rompe, "vacío"))
                else:
                    detalle = (r.text or "")[:90].replace("\n", " ")
                    print(f"  ❌ {ep:15} HTTP {r.status_code} → {rompe}")
                    if detalle:
                        print(f"       {detalle}")
                    rotos.append((ep, rompe, f"HTTP {r.status_code}"))
            except Exception as e:
                print(f"  ❌ {ep:15} {type(e).__name__} → {rompe}")
                rotos.append((ep, rompe, type(e).__name__))

        print()
        if not rotos:
            print("Todo llega. Si aun así el canal salió sin coches ni tabla,")
            print("el fallo NO es OpenF1: mira el registro del Repl y busca")
            print("'Telemetría no disponible'.")
            return 0
        print(f"FALLAN {len(rotos)}:")
        for ep, rompe, por in rotos:
            print(f"  {ep} ({por}) → {rompe}")
        if any(p.startswith("HTTP 401") or p.startswith("HTTP 403")
               for _e, _r, p in rotos) and not con_cuenta:
            print()
            print("Los 401/403 con modo gratis son la cuenta de pago: los")
            print("datos en tiempo real ya no son gratuitos. Se arregla con")
            print("los Secrets OPENF1_USERNAME y OPENF1_PASSWORD.")
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

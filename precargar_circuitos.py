#!/usr/bin/env python3
"""Deja el mapa del circuito DIBUJADO antes de que empiece la sesión.

El mapa en vivo sacaba la forma de la pista del GPS de la sesión en curso.
Eso significa que al arrancar una clasificación o una carrera todavía no
había ninguna vuelta rodada, así que el circuito se iba dibujando conforme
los coches avanzaban. Media pista dibujada no se lee como "cargando", se
lee como "esto está roto" — y así llegaron las quejas.

Esto lo arregla por adelantado: baja el trazado de una sesión YA DISPUTADA
en ese mismo circuito y lo guarda en cache/trazados/. Cuando el canal
arranque la emisión, el mapa aparece entero desde el primer segundo.

El canal también lo hace solo si se le olvidó a uno (tarda unos segundos la
primera vez), pero corriendo esto ANTES del fin de semana no hay ni esa
espera.

Uso, en el Shell de Replit:

    python3 precargar_circuitos.py                 # los del próximo GP
    python3 precargar_circuitos.py --ver           # qué hay guardado ya
    python3 precargar_circuitos.py Zandvoort Monza # circuitos concretos
    python3 precargar_circuitos.py --temporada     # TODOS los de este año

Tarda del orden de medio minuto por circuito (la API gratuita de OpenF1
limita el ritmo y hay que pedirle las coordenadas piloto a piloto). Con
--temporada, déjalo corriendo un rato.
"""

import argparse
import asyncio
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import telemetria                                              # noqa: E402
import main as canal                                           # noqa: E402


def guardados():
    """Circuitos que ya tienen el trazado en caché → {clave: nº de puntos}."""
    out = {}
    d = canal._TRAZADOS_DIR
    if not os.path.isdir(d):
        return out
    for a in sorted(os.listdir(d)):
        if not a.endswith(".json"):
            continue
        nombre = a[:-5]
        out[nombre] = len(canal._cargar_trazado_cache(nombre))
    return out


async def circuitos_proximos(n=8):
    """Los circuitos de las próximas sesiones, sin repetir y en orden."""
    try:
        ses = await telemetria.proximas_sesiones(n)
    except Exception as e:
        print(f"No pude leer el calendario ({e}).")
        return []
    vistos, out = set(), []
    for s in ses:
        c = (s.get("circuit_short_name") or "").strip()
        k = telemetria.clave_circuito(c)
        if c and k not in vistos:
            vistos.add(k)
            out.append(c)
    return out


async def circuitos_temporada():
    """Todos los circuitos con sesión este año (y el pasado si no hay)."""
    ahora = dt.datetime.now(dt.timezone.utc)
    import httpx
    vistos, out = set(), []
    async with httpx.AsyncClient() as client:
        cab = await telemetria._auth_headers(client)
        for año in (ahora.year, ahora.year - 1):
            try:
                r = await client.get(f"{telemetria.BASE}/sessions",
                                     params={"year": año}, timeout=30,
                                     headers=cab)
                r.raise_for_status()
                filas = r.json()
            except Exception as e:
                print(f"No pude listar {año} ({e}).")
                continue
            for s in filas:
                c = (s.get("circuit_short_name") or "").strip()
                k = telemetria.clave_circuito(c)
                if c and k not in vistos:
                    vistos.add(k)
                    out.append(c)
            if out:
                break
    return out


async def precargar(circuitos, rehacer=False):
    ya = guardados()
    hechos = saltados = fallos = 0
    for c in circuitos:
        clave = canal._clave_circuito(c)
        if not rehacer and ya.get(clave):
            print(f"  ✅ {c}  (ya guardado, {ya[clave]} puntos)")
            saltados += 1
            continue
        print(f"  ⏳ {c} …", flush=True)
        try:
            traza = await telemetria.trazado_de_circuito(c)
        except Exception as e:
            print(f"  ❌ {c}  ({e})")
            fallos += 1
            continue
        if traza:
            canal._guardar_trazado_cache(c, traza)
            print(f"  ✅ {c}  ({len(traza)} puntos)")
            hechos += 1
        else:
            # Circuito nuevo en el calendario, o sin GPS en OpenF1. No es un
            # error del canal: sencillamente no hay de dónde sacarlo.
            print(f"  ⬜ {c}  sin datos de posición en OpenF1")
            fallos += 1
    print(f"\n  {hechos} nuevo(s) · {saltados} ya estaban · {fallos} sin datos")
    return hechos, saltados, fallos


async def principal(args):
    if args.ver:
        ya = guardados()
        print(f"Trazados guardados: {len(ya)}")
        for k, n in ya.items():
            print(f"  {k}  ({n} puntos)")
        if not ya:
            print("  (ninguno — corre este mismo script sin --ver)")
        return 0

    if args.circuitos:
        circuitos = args.circuitos
    elif args.temporada:
        circuitos = await circuitos_temporada()
    else:
        circuitos = await circuitos_proximos()
    if not circuitos:
        print("No hay circuitos que precargar. Prueba a nombrarlos a mano:")
        print("    python3 precargar_circuitos.py Zandvoort Monza")
        return 1

    print(f"Precargando el trazado de {len(circuitos)} circuito(s):\n")
    await precargar(circuitos, args.rehacer)
    print("\nListo. En la próxima sesión el mapa sale dibujado entero desde "
          "el primer segundo.")
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("circuitos", nargs="*",
                   help="nombres de circuito (como los llama OpenF1)")
    p.add_argument("--ver", action="store_true",
                   help="solo listar lo que ya está guardado")
    p.add_argument("--temporada", action="store_true",
                   help="todos los circuitos del año")
    p.add_argument("--rehacer", action="store_true",
                   help="volver a bajarlos aunque ya estén guardados")
    args = p.parse_args()
    return asyncio.run(principal(args))


if __name__ == "__main__":
    raise SystemExit(main())

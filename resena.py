#!/usr/bin/env python3
"""Crea a mano el resumen pendiente de una sesión, para que salga su
video-reseña.

Para qué existe
────────────────
La reseña de cada carrera se arma sola: al terminar la sesión el canal
apunta el resultado en resumenes/pendiente_*.json —con la telemetría
todavía viva, porque en cuanto se descarga ya no hay tabla de la que
sacar quién ganó— y un bucle lo recoge a los dos minutos y monta el
video.

Todo eso depende de UNA cosa: que hubiera telemetría. El día que OpenF1
no responde, no hay tabla, no se apunta nada, y la reseña no existe. Y no
es un fallo del generador: es que nunca le llegó nada que generar.

Esto es la salida de emergencia. Se le pasa el resultado a mano —que es
público y se puede comprobar en cualquier parte— y el canal hace el video
igual que si lo hubiera medido él.

Lo que NO hace
───────────────
No se inventa lo que no se le dé. Sin vuelta rápida, la reseña dice
"n/a"; sin parte meteorológico, la da por seca, que es lo que hacía ya
cuando el dato faltaba. Los únicos campos obligatorios son los que de
verdad definen la carrera: qué sesión fue, dónde, y el orden de llegada.

Uso, en el Shell de Replit:

    python3 resena.py --sesion Race --pais Spain --circuito Madring \
        --top "1:Kimi Antonelli,2:Max Verstappen,3:Lando Norris" \
        --incidente "Virtual safety car for a stopped car" \
        --incidente "The leader missed the pit entry under the caution"

Y después: el bucle lo recoge en dos minutos. No hace falta reiniciar.
"""

import argparse
import datetime as dt
import json
import os
import sys

DIR = "resumenes"


def _acronimo(nombre):
    """Tres letras del apellido, que es lo que usa la pantalla. No es la
    abreviatura oficial de la FIA y no pretende serlo: el guion del video
    usa el NOMBRE completo, y esto solo rellena el campo."""
    partes = [x for x in (nombre or "").split() if x]
    base = partes[-1] if partes else "???"
    return base[:3].upper()


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sesion", default="Race",
                   help="Race, Sprint o Qualifying (por defecto Race)")
    p.add_argument("--pais", required=True, help='p.ej. "Spain"')
    p.add_argument("--circuito", required=True, help='p.ej. "Madring"')
    p.add_argument("--top", required=True,
                   help='Orden de llegada: "1:Nombre Apellido,2:Otro,..."')
    p.add_argument("--mejor-vuelta", default="",
                   help='Opcional: "Nombre — 1:16.200"')
    p.add_argument("--lluvia", action="store_true",
                   help="Marcar si la carrera fue en mojado")
    p.add_argument("--incidente", action="append", default=[],
                   help="Se puede repetir. Banderas, safety car, abandonos")
    a = p.parse_args()

    top = []
    for trozo in a.top.split(","):
        trozo = trozo.strip()
        if not trozo:
            continue
        if ":" not in trozo:
            print(f"⚠️  '{trozo}' no tiene el formato pos:Nombre — se salta")
            continue
        pos, nombre = trozo.split(":", 1)
        try:
            pos = int(pos.strip())
        except ValueError:
            print(f"⚠️  '{pos}' no es una posición — se salta")
            continue
        nombre = nombre.strip()
        if nombre:
            top.append({"pos": pos, "nombre": nombre,
                        "acr": _acronimo(nombre)})
    if len(top) < 3:
        print("❌ Hacen falta al menos los tres del podio. Nada escrito.")
        return 1
    top.sort(key=lambda x: x["pos"])

    resumen = {
        "sesion": a.sesion, "pais": a.pais, "circuito": a.circuito,
        "top": top,
        "mejor_vuelta": a.mejor_vuelta,
        "clima": {"lluvia": True} if a.lluvia else {},
        "incidentes": [x for x in a.incidente if x.strip()],
        "id": dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M%S"),
        "a_mano": True,       # para saber de dónde salió, si hay que mirar
    }
    os.makedirs(DIR, exist_ok=True)
    ruta = os.path.join(DIR, f"pendiente_{resumen['id']}.json")
    with open(ruta, "w") as f:
        json.dump(resumen, f, ensure_ascii=False, indent=2)

    print(f"✅ {ruta}")
    print(f"   {a.sesion} — {a.pais} ({a.circuito})")
    for t in top[:5]:
        print(f"   {t['pos']}. {t['nombre']}")
    if len(top) > 5:
        print(f"   … y {len(top) - 5} más")
    print(f"   vuelta rápida: {a.mejor_vuelta or 'n/a'}")
    print(f"   incidentes: {len(resumen['incidentes'])}")
    print("\nEl bucle de reseñas lo recoge en menos de dos minutos.")
    print("No hace falta reiniciar el canal.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

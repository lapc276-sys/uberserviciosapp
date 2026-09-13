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


def estado():
    """Por qué no se ha montado la reseña.

    El bucle tiene tres puertas —clave de Claude, OAuth de YouTube y
    ffmpeg— y las tres se cerraban sin decir nada: daba vueltas cada dos
    minutos sin escribir una línea. Desde fuera eso se ve igual que un
    generador roto. Esto las abre una por una y dice cuál falla.
    """
    print("RESUMEN PENDIENTE")
    pend = []
    if os.path.isdir(DIR):
        pend = sorted(a for a in os.listdir(DIR)
                      if a.startswith("pendiente_") and a.endswith(".json"))
    if pend:
        for a in pend:
            extra = ""
            try:
                with open(os.path.join(DIR, a)) as f:
                    d = json.load(f)
                intentos = d.get("intentos", 0)
                extra = (f"  ({d.get('sesion','?')} — {d.get('pais','?')}"
                         + (f", {intentos} intento(s) fallidos" if intentos
                            else "") + ")")
                if intentos >= 3:
                    extra += "  ⚠️  SE RINDIÓ: bórralo y vuelve a crearlo"
            except Exception as e:
                extra = f"  (no se pudo leer: {e})"
            print(f"  ✅ {a}{extra}")
    else:
        print(f"  ❌ no hay ningún pendiente_*.json en {DIR}/")
        print("     Sin eso no hay nada que montar. Créalo con este mismo")
        print("     script (mira --help) o espera a que lo apunte una")
        print("     sesión que SÍ tenga telemetría.")

    print("\nLAS TRES PUERTAS DEL BUCLE")
    ok = True
    if os.environ.get("RESUMEN_AUTO", "on").lower() in ("off", "0", ""):
        print("  ❌ RESUMEN_AUTO está en off — el bucle no arranca")
        ok = False
    else:
        print("  ✅ RESUMEN_AUTO activo")
    if os.environ.get("ANTHROPIC_API_KEY"):
        print("  ✅ ANTHROPIC_API_KEY presente")
    else:
        print("  ❌ falta ANTHROPIC_API_KEY — el bucle SE CIERRA al arrancar")
        ok = False
    faltan = [v for v in ("YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET",
                          "YOUTUBE_REFRESH_TOKEN")
              if not os.environ.get(v)]
    if faltan:
        print("  ❌ OAuth de YouTube incompleto, falta: " + ", ".join(faltan))
        print("     Con esto el bucle da vueltas y NO monta nada.")
        print("     Se arregla corriendo: python3 autorizar_youtube.py")
        ok = False
    else:
        print("  ✅ OAuth de YouTube completo")
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import youtube_subir
        if youtube_subir.ffmpeg_disponible():
            print("  ✅ ffmpeg disponible")
        else:
            print("  ❌ ffmpeg NO disponible — no se puede montar el video")
            ok = False
    except Exception as e:
        print(f"  ⚠️  no pude comprobar ffmpeg ({e})")

    print()
    if pend and ok:
        print("Todo en orden: el bucle lo monta en menos de dos minutos.")
        print("Si aun así no aparece, mira el registro del Repl y busca")
        print("'video-reseña' o 'Recap con muy pocas líneas'.")
    elif not pend:
        print("Falta el resumen pendiente. Eso es lo primero.")
    else:
        print("Arregla las puertas marcadas con ❌ y el bucle lo recogerá")
        print("solo, sin reiniciar.")
    return 0


def main():
    if "--estado" in sys.argv:
        return estado()
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--estado", action="store_true",
                   help="Solo diagnosticar: por qué no se monta la reseña")
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

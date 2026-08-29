"""backtest.py — Pasar el canal entero por carreras que ya ocurrieron.

Para qué sirve
──────────────
Todos los fallos que hemos ido arreglando aparecieron igual: en directo,
con la carrera corriendo, y viéndolos tú en la tele. El mapa cortado, el
cuadro pegado, la miniatura con la última palabra debajo de la insignia
de YouTube. Cada uno costó una carrera.

Esto le da la vuelta: coge carreras que YA pasaron, con sus datos
reales, y hace pasar por ellas todo lo que el canal DIBUJA. Si algo se
rompe con Zandvoort pero no con Monza, sale aquí, un martes, y no en
directo el domingo.

Lo que prueba y lo que no
─────────────────────────
Prueba lo que se puede juzgar sin público: que cada gráfico se dibuja,
que ninguno sale en blanco, que el mapa encuadra, que los textos caben.

NO prueba si un guion es bueno ni si un gancho funciona. Eso no lo dice
ningún backtest — lo dice la gente, publicando. Por eso aquí no se
genera narración ni se gasta un céntimo de la API de Claude.

Cómo se usa
───────────
    python3 backtest.py 2024              # toda la temporada
    python3 backtest.py 2024 Monza Spa    # solo esas
    python3 backtest.py 2024 --n 6        # las seis primeras

Deja todo en backtest/<año>/: un PNG por gráfico, una tira de contacto
por carrera y un informe.json con lo que salió y lo que no.
"""

import asyncio
import contextlib
import json
import logging
import os
import sys
import time

import httpx

import capitulos
import diagramas
import telemetria
import velocidades

log = logging.getLogger("backtest")

DIR = "backtest"

#: Cuántas carreras a la vez. Es el paralelismo que SÍ compra algo: cada
#: carrera es independiente, así que se hacen a la vez y el backtest
#: entero tarda lo que la más lenta. Con más de esto, OpenF1 empieza a
#: contestar con 429 y se tarda más, no menos.
A_LA_VEZ = int(os.environ.get("BACKTEST_A_LA_VEZ", "4"))


async def sesiones_del_año(año, tipo="Race"):
    """Las sesiones de esa temporada, con su clave y su circuito."""
    async with httpx.AsyncClient(timeout=40) as c:
        cab = await telemetria._auth_headers(c)
        try:
            r = await c.get(f"{telemetria.BASE}/sessions",
                            params={"year": año, "session_name": tipo},
                            headers=cab)
            r.raise_for_status()
            filas = r.json()
        except Exception as e:
            log.warning("No pude listar las sesiones de %s (%s)", año, e)
            return []
    return [{"session_key": s.get("session_key"),
             "circuito": (s.get("circuit_short_name") or "").strip(),
             "pais": (s.get("country_name") or "").strip(),
             "fecha": (s.get("date_start") or "")[:10]}
            for s in filas if s.get("session_key")]


async def _una_carrera(ses, año, destino):
    """Dibuja todo lo del canal para una carrera. Devuelve el parte."""
    t0 = time.time()
    nombre = ses["circuito"] or str(ses["session_key"])
    carpeta = os.path.join(destino, nombre.replace("/", "_"))
    with contextlib.suppress(Exception):
        os.makedirs(carpeta, exist_ok=True)
    parte = {"circuito": nombre, "pais": ses["pais"], "fecha": ses["fecha"],
             "session_key": ses["session_key"], "piezas": {}, "fallos": []}

    def _apunta(clave, ruta, motivo=""):
        parte["piezas"][clave] = ruta
        if not ruta:
            parte["fallos"].append(f"{clave}: {motivo or 'no se dibujó'}")

    # 1) El trazado del circuito y sus curvas. Es la pieza de la que
    #    cuelgan el mapa del directo, las curvas y la miniatura.
    trazado = []
    with contextlib.suppress(Exception):
        trazado = await telemetria.trazado_de_circuito(nombre)
    if not trazado:
        _apunta("trazado", None, "sin GPS guardado de este circuito")
    else:
        parte["puntos_trazado"] = len(trazado)
        try:
            import main
            curvas = main.curvas_del_trazado(trazado)
            parte["curvas"] = len(curvas)
            if len(curvas) < 4:
                parte["fallos"].append(
                    f"curvas: solo {len(curvas)} detectadas — el mapa saldrá "
                    "sin apenas referencias")
            _apunta("trazado", main._trazado_png(
                trazado, os.path.join(carpeta, "trazado.png")))
        except Exception as e:
            _apunta("trazado", None, f"reventó dibujando ({e})")

    # 2) El reparto de velocidad punta, por equipo y por piloto.
    for por in ("equipo", "piloto"):
        try:
            ruta, meta, series = await velocidades.grafico(
                os.path.join(carpeta, f"velocidad_{por}.png"),
                session_key=ses["session_key"], por=por,
                tam=diagramas.HORIZ)
            _apunta(f"velocidad_{por}", ruta,
                    f"solo {len(series)} grupos con muestras")
            if por == "equipo":
                parte["equipos"] = len(series)
        except Exception as e:
            _apunta(f"velocidad_{por}", None, f"reventó ({e})")

    # 3) Una hoja de capítulo, para ver que la tipografía cabe con el
    #    nombre de ESTE circuito (los largos son los que se salen).
    with contextlib.suppress(Exception):
        _apunta("capitulo", capitulos.tarjeta(
            3, f"What {nombre} does to a car's setup",
            os.path.join(carpeta, "capitulo.png"), diagramas.HORIZ, total=8))

    parte["segundos"] = round(time.time() - t0, 1)
    parte["ok"] = not parte["fallos"]
    log.info("%s %s — %s (%.0fs)", "✅" if parte["ok"] else "⚠️ ", nombre,
             "todo bien" if parte["ok"] else "; ".join(parte["fallos"][:2]),
             parte["segundos"])
    return parte


async def correr(año, filtro=(), maximo=0):
    """Pasa el backtest por una temporada. Devuelve el informe."""
    destino = os.path.join(DIR, str(año))
    with contextlib.suppress(Exception):
        os.makedirs(destino, exist_ok=True)
    sesiones = await sesiones_del_año(año)
    if filtro:
        aguja = [f.lower() for f in filtro]
        sesiones = [s for s in sesiones
                    if any(a in (s["circuito"] + " " + s["pais"]).lower()
                           for a in aguja)]
    if maximo:
        sesiones = sesiones[:maximo]
    if not sesiones:
        log.warning("Ninguna carrera que probar (¿año o filtro correctos? "
                    "¿responde OpenF1?)")
        return {"año": año, "carreras": [], "resumen": {}}

    log.info("🧪 Backtest de %d carreras de %s, de %d en %d",
             len(sesiones), año, A_LA_VEZ, A_LA_VEZ)
    freno = asyncio.Semaphore(A_LA_VEZ)

    async def _con_freno(s):
        async with freno:
            try:
                return await _una_carrera(s, año, destino)
            except Exception as e:              # que una no tumbe el resto
                log.warning("%s reventó entera (%s)", s["circuito"], e)
                return {"circuito": s["circuito"], "ok": False,
                        "fallos": [f"reventó: {e}"], "piezas": {}}

    partes = await asyncio.gather(*(_con_freno(s) for s in sesiones))
    partes = sorted(partes, key=lambda p: p.get("circuito") or "")
    fallos = [p for p in partes if not p.get("ok")]
    informe = {
        "año": año,
        "carreras": partes,
        "resumen": {
            "probadas": len(partes),
            "sin_problemas": len(partes) - len(fallos),
            "con_avisos": len(fallos),
            # Lo que más se repite es lo que hay que arreglar primero: un
            # fallo en catorce circuitos es del código, no del circuito.
            "avisos_por_tipo": _contar([f.split(":")[0]
                                        for p in partes
                                        for f in p.get("fallos", [])]),
        },
    }
    with contextlib.suppress(Exception):
        with open(os.path.join(destino, "informe.json"), "w") as f:
            json.dump(informe, f, indent=2, ensure_ascii=False)
    return informe


def _contar(xs):
    d = {}
    for x in xs:
        d[x] = d.get(x, 0) + 1
    return dict(sorted(d.items(), key=lambda kv: -kv[1]))


def tira_de_contacto(informe, salida):
    """Todo lo dibujado, en una imagen por carrera puestas en rejilla.

    El informe.json dice qué se rompió; esto enseña qué tal quedó lo que
    NO se rompió, que es la mitad que ningún test automático juzga.
    """
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return None
    piezas = [(p["circuito"], ruta)
              for p in informe.get("carreras", [])
              for ruta in p.get("piezas", {}).values()
              if ruta and os.path.exists(ruta)]
    if not piezas:
        return None
    cw, ch, sep, cab = 480, 270, 8, 22
    cols = 4
    filas = (len(piezas) + cols - 1) // cols
    W = cols * cw + sep * (cols + 1)
    H = filas * (ch + cab) + sep * (filas + 1)
    lienzo = Image.new("RGB", (W, H), "#0A0C11")
    dib = ImageDraw.Draw(lienzo)
    f = diagramas._fuente(15, True)
    for i, (nombre, ruta) in enumerate(piezas):
        x = sep + (i % cols) * (cw + sep)
        y = sep + (i // cols) * (ch + cab + sep)
        with contextlib.suppress(Exception):
            with Image.open(ruta) as im:
                im = im.convert("RGB")
                im.thumbnail((cw, ch))
                lienzo.paste(im, (x + (cw - im.width) // 2, y))
        dib.text((x + 2, y + ch + 3),
                 f"{nombre} · {os.path.basename(ruta)[:26]}", font=f,
                 fill="#8892A3")
    with contextlib.suppress(Exception):
        lienzo.save(salida, "PNG")
        return salida
    return None


if __name__ == "__main__":                      # pragma: no cover
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    if len(sys.argv) < 2:
        print(__doc__.split("Cómo se usa")[1])
        raise SystemExit(2)
    año = int(sys.argv[1])
    resto = sys.argv[2:]
    maximo = 0
    if "--n" in resto:
        i = resto.index("--n")
        maximo = int(resto[i + 1])
        resto = resto[:i] + resto[i + 2:]
    inf = asyncio.run(correr(año, resto, maximo))
    r = inf["resumen"]
    print("\n" + "=" * 60)
    print(f"Probadas {r.get('probadas', 0)} · sin problemas "
          f"{r.get('sin_problemas', 0)} · con avisos {r.get('con_avisos', 0)}")
    for tipo, n in (r.get("avisos_por_tipo") or {}).items():
        print(f"  {n:>3}x  {tipo}")
    tira = tira_de_contacto(inf, os.path.join(DIR, str(año), "tira.png"))
    if tira:
        print(f"\nTira de contacto: {tira}")
    print(f"Informe: {os.path.join(DIR, str(año), 'informe.json')}")

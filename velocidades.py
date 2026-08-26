"""velocidades.py — El reparto de velocidades punta, dibujado por nosotros.

De dónde sale esto
──────────────────
Circulan por ahí unos gráficos muy buenos de reparto de velocidad punta
por equipo. Están marcados con el nombre de quien los hace y no se
pueden reutilizar: son SU trabajo. Pero el gráfico no es de nadie —lo
que hay debajo es el dato de la trampa de velocidad, que la F1 publica
vuelta a vuelta y que OpenF1 sirve— así que lo que sí se puede hacer es
lo mismo: bajar el dato, calcularlo y dibujarlo con la cara del canal.

Por qué el reparto y no la máxima
─────────────────────────────────
La tabla de máximas premia una vuelta con rebufo. El reparto enseña
DÓNDE VIVE cada coche: si un equipo aparece siempre entre 328 y 332 y
otro entre 318 y 336, el segundo no es más rápido, es más irregular —
normalmente porque uno de sus dos coches va cazando rebufos. Eso es
exactamente lo que el comentarista puede contar y la tabla no.

Qué se mide
───────────
`st_speed` de /laps: la lectura de la trampa de velocidad de esa vuelta,
en km/h. Una por piloto y vuelta. Se descartan las vueltas de salida de
boxes (el coche va lanzándose, no es su punta real) y las lecturas
absurdas. No se inventa ni se rellena nada: si un equipo no tiene
muestras suficientes, no sale en el gráfico.
"""

import logging
import os

import httpx

import diagramas
from telemetria import BASE, _auth_headers

log = logging.getLogger("velocidades")

#: Menos de esto por equipo y no se dibuja: una silueta hecha con cuatro
#: lecturas insinúa una forma que los datos no sostienen.
MINIMO_MUESTRAS = 8

#: Lecturas fuera de este rango son ruido del cronometraje, no coches.
RANGO_KMH = (120.0, 400.0)

#: OpenF1 devuelve el nombre inscrito ("Haas F1 Team", "Kick Sauber");
#: en pantalla se usa el nombre con el que los llama el comentarista,
#: que además cabe en la columna sin recortarse.
CORTO = {
    "red bull racing": "Red Bull",
    "oracle red bull racing": "Red Bull",
    "haas f1 team": "Haas",
    "moneygram haas f1 team": "Haas",
    "kick sauber": "Sauber",
    "stake f1 team kick sauber": "Sauber",
    "rb": "Racing Bulls",
    "visa cash app rb": "Racing Bulls",
    "racing bulls": "Racing Bulls",
    "alphatauri": "AlphaTauri",
    "alfa romeo": "Alfa Romeo",
    "aston martin": "Aston Martin",
    "alpine": "Alpine",
}


def _nombre_corto(equipo):
    """El nombre de pantalla de un equipo, sin patrocinadores delante."""
    e = (equipo or "").strip()
    return CORTO.get(e.lower(), e)


async def _traer(client, cab, ruta, **params):
    """Una lista de OpenF1, o [] si la petición no sale bien."""
    try:
        r = await client.get(f"{BASE}{ruta}", params=params, headers=cab,
                             timeout=40)
        r.raise_for_status()
        d = r.json()
        return d if isinstance(d, list) else []
    except Exception as e:
        log.info("OpenF1 %s no respondió (%s)", ruta, e)
        return []


async def clave_de_sesion(client, cab, año, gp, tipo="Race"):
    """session_key de una sesión concreta, buscando el GP por nombre.

    `gp` se compara en minúsculas contra el país, la localidad y el
    nombre corto del circuito, que es como OpenF1 la nombra según el
    caso.
    """
    ses = await _traer(client, cab, "/sessions", year=año, session_name=tipo)
    if not ses:
        return None
    aguja = (gp or "").strip().lower()
    if not aguja:
        return ses[-1].get("session_key")
    for s in ses:
        campos = " ".join(str(s.get(k, "")) for k in (
            "country_name", "location", "circuit_short_name",
            "meeting_official_name")).lower()
        if aguja in campos:
            return s.get("session_key")
    return None


async def muestras(session_key="latest", por="equipo"):
    """Las lecturas de la trampa de velocidad de una sesión, agrupadas.

    Devuelve (meta, grupos):
      meta   = {"circuito", "sesion", "año"}
      grupos = [{"nombre", "valores", "color", "nota"}] listo para
               `diagramas.reparto`.
    """
    async with httpx.AsyncClient(timeout=40) as client:
        cab = await _auth_headers(client)
        pilotos = await _traer(client, cab, "/drivers",
                               session_key=session_key)
        vueltas = await _traer(client, cab, "/laps", session_key=session_key)
        sesiones = await _traer(client, cab, "/sessions",
                                session_key=session_key)

    if not pilotos or not vueltas:
        return {}, []

    ficha = {}
    for p in pilotos:
        n = p.get("driver_number")
        if n is None:
            continue
        ficha[int(n)] = {
            "equipo": (p.get("team_name") or "").strip(),
            "piloto": (p.get("full_name") or p.get("broadcast_name")
                       or p.get("name_acronym") or "").strip(),
            "sigla": (p.get("name_acronym") or "").strip(),
            "color": "#" + (p.get("team_colour") or "").lstrip("#"),
        }

    grupos = {}
    lo, hi = RANGO_KMH
    for v in vueltas:
        if v.get("is_pit_out_lap"):
            continue
        try:
            kmh = float(v.get("st_speed"))
            num = int(v.get("driver_number"))
        except (TypeError, ValueError):
            continue
        if not lo <= kmh <= hi:
            continue
        f = ficha.get(num)
        if not f:
            continue
        clave = (_nombre_corto(f["equipo"]) if por == "equipo"
                 else (f["sigla"] or f["piloto"]))
        if not clave:
            continue
        g = grupos.setdefault(clave, {"valores": [], "color": f["color"],
                                      "coches": set()})
        g["valores"].append(kmh)
        g["coches"].add(num)

    series = []
    for nombre, g in grupos.items():
        if len(g["valores"]) < MINIMO_MUESTRAS:
            continue
        n = len(g["valores"])
        series.append({
            "nombre": nombre,
            "valores": g["valores"],
            "color": g["color"] if diagramas._rgb(g["color"]) else None,
            "nota": f"{n} laps" + (f" · {len(g['coches'])} cars"
                                   if por == "equipo" else ""),
        })

    s = sesiones[0] if sesiones else {}
    meta = {
        "circuito": (s.get("circuit_short_name") or s.get("location")
                     or "").strip(),
        "sesion": (s.get("session_name") or "").strip(),
        "año": s.get("year") or "",
    }
    return meta, series


async def grafico(salida, session_key="latest", por="equipo",
                  tam=diagramas.HORIZ, titulo=None, meta_series=None):
    """Dibuja el reparto y devuelve (ruta, meta, series) — o (None, ...).

    `meta_series` permite reutilizar unos datos ya traídos (por ejemplo
    para sacar la versión vertical sin volver a pedir la sesión entera).
    """
    if meta_series is None:
        meta, series = await muestras(session_key, por)
    else:
        meta, series = meta_series
    if len(series) < 2:
        log.info("Sin muestras suficientes para el reparto de velocidades")
        return None, meta, series

    # El circuito va en la etiqueta y no en el título: en apaisado un
    # título de dos líneas se come la mitad del gráfico, y las filas se
    # quedan sin alto para su letra.
    sesion = (meta.get("sesion") or "").strip()
    sitio = " ".join(x for x in (meta.get("circuito") or "",
                                 str(meta.get("año") or "")) if x).strip()
    etiqueta = " · ".join(x for x in (sitio, sesion) if x).upper() or "MEASURED"
    if titulo is None:
        titulo = "Top speed spread"
    # El pie va a UNA línea a propósito: cada línea de más le roba alto a
    # las filas, y con diez equipos ese alto es la legibilidad.
    total = sum(len(s["valores"]) for s in series)
    pie = f"Our own chart · {total} speed-trap readings · Data: OpenF1"

    ruta = diagramas.reparto(
        salida, titulo, series, eje_x="Speed trap", unidad="km/h",
        pie=pie, etiqueta=etiqueta, tam=tam, decimales=0)
    return ruta, meta, series


async def grafico_carrera(salida, año, gp, tipo="Race", **kw):
    """El mismo gráfico, buscando la sesión por año y Gran Premio."""
    async with httpx.AsyncClient(timeout=40) as client:
        cab = await _auth_headers(client)
        sk = await clave_de_sesion(client, cab, año, gp, tipo)
    if not sk:
        log.info("No encontré la sesión %s %s %s", año, gp, tipo)
        return None, {}, []
    return await grafico(salida, session_key=sk, **kw)


if __name__ == "__main__":                      # pragma: no cover
    import asyncio
    import sys
    logging.basicConfig(level=logging.INFO)
    año = int(sys.argv[1]) if len(sys.argv) > 1 else 2024
    gp = sys.argv[2] if len(sys.argv) > 2 else "Monza"
    destino = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "reparto_velocidad.png")
    r, meta, series = asyncio.run(grafico_carrera(destino, año, gp))
    print(r, meta, [(s["nombre"], len(s["valores"])) for s in series])

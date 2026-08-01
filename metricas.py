"""Curva de vistas de cada short, medida por nosotros.

Responde a una pregunta concreta: ¿las vistas BAJAN de verdad después de
publicar, o solo se frena el ritmo?

Son cosas muy distintas. El total de vistas es acumulativo y normalmente
solo sube; lo que casi siempre pasa es que el ritmo se desploma tras el
empujón inicial. Pero YouTube TAMBIÉN revisa y descarta vistas que
considera inválidas, y entonces el número sí puede bajar. Con una muestra
cada media hora se distingue una cosa de la otra sin adivinar.

Solo necesita YOUTUBE_API_KEY (estadísticas públicas), no el OAuth. Cuesta
1 unidad de cuota por consulta y se piden hasta 50 videos de golpe, así
que el gasto es despreciable frente a las ~1600 de cada subida.
"""

import contextlib
import datetime as dt
import json
import logging
import os

import httpx

log = logging.getLogger("metricas")

DIR = "metricas"
ARCHIVO = os.path.join(DIR, "vistas.json")
_API = "https://www.googleapis.com/youtube/v3"
# Cada cuánto se toma una muestra. Media hora da resolución de sobra para
# ver la forma de la curva sin llenar el disco de puntos.
CADA_S = int(os.environ.get("METRICAS_CADA", "1800") or 1800)
# Cuánto tiempo se sigue midiendo un short. Pasada una semana la curva ya
# no cambia y solo gastaría cuota.
DIAS_SEGUIMIENTO = 7


def _ahora():
    return dt.datetime.now(dt.timezone.utc)


def cargar():
    with contextlib.suppress(Exception):
        with open(ARCHIVO, encoding="utf-8") as f:
            return json.load(f)
    return {}


def guardar(datos):
    with contextlib.suppress(Exception):
        os.makedirs(DIR, exist_ok=True)
        with open(ARCHIVO, "w", encoding="utf-8") as f:
            json.dump(datos, f, ensure_ascii=False, indent=1)


async def estadisticas(ids, api_key):
    """{video_id: {vistas, likes, comentarios}} para hasta 50 ids por
    llamada. {} si no hay clave o falla — nunca lanza."""
    if not (ids and api_key):
        return {}
    salida = {}
    async with httpx.AsyncClient() as c:
        for i in range(0, len(ids), 50):
            lote = ids[i:i + 50]
            try:
                r = await c.get(f"{_API}/videos", params={
                    "part": "statistics", "id": ",".join(lote),
                    "key": api_key}, timeout=25)
                r.raise_for_status()
                for it in r.json().get("items", []):
                    s = it.get("statistics", {})
                    salida[it["id"]] = {
                        "vistas": int(s.get("viewCount", 0) or 0),
                        "likes": int(s.get("likeCount", 0) or 0),
                        "comentarios": int(s.get("commentCount", 0) or 0),
                    }
            except Exception as e:
                log.info("Estadísticas de YouTube no disponibles (%s)", e)
    return salida


def registrar(datos, publicados, stats):
    """Añade una muestra por video. `publicados` es {video_id: (sid, iso)}."""
    t = _ahora().isoformat()
    nuevos = 0
    for vid, s in stats.items():
        sid, publicado = publicados.get(vid, (None, None))
        reg = datos.setdefault(vid, {"short": sid, "publicado": publicado,
                                     "muestras": []})
        m = reg["muestras"]
        # Si nada cambió desde la última muestra, no se apunta otra igual:
        # la curva se lee mejor y el archivo no crece sin motivo.
        if m and (m[-1][1], m[-1][2], m[-1][3]) == (s["vistas"], s["likes"],
                                                    s["comentarios"]):
            continue
        m.append([t, s["vistas"], s["likes"], s["comentarios"]])
        nuevos += 1
    return nuevos


def _horas(a, b):
    with contextlib.suppress(Exception):
        ta = dt.datetime.fromisoformat(a)
        tb = dt.datetime.fromisoformat(b)
        return (tb - ta).total_seconds() / 3600.0
    return None


def analizar(reg):
    """Resumen legible de un short: cuánto hizo en la primera hora, en 24 h,
    y —lo que importa— si el contador llegó a BAJAR alguna vez."""
    m = reg.get("muestras") or []
    if not m:
        return None
    publicado = reg.get("publicado") or m[0][0]
    ultima = m[-1]
    primera_hora = ultimas_24 = None
    for t, v, _l, _c in m:
        h = _horas(publicado, t)
        if h is None:
            continue
        if h <= 1.15 and (primera_hora is None or v > primera_hora):
            primera_hora = v
        if h <= 24.5 and (ultimas_24 is None or v > ultimas_24):
            ultimas_24 = v
    # Bajadas: el dato que responde a la pregunta
    bajadas = [{"cuando": m[i][0], "de": m[i - 1][1], "a": m[i][1]}
               for i in range(1, len(m)) if m[i][1] < m[i - 1][1]]
    pico = max(v for _t, v, _l, _c in m)
    return {
        "short": reg.get("short"),
        "publicado": publicado,
        "muestras": len(m),
        "vistas": ultima[1],
        "likes": ultima[2],
        "comentarios": ultima[3],
        "primera_hora": primera_hora,
        "primeras_24h": ultimas_24,
        # Qué parte del total llegó en la primera hora: si es casi todo, el
        # short vivió del empujón inicial y no consiguió segunda ola.
        # Se divide por el PICO, no por las vistas de ahora: si YouTube
        # retiró vistas después, dividir por el valor actual daba
        # porcentajes por encima de 100, que no significan nada.
        "porcentaje_primera_hora": (round(100 * primera_hora / pico, 1)
                                    if primera_hora and pico else None),
        "pico": pico,
        "bajadas": bajadas,
        "perdidas": pico - ultima[1] if pico > ultima[1] else 0,
    }


def resumen(datos=None):
    """Analiza todos los shorts seguidos, del más nuevo al más viejo."""
    datos = cargar() if datos is None else datos
    filas = [a for a in (analizar(r) for r in datos.values()) if a]
    filas.sort(key=lambda f: f.get("publicado") or "", reverse=True)
    con_bajada = [f for f in filas if f["bajadas"]]
    total_perdidas = sum(f["perdidas"] for f in filas)
    pcts = [f["porcentaje_primera_hora"] for f in filas
            if f["porcentaje_primera_hora"] is not None]
    return {
        "shorts_seguidos": len(filas),
        # La respuesta directa: ¿el contador baja de verdad?
        "shorts_con_bajada_real": len(con_bajada),
        "vistas_retiradas_por_youtube": total_perdidas,
        "media_porcentaje_primera_hora": (round(sum(pcts) / len(pcts), 1)
                                          if pcts else None),
        "shorts": filas,
    }


def en_seguimiento(publicado):
    """¿Sigue mereciendo la pena medir este short?"""
    h = _horas(publicado, _ahora().isoformat())
    return h is None or h <= DIAS_SEGUIMIENTO * 24

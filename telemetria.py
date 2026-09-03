"""
telemetria.py — Datos de carrera desde OpenF1 (https://openf1.org).

Modo repetición (replay): descarga la telemetría de una carrera ya
disputada y la reproduce al ritmo original (o acelerada), emitiendo
eventos narrables como si la carrera estuviera pasando en vivo:

  - adelantamientos (cambios de posición en el top 10)
  - paradas en boxes
  - mensajes de dirección de carrera (banderas, safety car, incidentes)
  - vueltas rápidas

Mantiene además el estado de carrera (vuelta actual, posiciones) para
darle contexto al narrador.
"""

import asyncio
import datetime as dt
import logging
import math
import os
import random
import re
import time

import httpx

log = logging.getLogger("telemetria")

BASE = "https://api.openf1.org/v1"
TOKEN_URL = "https://api.openf1.org/token"
JOLPICA = "https://api.jolpi.ca/ergast/f1"

# OpenF1 ahora exige cuenta (de pago) para datos en tiempo real; los
# históricos siguen gratis. Con los Secrets OPENF1_USERNAME/OPENF1_PASSWORD
# se autentican todas las llamadas. Sin cuenta, se usa el modo gratis y el
# calendario cae a Jolpica (gratis) si OpenF1 rechaza la petición.
_token = {"valor": "", "hasta": 0.0}


async def _auth_headers(client):
    """Bearer de OpenF1 si hay cuenta configurada; {} en modo gratis."""
    usuario = os.environ.get("OPENF1_USERNAME", "")
    clave = os.environ.get("OPENF1_PASSWORD", "")
    if not (usuario and clave):
        return {}
    ahora = time.time()
    if _token["valor"] and ahora < _token["hasta"]:
        return {"Authorization": f"Bearer {_token['valor']}"}
    try:
        r = await client.post(TOKEN_URL, data={"username": usuario,
                                               "password": clave},
                              timeout=20)
        r.raise_for_status()
        d = r.json()
        _token["valor"] = d.get("access_token", "")
        _token["hasta"] = ahora + float(d.get("expires_in", 3600) or 3600) - 60
        if _token["valor"]:
            log.info("🔑 Autenticado con OpenF1 (token ~1 h)")
    except Exception as e:
        log.warning("No se pudo obtener el token de OpenF1 (%s)", e)
        return {}
    return ({"Authorization": f"Bearer {_token['valor']}"}
            if _token["valor"] else {})


def _fecha(texto):
    return dt.datetime.fromisoformat(texto.replace("Z", "+00:00"))


def _seg(valor):
    """Formatea segundos como texto narrable: 83.456 -> 'un minuto 23.5'."""
    if valor is None:
        return ""
    m, s = divmod(float(valor), 60)
    if m >= 1:
        return f"{int(m)} minute{'s' if m >= 2 else ''} {s:.1f} seconds"
    return f"{s:.1f} seconds"


#: Sobre cuántos segundos del final se mide el CAMBIO de velocidad. Con
#: dos muestras sueltas el número baila (el coche manda a 3,7 Hz y hay
#: ruido); con toda la ventana se promedia una recta con una frenada y
#: sale casi cero. Segundo y medio es una frenada o una salida de curva
#: entera, que es justo lo que se quiere leer.
VENTANA_CAMBIO = 1.5


def _resumen_traza(muestras, puntos=40):
    """Qué está haciendo un coche, a partir de sus muestras de /car_data.

    Devuelve la velocidad de ahora, el máximo y el mínimo de la ventana,
    a cuántos km/h por segundo está cambiando, y cuánto de la ventana
    lleva a fondo o frenando. La serie sale submuestreada porque el
    dibujo tiene ciento y pico píxeles de ancho y no le caben trescientas
    muestras.
    """
    if len(muestras) < 4:
        return None
    t0 = muestras[0]["t"]
    seg = [( (m["t"] - t0).total_seconds(), m) for m in muestras]
    fin = seg[-1][0]
    # El cambio, solo con la cola: ver más arriba por qué segundo y medio.
    cola = [(s, m["v"]) for s, m in seg if s >= fin - VENTANA_CAMBIO]
    cambio = _pendiente(cola) if len(cola) >= 3 else 0.0
    vs = [m["v"] for m in muestras]
    n = len(vs)
    paso = max(1, n // puntos)
    return {
        "v": round(vs[-1]),
        "vmax": round(max(vs)),
        "vmin": round(min(vs)),
        # km/h por segundo. Positivo = acelerando.
        "cambio": round(cambio, 1),
        "gas": round(100 * sum(1 for m in muestras if m["gas"] >= 90) / n),
        "freno": round(100 * sum(1 for m in muestras if m["freno"]) / n),
        "serie": [round(v) for v in vs[::paso]][:puntos],
        "muestras": n,
    }


def _pendiente(puntos):
    """Pendiente por mínimos cuadrados de [(x, y)] — s por vuelta."""
    n = len(puntos)
    sx = sum(x for x, _ in puntos)
    sy = sum(y for _, y in puntos)
    sxx = sum(x * x for x, _ in puntos)
    sxy = sum(x * y for x, y in puntos)
    d = n * sxx - sx * sx
    return (n * sxy - sx * sy) / d if d else 0.0


# Duración estimada por tipo de sesión (minutos) para la ventana de aire
_DURACION = {"Race": 135, "Sprint": 70, "Qualifying": 80,
             "Sprint Qualifying": 80, "Practice 1": 80, "Practice 2": 80,
             "Practice 3": 80}


# Sesiones del fin de semana en el calendario de Jolpica (formato Ergast)
_SESIONES_JOLPICA = [("FirstPractice", "Practice 1"),
                     ("SecondPractice", "Practice 2"),
                     ("ThirdPractice", "Practice 3"),
                     ("SprintQualifying", "Sprint Qualifying"),
                     ("Sprint", "Sprint"),
                     ("Qualifying", "Qualifying")]


async def _sesiones_jolpica():
    """Calendario de respaldo (gratis, sin cuenta) desde Jolpica cuando
    OpenF1 no responde. No trae session_key de OpenF1, así que se usa
    'latest': durante la sesión en vivo apunta a la sesión en curso."""
    out = []
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{JOLPICA}/current.json",
                             params={"limit": 100}, timeout=30)
        r.raise_for_status()
        carreras = (r.json().get("MRData", {}).get("RaceTable", {})
                    .get("Races", []))
    for c in carreras:
        circ = c.get("Circuit", {})
        pais = circ.get("Location", {}).get("country", "?")
        circuito = circ.get("circuitName", "?")
        eventos = [(nombre, c.get(clave)) for clave, nombre in
                   _SESIONES_JOLPICA if c.get(clave, {}).get("date")]
        if c.get("date"):
            eventos.append(("Race", {"date": c["date"],
                                     "time": c.get("time") or "12:00:00Z"}))
        for nombre, ev in eventos:
            hora = ev.get("time") or "12:00:00Z"
            try:
                inicio = dt.datetime.fromisoformat(
                    f"{ev['date']}T{hora}".replace("Z", "+00:00"))
            except ValueError:
                continue
            dur = _DURACION.get(nombre, 80)
            out.append({"session_key": "latest", "sesion": nombre,
                        "pais": pais, "circuito": circuito, "inicio": inicio,
                        "fin": inicio + dt.timedelta(minutes=dur)})
    out.sort(key=lambda s: s["inicio"])
    return out


async def sesiones_programables():
    """Todas las sesiones del año con inicio/fin (UTC) y su clave, para
    que el director sepa cuándo poner cada carrera al aire. Datos reales;
    si OpenF1 no responde (ahora exige cuenta para tiempo real), cae al
    calendario gratis de Jolpica. Lista vacía solo si fallan ambos."""
    ahora = dt.datetime.now(dt.timezone.utc)
    out = []
    sesiones = []
    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(f"{BASE}/sessions",
                                 params={"year": ahora.year}, timeout=30,
                                 headers=await _auth_headers(client))
            r.raise_for_status()
            sesiones = r.json()
        except Exception as e:
            log.info("OpenF1 sin calendario (%s) — probando Jolpica", e)
    if not sesiones:
        try:
            out = await _sesiones_jolpica()
            if out:
                log.info("📅 Calendario cargado desde Jolpica (respaldo "
                         "gratis, %d sesiones)", len(out))
            return out
        except Exception as e:
            log.warning("Jolpica tampoco respondió (%s)", e)
            return []
    for s in sesiones:
        if not s.get("date_start"):
            continue
        inicio = _fecha(s["date_start"])
        dur = _DURACION.get(s.get("session_name"), 80)
        out.append({
            "session_key": s["session_key"],
            "sesion": s.get("session_name", "?"),
            "pais": s.get("country_name", "?"),
            "circuito": s.get("circuit_short_name", "?"),
            "inicio": inicio,
            "fin": inicio + dt.timedelta(minutes=dur),
        })
    out.sort(key=lambda s: s["inicio"])
    return out


async def proximas_sesiones(n=5):
    """Próximas sesiones de F1 (libres, clasificación, carrera) desde
    OpenF1, con respaldo gratis en Jolpica. Lista real y verificable;
    vacía si no hay datos — nunca se inventa una fecha."""
    ahora = dt.datetime.now(dt.timezone.utc)
    sesiones = []
    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(f"{BASE}/sessions",
                                 params={"year": ahora.year}, timeout=30,
                                 headers=await _auth_headers(client))
            r.raise_for_status()
            sesiones = r.json()
        except Exception:
            pass
    futuras = [s for s in sesiones
              if s.get("date_start") and _fecha(s["date_start"]) > ahora]
    futuras.sort(key=lambda s: s["date_start"])
    if futuras:
        return futuras[:n]
    # Respaldo: mismo formato que OpenF1, construido desde Jolpica
    try:
        todas = await _sesiones_jolpica()
    except Exception:
        return []
    return [{"country_name": s["pais"], "session_name": s["sesion"],
             "circuit_short_name": s["circuito"],
             "date_start": s["inicio"].isoformat()}
            for s in todas if s["inicio"] > ahora][:n]


async def carreras_clasicas(n=15):
    """Carreras reales ya disputadas (temporadas recientes) para rotar
    como maratón de 'clásicos' cuando no hay nada en vivo. Nunca inventa
    nada — solo reordena al azar carreras que sí ocurrieron."""
    ahora = dt.datetime.now(dt.timezone.utc)
    candidatas = []
    async with httpx.AsyncClient() as client:
        for año in (ahora.year, ahora.year - 1, ahora.year - 2):
            try:
                r = await client.get(f"{BASE}/sessions",
                                     params={"session_type": "Race",
                                            "year": año}, timeout=30,
                                     headers=await _auth_headers(client))
                r.raise_for_status()
                for s in r.json():
                    if (s.get("session_name") == "Race"
                            and s.get("date_start")
                            and _fecha(s["date_start"]) < ahora):
                        candidatas.append(s)
            except Exception:
                continue
    random.shuffle(candidatas)
    return candidatas[:n]


# ── Trazado del circuito ─────────────────────────────────────────────────
# El mapa en vivo se dibujaba con el GPS de la sesión EN CURSO. Eso tiene un
# problema que se ve en pantalla: al empezar una sesión todavía nadie ha
# dado una vuelta, así que la pista no existe y se iba dibujando conforme
# los coches rodaban. Queda cutre y confunde a quien llega a mitad de
# emisión. Lo de abajo trae la forma COMPLETA de antes de empezar, sacada de
# una sesión ya disputada en el mismo circuito.


def _limites_iqr(vals):
    """Rango razonable de una coordenada, por cuartiles. Un solo punto
    imposible dispara el bounding box y colapsa el circuito a una raya."""
    v = sorted(vals)
    n = len(v)
    q1, q3 = v[n // 4], v[(3 * n) // 4]
    iqr = (q3 - q1) or 1
    return q1 - 3 * iqr, q3 + 3 * iqr


def _es_vuelta_real(pts):
    """Descarta trazas DEGENERADAS: coches en parrilla, en el pit lane o
    dando una recta producen puntos casi COLINEALES, y dibujarlos deja el
    mapa como una raya. Se mide la dispersión perpendicular a la dirección
    dominante (ejes principales), así funciona en cualquier orientación —
    también en diagonal."""
    n = len(pts)
    if n < 20:
        return False
    mx = sum(p[0] for p in pts) / n
    my = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - mx) ** 2 for p in pts) / n
    syy = sum((p[1] - my) ** 2 for p in pts) / n
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts) / n
    # Autovalores de la matriz de covarianza 2x2
    tr = sxx + syy
    det = math.sqrt(max(0.0, (sxx - syy) ** 2 + 4 * sxy * sxy))
    lmax, lmin = (tr + det) / 2, (tr - det) / 2
    if lmax <= 0:
        return False
    # Relación entre el ancho del trazo y su largo. Un circuito real (incluso
    # uno alargado como Monza) queda muy por encima de 0.12; una parrilla o
    # un pit lane, muy por debajo.
    return math.sqrt(max(0.0, lmin) / lmax) >= 0.12


def _limpiar_traza(crudos):
    """Convierte filas de /location en un trazado dibujable, o []."""
    puntos = [(f["x"], f["y"]) for f in crudos
              if isinstance(f.get("x"), (int, float))
              and isinstance(f.get("y"), (int, float))
              and (f["x"], f["y"]) != (0, 0)]
    if len(puntos) < 50:
        return []
    xlo, xhi = _limites_iqr([p[0] for p in puntos])
    ylo, yhi = _limites_iqr([p[1] for p in puntos])
    puntos = [(x, y) for x, y in puntos
              if xlo <= x <= xhi and ylo <= y <= yhi]
    if len(puntos) < 50 or not _es_vuelta_real(puntos):
        return []
    paso = max(1, len(puntos) // 500)
    return [{"x": x, "y": y} for x, y in puntos[::paso]]


def clave_circuito(nombre):
    """'Spa-Francorchamps' y 'spa francorchamps' son el mismo circuito."""
    return re.sub(r"[^a-z0-9]+", "", (nombre or "").lower())


async def _trazado_de_sesion(client, cab, sesion):
    """Una vuelta buena sacada de una sesión concreta. [] si no la hay."""
    sk = sesion.get("session_key")
    if not sk or not sesion.get("date_start"):
        return []
    try:
        ini = _fecha(sesion["date_start"])
    except Exception:
        return []
    fin = None
    try:
        fin = _fecha(sesion["date_end"]) if sesion.get("date_end") else None
    except Exception:
        fin = None
    # Ventana a MITAD de sesión: al principio están en boxes o en la parrilla
    # y al final puede haber bandera roja, vuelta de honor o coches parados.
    if fin and (fin - ini) > dt.timedelta(minutes=20):
        centro = ini + (fin - ini) / 2
    else:
        centro = ini + dt.timedelta(minutes=25)
    desde = (centro - dt.timedelta(minutes=4)).isoformat()
    hasta = (centro + dt.timedelta(minutes=4)).isoformat()
    try:
        r = await client.get(f"{BASE}/drivers", params={"session_key": sk},
                             timeout=30, headers=cab)
        r.raise_for_status()
        numeros = [d["driver_number"] for d in r.json()
                   if d.get("driver_number")]
    except Exception as e:
        log.info("Trazado: sesión %s sin pilotos (%s)", sk, e)
        return []
    for num in numeros[:6]:
        await asyncio.sleep(0.6)     # la API gratuita limita el ritmo
        try:
            r = await client.get(
                f"{BASE}/location?session_key={sk}&driver_number={num}"
                f"&date>{desde}&date<{hasta}", timeout=40, headers=cab)
            r.raise_for_status()
            traza = _limpiar_traza(r.json())
        except Exception:
            continue
        if traza:
            return traza
    return []


async def trazado_de_circuito(circuito, años=3, sesiones=4):
    """Trazado COMPLETO de un circuito, sacado de una sesión YA DISPUTADA.

    Se usa para tener la pista dibujada ANTES de que empiece la sesión en
    vivo, en vez de irla pintando conforme los coches ruedan.

    Devuelve [{"x","y"}] en las mismas unidades que /location (las que el
    mapa ya sabe encuadrar), o [] si no se pudo.
    """
    clave = clave_circuito(circuito)
    if not clave:
        return []
    ahora = dt.datetime.now(dt.timezone.utc)
    # Carrera antes que clasificación antes que libres: cuanto más completa
    # la sesión, más probable que alguien haya dado una vuelta limpia.
    orden = {"Race": 0, "Sprint": 1, "Qualifying": 2,
             "Sprint Qualifying": 3, "Sprint Shootout": 3}
    candidatas = []
    async with httpx.AsyncClient() as client:
        cab = await _auth_headers(client)
        for año in range(ahora.year, ahora.year - max(1, años), -1):
            try:
                r = await client.get(f"{BASE}/sessions", params={"year": año},
                                     timeout=30, headers=cab)
                r.raise_for_status()
                filas = r.json()
            except Exception as e:
                log.info("Trazado: no pude listar las sesiones de %d (%s)",
                         año, e)
                continue
            for s in filas:
                if clave_circuito(s.get("circuit_short_name")) != clave:
                    continue
                if not s.get("date_start"):
                    continue
                try:
                    if _fecha(s["date_start"]) >= ahora:
                        continue      # aún no ha ocurrido: no tiene GPS
                except Exception:
                    continue
                candidatas.append(s)
            # Con el año más reciente que tenga sesiones basta: un circuito
            # puede haber cambiado de trazado y queremos el de ahora.
            if candidatas:
                break
        if not candidatas:
            log.info("Trazado: OpenF1 no tiene ninguna sesión pasada en %s",
                     circuito)
            return []
        candidatas.sort(key=lambda s: (orden.get(s.get("session_name"), 5),
                                       -_fecha(s["date_start"]).timestamp()))
        for s in candidatas[:max(1, sesiones)]:
            traza = await _trazado_de_sesion(client, cab, s)
            if traza:
                log.info("🗺️  Trazado de %s sacado de %s %s (%d puntos)",
                         circuito, s.get("year") or "",
                         s.get("session_name") or "", len(traza))
                return traza
    log.info("Trazado: ninguna sesión pasada de %s dio una vuelta limpia",
             circuito)
    return []


class Telemetria:
    def __init__(self, session_key="latest", velocidad=1.0):
        self.session_key = session_key
        self.velocidad = max(0.1, float(velocidad))
        self.sesion = {}
        self.pilotos = {}     # numero -> {"nombre", "equipo"}
        self.posiciones = {}  # numero -> posición actual
        self.vuelta = 0
        self.total_vueltas = 0
        self.mejor_vuelta = None  # (duración, numero de piloto)
        self.incidentes = []      # últimos avisos de dirección de carrera
        self.gaps = {}            # numero -> intervalo con el coche de delante
        self.gaps_anteriores = {} # numero -> intervalo de la lectura previa
        self.ultimo_pit = None    # {"vuelta", "nombre"} de la última parada
        self.neumaticos = {}      # numero -> {"compuesto", "vueltas", "desde"}
        self.clima = {}           # {"aire", "pista"}
        self._stints = []         # stints ordenados por vuelta de inicio
        self._vueltas = {}        # numero -> [{"n", "dur", "out"}] cronológico
        self._pit_laps = {}       # numero -> {vueltas en las que entró a boxes}
        self.velocidades = {}     # numero -> [km/h de la trampa, por vuelta]
        self._gaps_vuelta = {}    # numero -> {vuelta: hueco mínimo esa vuelta}
        self._pits = []           # [{"numero", "vuelta"}] paradas ya ocurridas
        # timeline: lista de (fecha, tipo, dato) ordenada por fecha
        self._timeline = []
        self.fecha_actual = None  # última fila procesada (avanza a saltos)
        self._ancla_datos = None  # inicio de datos del tramo en reproducción
        self._ancla_real = 0.0    # monotonic al arrancar ese tramo

    # ---------- descarga ----------

    async def _get(self, client, path, **params):
        """GET con reintentos: la API gratuita de OpenF1 limita el ritmo.
        Si hay cuenta de OpenF1 (Secrets), va autenticado."""
        for intento in range(6):
            r = await client.get(BASE + path, params=params, timeout=60,
                                 headers=await _auth_headers(client))
            if r.status_code == 401:
                log.warning("OpenF1 rechazó la petición (%s): los datos en "
                            "tiempo real ahora requieren cuenta de pago "
                            "(Secrets OPENF1_USERNAME/OPENF1_PASSWORD)", path)
                r.raise_for_status()
            if r.status_code != 429:
                r.raise_for_status()
                return r.json()
            espera = float(r.headers.get("retry-after", 0) or 0) or 2 ** intento
            log.info("OpenF1 pide esperar (%s) — reintento en %.0fs",
                     path, espera)
            await asyncio.sleep(espera)
        r.raise_for_status()

    async def cargar(self):
        async with httpx.AsyncClient() as client:
            sesion = await self._elegir_sesion(client)
            sk = sesion["session_key"]
            self.sesion = sesion
            # De uno en uno y con pausa: la API gratuita limita el ritmo.
            # Un 404 en un dato secundario (intervals, stints...) no debe
            # tumbar la sesión: se sigue sin ese dato — en unos libres en
            # curso muchos endpoints aún no tienen contenido.
            datos = {}
            for endpoint in ("/drivers", "/position", "/pit",
                             "/race_control", "/laps", "/intervals",
                             "/stints", "/weather"):
                await asyncio.sleep(1.0)
                try:
                    datos[endpoint] = await self._get(client, endpoint,
                                                      session_key=sk)
                except httpx.HTTPStatusError as e:
                    if (e.response.status_code == 404
                            and endpoint not in ("/drivers", "/position")):
                        log.info("OpenF1 %s sin datos aún (404) — la sesión "
                                 "sigue sin ese dato", endpoint)
                        datos[endpoint] = []
                    else:
                        raise
            drivers = datos["/drivers"]
            posiciones = datos["/position"]
            pits = datos["/pit"]
            control = datos["/race_control"]
            vueltas = datos["/laps"]
            intervalos = datos["/intervals"]
            stints = datos["/stints"]
            clima = datos["/weather"]
        for d in drivers:
            self.pilotos[d["driver_number"]] = {
                "nombre": d.get("full_name") or d.get("broadcast_name")
                or f"car number {d['driver_number']}",
                "equipo": d.get("team_name") or "",
                "acronimo": d.get("name_acronym")
                or str(d["driver_number"]),
                "color": d.get("team_colour") or "",
            }
        tl = []
        for p in posiciones:
            tl.append((_fecha(p["date"]), "posicion", p))
        for p in pits:
            tl.append((_fecha(p["date"]), "pit", p))
        for c in control:
            tl.append((_fecha(c["date"]), "control", c))
        for v in vueltas:
            if v.get("date_start"):
                tl.append((_fecha(v["date_start"]), "vuelta", v))
        for i in intervalos:
            tl.append((_fecha(i["date"]), "intervalo", i))
        for c in clima:
            tl.append((_fecha(c["date"]), "clima", c))
        # Los stints no traen fecha (solo vuelta de inicio/fin), así que se
        # consultan por número de vuelta en _procesar en vez de ir en la
        # timeline ordenada por fecha.
        self._stints = sorted(stints, key=lambda s: s.get("lap_start") or 0)
        self.total_vueltas = max(
            (v.get("lap_number") or 0 for v in vueltas), default=0)
        tl.sort(key=lambda e: e[0])
        # Recortar la previa muerta (garaje): el replay arranca cerca del
        # inicio OFICIAL de la sesión, no cuando aparece la primera fila —
        # menos desfase con el vivo y el mapa se mueve desde el minuto uno
        try:
            corte = _fecha(sesion["date_start"]) - dt.timedelta(seconds=90)
            tl = [e for e in tl if e[0] >= corte] or tl
        except Exception:
            pass
        self._timeline = tl
        log.info("Telemetría cargada: %s — %d filas de datos",
                 self.descripcion(), len(tl))

    async def _elegir_sesion(self, client):
        if self.session_key != "latest":
            sesiones = await self._get(client, "/sessions",
                                       session_key=self.session_key)
            if not sesiones:
                raise RuntimeError(f"sesión {self.session_key} no encontrada")
            return sesiones[0]
        ahora = dt.datetime.now(dt.timezone.utc)
        for año in (ahora.year, ahora.year - 1):
            sesiones = await self._get(client, "/sessions",
                                       session_type="Race", year=año)
            pasadas = [s for s in sesiones
                       if s.get("session_name") == "Race"
                       and _fecha(s["date_start"]) < ahora]
            if pasadas:
                return pasadas[-1]
        raise RuntimeError("no se encontró ninguna carrera pasada en OpenF1")

    async def trazado_circuito(self):
        """Trazado COMPLETO del circuito: una vuelta de un piloto sacada de
        /location, para dibujar la pista entera de una vez (en vez de irla
        acumulando). Devuelve [{"x","y"}] normalizados o [] si no se pudo."""
        sk = self.sesion.get("session_key")
        if not sk or not self.pilotos:
            return []
        try:
            inicio = _fecha(self.sesion["date_start"])
        except Exception:
            return []
        # Ventana de datos. ADAPTATIVA: se pide el tramo MÁS RECIENTE que ya
        # ocurrió (los últimos ~10 min del replay), no una ventana fija en los
        # minutos 15-23 de la sesión: al empezar la carrera esos datos aún no
        # existen y el trazado nunca llegaba a dibujarse. Si el replay lleva
        # poco recorrido, se cae a la ventana fija (llegará más adelante).
        ahora_rep = getattr(self, "fecha_actual", None)
        if ahora_rep and (ahora_rep - inicio) >= dt.timedelta(minutes=8):
            desde = (ahora_rep - dt.timedelta(minutes=10)).isoformat()
            hasta = ahora_rep.isoformat()
        else:
            desde = (inicio + dt.timedelta(minutes=15)).isoformat()
            hasta = (inicio + dt.timedelta(minutes=23)).isoformat()

        for num in list(self.pilotos)[:5]:
            try:
                async with httpx.AsyncClient() as client:
                    url = (f"{BASE}/location?session_key={sk}"
                           f"&driver_number={num}&date>{desde}&date<{hasta}")
                    r = await client.get(url, timeout=25,
                                         headers=await _auth_headers(client))
                    r.raise_for_status()
                    filas = r.json()
            except Exception as e:
                log.info("Trazado: piloto %s sin datos (%s)", num, e)
                continue
            traza = _limpiar_traza(filas)
            if traza:
                return traza
        return []

    def fin_datos(self):
        """Fecha del último dato descargado (el borde de la sesión). Sirve
        para saltar al 'ahora' en una sesión en vivo."""
        return self._timeline[-1][0] if self._timeline else None

    def reloj(self):
        """Reloj CONTINUO del replay: avanza en tiempo real aunque no haya
        eventos que procesar (la fecha de la última fila avanza a saltos y
        congelaba el mapa)."""
        if self._ancla_datos is None:
            return self.fecha_actual
        avance = (time.monotonic() - self._ancla_real) * self.velocidad
        est = self._ancla_datos + dt.timedelta(seconds=avance)
        if self.fecha_actual and self.fecha_actual > est:
            return self.fecha_actual
        return est

    async def datos_coche(self, numero, desde, hasta):
        """Lo que manda el coche entre dos instantes: velocidad, freno y
        acelerador. Devuelve [{"t": datetime, "v": km/h, "freno": bool,
        "gas": 0-100, "drs": n}] ordenado, o [] si no hay.

        Se pide SOLO alrededor de un momento concreto (un adelantamiento):
        /car_data va a 3,7 muestras por segundo y por coche, así que
        traerse una carrera entera serían cientos de miles de filas para
        usar cuarenta.
        """
        sk = self.sesion.get("session_key")
        if not (sk and desde and hasta):
            return []
        fuera = []
        try:
            async with httpx.AsyncClient() as client:
                url = (f"{BASE}/car_data?session_key={sk}"
                       f"&driver_number={numero}"
                       f"&date>{desde.isoformat()}&date<{hasta.isoformat()}")
                r = await client.get(url, timeout=20,
                                     headers=await _auth_headers(client))
                r.raise_for_status()
                for d in r.json():
                    if d.get("date") is None or d.get("speed") is None:
                        continue
                    fuera.append({
                        "t": _fecha(d["date"]),
                        "v": float(d["speed"]),
                        # brake viene 0 o 100; alguna vez llega como bool
                        "freno": bool(d.get("brake")),
                        "gas": float(d.get("throttle") or 0),
                        "drs": d.get("drs"),
                    })
        except Exception as e:
            log.info("Telemetría del coche %s sin datos (%s)", numero, e)
            return []
        fuera.sort(key=lambda d: d["t"])
        return fuera

    async def posiciones_pista(self):
        """Última posición (x, y) de cada coche alrededor del reloj del
        replay — para pintar el mapa del circuito. {} si no hay datos."""
        ahora_replay = self.reloj()
        if not (ahora_replay and self.sesion.get("session_key")):
            return {}
        sk = self.sesion["session_key"]
        desde = (ahora_replay - dt.timedelta(seconds=60)).isoformat()
        hasta = ahora_replay.isoformat()
        salida = {}
        try:
            async with httpx.AsyncClient() as client:
                url = (f"{BASE}/location?session_key={sk}"
                       f"&date>{desde}&date<{hasta}")
                r = await client.get(url, timeout=15,
                                     headers=await _auth_headers(client))
                r.raise_for_status()
                for p in r.json():  # ordenado por fecha: la última gana
                    n = p.get("driver_number")
                    if n and p.get("x") is not None:
                        salida[n] = {"x": p["x"], "y": p["y"]}
        except Exception as e:
            log.info("Mapa de pista sin datos (%s)", e)
        return salida

    # ---------- estado / contexto ----------

    def _nombre(self, numero):
        return self.pilotos.get(numero, {}).get(
            "nombre", f"car number {numero}")

    def descripcion(self):
        s = self.sesion
        return (f"{s.get('country_name', '?')} {s.get('year', '')} "
                f"({s.get('circuit_short_name', '')})")

    def resumen(self):
        """Contexto compacto para el narrador."""
        orden = sorted(self.posiciones.items(), key=lambda kv: kv[1])
        top = ", ".join(f"P{pos} {self._nombre(n)}" for n, pos in orden[:6])
        s = self.sesion
        vueltas = (f"Lap {self.vuelta} of {self.total_vueltas}"
                   if self.total_vueltas else f"Lap {self.vuelta}")
        return (f"{s.get('country_name', '?')} Grand Prix at "
                f"{s.get('circuit_short_name', '?')}. {vueltas}. "
                f"Order: {top or 'no data yet'}.")

    # ---------- replay ----------

    def _procesar(self, tipo, dato):
        """Aplica una fila al estado y devuelve un texto narrable o None."""
        if tipo == "posicion":
            numero, pos = dato["driver_number"], dato["position"]
            anterior = self.posiciones.get(numero)
            self.posiciones[numero] = pos
            if anterior is not None and pos < anterior and pos <= 10 \
                    and self.vuelta >= 1:
                return (f"ADELANTAMIENTO: {self._nombre(numero)} gana la "
                        f"posición {pos} (venía {anterior}º)")
            return None
        if tipo == "clima":
            self.clima = {"aire": dato.get("air_temperature"),
                         "pista": dato.get("track_temperature"),
                         "lluvia": bool(dato.get("rainfall"))}
            return None
        if tipo == "vuelta":
            n = dato.get("lap_number") or 0
            if n > self.vuelta:
                self.vuelta = n
                for s in self._stints:
                    if (s.get("lap_start") or 0) <= n:
                        self.neumaticos[s["driver_number"]] = {
                            "compuesto": (s.get("compound") or "")[:1],
                            "vueltas": n - (s.get("lap_start") or n) + 1,
                            "desde": s.get("lap_start") or n,
                        }
            # La lectura de la trampa de velocidad viene en la MISMA fila de
            # /laps que ya estamos procesando: guardarla no cuesta ni una
            # petición más, y es lo único que hace falta para el reparto de
            # velocidades punta. Las vueltas de salida de boxes no cuentan
            # (el coche va lanzándose, no es su punta real).
            if dato.get("st_speed") is not None and not dato.get(
                    "is_pit_out_lap"):
                try:
                    kmh = float(dato["st_speed"])
                except (TypeError, ValueError):
                    kmh = 0.0
                if 120.0 <= kmh <= 400.0:
                    self.velocidades.setdefault(
                        dato["driver_number"], []).append(kmh)
            if dato.get("lap_duration"):
                self._vueltas.setdefault(dato["driver_number"], []).append({
                    "n": n, "dur": dato["lap_duration"],
                    "out": bool(dato.get("is_pit_out_lap")),
                    # Los tres sectores. Son los que explican POR QUÉ un
                    # coche no consigue pasar al de delante: casi siempre
                    # gana en uno y lo pierde justo en el que desemboca en
                    # la recta.
                    "s": [dato.get(f"duration_sector_{i}") for i in (1, 2, 3)],
                })
            dur = dato.get("lap_duration")
            if dur and n > 1 and not dato.get("is_pit_out_lap"):
                if self.mejor_vuelta is None or dur < self.mejor_vuelta[0]:
                    self.mejor_vuelta = (dur, dato["driver_number"])
                    if self.vuelta > 2:  # evitar ruido de las primeras vueltas
                        return (f"FASTEST LAP: {self._nombre(dato['driver_number'])} "
                                f"sets the fastest lap of the race, {_seg(dur)}")
            return None
        if tipo == "pit":
            dur = dato.get("pit_duration")
            extra = f", stop of {_seg(dur)}" if dur else ""
            self.ultimo_pit = {"vuelta": dato.get("lap_number", self.vuelta),
                               "nombre": self._nombre(dato["driver_number"])}
            vuelta_pit = dato.get("lap_number") or self.vuelta
            self._pit_laps.setdefault(
                dato["driver_number"], set()).add(vuelta_pit)
            self._pits.append({"numero": dato["driver_number"],
                               "vuelta": vuelta_pit})
            return (f"PIT STOP: {self._nombre(dato['driver_number'])} boxes on "
                    f"lap {dato.get('lap_number', '?')}{extra}")
        if tipo == "intervalo":
            n = dato["driver_number"]
            anterior = self.gaps.get(n)
            if isinstance(anterior, (int, float)):
                self.gaps_anteriores[n] = anterior
            self.gaps[n] = dato.get("interval")
            # Cuánto ha estado pegado, vuelta a vuelta. Con solo el hueco
            # de ahora no se puede decir "lleva seis vueltas ahí detrás",
            # que es lo que convierte un hueco pequeño en una historia.
            if isinstance(self.gaps[n], (int, float)) and self.vuelta:
                h = self._gaps_vuelta.setdefault(n, {})
                v = self.vuelta
                h[v] = min(h.get(v, 9e9), float(self.gaps[n]))
                if len(h) > 25:
                    for viejo in sorted(h)[:-25]:
                        del h[viejo]
            return None
        if tipo == "control":
            msj = (dato.get("message") or "").strip()
            if not msj or "BLUE FLAG" in msj:
                return None  # las banderas azules son puro ruido
            self.incidentes.append({"vuelta": self.vuelta, "texto": msj})
            del self.incidentes[:-8]
            quien = ""
            if dato.get("driver_number"):
                quien = f" (afecta a {self._nombre(dato['driver_number'])})"
            return f"DIRECCIÓN DE CARRERA: {msj}{quien}"
        return None

    def tabla(self):
        """Leaderboard completo (los 20): [{pos, acr, nombre, color, gap,
        mejor, pelea, neumatico}]. `mejor` es la mejor vuelta personal —
        el dato clave en libres/clasificación."""
        orden = sorted(self.posiciones.items(), key=lambda kv: kv[1])
        filas = []
        for n, pos in orden[:20]:
            p = self.pilotos.get(n, {})
            gap = self.gaps.get(n)
            if pos == 1 or gap is None:
                gap_txt = ""
            elif isinstance(gap, (int, float)):
                gap_txt = f"+{gap:.3f}"
            else:
                gap_txt = str(gap)
            pelea = (pos > 1 and isinstance(gap, (int, float))
                     and gap < 1.0)
            neu = self.neumaticos.get(n, {})
            durs = [v["dur"] for v in (self._vueltas.get(n) or [])
                    if v.get("dur")]
            mejor = ""
            if durs:
                d = min(durs)
                mejor = f"{int(d // 60)}:{d % 60:06.3f}"
            filas.append({"pos": pos,
                          "acr": p.get("acronimo", str(n)),
                          "nombre": self._nombre(n),
                          "color": p.get("color", ""),
                          "gap": gap_txt,
                          # El gap en segundos, aparte del texto que se
                          # enseña. OpenF1 manda "+1 LAP" cuando a un coche
                          # le han sacado una vuelta, así que volver a leer
                          # `gap` como número no funciona: aquí va None
                          # cuando no hay una cifra que valga.
                          "gap_seg": (gap if isinstance(gap, (int, float))
                                      else None),
                          "mejor": mejor,
                          "pelea": pelea,
                          "neumatico": neu.get("compuesto", ""),
                          "vueltas_neumatico": neu.get("vueltas", 0)})
        # una pelea involucra a los dos coches: marcar también al de delante
        for i in range(1, len(filas)):
            if filas[i]["pelea"]:
                filas[i - 1]["pelea"] = True
        return filas

    def hay_pelea(self):
        """True si hay lucha rueda a rueda en el top 10."""
        return any(f["pelea"] for f in self.tabla())

    def battle_scores(self):
        """Puntaje 0-100 por cada duelo entre posiciones consecutivas.

        Metodología (100% explicable, sin cifras inventadas):
        - Cercanía: 70 puntos como máximo, decreciendo linealmente desde
          gap=0s (70 pts) hasta gap=3s (0 pts) — más allá de 3s no cuenta
          como duelo.
        - Tendencia: hasta 30 puntos extra si el gap se está CERRANDO
          respecto a la lectura anterior (velocidad de cierre), o hasta
          -30 si se está abriendo. Sin dato anterior, tendencia = 0.
        Devuelve lista [{"entre": "VER vs NOR", "score": 87,
        "razon": "..."}] ordenada de mayor a menor score.
        """
        tabla = self.tabla()
        resultados = []
        for i in range(1, len(tabla)):
            delante, detras = tabla[i - 1], tabla[i]
            gap = detras.get("gap_seg")
            # Sin cifra no hay duelo que puntuar: o es el líder, o le han
            # sacado una vuelta, o todavía no ha llegado el dato.
            if gap is None or gap > 3.0:
                continue
            cercania = max(0.0, 70.0 * (1 - gap / 3.0))
            numero = next((n for n, p in self.posiciones.items()
                          if p == detras["pos"]), None)
            anterior = self.gaps_anteriores.get(numero) if numero else None
            tendencia = 0.0
            razon_tendencia = "no previous reading to measure the trend"
            if isinstance(anterior, (int, float)) and anterior > 0:
                cierre = (anterior - gap) / anterior  # >0 se acerca
                tendencia = max(-30.0, min(30.0, cierre * 30.0))
                if cierre > 0.02:
                    razon_tendencia = (f"closing the gap "
                                      f"({anterior:.2f}s → {gap:.2f}s)")
                elif cierre < -0.02:
                    razon_tendencia = (f"gap opening up "
                                      f"({anterior:.2f}s → {gap:.2f}s)")
                else:
                    razon_tendencia = f"gap steady at {gap:.2f}s"
            score = round(max(0.0, min(100.0, cercania + tendencia)))
            # La tendencia en un campo aparte del texto: el gráfico de
            # pantalla necesita saber si el hueco se cierra para pintar la
            # flecha, y sacarlo de la frase a base de buscar palabras sería
            # frágil.
            if tendencia > 2:
                sentido, delta = "closing", (anterior - gap) if anterior else 0.0
            elif tendencia < -2:
                sentido, delta = "opening", (anterior - gap) if anterior else 0.0
            else:
                sentido, delta = "steady", 0.0
            resultados.append({
                "entre": f"{delante['acr']} vs {detras['acr']}",
                "score": score,
                "pos_delante": delante["pos"],
                "pos_detras": detras["pos"],
                "gap": round(gap, 3),
                "sentido": sentido,
                "delta": round(delta, 3),
                # Las dos filas enteras: acrónimo, nombre, color de equipo,
                # neumático con su edad y mejor vuelta. Ya estaban
                # calculadas aquí; mandarlas evita que la pantalla tenga
                # que volver a cruzar la tabla por posición.
                "delante": delante,
                "detras": detras,
                "razon": f"{gap:.2f}s gap ({round(cercania)} pts for "
                        f"closeness) — {razon_tendencia} "
                        f"({round(tendencia):+d} pts trend)",
            })
        resultados.sort(key=lambda r: -r["score"])
        # A los duelos más calientes se les añade la lectura de estrategia
        # (degradación medida de ambos coches) cuando hay datos suficientes
        nums = {p: n for n, p in self.posiciones.items()}
        for r in resultados[:3]:
            estr = self._estrategia_duelo(nums.get(r["pos_delante"]),
                                          nums.get(r["pos_detras"]))
            if estr:
                r["estrategia"] = estr
        return resultados

    # ---------- atascado detrás: por qué no pasa ----------

    @staticmethod
    def _mediana(vals):
        v = sorted(x for x in vals if isinstance(x, (int, float)))
        if not v:
            return None
        m = len(v) // 2
        return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2

    def _ultimas_limpias(self, numero, cuantas=5):
        """Las últimas vueltas del coche sin entradas ni salidas de boxes."""
        en_boxes = self._pit_laps.get(numero, set())
        return [v for v in self._vueltas.get(numero, [])
                if not v["out"] and v["n"] not in en_boxes][-cuantas:]

    def vueltas_pegado(self, numero, umbral=1.2):
        """Vueltas SEGUIDAS que lleva a menos de `umbral` del de delante."""
        h = self._gaps_vuelta.get(numero) or {}
        n = 0
        v = self.vuelta
        while v >= 1 and h.get(v) is not None and h[v] <= umbral:
            n += 1
            v -= 1
        return n

    def comparar(self, detras, delante, cuantas=5):
        """Lo MEDIBLE entre dos coches: dónde gana cada uno y por cuánto.

        Estaba metido dentro de `atascos`, que solo mira a quien lleva
        tres vueltas pegado. Pero la comparación no depende de eso: en
        cuanto dos están a menos de un segundo ya hay algo que enseñar, y
        el espectador quiere verlo en la primera vuelta que se juntan, no
        a la cuarta. Sacarlo aquí permite usarlo en los dos sitios sin
        tener dos implementaciones que se van separando con el tiempo.

        Todo son medianas de las últimas vueltas limpias de cada uno.
        Nada es una opinión y nada se rellena: si a un dato le faltan
        vueltas, ese dato sale vacío.

        El signo, siempre igual para no equivocarse al leerlo: NEGATIVO
        es que el de ATRÁS va mejor.
        """
        va = self._ultimas_limpias(detras, cuantas)
        vb = self._ultimas_limpias(delante, cuantas)
        sectores = []
        if len(va) >= 3 and len(vb) >= 3:
            for k in range(3):
                ma = self._mediana([v.get("s") and v["s"][k] for v in va])
                mb = self._mediana([v.get("s") and v["s"][k] for v in vb])
                if ma is not None and mb is not None:
                    sectores.append({"n": k + 1, "delta": round(ma - mb, 3)})

        trampa = None
        ta = self._mediana((self.velocidades.get(detras) or [])[-5:])
        tb = self._mediana((self.velocidades.get(delante) or [])[-5:])
        if ta is not None and tb is not None:
            trampa = {"detras": round(ta), "delante": round(tb),
                      "delta": round(ta - tb)}

        neu_a = self.neumaticos.get(detras) or {}
        neu_b = self.neumaticos.get(delante) or {}
        return {
            "sectores": sectores,
            # El sector donde más gana y donde más pierde, ya elegidos
            # aquí: la pantalla no tiene por qué saber de medianas.
            "gana": min(sectores, key=lambda s: s["delta"], default=None),
            "pierde": max(sectores, key=lambda s: s["delta"], default=None),
            "trampa": trampa,
            "neumaticos": {
                "detras": {"c": neu_a.get("compuesto", ""),
                           "v": neu_a.get("vueltas", 0)},
                "delante": {"c": neu_b.get("compuesto", ""),
                            "v": neu_b.get("vueltas", 0)},
            },
        }

    def duelo_cercano(self, umbral=1.0):
        """El duelo más caliente por debajo de `umbral`, ya comparado.

        A diferencia de `atascos`, aquí NO se exige llevar vueltas
        pegado. Un segundo es la distancia a la que la pelea empieza a
        existir —es también donde se abre el DRS— y esperar tres vueltas
        para enseñar algo es llegar tarde a la mitad de las peleas, que
        se resuelven antes.

        Devuelve None si no hay ninguno: la pantalla no dibuja la tarjeta
        y no pasa nada. Un duelo inventado es peor que ningún duelo.
        """
        nums = {p: n for n, p in self.posiciones.items()}
        for r in self.battle_scores():
            if r["gap"] > umbral:
                continue
            a = nums.get(r["pos_detras"])
            b = nums.get(r["pos_delante"])
            if not (a and b):
                continue
            return {"detras": r["detras"], "delante": r["delante"],
                    "n_detras": a, "n_delante": b,
                    "gap": r["gap"], "sentido": r["sentido"],
                    "delta_gap": r["delta"],
                    # Vueltas pegado: si son varias la historia cambia de
                    # "se acaba de poner ahí" a "no consigue pasar".
                    "vueltas": self.vueltas_pegado(a, umbral),
                    **self.comparar(a, b)}
        return None

    async def trazas_par(self, detras, delante, segundos=12.0):
        """Qué está haciendo AHORA MISMO cada uno de los dos coches.

        Es la mitad que faltaba. `comparar` dice quién es mejor dónde,
        pero con medianas de vueltas enteras: es el resumen del duelo, no
        el duelo. Esto trae las muestras del coche de los últimos segundos
        y con eso se ve la velocidad de cada uno y hacia dónde va —
        quién está acelerando y quién frenando en este instante.

        Se pide solo para UN par y una ventana corta. /car_data manda
        3,7 muestras por segundo y por coche: doce segundos de dos coches
        son unas noventa filas. Traerlo para toda la parrilla en cada
        refresco sí sería un abuso, y por eso el bucle que llama aquí lo
        hace únicamente con el duelo más caliente.
        """
        fin = self.reloj() or self.fecha_actual
        if not fin:
            return None
        ini = fin - dt.timedelta(seconds=segundos)
        ta = await self.datos_coche(detras, ini, fin)
        tb = await self.datos_coche(delante, ini, fin)
        ra, rb = _resumen_traza(ta), _resumen_traza(tb)
        if not (ra and rb):
            return None
        return {"detras": ra, "delante": rb,
                "delta": round(ra["v"] - rb["v"]),
                "segundos": segundos}

    def atascos(self, minimo=3, umbral=1.2):
        """Coches que llevan varias vueltas pegados y no consiguen pasar,
        con lo que se puede MEDIR de por qué.

        Nada de aquí es una opinión: son las medianas de las últimas
        vueltas limpias de cada uno. El sector donde el de atrás gana y
        el sector donde lo pierde salen de sus propios tiempos; la
        diferencia en la trampa de velocidad, de sus propias lecturas; la
        edad del neumático, de los stints. Si a un dato le faltan
        vueltas, ese dato no sale — no se rellena con una estimación.
        """
        tabla = self.tabla()
        pos_num = {p: n for n, p in self.posiciones.items()}
        fuera = []
        for i in range(1, len(tabla)):
            delante_f, detras_f = tabla[i - 1], tabla[i]
            gap = detras_f.get("gap_seg")
            if gap is None or gap > umbral:
                continue
            detras = pos_num.get(detras_f["pos"])
            delante = pos_num.get(delante_f["pos"])
            if not (detras and delante):
                continue
            vueltas = self.vueltas_pegado(detras, umbral)
            if vueltas < minimo:
                continue

            fuera.append({
                "delante": delante_f, "detras": detras_f,
                "vueltas": vueltas, "gap": round(gap, 3),
                **self.comparar(detras, delante),
            })
        fuera.sort(key=lambda a: -a["vueltas"])
        return fuera

    # ---------- estrategia (métricas medidas, nunca inventadas) ----------

    def degradacion(self, numero):
        """Tendencia de ritmo del stint actual: pendiente (s/vuelta) por
        mínimos cuadrados sobre las vueltas limpias — se excluyen la
        vuelta de entrada y salida de boxes y las vueltas 7% más lentas
        que la mejor del stint (tráfico, safety car). Positiva = el
        neumático está cayendo. Devuelve dict o None si no hay al menos
        cuatro vueltas limpias que medir."""
        neu = self.neumaticos.get(numero) or {}
        desde = neu.get("desde") or 1
        en_boxes = self._pit_laps.get(numero, set())
        stint = [v for v in self._vueltas.get(numero, [])
                 if v["n"] >= desde and not v["out"]
                 and v["n"] not in en_boxes]
        if len(stint) < 4:
            return None
        mejor = min(v["dur"] for v in stint)
        limpias = [v for v in stint if v["dur"] <= mejor * 1.07]
        if len(limpias) < 4:
            return None
        return {
            "pendiente": _pendiente([(v["n"], v["dur"]) for v in limpias]),
            "muestras": len(limpias),
            "compuesto": neu.get("compuesto", ""),
            "edad": neu.get("vueltas", 0),
        }

    def perdida_pit(self):
        """Cuánto cuesta una parada EN ESTA carrera, medido de las paradas
        que ya ocurrieron: (vuelta de entrada + vuelta de salida) menos dos
        vueltas al ritmo previo del propio piloto (mediana de sus últimas
        vueltas limpias). Devuelve {"segundos", "muestras"} o None si aún
        no hay paradas medibles."""
        perdidas = []
        for p in self._pits:
            n, lap = p["numero"], p["vuelta"]
            por_n = {v["n"]: v for v in self._vueltas.get(n, [])}
            entrada, salida = por_n.get(lap), por_n.get(lap + 1)
            if not entrada or not salida:
                continue
            previas = [v["dur"] for v in self._vueltas.get(n, [])
                       if v["n"] < lap and not v["out"]
                       and v["n"] not in self._pit_laps.get(n, set())][-8:]
            if len(previas) < 3:
                continue
            base = sorted(previas)[len(previas) // 2]
            perdida = entrada["dur"] + salida["dur"] - 2 * base
            if 5 < perdida < 60:  # fuera de esto hubo SC/bandera: no sirve
                perdidas.append(perdida)
        if not perdidas:
            return None
        return {"segundos": sorted(perdidas)[len(perdidas) // 2],
                "muestras": len(perdidas)}

    def _estrategia_duelo(self, delante, detras):
        """Lectura de estrategia de un duelo: degradación medida de ambos
        y a quién favorece la tendencia. Texto vacío si faltan datos."""
        if delante is None or detras is None:
            return ""
        dd, dt_ = self.degradacion(delante), self.degradacion(detras)
        if not dd or not dt_:
            return ""
        def parte(num, d):
            acr = self.pilotos.get(num, {}).get("acronimo", str(num))
            return (f"{acr} {d['pendiente']:+.2f}s/lap "
                    f"({d['compuesto'] or '?'}×{d['edad']}, "
                    f"{d['muestras']} clean laps)")
        texto = f"Stint pace: {parte(delante, dd)} · {parte(detras, dt_)}"
        dif = dd["pendiente"] - dt_["pendiente"]
        if abs(dif) >= 0.05:
            quien = (self.pilotos.get(delante if dif > 0 else detras, {})
                     .get("acronimo", "?"))
            texto += (f" — {quien}'s tyres dropping off "
                      f"{abs(dif):.2f}s/lap faster")
        return texto

    def estrategia_resumen(self):
        """Datos de estrategia medidos, en una línea, para el narrador.

        EN INGLÉS: esto entra en un prompt en inglés y sale por boca del
        dúo. Estaba en español y era cuestión de tiempo que se colara una
        palabra suelta en una emisión que solo publica en inglés.

        Lleva además el marcador y el hueco de cada duelo, no solo la
        lectura de estrategia. Son las cifras que el espectador está
        viendo en el rótulo: si el narrador va a señalarlas, tiene que
        tenerlas — y si no las tiene, se las inventaría.
        """
        partes = []
        pit = self.perdida_pit()
        if pit:
            partes.append(f"a pit stop costs ~{pit['segundos']:.1f}s "
                          f"(median of {pit['muestras']} measured stops)")
        for r in self.battle_scores()[:2]:
            trozo = (f"battle {r['entre']} for P{r['pos_delante']}: "
                     f"{r['gap']:.2f}s and {r['sentido']}, "
                     f"scoring {r['score']} out of 100 on the on-screen board")
            if r.get("estrategia"):
                trozo += f" — {r['estrategia']}"
            partes.append(trozo)
        return "; ".join(partes)

    def alertas(self):
        """Lecturas de la IA para el ticker de pantalla. SOLO cosas medibles
        de esta carrera, cada una con su porqué — nunca un porcentaje ni un
        dato inventado (regla de oro). Lista ordenada por importancia:
        [{"txt", "nivel"}] con nivel hot/warn/info; vacía si no hay nada
        sólido que decir."""
        out = []
        nums = {p: n for n, p in self.posiciones.items()}

        # 1) Carrera neutralizada / incidente (mensaje real de dirección)
        for inc in reversed(self.incidentes):
            if inc["vuelta"] < self.vuelta - 1:
                continue
            m = inc["texto"].upper()
            if any(k in m for k in ("SAFETY CAR", "VIRTUAL SAFETY", "VSC")):
                out.append({"txt": "RACE NEUTRALISED — pit-stop window "
                            "just opened for the whole field", "nivel": "hot"})
                break
            if "RED FLAG" in m:
                out.append({"txt": "RED FLAG — race stopped", "nivel": "hot"})
                break
            if any(k in m for k in ("INCIDENT", "ACCIDENT", "CRASH",
                                    "COLLISION")):
                out.append({"txt": f"INCIDENT: {inc['texto']}",
                            "nivel": "hot"})
                break

        # 2) Ventana de undercut en el duelo más caliente (degradación medida)
        duelos = self.battle_scores()
        if duelos and duelos[0]["score"] >= 45:
            d = duelos[0]
            delante, detras = d["entre"].split(" vs ")
            da = self.degradacion(nums.get(d["pos_delante"]))
            db = self.degradacion(nums.get(d["pos_detras"]))
            if da and db:
                dif = da["pendiente"] - db["pendiente"]  # >0: delante cae antes
                if dif >= 0.05:
                    out.append({"txt": f"UNDERCUT IN PLAY — {detras}'s tyres "
                                f"{dif:.2f}s/lap fresher than {delante}, "
                                f"P{d['pos_delante']} under threat",
                                "nivel": "hot"})

        # 3) Caída de neumático medible en el top-10 (pit window abriéndose)
        for f in self.tabla():
            deg = self.degradacion(nums.get(f["pos"]))
            if deg and deg["pendiente"] >= 0.12 and deg["edad"] >= 8:
                out.append({"txt": f"TYRE DROP-OFF — {f['acr']} losing "
                            f"{deg['pendiente']:.2f}s/lap on "
                            f"{deg['compuesto'] or '?'} ({deg['edad']} laps), "
                            f"a stop is coming", "nivel": "warn"})
                break

        # 4) Últimas vueltas
        if (self.total_vueltas and self.vuelta
                and self.vuelta >= self.total_vueltas - 3):
            quedan = self.total_vueltas - self.vuelta
            out.append({"txt": f"FINAL LAPS — {quedan} to go", "nivel": "hot"})

        # 5) Coste de parada medido (contexto de fondo, siempre útil)
        pit = self.perdida_pit()
        if pit:
            out.append({"txt": f"PIT LOSS here ~{pit['segundos']:.1f}s "
                        f"(median of {pit['muestras']} stops)", "nivel": "info"})

        return out

    async def correr(self, al_evento, desde=None):
        """Reproduce la línea de tiempo llamando a al_evento(texto).

        Con `desde` (fecha), lo anterior a esa fecha se procesa EN
        SILENCIO (reconstruye posiciones/estado sin narrar) y la
        reproducción con ritmo real arranca justo después — así una
        sesión EN CURSO puede recargarse con datos frescos sin repetir
        lo ya narrado."""
        if not self._timeline:
            raise RuntimeError("timeline vacía: ¿faltó llamar a cargar()?")
        pendientes = self._timeline
        if desde is not None:
            for fecha, tipo, dato in pendientes:
                if fecha <= desde:
                    self.fecha_actual = fecha
                    self._procesar(tipo, dato)  # estado sí, narración no
            pendientes = [e for e in pendientes if e[0] > desde]
            if not pendientes:
                return
        inicio_datos = pendientes[0][0]
        inicio_real = time.monotonic()
        self._ancla_datos = inicio_datos   # reloj continuo (para el mapa)
        self._ancla_real = inicio_real
        for fecha, tipo, dato in pendientes:
            objetivo = (fecha - inicio_datos).total_seconds() / self.velocidad
            espera = objetivo - (time.monotonic() - inicio_real)
            if espera > 0:
                await asyncio.sleep(espera)
            self.fecha_actual = fecha   # reloj del replay (para el mapa)
            texto = self._procesar(tipo, dato)
            if texto:
                al_evento(texto)
        log.info("Replay al día: %s (fin de los datos descargados)",
                 self.descripcion())

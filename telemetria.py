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
import random
import time

import httpx

log = logging.getLogger("telemetria")

BASE = "https://api.openf1.org/v1"


def _fecha(texto):
    return dt.datetime.fromisoformat(texto.replace("Z", "+00:00"))


def _seg(valor):
    """Formatea segundos como texto narrable: 83.456 -> 'un minuto 23.5'."""
    if valor is None:
        return ""
    m, s = divmod(float(valor), 60)
    if m >= 1:
        return f"{int(m)} minuto{'s' if m >= 2 else ''} {s:.1f} segundos"
    return f"{s:.1f} segundos"


async def proximas_sesiones(n=5):
    """Próximas sesiones de F1 (libres, clasificación, carrera) desde
    OpenF1. Lista real y verificable; vacía si no hay datos disponibles
    — nunca se inventa una fecha."""
    ahora = dt.datetime.now(dt.timezone.utc)
    async with httpx.AsyncClient() as client:
        try:
            r = await client.get(f"{BASE}/sessions",
                                 params={"year": ahora.year}, timeout=30)
            r.raise_for_status()
            sesiones = r.json()
        except Exception:
            return []
    futuras = [s for s in sesiones
              if s.get("date_start") and _fecha(s["date_start"]) > ahora]
    futuras.sort(key=lambda s: s["date_start"])
    return futuras[:n]


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
                                            "year": año}, timeout=30)
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
        self.neumaticos = {}      # numero -> {"compuesto", "vueltas"}
        self.clima = {}           # {"aire", "pista"}
        self._stints = []         # stints ordenados por vuelta de inicio
        # timeline: lista de (fecha, tipo, dato) ordenada por fecha
        self._timeline = []

    # ---------- descarga ----------

    async def _get(self, client, path, **params):
        """GET con reintentos: la API gratuita de OpenF1 limita el ritmo."""
        for intento in range(6):
            r = await client.get(BASE + path, params=params, timeout=60)
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
            # De uno en uno y con pausa: la API gratuita limita el ritmo
            datos = {}
            for endpoint in ("/drivers", "/position", "/pit",
                             "/race_control", "/laps", "/intervals",
                             "/stints", "/weather"):
                await asyncio.sleep(1.0)
                datos[endpoint] = await self._get(client, endpoint,
                                                  session_key=sk)
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
                or f"el piloto número {d['driver_number']}",
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

    # ---------- estado / contexto ----------

    def _nombre(self, numero):
        return self.pilotos.get(numero, {}).get(
            "nombre", f"el piloto número {numero}")

    def descripcion(self):
        s = self.sesion
        return (f"{s.get('country_name', '?')} {s.get('year', '')} "
                f"({s.get('circuit_short_name', '')})")

    def resumen(self):
        """Contexto compacto para el narrador."""
        orden = sorted(self.posiciones.items(), key=lambda kv: kv[1])
        top = ", ".join(f"{pos}º {self._nombre(n)}" for n, pos in orden[:6])
        s = self.sesion
        vueltas = (f"Vuelta {self.vuelta} de {self.total_vueltas}"
                   if self.total_vueltas else f"Vuelta {self.vuelta}")
        return (f"Gran Premio de {s.get('country_name', '?')} en "
                f"{s.get('circuit_short_name', '?')}. {vueltas}. "
                f"Posiciones: {top or 'aún sin datos'}.")

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
                         "pista": dato.get("track_temperature")}
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
                        }
            dur = dato.get("lap_duration")
            if dur and n > 1 and not dato.get("is_pit_out_lap"):
                if self.mejor_vuelta is None or dur < self.mejor_vuelta[0]:
                    self.mejor_vuelta = (dur, dato["driver_number"])
                    if self.vuelta > 2:  # evitar ruido de las primeras vueltas
                        return (f"VUELTA RÁPIDA: {self._nombre(dato['driver_number'])} "
                                f"marca la vuelta más rápida, {_seg(dur)}")
            return None
        if tipo == "pit":
            dur = dato.get("pit_duration")
            extra = f", parada de {_seg(dur)}" if dur else ""
            self.ultimo_pit = {"vuelta": dato.get("lap_number", self.vuelta),
                               "nombre": self._nombre(dato["driver_number"])}
            return (f"BOXES: {self._nombre(dato['driver_number'])} entra a "
                    f"boxes en la vuelta {dato.get('lap_number', '?')}{extra}")
        if tipo == "intervalo":
            n = dato["driver_number"]
            anterior = self.gaps.get(n)
            if isinstance(anterior, (int, float)):
                self.gaps_anteriores[n] = anterior
            self.gaps[n] = dato.get("interval")
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
        """Leaderboard: [{pos, acr, nombre, color, gap, pelea, neumatico}]."""
        orden = sorted(self.posiciones.items(), key=lambda kv: kv[1])
        filas = []
        for n, pos in orden[:10]:
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
            filas.append({"pos": pos,
                          "acr": p.get("acronimo", str(n)),
                          "nombre": self._nombre(n),
                          "color": p.get("color", ""),
                          "gap": gap_txt,
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
            gap_txt = detras["gap"]
            if not gap_txt:
                continue
            gap = float(gap_txt.lstrip("+"))
            if gap > 3.0:
                continue
            cercania = max(0.0, 70.0 * (1 - gap / 3.0))
            numero = next((n for n, p in self.posiciones.items()
                          if p == detras["pos"]), None)
            anterior = self.gaps_anteriores.get(numero) if numero else None
            tendencia = 0.0
            razon_tendencia = "sin lectura anterior para medir tendencia"
            if isinstance(anterior, (int, float)) and anterior > 0:
                cierre = (anterior - gap) / anterior  # >0 se acerca
                tendencia = max(-30.0, min(30.0, cierre * 30.0))
                if cierre > 0.02:
                    razon_tendencia = (f"cerrando el hueco "
                                      f"({anterior:.2f}s → {gap:.2f}s)")
                elif cierre < -0.02:
                    razon_tendencia = (f"el hueco se abre "
                                      f"({anterior:.2f}s → {gap:.2f}s)")
                else:
                    razon_tendencia = f"hueco estable en {gap:.2f}s"
            score = round(max(0.0, min(100.0, cercania + tendencia)))
            resultados.append({
                "entre": f"{delante['acr']} vs {detras['acr']}",
                "score": score,
                "pos_delante": delante["pos"],
                "pos_detras": detras["pos"],
                "razon": f"gap de {gap:.2f}s ({round(cercania)} pts de "
                        f"cercanía) — {razon_tendencia} "
                        f"({round(tendencia):+d} pts de tendencia)",
            })
        resultados.sort(key=lambda r: -r["score"])
        return resultados

    async def correr(self, al_evento):
        """Reproduce la línea de tiempo llamando a al_evento(texto)."""
        if not self._timeline:
            raise RuntimeError("timeline vacía: ¿faltó llamar a cargar()?")
        inicio_datos = self._timeline[0][0]
        inicio_real = time.monotonic()
        for fecha, tipo, dato in self._timeline:
            objetivo = (fecha - inicio_datos).total_seconds() / self.velocidad
            espera = objetivo - (time.monotonic() - inicio_real)
            if espera > 0:
                await asyncio.sleep(espera)
            texto = self._procesar(tipo, dato)
            if texto:
                al_evento(texto)
        log.info("Replay terminado: %s", self.descripcion())

"""Gráficos de telemetría propios con FastF1 + matplotlib.

AISLADO A PROPÓSITO: todo importa perezosamente y va envuelto en try/except.
Si FastF1 no está instalado o falla (red, datos aún no disponibles), las
funciones devuelven [] y el canal sigue igual — nunca rompe nada.

USO: solo POST-sesión (FastF1 descarga los datos después de la sesión, no
es en vivo). Los gráficos son 100% propios (matplotlib) → sin copyright.
"""

import logging
import os

log = logging.getLogger("graficos")

# 16:9 a 1280x720 para encajar en los videos sin recorte
_W_IN, _H_IN, _DPI = 12.8, 7.2, 100
_FONDO = "#0B0D12"
_ACENTO = "#E10600"
_TEXTO = "#E6ECF5"
# Colores por si dos pilotos coinciden de equipo
_COLORES = ["#E10600", "#27F4D2", "#F58020", "#3671C6", "#52E252"]

_MAPA_SESION = {
    "Race": "R", "Sprint": "Sprint", "Sprint Qualifying": "SQ",
    "Qualifying": "Q", "Practice 1": "FP1", "Practice 2": "FP2",
    "Practice 3": "FP3",
}


def disponible():
    """True si FastF1 y matplotlib se pueden importar."""
    try:
        import fastf1  # noqa: F401
        import matplotlib  # noqa: F401
        return True
    except Exception:
        return False


def _cargar_sesion(year, gp, sesion):
    import fastf1
    os.makedirs("cache_f1", exist_ok=True)
    fastf1.Cache.enable_cache("cache_f1")
    code = _MAPA_SESION.get(sesion, "R")
    s = fastf1.get_session(int(year), gp, code)
    s.load(telemetry=True, laps=True, weather=False, messages=False)
    return s


def _tema(ax, fig):
    fig.patch.set_facecolor(_FONDO)
    ax.set_facecolor(_FONDO)
    for spine in ax.spines.values():
        spine.set_color("#2A3340")
    ax.tick_params(colors=_TEXTO)
    ax.title.set_color(_TEXTO)
    ax.xaxis.label.set_color(_TEXTO)
    ax.yaxis.label.set_color(_TEXTO)
    ax.grid(True, color="#1C242F", linewidth=0.6)


def _grafico_velocidad(s, acr, salida):
    """Velocidad vs distancia de la vuelta rápida de 2 pilotos."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(_W_IN, _H_IN), dpi=_DPI)
    _tema(ax, fig)
    dibujados = []
    for i, d in enumerate(acr[:2]):
        try:
            lap = s.laps.pick_drivers(d).pick_fastest()
            tel = lap.get_telemetry()
            ax.plot(tel["Distance"], tel["Speed"], color=_COLORES[i],
                    linewidth=2.2, label=d)
            dibujados.append(d)
        except Exception:
            continue
    if len(dibujados) < 1:
        plt.close(fig)
        return None
    ax.set_title(f"FASTEST LAP — SPEED   {' vs '.join(dibujados)}",
                 fontsize=20, fontweight="bold", loc="left", pad=16)
    ax.set_xlabel("Distance (m)")
    ax.set_ylabel("Speed (km/h)")
    leg = ax.legend(loc="lower right", frameon=False)
    for txt in leg.get_texts():
        txt.set_color(_TEXTO)
    fig.tight_layout()
    fig.savefig(salida, facecolor=_FONDO)
    plt.close(fig)
    return salida


def _grafico_ritmo(s, acr, salida):
    """Tiempos de vuelta (ritmo de carrera) de hasta 5 pilotos."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(_W_IN, _H_IN), dpi=_DPI)
    _tema(ax, fig)
    dibujados = 0
    for i, d in enumerate(acr[:5]):
        try:
            laps = s.laps.pick_drivers(d).pick_quicklaps()
            if laps.empty:
                continue
            t = laps["LapTime"].dt.total_seconds()
            ax.plot(laps["LapNumber"], t, marker="o", markersize=3,
                    linewidth=1.6, color=_COLORES[i % len(_COLORES)], label=d)
            dibujados += 1
        except Exception:
            continue
    if dibujados < 1:
        plt.close(fig)
        return None
    ax.set_title("RACE PACE — LAP TIMES", fontsize=20, fontweight="bold",
                 loc="left", pad=16)
    ax.set_xlabel("Lap")
    ax.set_ylabel("Lap time (s)")
    leg = ax.legend(loc="upper right", frameon=False, ncol=2)
    for txt in leg.get_texts():
        txt.set_color(_TEXTO)
    fig.tight_layout()
    fig.savefig(salida, facecolor=_FONDO)
    plt.close(fig)
    return salida


def graficos_sesion(year, gp, sesion, acronimos, salida_dir):
    """Genera los gráficos de la sesión. Devuelve lista de rutas PNG (o []
    si FastF1 no está o falla). Pensado para llamarse en un hilo aparte."""
    if not disponible():
        return []
    try:
        s = _cargar_sesion(year, gp, sesion)
    except Exception as e:
        log.info("FastF1 no cargó la sesión %s %s (%s)", year, gp, e)
        return []
    os.makedirs(salida_dir, exist_ok=True)
    rutas = []
    for fn, nombre in ((_grafico_velocidad, "vel"),
                       (_grafico_ritmo, "ritmo")):
        try:
            r = fn(s, acronimos, os.path.join(salida_dir, f"g_{nombre}.png"))
            if r:
                rutas.append(r)
        except Exception as e:
            log.info("Gráfico %s falló (%s)", nombre, e)
    if rutas:
        log.info("📊 %d gráfico(s) FastF1 generados", len(rutas))
    return rutas

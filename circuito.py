"""circuito.py — El retrato de un circuito, medido de una vuelta rápida.

De dónde sale esto
──────────────────
Circulan por Instagram unas fichas de circuito muy buenas: longitud,
curva más rápida, mayor frenada, porcentaje de vuelta a fondo, tramo más
largo sin levantar. Son el arranque perfecto de una retransmisión — en
treinta segundos el que llega sabe a qué se enfrenta el coche.

Ese formato no es de nadie. Y lo que hay debajo lo podemos MEDIR
nosotros, porque el coche publica lo que hace: /car_data da velocidad,
acelerador y freno varias veces por segundo.

La idea que lo hace posible sin calibrar nada
─────────────────────────────────────────────
La distancia no hace falta pedirla: se integra. Si el coche va a 300
km/h durante 0,27 segundos, ha recorrido 22,5 metros. Sumando eso a lo
largo de la vuelta salen los metros — y con ellos el largo del trazado,
cuánta distancia se pasa por encima de 300, y cuánto mide el tramo más
largo a fondo.

Eso evita el problema de las coordenadas de OpenF1, que vienen en
unidades propias y nadie documenta a cuántos metros equivalen. Aquí no
se tocan: todo sale de velocidad y tiempo, que sí vienen en unidades
conocidas.

Comprobación honesta
────────────────────
La longitud calculada se compara con la publicada del circuito. Si no
cuadran dentro de un margen, la ficha lo DICE en vez de callarse: una
vuelta con bandera amarilla o con datos incompletos da un número que no
vale, y es mejor verlo que publicarlo.
"""

import contextlib
import logging
import math
import os

import httpx

import telemetria

log = logging.getLogger("circuito")

#: Longitud oficial publicada, en metros. Solo sirve para COMPROBAR que
#: la medición de la vuelta es sana, nunca para sustituirla.
LARGO_OFICIAL = {
    "monza": 5793, "spa-francorchamps": 7004, "silverstone": 5891,
    "zandvoort": 4259, "monaco": 3337, "suzuka": 5807, "interlagos": 4309,
    "hungaroring": 4381, "jeddah": 6174, "baku": 6003, "singapore": 4940,
    "las vegas": 6201, "austin": 5513, "melbourne": 5278, "imola": 4909,
    "barcelona": 4657, "montreal": 4361, "red bull ring": 4318,
    "mexico city": 4304, "lusail": 5419, "yas marina": 5281,
    "shanghai": 5451, "miami": 5412, "sakhir": 5412,
}

#: Umbrales de lectura. A fondo = acelerador casi al máximo y sin freno.
GAS_FONDO = 96.0
RAPIDO_KMH = 300.0


def _dt(a, b):
    return max(0.0, (b["t"] - a["t"]).total_seconds())


def medir(muestras, largo_publicado=None):
    """De las muestras de una vuelta a las cifras de la ficha.

    `muestras` = [{"t": datetime, "v": km/h, "gas": 0-100, "freno": bool}]
    tal como las devuelve `telemetria.datos_coche`.

    Todo se integra: distancia = velocidad × tiempo, sumado. Devuelve un
    dict con las cifras y con `fiable`, que dice si la vuelta da para
    publicarla.
    """
    m = [x for x in (muestras or []) if x.get("v") is not None]
    if len(m) < 30:
        return None
    metros = 0.0
    metros_rapido = 0.0
    seg_fondo = 0.0
    metros_fondo = 0.0
    # Tramo a fondo en curso y el mejor visto
    corr_m = corr_s = corr_vmax = 0.0
    mejor = {"metros": 0.0, "segundos": 0.0, "vmax": 0.0}
    frenadas = []
    en_freno = None

    for i in range(1, len(m)):
        a, b = m[i - 1], m[i]
        dt = _dt(a, b)
        if dt <= 0 or dt > 2.0:          # hueco de datos: no se inventa
            continue
        v = (a["v"] + b["v"]) / 2.0
        d = v / 3.6 * dt                  # km/h → m/s → metros
        metros += d
        if v >= RAPIDO_KMH:
            metros_rapido += d
        a_fondo = (a.get("gas", 0) >= GAS_FONDO) and not a.get("freno")
        if a_fondo:
            seg_fondo += dt
            metros_fondo += d
            corr_m += d
            corr_s += dt
            corr_vmax = max(corr_vmax, a["v"], b["v"])
        else:
            if corr_m > mejor["metros"]:
                mejor = {"metros": corr_m, "segundos": corr_s,
                         "vmax": corr_vmax}
            corr_m = corr_s = corr_vmax = 0.0
        # Frenadas: desde que pisa hasta que suelta
        if a.get("freno") and en_freno is None:
            en_freno = {"desde": a["v"], "hasta": a["v"], "metros": 0.0}
        elif en_freno is not None:
            en_freno["hasta"] = a["v"]
            en_freno["metros"] += d
            if not a.get("freno"):
                if en_freno["desde"] - en_freno["hasta"] > 30:
                    frenadas.append(en_freno)
                en_freno = None
    if corr_m > mejor["metros"]:
        mejor = {"metros": corr_m, "segundos": corr_s, "vmax": corr_vmax}
    if en_freno is not None and en_freno["desde"] - en_freno["hasta"] > 30:
        frenadas.append(en_freno)

    total_s = _dt(m[0], m[-1])
    vels = [x["v"] for x in m]
    mayor = max(frenadas, key=lambda f: f["desde"] - f["hasta"],
                default=None)

    # ¿Cuadra con la longitud publicada? Si no, la ficha lo dice.
    desvio = None
    fiable = True
    if largo_publicado:
        desvio = 100.0 * (metros - largo_publicado) / largo_publicado
        fiable = abs(desvio) <= 6.0

    return {
        "metros": round(metros),
        "segundos": round(total_s, 3),
        "vmax": round(max(vels)),
        "vmin": round(min(vels)),
        "pct_fondo": round(100.0 * seg_fondo / total_s, 1) if total_s else 0.0,
        "pct_distancia_rapida": (round(100.0 * metros_rapido / metros, 1)
                                 if metros else 0.0),
        "tramo_largo": {"metros": round(mejor["metros"]),
                        "segundos": round(mejor["segundos"], 1),
                        "vmax": round(mejor["vmax"])},
        "frenadas": len(frenadas),
        "mayor_frenada": ({"desde": round(mayor["desde"]),
                           "hasta": round(mayor["hasta"]),
                           "metros": round(mayor["metros"])}
                          if mayor else None),
        "largo_publicado": largo_publicado,
        "desvio_pct": round(desvio, 1) if desvio is not None else None,
        "fiable": fiable,
    }


async def vuelta_rapida(session_key):
    """La vuelta más rápida de la sesión: (numero_piloto, desde, hasta)."""
    async with httpx.AsyncClient(timeout=40) as c:
        cab = await telemetria._auth_headers(c)
        try:
            r = await c.get(f"{telemetria.BASE}/laps",
                            params={"session_key": session_key}, headers=cab)
            r.raise_for_status()
            filas = r.json()
        except Exception as e:
            log.info("No pude pedir las vueltas (%s)", e)
            return None
    mejor = None
    for v in filas:
        d = v.get("lap_duration")
        if not d or v.get("is_pit_out_lap") or not v.get("date_start"):
            continue
        if mejor is None or d < mejor["lap_duration"]:
            mejor = v
    if not mejor:
        return None
    import datetime as dt
    ini = telemetria._fecha(mejor["date_start"])
    return (mejor["driver_number"], ini,
            ini + dt.timedelta(seconds=float(mejor["lap_duration"])))


async def analizar(session_key, circuito=""):
    """La ficha del circuito, medida de la vuelta más rápida de esa sesión."""
    v = await vuelta_rapida(session_key)
    if not v:
        return None
    numero, desde, hasta = v
    t = telemetria.Telemetria(session_key=session_key)
    t.sesion = {"session_key": session_key}
    muestras = await t.datos_coche(numero, desde, hasta)
    if not muestras:
        log.info("Sin telemetría del coche %s en esa vuelta", numero)
        return None
    largo = LARGO_OFICIAL.get((circuito or "").strip().lower())
    ficha = medir(muestras, largo)
    if ficha:
        ficha["circuito"] = circuito
        ficha["piloto"] = numero
    return ficha


# ── El panel ──────────────────────────────────────────────────────────

def panel(ficha, salida, titulo=None, tam=(1280, 720), etiqueta=None,
          pie=None):
    """La ficha dibujada, en el estilo del canal."""
    from PIL import ImageDraw
    import diagramas as D
    if not ficha:
        return None
    w, h = tam
    corto = min(tam)
    circuito = (ficha.get("circuito") or "").strip()
    titulo = titulo or (f"{circuito}: what the lap actually asks"
                        if circuito else "What the lap actually asks")
    if pie is None:
        pie = ("Measured by us from the fastest lap's own telemetry — "
               "distance integrated from speed and time, so nothing here "
               "depends on a scale nobody publishes.")
        if not ficha.get("fiable"):
            pie = ("CHECK: our measured length is off the published figure "
                   "by " + f"{ficha.get('desvio_pct')}%. The lap may have "
                   "been interrupted — treat these numbers with care.")
    img, dib, y0, y1, m = _marco(tam, titulo, etiqueta or "Measured", pie)

    def _fmt_m(x):
        return f"{x:,}".replace(",", " ")

    filas = []
    if ficha.get("metros"):
        extra = ""
        if ficha.get("largo_publicado"):
            extra = f"published {_fmt_m(ficha['largo_publicado'])} m"
        filas.append(("LAP LENGTH", f"{_fmt_m(ficha['metros'])} m", extra))
    filas.append(("TOP SPEED", f"{ficha['vmax']} km/h",
                  f"slowest point {ficha['vmin']} km/h"))
    filas.append(("FLAT OUT", f"{ficha['pct_fondo']:.0f}%",
                  "of the lap, on full throttle and off the brake"))
    filas.append(("ABOVE 300", f"{ficha['pct_distancia_rapida']:.0f}%",
                  "of the distance"))
    tl = ficha.get("tramo_largo") or {}
    if tl.get("metros"):
        filas.append(("LONGEST RUN",
                      f"{_fmt_m(tl['metros'])} m",
                      f"{tl['segundos']:.1f} s without lifting, "
                      f"reaching {tl['vmax']} km/h"))
    mf = ficha.get("mayor_frenada")
    if mf:
        # "to" y no una flecha: el → no está en la tipografía del canal
        # y salía como un hueco en blanco entre los dos números.
        filas.append(("BIGGEST STOP",
                      f"{mf['desde']} to {mf['hasta']} km/h",
                      f"in {_fmt_m(mf['metros'])} m"))
    if ficha.get("frenadas"):
        filas.append(("BRAKING ZONES", str(ficha["frenadas"]),
                      "significant applications on the lap"))

    alto = (y1 - y0) / max(1, len(filas))
    f_et = D._fuente(int(corto * 0.026), True)
    f_val = D._fuente(int(corto * 0.062), True)
    f_nota = D._fuente(int(corto * 0.026), False)
    for i, (et, val, nota) in enumerate(filas):
        yy = y0 + alto * i
        dib.rectangle([m, yy + int(corto * .012), m + int(corto * .006),
                       yy + int(corto * .052)], fill=D.ACENTO)
        D._texto(dib, (m + int(corto * .022), yy + int(corto * .012)),
                 et, f_et, D.APAGADO, esp=int(corto * .005))
        ancho = D._texto(dib, (m + int(corto * .022), yy + int(corto * .046)),
                         val, f_val, D.TINTA)
        if nota:
            dib.text((m + int(corto * .030) + ancho,
                      yy + int(corto * .078)), nota, font=f_nota,
                     fill=D.TENUE)
        if i:
            dib.line([(m, yy + int(corto * .004)),
                      (w - m, yy + int(corto * .004))], fill=D.LINEA, width=1)
    _pie(img, dib, pie, m)
    return _guardar(img, salida)


def _marco(tam, titulo, etiqueta, pie):
    from PIL import Image, ImageDraw
    import diagramas as D
    w, h = tam
    corto = min(tam)
    img = Image.new("RGB", (w, h), D.FONDO)
    dib = ImageDraw.Draw(img)
    m = int(w * 0.06)
    y = int(h * 0.06)
    if etiqueta:
        f = D._fuente(int(corto * 0.026), True)
        dib.rectangle([m, y + int(corto * .012), m + int(corto * .038),
                       y + int(corto * .017)], fill=D.ACENTO)
        D._texto(dib, (m + int(corto * .055), y), etiqueta.upper(), f,
                 D.ACENTO, esp=int(corto * .006))
        y += int(corto * 0.050)
    if titulo:
        f = D._fuente(int(corto * 0.048), True)
        for ln in D._partir(dib, titulo, f, w - 2 * m)[:2]:
            dib.text((m, y), ln, font=f, fill=D.TINTA)
            y += int(corto * 0.060)
    return img, dib, y + int(corto * 0.018), h - int(corto * 0.10), m


def _pie(img, dib, pie, m):
    import diagramas as D
    if not pie:
        return
    w, h = img.size
    corto = min(img.size)
    f = D._fuente(int(corto * 0.023), False)
    y = h - int(corto * 0.075)
    for ln in D._partir(dib, pie, f, w - 2 * m)[:2]:
        dib.text((m, y), ln, font=f, fill=D.APAGADO)
        y += int(corto * 0.029)


def _guardar(img, salida):
    with contextlib.suppress(Exception):
        os.makedirs(os.path.dirname(os.path.abspath(salida)), exist_ok=True)
    try:
        img.save(salida, "PNG")
        return salida
    except Exception as e:
        log.info("No pude guardar la ficha (%s)", e)
        return None


def narracion(ficha):
    """La ficha dicha en voz alta, para abrir una retransmisión.

    Solo cifras medidas. Si algo no se pudo medir, no se menciona — no
    se rellena con una frase de relleno.
    """
    if not ficha:
        return ""
    c = (ficha.get("circuito") or "this circuit").strip()
    p = [f"This is what {c} actually asks of a car, measured from the "
         f"fastest lap of the session."]
    if ficha.get("metros"):
        p.append(f"{ficha['metros']:,} metres a lap.".replace(",", ","))
    p.append(f"Top speed {ficha['vmax']}, and at the slowest point of the "
             f"lap they are down to {ficha['vmin']}.")
    p.append(f"{ficha['pct_fondo']:.0f} per cent of the lap is spent flat "
             f"out, and {ficha['pct_distancia_rapida']:.0f} per cent of the "
             f"distance goes by above three hundred.")
    tl = ficha.get("tramo_largo") or {}
    if tl.get("metros"):
        p.append(f"The longest run without lifting is {tl['metros']:,} "
                 f"metres — {tl['segundos']:.0f} seconds, topping out at "
                 f"{tl['vmax']}.".replace(",", ","))
    mf = ficha.get("mayor_frenada")
    if mf:
        p.append(f"And the biggest stop of the lap takes them from "
                 f"{mf['desde']} to {mf['hasta']} in {mf['metros']} metres.")
    return " ".join(p)

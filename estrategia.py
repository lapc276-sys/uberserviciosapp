"""Modelo PROPIO de estrategia, a partir de datos MEDIDOS.

Todo lo que hay aquí sale de tres números que el canal ya mide en carrera:

  · degradación real del neumático, en segundos por vuelta (pendiente por
    mínimos cuadrados sobre vueltas limpias),
  · lo que cuesta de verdad una parada en ESE circuito (mediana de las
    paradas ya ocurridas),
  · vueltas que quedan.

Reglas de la casa:

  1. Ningún número inventado. Si falta un dato, la función devuelve None en
     vez de rellenar con un valor "típico".
  2. Cada resultado viaja con su PORQUÉ, listo para decirlo al aire o
     ponerlo en pantalla.
  3. Es un modelo de primer orden: supone que la degradación sigue siendo
     lineal y no conoce el tráfico, los coches de seguridad ni la lluvia que
     vendrá. Se presenta como estimación, nunca como profecía.

La aproximación de fondo: perder tiempo por neumático gastado crece con el
CUADRADO del largo del stint (cada vuelta va un poco más lenta que la
anterior), mientras que parar cuesta una cantidad fija cada vez. De ahí sale
el equilibrio entre parar poco y parar mucho.
"""

import logging

log = logging.getLogger("estrategia")


def _valido(*vals):
    return all(isinstance(v, (int, float)) and v is not None for v in vals)


def perdida_por_stint(vueltas, deg_s_vuelta):
    """Segundos perdidos por degradación en un stint de `vueltas` vueltas.

    Si cada vuelta se degrada `deg`, la vuelta k va deg·k más lenta que la
    primera, así que el total es deg·(n-1)·n/2 ≈ deg·n²/2.
    """
    if not _valido(vueltas, deg_s_vuelta) or vueltas <= 0:
        return 0.0
    return deg_s_vuelta * (vueltas - 1) * vueltas / 2.0


def plan_paradas(vueltas_totales, deg_s_vuelta, coste_parada_s,
                 max_paradas=3):
    """Compara planes de 1, 2, 3… paradas y devuelve el ranking.

    Devuelve [{paradas, perdida_s, stint_vueltas, motivo}] ordenado de mejor
    a peor, o None si falta algún dato medido.
    """
    if not _valido(vueltas_totales, deg_s_vuelta, coste_parada_s):
        return None
    if vueltas_totales <= 1 or coste_parada_s <= 0 or deg_s_vuelta < 0:
        return None
    planes = []
    for n in range(1, max(1, int(max_paradas)) + 1):
        stints = n + 1
        largo = vueltas_totales / stints
        # Cada stint arranca con goma nueva: la pérdida se reparte entre todos
        perdida_goma = stints * perdida_por_stint(largo, deg_s_vuelta)
        total = n * coste_parada_s + perdida_goma
        planes.append({
            "paradas": n,
            "perdida_s": round(total, 1),
            "stint_vueltas": round(largo, 1),
            "motivo": (f"{n} stop{'s' if n > 1 else ''}: "
                       f"{round(n * coste_parada_s, 1)}s in the pits + "
                       f"{round(perdida_goma, 1)}s lost to tyre wear over "
                       f"{stints} stints of ~{round(largo)} laps"),
        })
    planes.sort(key=lambda p: p["perdida_s"])
    return planes


def recomendacion_paradas(vueltas_totales, deg_s_vuelta, coste_parada_s,
                          muestras_deg=None, muestras_parada=None):
    """Plan recomendado + margen sobre la alternativa, con su explicación.

    `muestras_*` son cuántas medidas respaldan cada número: si son pocas, el
    resultado se marca como poco fiable en vez de ocultarlo.
    """
    planes = plan_paradas(vueltas_totales, deg_s_vuelta, coste_parada_s)
    if not planes:
        return None
    mejor, segundo = planes[0], planes[1] if len(planes) > 1 else None
    margen = (round(segundo["perdida_s"] - mejor["perdida_s"], 1)
              if segundo else None)
    # Con poco respaldo o con dos planes casi empatados, hay que decirlo
    flojo = ((muestras_deg is not None and muestras_deg < 6)
             or (muestras_parada is not None and muestras_parada < 3))
    ajustado = margen is not None and margen < 3.0
    if flojo:
        confianza = "low"
    elif ajustado:
        confianza = "close"
    else:
        confianza = "clear"
    texto = mejor["motivo"]
    if segundo and margen is not None:
        texto += (f" — that is {margen}s better than "
                  f"{segundo['paradas']} stop"
                  f"{'s' if segundo['paradas'] > 1 else ''}")
    if confianza == "low":
        texto += " (few measurements so far — treat as a first read)"
    elif confianza == "close":
        texto += " (too close to call, traffic or a safety car would decide)"
    return {"paradas": mejor["paradas"], "perdida_s": mejor["perdida_s"],
            "stint_vueltas": mejor["stint_vueltas"], "margen_s": margen,
            "confianza": confianza, "planes": planes, "motivo": texto}


def conviene_parar_ahora(vueltas_restantes, deg_s_vuelta, edad_neumatico,
                         coste_parada_s):
    """¿Sale a cuenta parar YA o aguantar hasta el final?

    Aguantar: el neumático ya está `edad` vueltas gastado, así que cada
    vuelta que queda se paga a deg·edad, y encima sigue empeorando.
    Parar: se paga la parada una vez, pero se arranca de cero.
    """
    if not _valido(vueltas_restantes, deg_s_vuelta, edad_neumatico,
                   coste_parada_s):
        return None
    if vueltas_restantes <= 0:
        return None
    seguir = (deg_s_vuelta * edad_neumatico * vueltas_restantes
              + perdida_por_stint(vueltas_restantes, deg_s_vuelta))
    parar = coste_parada_s + perdida_por_stint(vueltas_restantes,
                                               deg_s_vuelta)
    dif = round(seguir - parar, 1)
    return {
        "parar": dif > 0,
        "ganancia_s": abs(dif),
        "motivo": (
            f"stopping now costs {round(coste_parada_s, 1)}s but saves "
            f"{round(deg_s_vuelta * edad_neumatico * vueltas_restantes, 1)}s "
            f"of worn-tyre pace over the remaining {int(vueltas_restantes)} "
            f"laps → {'box now' if dif > 0 else 'stay out'} by "
            f"{abs(dif)}s"),
    }


def ventana_undercut(gap_s, deg_s_vuelta, edad_neumatico, vueltas_restantes=None):
    """¿Tiene el de atrás ventana de undercut?

    La goma nueva rinde aproximadamente deg·edad segundos por vuelta más que
    la usada del de delante. Si ese ritmo extra recupera el hueco antes de
    que el de delante reaccione, el undercut está vivo.
    """
    if not _valido(gap_s, deg_s_vuelta, edad_neumatico):
        return None
    ventaja = deg_s_vuelta * edad_neumatico          # s/vuelta de goma nueva
    if ventaja <= 0.001:
        return {"activo": False, "ventaja_s_vuelta": round(ventaja, 3),
                "vueltas": None,
                "motivo": "tyres are barely degrading — no undercut on"}
    vueltas = gap_s / ventaja
    activo = vueltas <= 3.0
    if vueltas_restantes is not None and vueltas > vueltas_restantes:
        activo = False
    return {
        "activo": activo,
        "ventaja_s_vuelta": round(ventaja, 3),
        "vueltas": round(vueltas, 1),
        "motivo": (
            f"fresh rubber is worth about {round(ventaja, 2)}s a lap here, so "
            f"closing a {round(gap_s, 2)}s gap takes ~{round(vueltas, 1)} "
            f"laps — {'undercut is ON' if activo else 'not enough for an undercut'}"),
    }

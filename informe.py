"""informe.py — Qué tienen en común los videos que aguantan.

Para qué existe
────────────────
Los videos ya publicados no se pueden reeditar: YouTube no deja cambiar
el archivo. Pero cada uno de ellos se armó tomando decisiones que quedaron
apuntadas —si llevaba diagrama, de qué temática era, si entró en el grupo
con metraje de stock, qué titular tenía— y ahora hay retención medida para
cruzarlas.

Así que el archivo no arregla nada: busca en qué se diferencian los que
retuvieron de los que no, para dejar de repetir lo que no funciona.

Cómo evita decir tonterías
───────────────────────────
Con 155 videos es facilísimo encontrar coincidencias que no significan
nada. Tres reglas:

1. MÍNIMO POR GRUPO. Una comparación con tres videos a un lado no se
   publica. Tres videos son tres tiradas de dado.
2. DIFERENCIA MÍNIMA. Por debajo de unos puntos, la diferencia entra
   dentro de lo que varía un video y otro por puro azar.
3. SE DICE EL TAMAÑO. Cada hallazgo lleva cuántos videos hay a cada lado,
   para que se pueda desconfiar de él con conocimiento.

Y ninguna de estas frases demuestra una causa. Que los videos con
diagrama retengan más puede ser por el diagrama, o porque los temas que
piden diagrama son de por sí más interesantes. Lo que da es una pista
que merece probarse, no una conclusión.
"""

import logging

log = logging.getLogger("informe")

#: Mínimo de videos a CADA lado de una comparación.
MIN_GRUPO = 8
#: Diferencia mínima en puntos de retención para contarla.
MIN_DIFERENCIA = 3.0
#: Vistas mínimas para que un video entre en el análisis. Por debajo, su
#: retención es lo que hicieron dos personas.
MIN_VISTAS = 30


def _media(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return sum(xs) / len(xs) if xs else None


def _mediana(xs):
    xs = sorted(x for x in xs if isinstance(x, (int, float)))
    if not xs:
        return None
    m = len(xs) // 2
    return xs[m] if len(xs) % 2 else (xs[m - 1] + xs[m]) / 2


def _grupo(muestras, prueba):
    return [m for m in muestras if prueba(m)]


def _comparar(muestras, etiqueta, prueba, si="sí", no="no"):
    """Compara los que cumplen algo contra los que no. None si no da."""
    a = _grupo(muestras, prueba)
    b = [m for m in muestras if m not in a]
    if len(a) < MIN_GRUPO or len(b) < MIN_GRUPO:
        return None
    ra, rb = _media([m["retencion"] for m in a]), _media(
        [m["retencion"] for m in b])
    if ra is None or rb is None:
        return None
    dif = ra - rb
    if abs(dif) < MIN_DIFERENCIA:
        return None
    return {
        "sobre": etiqueta,
        "mejor": si if dif > 0 else no,
        "diferencia": round(abs(dif), 1),
        "con": {"n": len(a), "retencion": round(ra, 1),
                "vistas_medianas": _mediana([m["vistas"] for m in a])},
        "sin": {"n": len(b), "retencion": round(rb, 1),
                "vistas_medianas": _mediana([m["vistas"] for m in b])},
        "frase": (f"Los que {si} retienen {abs(dif):.1f} puntos "
                  f"{'más' if dif > 0 else 'menos'} "
                  f"({ra:.0f}% con {len(a)} videos frente a {rb:.0f}% "
                  f"con {len(b)})"),
    }


def hallazgos(muestras):
    """Las diferencias que aguantan las tres reglas de arriba.

    `muestras` = [{retencion, vistas, categoria, diagrama, serie,
    video_stock, tipo, titulo, duracion}] — un elemento por video
    publicado que tenga retención medida.
    """
    m = [x for x in (muestras or [])
         if (x.get("vistas") or 0) >= MIN_VISTAS
         and isinstance(x.get("retencion"), (int, float))]
    if len(m) < MIN_GRUPO * 2:
        return {"suficiente": False, "videos": len(m),
                "hacen_falta": MIN_GRUPO * 2}

    pruebas = [
        ("llevar un diagrama propio", lambda x: bool(x.get("diagrama")),
         "llevan diagrama", "no lo llevan"),
        ("pertenecer a una serie", lambda x: bool(x.get("serie")),
         "van en serie", "van sueltos"),
        ("llevar metraje de vídeo", lambda x: bool(x.get("video_stock")),
         "llevan vídeo", "solo llevan fotos"),
        ("salir de un titular real",
         lambda x: bool(x.get("fuente_titulares")),
         "salen de una noticia", "son de tema fijo"),
        ("ser de noticias", lambda x: (x.get("tipo") or "") == "noticia",
         "son de noticias", "son técnicos"),
        # El título: interrogación y cifras son los dos ganchos que más
        # se repiten en los manuales. Aquí se comprueba si es verdad AQUÍ.
        ("un título con pregunta",
         lambda x: "?" in (x.get("titulo") or ""),
         "preguntan en el título", "no preguntan"),
        ("un título con una cifra",
         lambda x: any(c.isdigit() for c in (x.get("titulo") or "")),
         "llevan una cifra en el título", "no la llevan"),
        ("un título largo",
         lambda x: len(x.get("titulo") or "") > 55,
         "tienen título largo", "lo tienen corto"),
    ]
    fuera = []
    for etq, prueba, si, no in pruebas:
        with_ = None
        try:
            with_ = _comparar(m, etq, prueba, si, no)
        except Exception as e:
            log.info("Comparación '%s' falló (%s)", etq, e)
        if with_:
            fuera.append(with_)
    fuera.sort(key=lambda f: -f["diferencia"])

    # Por temática, que es la comparación de más de dos grupos.
    cats = {}
    for x in m:
        c = (x.get("categoria") or "").strip()
        if c:
            cats.setdefault(c, []).append(x)
    por_cat = sorted(
        ({"categoria": c, "n": len(v),
          "retencion": round(_media([y["retencion"] for y in v]), 1),
          "vistas_medianas": _mediana([y["vistas"] for y in v])}
         for c, v in cats.items() if len(v) >= MIN_GRUPO // 2),
        key=lambda d: -d["retencion"])

    return {
        "suficiente": True,
        "videos": len(m),
        "retencion_mediana": round(_mediana([x["retencion"] for x in m]), 1),
        "hallazgos": fuera,
        "por_categoria": por_cat,
    }


# ── El perfil medio: dónde se va la gente, en todos a la vez ──────────

def perfil(curvas, puntos=21):
    """La curva MEDIA de varios videos, remuestreada a `puntos`.

    Un video suelto tiene ruido; veinte promediados enseñan la forma real
    de cómo abandona la audiencia de ESTE canal. Y esa forma es la que
    dice si el problema está en el gancho —se van en los primeros
    segundos— o en el desarrollo, que son dos arreglos distintos.
    """
    curvas = [sorted(c, key=lambda p: p.get("ratio", 0))
              for c in (curvas or []) if c and len(c) >= 10]
    if not curvas:
        return []
    fuera = []
    for i in range(puntos):
        r = i / (puntos - 1)
        vals = []
        for c in curvas:
            # El punto más cercano de cada curva a esa posición.
            vals.append(min(c, key=lambda p: abs(p["ratio"] - r))["visto"])
        fuera.append({"ratio": round(r, 3),
                      "visto": round(sum(vals) / len(vals), 4),
                      "videos": len(vals)})
    return fuera


def lectura_perfil(perf):
    """Qué dice la forma de la curva media, en una frase."""
    if len(perf) < 5:
        return ""
    def en(r):
        return min(perf, key=lambda p: abs(p["ratio"] - r))["visto"]
    p10, p50, p90 = en(0.10), en(0.50), en(0.90)
    partes = [f"al 10% del video queda el {p10 * 100:.0f}%, "
              f"a la mitad el {p50 * 100:.0f}% y al 90% el {p90 * 100:.0f}%"]
    # La caída del arranque contra la del resto. Si la mayor parte de la
    # pérdida ocurre en el primer décimo, el problema es el GANCHO y no
    # el contenido — y son arreglos distintos.
    caida_inicio = 1.0 - p10
    caida_resto = p10 - p90
    if caida_inicio > caida_resto and caida_inicio > 0.2:
        partes.append("la mayor parte de la gente se va en el primer 10% "
                      "del video: el problema está en el arranque, no en "
                      "el desarrollo")
    elif caida_resto > caida_inicio * 1.5:
        partes.append("el arranque aguanta y la pérdida es gradual: el "
                      "gancho funciona y lo que se cae es el desarrollo")
    return " · ".join(partes) + "."

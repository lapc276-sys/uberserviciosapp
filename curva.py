"""curva.py — Dónde se va la gente, y QUÉ había en pantalla cuando se fue.

El límite que hay que decir primero
───────────────────────────────────
YouTube NO deja sustituir el archivo de un video ya publicado. No existe
"subir la versión corregida": o se deja como está, o se borra y se sube
otro, que es un video nuevo con URL nueva y sin las visitas, comentarios
ni el historial que el algoritmo ya le había construido. Así que la idea
de reeditar un video viejo con lo aprendido no se puede hacer, y este
archivo no lo intenta.

Lo que sí se puede, y vale más
───────────────────────────────
YouTube publica la CURVA de retención: cuánta gente seguía viendo en cada
punto del video. Eso dice DÓNDE se van. Lo que no dice —y es la mitad que
importa— es QUÉ había en pantalla en ese momento.

Nosotros sí lo sabemos, porque montamos el video. Desde que el montador
guarda su plan de tomas, cada video publicado lleva apuntado qué se veía
en cada segundo. Cruzar las dos cosas convierte "se van en el 40%" en
"se van en la cuarta foto de archivo seguida, y aguantan en los gráficos
propios" — que ya es una instrucción para el siguiente video.

Y el siguiente video es el sitio donde esto sirve. No se arregla el que
ya está: se deja de repetir el error en los que vienen.
"""

import logging

log = logging.getLogger("curva")

#: Caída mínima entre dos puntos para considerarla una fuga y no ruido.
#: La curva siempre baja; lo interesante es dónde baja MÁS DE LA CUENTA.
CAIDA_MINIMA = 0.04

#: Cuántos puntos de curva hacen falta para que el análisis signifique
#: algo. YouTube da unos cien en un video con tráfico; con menos de veinte
#: el video no tuvo bastantes reproducciones y cualquier lectura sería
#: inventada.
PUNTOS_MINIMOS = 20


def _elemento(montaje, segundo):
    """Qué había en pantalla en ese segundo. None si no se sabe."""
    for t in (montaje or []):
        if t.get("desde", 0) <= segundo < t.get("hasta", 0):
            return t
    return None


def fugas(curva, montaje=None, duracion=None, n=5):
    """Los puntos donde MÁS gente se fue, con lo que había en pantalla.

    Devuelve [{"ratio", "segundo", "caida", "visto", "tipo", "archivo"}]
    de mayor a menor caída. `duracion` en segundos permite traducir la
    posición relativa que da YouTube a un segundo concreto del montaje.
    """
    curva = sorted(curva or [], key=lambda p: p.get("ratio", 0))
    if len(curva) < PUNTOS_MINIMOS:
        return []
    fuera = []
    for i in range(1, len(curva)):
        caida = curva[i - 1]["visto"] - curva[i]["visto"]
        if caida < CAIDA_MINIMA:
            continue
        ratio = curva[i]["ratio"]
        seg = ratio * duracion if duracion else None
        el = _elemento(montaje, seg) if seg is not None else None
        fuera.append({
            "ratio": round(ratio, 3),
            "segundo": round(seg, 1) if seg is not None else None,
            "caida": round(caida, 4),
            "visto": round(curva[i]["visto"], 4),
            "tipo": (el or {}).get("tipo"),
            "archivo": (el or {}).get("archivo"),
        })
    fuera.sort(key=lambda f: -f["caida"])
    return fuera[:n]


def por_tipo(curva, montaje, duracion):
    """Cuánto retiene CADA TIPO de toma: foto, gráfico propio o clip.

    Esta es la lectura que sirve para el siguiente video. Si los gráficos
    aguantan y las fotos de archivo pierden gente, la conclusión no es
    "arreglar el video de ayer": es meter más gráficos en el de mañana.

    Devuelve {tipo: {"tomas", "caida_media", "visto_medio"}}.
    """
    curva = sorted(curva or [], key=lambda p: p.get("ratio", 0))
    if len(curva) < PUNTOS_MINIMOS or not montaje or not duracion:
        return {}
    acc = {}
    for i in range(1, len(curva)):
        seg = curva[i]["ratio"] * duracion
        el = _elemento(montaje, seg)
        if not el:
            continue
        a = acc.setdefault(el["tipo"], {"n": 0, "caida": 0.0, "visto": 0.0})
        a["n"] += 1
        a["caida"] += curva[i - 1]["visto"] - curva[i]["visto"]
        a["visto"] += curva[i]["visto"]
    return {t: {"tomas": a["n"],
                # Por punto de curva, no total: si no, el tipo que más
                # tiempo ocupa saldría siempre como el peor solo por
                # aparecer más.
                "caida_media": round(a["caida"] / a["n"], 4),
                "visto_medio": round(a["visto"] / a["n"], 4)}
            for t, a in acc.items() if a["n"]}


def veredicto(curva, montaje=None, duracion=None):
    """La lectura en una línea, con las cifras que la sostienen.

    Devuelve "" cuando no hay bastante para decir nada. Ese caso es
    frecuente y es correcto: la mayoría de los videos de un canal nuevo
    no acumulan reproducciones para tener curva, y decir algo igualmente
    sería inventarlo.
    """
    curva = sorted(curva or [], key=lambda p: p.get("ratio", 0))
    if len(curva) < PUNTOS_MINIMOS:
        return ""
    # Cuánta gente llega a la mitad y al final. Son las dos cifras que
    # resumen un video largo mejor que la media.
    def en(r):
        cerca = min(curva, key=lambda p: abs(p["ratio"] - r))
        return cerca["visto"]
    partes = [f"llega a la mitad el {en(0.5) * 100:.0f}% "
              f"y al final el {en(0.95) * 100:.0f}%"]

    tipos = por_tipo(curva, montaje, duracion)
    # Se comparan por CAÍDA, no por cuánta audiencia quedaba.
    #
    # "Cuánta quedaba" está contaminado por la posición: la curva baja
    # siempre, así que lo que sale al final del video tiene menos
    # audiencia POR SALIR AL FINAL, no por ser peor. Comparar tipos con
    # esa cifra premiaría a lo que va al principio y castigaría a lo que
    # va al final, dijera lo que dijera el contenido.
    #
    # La caída mientras ese tipo está en pantalla no depende de dónde
    # esté: mide cuánta gente se marcha DURANTE esa toma.
    utiles = {t: d for t, d in tipos.items() if d["tomas"] >= 5}
    if len(utiles) >= 2:
        mejor = min(utiles.items(), key=lambda kv: kv[1]["caida_media"])
        peor = max(utiles.items(), key=lambda kv: kv[1]["caida_media"])
        if mejor[0] != peor[0]:
            a, b = mejor[1]["caida_media"], peor[1]["caida_media"]
            dif = (b - a) * 100          # en PUNTOS de audiencia
            if dif >= 0.15:
                # Se dice como cociente ("el triple") porque se entiende
                # mejor que una diferencia de décimas de punto. Pero solo
                # cuando el mejor no es casi cero: dividir entre 0,0001
                # da "mil veces mejor", que es aritmética, no información.
                if a >= 0.0005 and b / a >= 1.5:
                    partes.append(f"se va {b / a:.0f} veces más gente "
                                  f"en {peor[0]} que en {mejor[0]}")
                else:
                    partes.append(
                        f"en {peor[0]} se pierden {dif:.1f} puntos más de "
                        f"audiencia por tramo que en {mejor[0]}")
    f = fugas(curva, montaje, duracion, n=1)
    if f and f[0].get("tipo"):
        partes.append(f"la mayor fuga cae en un(a) {f[0]['tipo']} "
                      f"del segundo {f[0]['segundo']:.0f}")
    elif f:
        partes.append(f"la mayor fuga está en el "
                      f"{f[0]['ratio'] * 100:.0f}% del video")
    return " · ".join(partes) + "."

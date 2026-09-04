"""prioridad.py — Qué tema toca, y por qué ese.

Hasta ahora los temas se elegían con `random.choice`. Esto los ordena por
lo que se puede esperar de ellos, combinando tres cosas: una apuesta de
partida, el momento del calendario, y lo que YA midió el canal.

Las tres piezas y quién manda
──────────────────────────────
1. PESO DE PARTIDA (`PESOS`): la apuesta a priori de cada temática.
2. VENTANA (`factor_ventana`): qué toca según el día del fin de semana
   de carrera. Un análisis de degradación el lunes vale; el jueves no.
3. RENDIMIENTO MEDIDO (`Historial`): lo que la retención real dice.

La regla de convivencia es lo importante: **el peso de partida es una
hipótesis y el dato medido es la prueba, así que la prueba gana según se
va acumulando.** Con dos videos de una temática no se sabe nada y manda
la hipótesis; con treinta, mandan los números.

Eso no es un adorno teórico. Este canal tiene un caso concreto: la
temática de tecnología prohibida es historia —a la que la matriz de
partida daría un peso bajo— y es de lo que mejor le ha funcionado. Si
los pesos fijos mandaran siempre, el sistema seguiría castigando su
mejor contenido para siempre. Por eso el peso fijo solo decide mientras
no hay datos.

Por qué NO se elige siempre el mejor
─────────────────────────────────────
Coger siempre el de más puntuación tiene dos problemas: el canal publica
lo mismo hasta cansar, y —peor— nunca se entera de si lo que descartó
habría funcionado, porque deja de probarlo. Un tema con dos muestras
malas quedaría enterrado sin llegar a saberse si tuvo mala suerte.

Así que se sortea CON LOS PESOS: lo bueno sale mucho más a menudo, pero
todo sigue teniendo una posibilidad. Es la diferencia entre explotar lo
que sabes y seguir aprendiendo.
"""

import json
import logging
import math
import os
import random

log = logging.getLogger("prioridad")

#: Dónde se guarda lo medido por temática.
ARCHIVO = os.path.join("datos", "rendimiento.json")

#: Peso de partida por temática. Son la HIPÓTESIS, no la verdad: en
#: cuanto haya retención medida, los números mandan sobre esto.
#:
#: Las claves son las categorías que ya usa el canal en `_TEMAS_TECNICOS`
#: más las de actualidad. Los valores vienen de la matriz acordada:
#: fichajes 1.5, técnico 1.2, polémica/reglamento 1.0, historia 0.7.
PESOS = {
    # Mercado de pilotos: mucho volumen de búsqueda y titular fácil.
    "Silly season": 1.5,
    "News": 1.3,
    # Técnico y telemetría: menos búsquedas, pero retiene y da comentarios
    # de calidad. Es además lo que este canal sabe hacer y otros no.
    "Aero": 1.2,
    "Engine": 1.2,
    "Tyres": 1.2,
    "Strategy": 1.2,
    "Telemetry": 1.2,
    # Reglamento y polémica: pico corto, poca permanencia.
    "Rules": 1.0,
    "Controversy": 1.0,
    # Historia: peso bajo DE PARTIDA, y ojo — ver la nota de arriba. En
    # este canal "Banned tech" ha rendido por encima de lo que este 0.7
    # sugiere, y el historial está para corregirlo solo.
    "Tech history": 0.7,
    "Banned tech": 0.7,
}
#: Para una categoría que no esté en la tabla.
PESO_POR_DEFECTO = 1.0

#: Cuántas muestras hacen falta para fiarse del dato en vez de la
#: hipótesis. Con N0 muestras, el dato pesa la mitad; con el triple, tres
#: cuartos. Ocho es aproximadamente una semana de shorts de una temática.
N0_CONFIANZA = 8.0
#: Cuánto puede mover el rendimiento medido al peso de partida.
#:
#: Se aplica como EXPONENTE sobre el cociente (retención de la temática
#: entre retención del canal), no como suma. Dos motivos:
#:
#: - Es simétrico: una temática que retiene el doble sube tanto como baja
#:   una que retiene la mitad. Con la fórmula lineal que tenía antes, el
#:   castigo y el premio no eran del mismo tamaño.
#: - Deja que la prueba gane de verdad. Con la versión lineal, una
#:   temática con 58% de retención medida en veinte videos seguía por
#:   detrás de otra con 24% solo porque su peso de partida era el doble.
#:   Eso convierte la hipótesis en dogma, que es justo lo que no debe ser.
FUERZA_HISTORIAL = 1.5

#: Cuánto más probable es el mejor frente al peor en el sorteo. Con la
#: temperatura a 1 el sorteo es proporcional al peso; más baja concentra
#: en los buenos, más alta reparte. 0.7 explota bastante sin cerrar la
#: puerta a nada.
TEMPERATURA = 0.7

# ── La ventana de oportunidad ─────────────────────────────────────────
#
# El calendario manda sobre el peso: durante el fin de semana de carrera
# la gente busca ESA carrera, y un documental de historia compite contra
# algo que el espectador quiere ahora. Fuera de carrera se invierte.
#
# `dias_al_gp` es negativo antes de la carrera y positivo después.

#: Multiplicadores por fase del fin de semana. La clave es la fase; el
#: valor, {categoría: factor}. Lo que no aparece se queda en 1.0.
VENTANAS = {
    # Jueves a domingo: solo importa el circuito que está rodando.
    "gp": {"Telemetry": 1.6, "Strategy": 1.4, "Aero": 1.2, "Engine": 1.1,
           "Tyres": 1.3, "News": 1.1,
           "Tech history": 0.5, "Banned tech": 0.6},
    # Lunes a miércoles: la resaca de la carrera. Degradación, estrategia
    # de boxes y decisiones de comisarios, que es lo que se discute.
    "post": {"Strategy": 1.5, "Tyres": 1.5, "Controversy": 1.4,
             "Rules": 1.3, "Telemetry": 1.2,
             "Tech history": 0.8, "Banned tech": 0.9},
    # Semana sin carrera: es cuando la historia y el mercado respiran.
    "libre": {"Tech history": 1.4, "Banned tech": 1.4, "Silly season": 1.3,
              "Telemetry": 0.8, "Strategy": 0.9},
}


def fase(dias_al_gp):
    """En qué parte del calendario estamos.

    `dias_al_gp`: días hasta la próxima carrera (negativo), o desde la
    última (positivo). None si no se sabe → semana libre, que es la
    hipótesis menos arriesgada: no fuerza contenido de circuito cuando
    a lo mejor no hay circuito.
    """
    if dias_al_gp is None:
        return "libre"
    # De jueves (-3) al domingo (0) es fin de semana de carrera.
    if -3 <= dias_al_gp <= 0:
        return "gp"
    # Lunes a miércoles después de correr.
    if 1 <= dias_al_gp <= 3:
        return "post"
    return "libre"


def factor_ventana(categoria, dias_al_gp):
    return VENTANAS.get(fase(dias_al_gp), {}).get(categoria, 1.0)


# ── Lo que el canal ya midió ──────────────────────────────────────────

class Historial:
    """Retención y CTR medidos, agrupados por temática.

    Se guarda como {categoria: {"n", "retencion", "ctr", "vistas"}} donde
    los valores son MEDIAS. Se puede recalcular entero desde YouTube en
    cualquier momento, así que si el archivo se pierde no pasa nada.
    """

    def __init__(self, datos=None):
        self.cats = dict(datos or {})

    # -- carga y guardado --
    @classmethod
    def cargar(cls, ruta=ARCHIVO):
        try:
            with open(ruta, encoding="utf-8") as f:
                d = json.load(f)
            return cls(d.get("categorias") or {})
        except Exception:
            return cls()

    def guardar(self, ruta=ARCHIVO):
        try:
            os.makedirs(os.path.dirname(ruta) or ".", exist_ok=True)
            with open(ruta, "w", encoding="utf-8") as f:
                json.dump({"categorias": self.cats}, f,
                          ensure_ascii=False, indent=1)
            return True
        except Exception as e:
            log.info("No pude guardar el rendimiento (%s)", e)
            return False

    # -- construcción desde las filas de YouTube --
    def recalcular(self, muestras):
        """`muestras` = [{"categoria", "retencion", "ctr", "vistas"}].

        Se ignoran las muestras sin categoría (no se sabe de qué tema
        salieron) y las de muy pocas vistas: con una visita, la retención
        es lo que hizo una persona, no una señal.
        """
        acc = {}
        for m in muestras:
            cat = (m.get("categoria") or "").strip()
            if not cat:
                continue
            a = acc.setdefault(cat, {"n": 0, "ret": 0.0, "ctr": 0.0,
                                     "nctr": 0, "vistas": 0})
            a["n"] += 1
            a["ret"] += float(m.get("retencion") or 0.0)
            a["vistas"] += int(m.get("vistas") or 0)
            # El CTR puede no venir: en Shorts no existe una miniatura que
            # se pulse, y la API solo lo da donde lo hay. Se promedia
            # aparte para no hundirlo con ceros que no son ceros.
            if m.get("ctr") is not None:
                a["ctr"] += float(m["ctr"])
                a["nctr"] += 1
        self.cats = {
            c: {"n": a["n"],
                "retencion": round(a["ret"] / a["n"], 2),
                "ctr": (round(a["ctr"] / a["nctr"], 2) if a["nctr"] else None),
                "vistas": a["vistas"]}
            for c, a in acc.items() if a["n"]}
        return self.cats

    # -- lecturas --
    def retencion_canal(self):
        """Retención media del canal, ponderada por número de videos."""
        n = sum(c["n"] for c in self.cats.values())
        if not n:
            return None
        return sum(c["retencion"] * c["n"] for c in self.cats.values()) / n

    def ajuste(self, categoria):
        """Cuánto corrige el dato medido al peso de partida.

        Devuelve un multiplicador alrededor de 1.0. La confianza crece
        con las muestras: `n / (n + N0)`. Con pocas, el ajuste tiende a 1
        y manda la hipótesis; con muchas, se acerca a la diferencia real.
        """
        c = self.cats.get(categoria)
        base = self.retencion_canal()
        if not c or not base or not c.get("retencion"):
            return 1.0
        confianza = c["n"] / (c["n"] + N0_CONFIANZA)
        razon = c["retencion"] / base          # 1.4 = retiene un 40% más
        # Potencia y no suma: ver la nota de FUERZA_HISTORIAL. El tope
        # evita que una temática con cuatro videos afortunados se coma el
        # canal entero antes de que haya muestras para saberlo.
        return max(0.25, min(3.0,
                             razon ** (confianza * FUERZA_HISTORIAL)))

    def destacadas(self, umbral=0.15, minimo=4):
        """Temáticas que superan la media del canal por `umbral`.

        Son las de "alta relevancia": las que merecen que se les dedique
        más. Se exige un mínimo de muestras para no coronar a una
        temática por un solo video con suerte.
        """
        base = self.retencion_canal()
        if not base:
            return []
        fuera = [(c, d) for c, d in self.cats.items()
                 if d["n"] >= minimo and d["retencion"] >= base * (1 + umbral)]
        return sorted(fuera, key=lambda cd: -cd[1]["retencion"])


# ── La puntuación y el sorteo ─────────────────────────────────────────

def puntuar(categoria, historial=None, dias_al_gp=None):
    """Cuánto vale ahora mismo un tema de esa temática."""
    peso = PESOS.get(categoria, PESO_POR_DEFECTO)
    ventana = factor_ventana(categoria, dias_al_gp)
    ajuste = historial.ajuste(categoria) if historial else 1.0
    return max(0.01, peso * ventana * ajuste)


def elegir(temas, historial=None, dias_al_gp=None, n=1, categoria=None,
           azar=None):
    """Elige `n` temas de la lista, sorteando con los pesos.

    `temas` es una lista de tuplas cuyo PRIMER elemento es la categoría
    (el formato de `_TEMAS_TECNICOS`), o de diccionarios con la clave
    `categoria`. `categoria` permite pasar otra función extractora.

    Devuelve una lista sin repetidos. Si algo va mal, devuelve una
    selección al azar: la elección de tema nunca debe tumbar la
    producción del día.
    """
    r = azar or random
    temas = list(temas or [])
    if not temas:
        return []
    if categoria is None:
        def categoria(t):
            if isinstance(t, dict):
                return t.get("categoria", "")
            return t[0] if isinstance(t, (list, tuple)) and t else ""
    try:
        cats = [categoria(t) for t in temas]
        # Se reparte el peso de la temática ENTRE SUS TEMAS. Sin esto, una
        # categoría con dieciséis temas sale cuatro veces más que otra con
        # cuatro aunque pesen igual, y la matriz de pesos deja de
        # significar lo que dice: mandaría el tamaño de la lista.
        cuantos = {}
        for c in cats:
            cuantos[c] = cuantos.get(c, 0) + 1
        # ORDEN IMPORTANTE: primero la temperatura sobre el peso de la
        # CATEGORÍA, y solo después se reparte entre sus temas.
        #
        # Al revés —dividir y luego elevar— la suma de una categoría con n
        # temas sale multiplicada por n^(1-1/T), o sea que las listas
        # largas se llevaban un castigo extra que nadie pidió. Con la
        # temperatura en 0.7 y dieciséis temas eso era un factor 0,3: la
        # temática de mejor retención medida caía al último puesto.
        exp = 1.0 / max(0.05, TEMPERATURA)
        pesos = [(puntuar(c, historial, dias_al_gp) ** exp) / cuantos[c]
                 for c in cats]
        fuera, quedan, pq = [], list(temas), list(pesos)
        for _ in range(min(n, len(quedan))):
            total = sum(pq)
            if total <= 0:
                fuera.append(quedan.pop(r.randrange(len(quedan))))
                pq.pop(0)
                continue
            corte, acum = r.random() * total, 0.0
            for i, p in enumerate(pq):
                acum += p
                if acum >= corte:
                    fuera.append(quedan.pop(i))
                    pq.pop(i)
                    break
        return fuera
    except Exception as e:
        log.info("Sorteo de temas falló (%s) — voy al azar", e)
        return r.sample(temas, k=min(n, len(temas)))


def explicacion(categoria, historial=None, dias_al_gp=None):
    """Por qué esa temática puntúa lo que puntúa, en una línea.

    Para el registro: si un día el canal se pone a publicar solo de una
    cosa, esto dice si fue la hipótesis, el calendario o los números.
    """
    peso = PESOS.get(categoria, PESO_POR_DEFECTO)
    v = factor_ventana(categoria, dias_al_gp)
    a = historial.ajuste(categoria) if historial else 1.0
    c = (historial.cats.get(categoria) if historial else None) or {}
    tot = puntuar(categoria, historial, dias_al_gp)
    partes = [f"peso {peso:.2f}", f"ventana {fase(dias_al_gp)} x{v:.2f}"]
    if c.get("n"):
        partes.append(f"medido x{a:.2f} ({c['retencion']:.0f}% en "
                      f"{c['n']} videos)")
    else:
        partes.append("sin datos aún")
    return f"{categoria}: {tot:.2f} = " + " · ".join(partes)

"""esquemas_2026.py — Geometría propia de las piezas de las que se habla.

Para explicar la pieza de un equipo hace falta enseñar cómo está
dispuesta. La lámina de quien la dibujó no se puede usar —es su obra, y
girarla o cambiarle el color la convierte en obra derivada, no en obra
nuestra—, pero el HECHO de cómo están colocadas las piezas no es de
nadie.

Así que estas coordenadas están escritas a mano a partir de la
descripción publicada y verificada, no de mirar ningún dibujo. Salen en
el modo esquema —rejilla y neón sobre negro— que es deliberadamente lo
contrario de una ilustración técnica al uso: nadie va a confundir uno de
estos con el trabajo de otro.

Cada conjunto declara su propia proporción: un corte lateral mide unas
tres veces más de largo que de alto, y sin decirlo se deformaría al
dibujarlo en un lienzo vertical.
"""
import diagramas as D

#: Proporción propia de un corte lateral de la cola del coche
ASPECTO_LATERAL = 3.0

PIEZAS = [
    # Cubremotor: baja desde el airbox hacia la cola
    {"nombre": "cover", "clave": False, "puntos": [
        [0.04, 0.34], [0.16, 0.30], [0.30, 0.31], [0.44, 0.35],
        [0.56, 0.41], [0.64, 0.47]]},
    # Pontón / lateral, para que se lea como coche y no como palos
    {"nombre": "ponton", "clave": False, "puntos": [
        [0.04, 0.34], [0.06, 0.52], [0.14, 0.60], [0.30, 0.62],
        [0.44, 0.60], [0.54, 0.55], [0.64, 0.47]]},
    # Suelo, plano hasta donde arranca el difusor
    {"nombre": "suelo", "clave": False, "puntos": [[0.02, 0.78], [0.38, 0.78]]},
    # Difusor: la rampa de salida
    {"nombre": "difusor", "clave": True, "puntos": [
        [0.38, 0.78], [0.52, 0.75], [0.66, 0.68], [0.80, 0.60],
        [0.90, 0.55]]},
    # Estructura deformable trasera, y el hueco que deja debajo
    {"nombre": "crash", "clave": False, "puntos": [
        [0.58, 0.46], [0.84, 0.45], [0.85, 0.51], [0.59, 0.52],
        [0.58, 0.46]]},
    # Salida de escape, bajo la estructura
    {"nombre": "escape", "clave": True, "puntos": [
        [0.64, 0.55], [0.83, 0.545], [0.83, 0.605], [0.64, 0.61],
        [0.64, 0.55]]},
    # EL winglet: encima del escape, en el hueco
    {"nombre": "winglet", "clave": True, "puntos": [
        [0.72, 0.375], [0.96, 0.355], [0.965, 0.405], [0.725, 0.425],
        [0.72, 0.375]]},
    # Alerón trasero y su soporte
    {"nombre": "alerón", "clave": False, "puntos": [[0.58, 0.14], [0.96, 0.115]]},
    {"nombre": "alerón2", "clave": False, "puntos": [[0.60, 0.20], [0.96, 0.175]]},
    {"nombre": "soporte", "clave": False, "puntos": [[0.76, 0.145], [0.755, 0.44]]},
]

FLUJO = [
    # El gas de escape lamiendo el winglet y saliendo
    [[0.845, 0.58], [0.89, 0.52], [0.94, 0.44], [1.0, 0.395]],
    # Aire acelerado del difusor
    [[0.42, 0.735], [0.60, 0.70], [0.78, 0.62], [1.0, 0.545]],
    # Aire limpio hacia la parte baja del alerón
    [[0.60, 0.30], [0.74, 0.265], [0.88, 0.225], [1.0, 0.20]],
]

NOTAS = [
    (0.84, 0.39, "Winglet sits in the exhaust plume"),
    (0.73, 0.58, "Tailpipe, partly blocked - costs 7-13 hp"),
    (0.61, 0.49, "Space beneath the crash structure"),
]

def ftm(salida, tam=D.HORIZ):
    """El winglet soplado de Ferrari. Devuelve la ruta, o None."""
    return D.esquema(
        salida, "Ferrari's exhaust wing", PIEZAS,
        flujo_lineas=FLUJO, notas=NOTAS,
        pie="Our own schematic, drawn from the published description",
        etiqueta="Schematic", tam=tam, aspecto=ASPECTO_LATERAL)

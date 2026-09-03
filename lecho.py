"""lecho.py — El fondo sonoro de la carrera, sintetizado por nosotros.

Por qué sintetizado y no una pista descargada
──────────────────────────────────────────────
El canal emite 24/7 y monetiza. Una pista "gratis" de internet es una
reclamación de Content ID esperando a ocurrir: "royalty free" casi nunca
quiere decir "libre", quiere decir "sin regalías POR reproducción", y
casi siempre exige atribución o una licencia que hay que poder enseñar.
Esto se genera con ffmpeg a partir de ondas: es obra nuestra, no hay
nada que reclamar y no depende de que una URL siga viva dentro de un año.

Por qué vive DEBAJO de la voz, no solo más bajo
────────────────────────────────────────────────
Lo importante de este archivo no es el volumen: es el filtro paso bajo.

La voz humana vive entre unos 300 Hz y 3,4 kHz —es la banda del teléfono,
y no por casualidad—. Un fondo con contenido en esa banda enmascara la
palabra aunque esté bajito: el oído tiene que separar dos cosas que
ocupan el mismo sitio. Cortando el lecho por encima de 380 Hz, el fondo
queda FÍSICAMENTE por debajo de la voz y no compite con ella. Se oye,
llena el silencio, y no cuesta ni una palabra de inteligibilidad.

Ese es también el motivo de que no lleve melodía. Una melodía obliga a
seguirla; un acorde quieto se convierte en el suelo de la escena y se
olvida, que es exactamente lo que tiene que hacer un fondo bajo una
narración que dura tres horas.

Por qué el bucle no chasquea (y por qué el archivo dura más de lo que
suena)
──────────────────────────────────────────────────────────────────────
Un bucle corta cuando la onda no está en el mismo punto al final que al
principio: se oye un clic en cada vuelta, y en tres horas son cientos.

Las cuatro frecuencias son múltiplos de 27,5 Hz, así que en 40 segundos
todas completan un número entero de ciclos (55x40=2200, 82,5x40=3300,
110x40=4400, 165x40=6600) y el pulso también (1,6x40=64). O sea que
CUALQUIER trozo de exactamente 40 s empalma consigo mismo.

Pero el archivo no se puede reproducir entero en bucle, y esto se
comprobó midiendo, no suponiendo: un MP3 de 40 s dura en realidad 40,110
—el codificador añade relleno— y el RMS de los últimos 20 ms cae a 476
frente a 3302 del centro. Reproducirlo con <audio loop> da un bajón
audible cada vuelta.

La solución es generar de MÁS y marcar dónde está el bucle bueno: se
sintetizan 42 segundos y se repiten los 40 que van de LOOP_INICIO a
LOOP_FIN. Empezar en el segundo 1 deja fuera el relleno del principio y
la cola del eco, que tarda 110 ms en estabilizarse. El navegador usa la
Web Audio API, que sabe repetir entre dos instantes exactos; un
<audio loop> normal no puede, porque siempre reproduce el archivo entero.
"""

import logging
import os
import subprocess

log = logging.getLogger("lecho")

#: Dónde se guarda. Se genera UNA vez y se reutiliza siempre.
ARCHIVO = "lecho_carrera.mp3"

#: Se sintetizan 42 s pero solo se repiten 40: ver arriba.
SEGUNDOS = 42
#: El trozo que se repite. 40 s exactos, empezando en el 1 para dejar
#: fuera el relleno del codificador y el arranque del eco. Es largo a
#: propósito: un bucle de cinco segundos se reconoce enseguida y cansa.
LOOP_INICIO = 1.0
LOOP_LARGO = 40.0
LOOP_FIN = LOOP_INICIO + LOOP_LARGO

#: La quinta abierta A1–E2–A2–E3. Sin tercera: ni mayor ni menor, o sea
#: ni alegre ni triste. Un fondo no debe opinar sobre lo que pasa en
#: pista — si suena triste durante un adelantamiento, estorba.
#: Todas múltiplos de 27,5 para que el bucle cierre.
FRECUENCIAS = [55.0, 82.5, 110.0, 165.0]

#: Corte del paso bajo. La voz empieza sobre los 300 Hz; dejando el lecho
#: por debajo de 380 no hay nada que enmascarar.
CORTE_HZ = 380

#: Pulso lento, 1,6 Hz = 96 por minuto. Da sensación de que algo avanza
#: sin ser un ritmo que se pueda seguir. 1,6 x 40 = 64 ciclos enteros, así
#: que tampoco rompe el bucle.
PULSO_HZ = 1.6


def _ffmpeg():
    try:
        import youtube_subir
        return youtube_subir._ffmpeg()
    except Exception:
        import shutil
        return shutil.which("ffmpeg") or "ffmpeg"


def _hay_ffmpeg():
    try:
        import youtube_subir
        return youtube_subir.ffmpeg_disponible()
    except Exception:
        return False


def generar(destino=ARCHIVO):
    """Sintetiza el lecho. Devuelve la ruta, o None si no se pudo."""
    if not _hay_ffmpeg():
        log.info("Sin ffmpeg: no hay lecho de carrera")
        return None
    args = [_ffmpeg(), "-y", "-loglevel", "error"]
    for f in FRECUENCIAS:
        args += ["-f", "lavfi",
                 "-i", f"sine=frequency={f}:duration={SEGUNDOS}"]
    n = len(FRECUENCIAS)
    entradas = "".join(f"[{i}]" for i in range(n))
    filtro = (
        # normalize=0 suma en vez de promediar; el volume de después
        # es quien controla el nivel, y así no depende de cuántas notas
        # haya si algún día se cambia el acorde.
        f"{entradas}amix=inputs={n}:normalize=0,"
        # 0.9 medido: da -20,7 LUFS con pico a -11,7 dBFS. Con el 0.12
        # de la primera versión salía a -38 LUFS, y al bajarlo además en
        # el navegador se quedaba en nada. Este nivel deja el archivo a
        # una sonoridad normal y que sea la mezcla quien decida.
        "volume=0.9,"
        "aformat=channel_layouts=stereo,"
        f"tremolo=f={PULSO_HZ}:d=0.30,"
        # Eco corto: da tamaño de sala. Sin esto suena a sintetizador
        # de prueba, que es exactamente lo que es.
        "aecho=0.8:0.9:60|110:0.30|0.22,"
        # LO IMPORTANTE: el lecho se queda por debajo de la voz.
        f"lowpass=f={CORTE_HZ},highpass=f=45"
    )
    args += ["-filter_complex", filtro,
             "-c:a", "libmp3lame", "-b:a", "128k", destino]
    try:
        r = subprocess.run(args, capture_output=True, timeout=180)
        if r.returncode == 0 and os.path.exists(destino) \
                and os.path.getsize(destino) > 0:
            log.info("🎵 Lecho de carrera generado (%d KB)",
                     os.path.getsize(destino) // 1024)
            return destino
        log.info("No se pudo generar el lecho: %s",
                 (r.stderr or b"")[-200:].decode("utf-8", "ignore"))
    except Exception as e:
        log.info("Fallo generando el lecho (%s)", e)
    return None


def asegurar(destino=ARCHIVO):
    """La ruta del lecho, generándolo si aún no existe. None si no se pudo."""
    if os.path.exists(destino) and os.path.getsize(destino) > 0:
        return destino
    return generar(destino)

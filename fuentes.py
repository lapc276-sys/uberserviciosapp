"""fuentes.py — La tipografía del canal.

Todo lo que dibuja este proyecto —miniaturas, diagramas, rótulos del
directo, texto sobre los videos— venía saliendo en DejaVu Sans, que es
la fuente que traen los contenedores de Linux por defecto. Es legible y
no cuesta nada, pero es EXACTAMENTE la que usa cualquier script que no
eligió fuente, y eso se nota: una miniatura en DejaVu se lee como un
gráfico de laboratorio, no como un canal de motor.

Aquí se instalan dos familias que sí tienen carácter deportivo y que se
pueden usar comercialmente sin pagar ni pedir permiso:

  Titillium Web — la que la Fórmula 1 usó durante años en su propia
                  identidad. Condensada, técnica, muy reconocible.
  Barlow        — familia amplia con versiones condensadas, buena para
                  titulares grandes y para texto pequeño de datos.

Las dos son SIL Open Font License 1.1: uso comercial permitido,
incluido incrustarlas en video, sin regalías y sin tener que acreditar
en pantalla. La licencia se guarda junto a los archivos.

Sobre el hilo del que cuelga esto
─────────────────────────────────
No se descarga nada en cada arranque. Se mira si ya están; si no, se
intentan traer UNA vez y, si no hay red o falla, se sigue con DejaVu
como hasta ahora. Una tipografía que no llegó no puede tumbar la
emisión.
"""

import contextlib
import io
import logging
import os
import zipfile

log = logging.getLogger("fuentes")

#: Dónde quedan instaladas. Local al proyecto para que no dependa de que
#: el contenedor traiga nada.
DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tipos")

#: De dónde se traen. Los repositorios oficiales de Google Fonts, que
#: sirven el TTF directamente sin pasar por la página de descarga.
_BASE = "https://raw.githubusercontent.com/google/fonts/main"
ARCHIVOS = {
    "TitilliumWeb-Bold.ttf":
        f"{_BASE}/ofl/titilliumweb/TitilliumWeb-Bold.ttf",
    "TitilliumWeb-SemiBold.ttf":
        f"{_BASE}/ofl/titilliumweb/TitilliumWeb-SemiBold.ttf",
    "TitilliumWeb-Regular.ttf":
        f"{_BASE}/ofl/titilliumweb/TitilliumWeb-Regular.ttf",
    "BarlowCondensed-Bold.ttf":
        f"{_BASE}/ofl/barlowcondensed/BarlowCondensed-Bold.ttf",
    "Barlow-Bold.ttf":
        f"{_BASE}/ofl/barlow/Barlow-Bold.ttf",
    "Barlow-Regular.ttf":
        f"{_BASE}/ofl/barlow/Barlow-Regular.ttf",
}

#: La licencia, al lado de los archivos. No hace falta enseñarla en
#: pantalla, pero sí conservarla con la fuente.
_LICENCIA = f"{_BASE}/ofl/titilliumweb/OFL.txt"

_intentado = False


def ruta(nombre):
    """Ruta de una fuente instalada, o None."""
    p = os.path.join(DIR, nombre)
    return p if os.path.exists(p) else None


def instaladas():
    """Cuáles de las nuestras están ya en disco."""
    return [n for n in ARCHIVOS if ruta(n)]


def asegurar(forzar=False):
    """Instala las fuentes si faltan. Devuelve cuántas hay disponibles.

    Nunca lanza: si no hay red, o GitHub no responde, o el disco está
    lleno, se sigue con las del sistema.
    """
    global _intentado
    if _intentado and not forzar:
        return len(instaladas())
    _intentado = True
    faltan = [n for n in ARCHIVOS if not ruta(n)]
    if not faltan:
        return len(ARCHIVOS)
    try:
        import httpx
    except Exception:
        return len(instaladas())
    with contextlib.suppress(Exception):
        os.makedirs(DIR, exist_ok=True)
    traidas = 0
    with contextlib.suppress(Exception):
        with httpx.Client(timeout=20, follow_redirects=True) as c:
            for nombre in faltan:
                with contextlib.suppress(Exception):
                    r = c.get(ARCHIVOS[nombre])
                    r.raise_for_status()
                    # Un TTF empieza por 0x00010000 o "true"/"OTTO".
                    # Si GitHub devuelve una página de error, esto lo caza
                    # antes de dejar un archivo roto en disco.
                    if len(r.content) < 5000 or r.content[:4] not in (
                            b"\x00\x01\x00\x00", b"true", b"OTTO", b"ttcf"):
                        continue
                    with open(os.path.join(DIR, nombre), "wb") as f:
                        f.write(r.content)
                    traidas += 1
            if traidas and not os.path.exists(os.path.join(DIR, "OFL.txt")):
                with contextlib.suppress(Exception):
                    r = c.get(_LICENCIA)
                    if r.status_code == 200:
                        with open(os.path.join(DIR, "OFL.txt"), "wb") as f:
                            f.write(r.content)
    hay = instaladas()
    if traidas:
        log.info("🔤 Tipografía del canal instalada (%d archivos)", traidas)
    elif not hay:
        log.info("🔤 Sin tipografía propia (sin red o no disponible) — "
                 "se usa la del sistema")
    return len(hay)


def lista(negrita=True, condensada=False):
    """Las rutas a probar, de la más deseada a la de respaldo.

    Se antepone lo nuestro y se deja DEJAVU al final: así, si las
    fuentes no llegaron, todo sigue dibujándose exactamente igual que
    antes en vez de quedarse sin texto.
    """
    propias = []
    if condensada:
        propias.append("BarlowCondensed-Bold.ttf")
    if negrita:
        propias += ["TitilliumWeb-Bold.ttf", "Barlow-Bold.ttf",
                    "TitilliumWeb-SemiBold.ttf"]
    else:
        propias += ["TitilliumWeb-Regular.ttf", "Barlow-Regular.ttf"]
    out = [p for p in (ruta(n) for n in propias) if p]
    sistema_bold = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ]
    sistema_normal = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    return out + (sistema_bold if negrita else sistema_normal)

"""revisar.py — Mirar nuestros propios videos ANTES de publicarlos.

El problema que resuelve
────────────────────────
El canal monta videos solo y los sube solo. Nadie los ve entre una cosa
y la otra. Cuando algo sale mal —una lámina que quedó negra, un rótulo
que se salió del cuadro, el audio que se acabó a mitad— nos enteramos
por YouTube, con el video ya publicado y con las visitas ya perdidas.

Esto pone un par de ojos en medio. Hace dos cosas:

1. Las comprobaciones que NO necesitan ojos, que son las de siempre en
   cualquier control de calidad de emisión, y que ffmpeg ya sabe hacer:
   trozos en negro, imagen congelada, silencios largos, audio que no
   dura lo que el video, resolución equivocada.

2. Saca unos cuantos fotogramas repartidos por el video. Eso es lo que
   convierte "el video está montado" en algo que se puede MIRAR — por
   mí, que leo imágenes, o por quien abra la carpeta.

Lo que aquí NO se hace es decidir por su cuenta. `revisar()` devuelve un
informe; quien llama decide si eso se publica o se para. Un control de
calidad que además tira videos a la basura sin avisar es peor que no
tenerlo.
"""

import asyncio
import contextlib
import json
import logging
import os
import re
import subprocess

import youtube_subir

log = logging.getLogger("revisar")

#: Un fotograma con esta luminancia media (0-255) está prácticamente
#: negro. El canal usa fondos muy oscuros a propósito (#0A0C11 ≈ 11), así
#: que el umbral se mide contra ESE negro, no contra el negro puro: lo
#: que se busca es un cuadro donde no llegó a dibujarse nada.
LUZ_NEGRA = 14.0

#: Y con esta desviación típica, el cuadro es de un solo tono: puede
#: estar iluminado, pero no hay nada dibujado encima.
PLANO_SIGMA = 6.0

#: Cuánto puede desfasar el audio del video antes de que sea un fallo de
#: montaje y no un redondeo.
DESFASE_MAX = 1.5


def _correr(args, timeout=180):
    """Ejecuta y devuelve (código, stdout+stderr). ffmpeg escribe casi
    todo lo interesante en stderr, así que van juntos."""
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def _sonda(ruta):
    """Lo que ffprobe sabe del archivo: duración, tamaño, pistas."""
    cod, salida = _correr([
        youtube_subir._ffprobe(), "-v", "quiet", "-print_format", "json",
        "-show_format", "-show_streams", ruta], timeout=60)
    if cod != 0:
        return None
    with contextlib.suppress(Exception):
        return json.loads(salida)
    return None


def _meta(sonda):
    """Lo que interesa de la sonda, ya masticado."""
    if not sonda:
        return {}
    v = next((s for s in sonda.get("streams", [])
              if s.get("codec_type") == "video"), None)
    a = next((s for s in sonda.get("streams", [])
              if s.get("codec_type") == "audio"), None)
    def _dur(x):
        with contextlib.suppress(TypeError, ValueError):
            return float((x or {}).get("duration"))
        return None
    return {
        "duracion": _dur(sonda.get("format")) or _dur(v) or 0.0,
        "ancho": (v or {}).get("width"), "alto": (v or {}).get("height"),
        "video": (v or {}).get("codec_name"),
        "audio": (a or {}).get("codec_name"),
        "dur_video": _dur(v), "dur_audio": _dur(a),
        "bytes": int((sonda.get("format") or {}).get("size") or 0),
    }


def _detectores(ruta, dur):
    """Los detectores de ffmpeg: negro, congelado y silencio.

    Es una sola pasada por el archivo sin escribir nada (`-f null -`), así
    que cuesta lo que cuesta decodificar. Para un short de 40 s son un par
    de segundos.
    """
    args = [youtube_subir._ffmpeg(), "-v", "info", "-i", ruta,
            "-vf", "blackdetect=d=0.9:pic_th=0.98,freezedetect=n=-58dB:d=2.5",
            "-af", "silencedetect=n=-48dB:d=3",
            "-f", "null", "-"]
    try:
        _, salida = _correr(args, timeout=max(120, int(dur * 4) + 60))
    except subprocess.TimeoutExpired:
        return {"negro": [], "congelado": [], "silencio": [], "corte": True}
    negro = [(float(a), float(b)) for a, b in re.findall(
        r"black_start:([\d.]+) black_end:([\d.]+)", salida)]
    congelado = [float(x) for x in re.findall(
        r"freeze_start: ([\d.]+)", salida)]
    silencio = [(float(a), float(b)) for a, b in re.findall(
        r"silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)", salida)]
    return {"negro": negro, "congelado": congelado, "silencio": silencio,
            "corte": False}


def _fotogramas(ruta, destino, dur, n=9):
    """Saca n fotogramas repartidos por el video, con la hora en el
    nombre. Uno a uno y no con `fps=`: repartidos por tiempo salen
    siempre los mismos n, dure lo que dure el video."""
    os.makedirs(destino, exist_ok=True)
    fuera = []
    for i in range(n):
        # Ni el primer ni el último instante: en los dos suele haber un
        # fundido, y un fundido no dice nada de cómo quedó el video.
        t = dur * (i + 0.5) / n
        salida = os.path.join(destino, f"f{i:02d}_{int(t // 60):02d}"
                                       f"-{int(t % 60):02d}.png")
        cod, _ = _correr([
            youtube_subir._ffmpeg(), "-y", "-loglevel", "error",
            "-ss", f"{t:.2f}", "-i", ruta, "-frames:v", "1",
            "-vf", "scale=640:-2", salida], timeout=60)
        if cod == 0 and os.path.exists(salida):
            fuera.append((round(t, 2), salida))
    return fuera


def _luz(ruta_png):
    """(luminancia media, desviación) de un fotograma."""
    try:
        from PIL import Image, ImageStat
        with Image.open(ruta_png) as im:
            st = ImageStat.Stat(im.convert("L"))
            return st.mean[0], st.stddev[0]
    except Exception:
        return None, None


def mosaico(inf, salida, columnas=3):
    """Todos los fotogramas en UNA imagen, con su hora y el veredicto.

    Nueve archivos sueltos en una carpeta del servidor no los mira nadie.
    Una sola imagen sí: se abre en el navegador, se ve de un vistazo si
    el video salió bien y se puede mandar por chat tal cual. Es la
    diferencia entre tener el control y usarlo.
    """
    fotos = [f for f in (inf.get("fotogramas") or []) if
             os.path.exists(f.get("png", ""))]
    if not fotos:
        return None
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return None
    try:
        import diagramas as D
    except Exception:
        D = None

    with Image.open(fotos[0]["png"]) as p:
        cw, ch = p.size
    cols = max(1, min(columnas, len(fotos)))
    filas = (len(fotos) + cols - 1) // cols
    sep, cab = 10, 78
    W = cols * cw + sep * (cols + 1)
    H = cab + filas * (ch + 22) + sep * (filas + 1)
    lienzo = Image.new("RGB", (W, H), "#0A0C11")
    dib = ImageDraw.Draw(lienzo)

    def _f(tam, negrita=True):
        if D:
            return D._fuente(tam, negrita)
        from PIL import ImageFont
        return ImageFont.load_default()

    m = inf.get("meta") or {}
    verde, rojo, ambar = "#31D97A", "#FF2D16", "#FFB020"
    color = rojo if inf.get("grave") else (ambar if inf.get("avisos")
                                           else verde)
    dib.rectangle([0, 0, W, 5], fill=color)
    dib.text((sep + 4, 16), os.path.basename(inf.get("archivo", "")),
             font=_f(26), fill="#F2F4F8")
    linea = (f"{m.get('duracion', 0):.0f}s · {m.get('ancho', '?')}x"
             f"{m.get('alto', '?')} · {m.get('audio') or 'SIN AUDIO'}")
    dib.text((sep + 4, 46), linea, font=_f(19, False), fill="#8892A3")
    aviso = "; ".join((inf.get("grave") or []) + (inf.get("avisos") or []))
    if aviso:
        dib.text((sep + 4 + 320, 46), aviso[:110], font=_f(19, False),
                 fill=color)

    for i, f in enumerate(fotos):
        cx = sep + (i % cols) * (cw + sep)
        cy = cab + sep + (i // cols) * (ch + 22 + sep)
        with Image.open(f["png"]) as im:
            im = im.convert("RGB")
            # Todos los fotogramas salen del mismo video y miden lo
            # mismo, pero si alguno no lo hace, la rejilla se descuadra
            # entera a partir de ahí. Ajustarlo cuesta una línea.
            if im.size != (cw, ch):
                im = im.resize((cw, ch))
            lienzo.paste(im, (cx, cy))
        # Un borde de color solo si ESE fotograma tiene algo raro: sin
        # marca, el ojo no sabe cuál mirar de los nueve.
        if f.get("marca"):
            dib.rectangle([cx, cy, cx + cw - 1, cy + ch - 1],
                          outline=rojo if f["marca"] == "negro" else ambar,
                          width=3)
        etq = f"{int(f['t'] // 60):02d}:{int(f['t'] % 60):02d}"
        if f.get("marca"):
            etq += f"  ({f['marca']})"
        dib.text((cx + 2, cy + ch + 3), etq, font=_f(17, False),
                 fill="#8892A3" if not f.get("marca") else ambar)
    with contextlib.suppress(Exception):
        os.makedirs(os.path.dirname(os.path.abspath(salida)), exist_ok=True)
    try:
        lienzo.save(salida, "PNG")
        return salida
    except Exception as e:
        log.info("No pude guardar el mosaico de revisión (%s)", e)
        return None


def revisar(ruta, destino=None, fotogramas=9, esperado=None):
    """Revisa un video ya montado. Devuelve el informe; no borra nada.

    `esperado` = (ancho, alto) si se sabe cómo tenía que salir.

    En `informe["grave"]` van solo las cosas por las que NO se debería
    publicar: sin imagen, sin audio, o el video entero en negro. Todo lo
    demás son avisos para mirar los fotogramas.
    """
    inf = {"archivo": ruta, "ok": False, "grave": [], "avisos": [],
           "fotogramas": [], "meta": {}}
    if not (ruta and os.path.exists(ruta)):
        inf["grave"].append("El archivo no existe")
        return inf
    if not youtube_subir.ffmpeg_disponible():
        inf["avisos"].append("Sin ffmpeg: no se pudo revisar")
        return inf

    meta = _meta(_sonda(ruta))
    inf["meta"] = meta
    dur = meta.get("duracion") or 0.0
    if not meta.get("video"):
        inf["grave"].append("No tiene pista de video")
        return inf
    if dur < 1.0:
        inf["grave"].append(f"Dura {dur:.1f}s — no llegó a montarse")
        return inf
    if not meta.get("audio"):
        inf["grave"].append("No tiene pista de audio")
    if meta.get("bytes", 0) < 50_000:
        inf["avisos"].append(
            f"Pesa {meta['bytes'] // 1024} KB, muy poco para {dur:.0f}s")

    da, dv = meta.get("dur_audio"), meta.get("dur_video")
    if da and dv and abs(da - dv) > DESFASE_MAX:
        inf["avisos"].append(
            f"El audio dura {da:.1f}s y la imagen {dv:.1f}s "
            f"({abs(da - dv):.1f}s de diferencia)")
    if esperado and meta.get("ancho") and (
            meta["ancho"], meta["alto"]) != tuple(esperado):
        inf["avisos"].append(
            f"Salió a {meta['ancho']}x{meta['alto']} y se esperaba "
            f"{esperado[0]}x{esperado[1]}")

    det = _detectores(ruta, dur)
    if det["corte"]:
        inf["avisos"].append("La revisión de negro/congelado tardó demasiado "
                             "y se cortó")
    negro_total = sum(b - a for a, b in det["negro"])
    if negro_total > dur * 0.6:
        inf["grave"].append(
            f"{negro_total:.0f}s de los {dur:.0f}s están en negro")
    elif det["negro"]:
        inf["avisos"].append(
            "En negro: " + ", ".join(f"{a:.0f}-{b:.0f}s"
                                     for a, b in det["negro"][:4]))
    if det["congelado"]:
        inf["avisos"].append(
            "Imagen congelada desde: " +
            ", ".join(f"{t:.0f}s" for t in det["congelado"][:4]))
    # El silencio se mira por dos lados. Mucho silencio repartido puede
    # ser el ritmo del montaje; un hueco LARGO seguido, no: en un video
    # narrado con música de fondo, cinco segundos sin nada es que se
    # cortó la voz o se acabó el audio antes que la imagen.
    silencio_total = sum(b - a for a, b in det["silencio"])
    hueco = max((b - a for a, b in det["silencio"]), default=0.0)
    if silencio_total > dur * 0.35:
        inf["avisos"].append(
            f"{silencio_total:.0f}s de silencio de {dur:.0f}s — ¿se quedó "
            "sin voz?")
    elif hueco > 5.0:
        inf["avisos"].append(
            f"{hueco:.0f}s seguidos en silencio — mira los fotogramas de "
            "esa parte")

    destino = destino or os.path.join(
        "revision", os.path.splitext(os.path.basename(ruta))[0])
    apagados = 0
    for t, png in _fotogramas(ruta, destino, dur, fotogramas):
        media, sigma = _luz(png)
        marca = ""
        if media is not None and media < LUZ_NEGRA:
            marca, apagados = "negro", apagados + 1
        elif sigma is not None and sigma < PLANO_SIGMA:
            marca = "plano"
        inf["fotogramas"].append({
            "t": t, "png": png,
            "luz": round(media, 1) if media is not None else None,
            "sigma": round(sigma, 1) if sigma is not None else None,
            "marca": marca})
    if inf["fotogramas"] and apagados == len(inf["fotogramas"]):
        inf["grave"].append("Todos los fotogramas salieron negros")
    elif apagados:
        inf["avisos"].append(
            f"{apagados} de {len(inf['fotogramas'])} fotogramas en negro")

    inf["ok"] = not inf["grave"]
    # El mosaico va SIEMPRE, salga bien o mal, y siempre al mismo sitio:
    # estatico/revision.png es "el último video que montamos, visto".
    # Estando ahí se abre desde el navegador sin entrar al servidor.
    inf["mosaico"] = mosaico(inf, os.path.join(destino, "mosaico.png"))
    with contextlib.suppress(Exception):
        if inf["mosaico"]:
            os.makedirs("estatico", exist_ok=True)
            import shutil as _sh
            _sh.copy(inf["mosaico"], os.path.join("estatico", "revision.png"))
            inf["url"] = "/estatico/revision.png"
    return inf


async def revisar_async(ruta, **kw):
    """Igual, sin bloquear el bucle: descarga ffmpeg si hace falta."""
    if not await youtube_subir.asegurar_ffmpeg():
        return {"archivo": ruta, "ok": True, "grave": [],
                "avisos": ["Sin ffmpeg: no se pudo revisar"],
                "fotogramas": [], "meta": {}}
    return await asyncio.to_thread(revisar, ruta, **kw)


def resumen(inf):
    """Una línea para el log."""
    m = inf.get("meta") or {}
    partes = [f"{m.get('duracion', 0):.0f}s",
              f"{m.get('ancho', '?')}x{m.get('alto', '?')}",
              m.get("audio") or "SIN AUDIO"]
    if inf.get("grave"):
        return "❌ " + " · ".join(partes) + " — " + "; ".join(inf["grave"])
    if inf.get("avisos"):
        return "⚠️  " + " · ".join(partes) + " — " + "; ".join(inf["avisos"])
    return "✅ " + " · ".join(partes)


if __name__ == "__main__":                      # pragma: no cover
    import sys
    logging.basicConfig(level=logging.INFO)
    if len(sys.argv) < 2:
        print("uso: python3 revisar.py <video.mp4> [carpeta_salida]")
        raise SystemExit(2)
    inf = revisar(sys.argv[1],
                  destino=sys.argv[2] if len(sys.argv) > 2 else None)
    print(resumen(inf))
    for f in inf["fotogramas"]:
        print(f"  {f['t']:6.1f}s  luz {f['luz']}  σ {f['sigma']}  "
              f"{f['marca']}  {f['png']}")

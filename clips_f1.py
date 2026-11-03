"""clips_f1.py — Lo que publica el canal OFICIAL de F1 durante la sesión.

Durante una carrera o una clasificación, F1 sube clips cortos de lo que
acaba de pasar: un choque, un adelantamiento, una radio. El TÍTULO de cada
clip lo escribe la propia F1 ("Leclerc and Norris collide at Turn 1!"), y
eso es un hecho que el narrador puede contar.

Qué se hace y qué NO
─────────────────────
• Se LEE la lista de subidas del canal de F1 con la API oficial de YouTube
  (Data API v3, clave YOUTUBE_API_KEY): título y fecha. Cuesta 1 unidad de
  cuota por consulta.
• NO se descarga ni se emite ningún video, ni un fotograma. Las imágenes
  son de Formula One Management: ponerlas en el directo es un aviso por
  copyright, y descargarlas va contra las condiciones de YouTube.
• NO se "mira" el video con una IA: podría confundir piloto o curva, y el
  narrador lo contaría como cierto. El título es de F1; la interpretación
  de unas imágenes sería nuestra.

Al narrador le llega como evento: "F1 has just posted a clip: <título>". Lo
cuenta atribuido y sin añadir nada que el título no diga.
"""

import asyncio
import contextlib
import logging
import os
import re

import httpx

log = logging.getLogger("clips")

ACTIVO = os.environ.get("CLIPS_F1", "on").lower() not in ("off", "0", "no")
API = "https://www.googleapis.com/youtube/v3"
#: Canal oficial, por su @: así no depende de un id que haya que mantener.
HANDLE = os.environ.get("CLIPS_F1_HANDLE", "Formula1")
CADA_S = 180

#: Los títulos son de F1, pero vienen de fuera: se limpian igual. Nada que
#: parezca una orden ni un enlace llega al guionista.
_RARO = re.compile(r"https?://|www\.|ignore |system prompt|instructions",
                   re.I)


def _limpiar(titulo):
    t = re.sub(r"\s+", " ", (titulo or "")).strip()
    t = re.sub(r"#\S+", "", t).strip(" |-–—")       # sin hashtags
    if not t or _RARO.search(t):
        return ""
    return t[:140]


async def _subidas_playlist(c, clave):
    r = await c.get(f"{API}/channels", params={
        "part": "contentDetails", "forHandle": HANDLE, "key": clave},
        timeout=20)
    r.raise_for_status()
    items = r.json().get("items") or []
    if not items:
        return None
    return items[0]["contentDetails"]["relatedPlaylists"]["uploads"]


async def _ultimos(c, clave, playlist):
    r = await c.get(f"{API}/playlistItems", params={
        "part": "snippet", "playlistId": playlist, "maxResults": 10,
        "key": clave}, timeout=20)
    r.raise_for_status()
    out = []
    for it in r.json().get("items") or []:
        sn = it.get("snippet") or {}
        vid = (sn.get("resourceId") or {}).get("videoId")
        if vid:
            out.append({"id": vid, "titulo": sn.get("title", ""),
                        "fecha": sn.get("publishedAt", "")})
    return out


async def bucle(estado, clave):
    """Durante una sesión en vivo, cada 3 min mira si F1 ha subido algo
    nuevo y lo pasa al narrador y a la pantalla (`estado.clips_f1`)."""
    estado.clips_f1 = []
    if not (ACTIVO and clave):
        return
    vistos, sesion_previa, playlist = set(), None, None
    async with httpx.AsyncClient() as c:
        while True:
            await asyncio.sleep(CADA_S)
            t = estado.tele
            if not (t and estado.carrera_en_vivo):
                continue
            sk = (t.sesion or {}).get("session_key")
            primera = sk != sesion_previa
            if primera:
                sesion_previa = sk
                vistos.clear()
                estado.clips_f1 = []
            try:
                if playlist is None:
                    playlist = await _subidas_playlist(c, clave)
                    if not playlist:
                        log.info("Clips de F1: no encuentro el canal @%s",
                                 HANDLE)
                        continue
                ultimos = await _ultimos(c, clave, playlist)
            except Exception as e:
                log.info("Clips de F1: la API no respondió (%s)", e)
                continue
            if primera:
                # Lo que ya estaba subido al empezar la sesión no es de
                # esta sesión: se marca como visto y no se cuenta.
                vistos.update(v["id"] for v in ultimos)
                continue
            for v in reversed(ultimos):          # del más viejo al nuevo
                if v["id"] in vistos:
                    continue
                vistos.add(v["id"])
                titulo = _limpiar(v["titulo"])
                if not titulo:
                    continue
                estado.clips_f1.append({"titulo": titulo,
                                        "vuelta": getattr(t, "vuelta", 0)})
                del estado.clips_f1[:-5]
                log.info("🎬 F1 publicó: %s", titulo)
                with contextlib.suppress(Exception):
                    estado.eventos.append(
                        f"OFFICIAL F1 CLIP just posted by Formula 1: "
                        f"\"{titulo}\"")

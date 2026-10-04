"""radio_equipo.py — Las radios de los pilotos, transcritas a texto.

OpenF1 publica cada mensaje de radio de la carrera (`/team_radio`) con el
enlace a su grabación. Aquí se descarga, se transcribe con OpenAI y queda
como TEXTO para la pantalla y para el narrador.

Por qué texto y nunca el audio
──────────────────────────────
La grabación es contenido de la retransmisión de F1. Emitirla en el
directo es justo lo que Content ID detecta. Citar una frase corta, con el
nombre del piloto, y comentarla es información; reproducir el audio no.

Y por qué con cuidado con lo transcrito
───────────────────────────────────────
La radio llega con ruido de motor y cortes, y el transcriptor a veces se
inventa una frase en un tramo de silencio ("Thank you.", "Thanks for
watching"). Se descartan esas y las de una sola palabra, y al narrador se
le avisa de que es una transcripción automática: puede citarla, no
adornarla.
"""

import asyncio
import contextlib
import datetime as dt
import logging
import os
import re

import httpx

import telemetria

log = logging.getLogger("radio")

ACTIVA = os.environ.get("RADIO_EQUIPO", "on").lower() not in ("off", "0", "no")
MODELO = os.environ.get("RADIO_MODELO", "gpt-4o-mini-transcribe")
CADA_S = 25

#: Lo que el transcriptor suele inventarse en el silencio o el ruido.
_ALUCINACIONES = re.compile(
    r"^(thank you\.?|thanks\.?|thanks for watching.*|you\.?|bye\.?|"
    r"subtitles by.*|\.+|okay\.?)$", re.I)


def _fecha(t):
    return dt.datetime.fromisoformat(str(t).replace("Z", "+00:00"))


async def transcribir(cliente, audio, clave):
    """Texto de un MP3 de radio, o "" si no se pudo o no dice nada."""
    try:
        r = await cliente.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {clave}"},
            data={"model": MODELO, "language": "en",
                  "prompt": "Formula 1 team radio between a driver and his "
                            "race engineer. Box, tyres, gap, push, DRS."},
            files={"file": ("radio.mp3", audio, "audio/mpeg")},
            timeout=60)
        r.raise_for_status()
        texto = (r.json().get("text") or "").strip()
    except Exception as e:
        log.info("Radio sin transcribir (%s)", e)
        return ""
    if not texto or _ALUCINACIONES.match(texto) or len(texto.split()) < 2:
        return ""
    return texto[:220]


async def bucle(estado, clave_openai):
    """Vigila /team_radio durante la sesión y deja en `estado.radios` las
    transcripciones, SINCRONIZADAS con el reloj del directo: una radio no
    sale antes de que la pantalla haya llegado a ese momento de la carrera
    (el directo va unos segundos por detrás de los datos)."""
    estado.radios = []
    vistos = set()
    pendientes = []          # transcritas pero aún "en el futuro" del replay
    sesion_previa = None
    async with httpx.AsyncClient() as c:
        while True:
            await asyncio.sleep(CADA_S)
            t = estado.tele
            if not (ACTIVA and clave_openai and t):
                continue
            sk = (t.sesion or {}).get("session_key")
            if not sk:
                continue
            if sk != sesion_previa:          # sesión nueva: empezar limpio
                sesion_previa = sk
                vistos.clear()
                pendientes.clear()
                estado.radios = []
                primera = True
            else:
                primera = False
            try:
                cab = await telemetria._auth_headers(c)
                r = await c.get(telemetria.BASE + "/team_radio",
                                params={"session_key": sk}, headers=cab,
                                timeout=30)
                filas = r.json() if r.status_code == 200 else []
            except Exception as e:
                log.info("Radio: OpenF1 no respondió (%s)", e)
                filas = []
            filas = sorted((f for f in filas if f.get("recording_url")),
                           key=lambda f: f.get("date") or "")
            if primera:
                # Al arrancar a mitad de sesión no se transcribe todo lo
                # atrasado: solo las tres últimas.
                for f in filas[:-3]:
                    vistos.add(f["recording_url"])
            for f in [f for f in filas if f["recording_url"] not in vistos][-4:]:
                vistos.add(f["recording_url"])
                try:
                    a = await c.get(f["recording_url"], timeout=30)
                    a.raise_for_status()
                except Exception as e:
                    log.info("Radio: no se pudo bajar la grabación (%s)", e)
                    continue
                texto = await transcribir(c, a.content, clave_openai)
                if not texto:
                    continue
                n = f.get("driver_number")
                p = (t.pilotos or {}).get(n, {})
                pendientes.append({
                    "fecha": f.get("date"),
                    "numero": n,
                    "acr": p.get("acronimo") or str(n),
                    "nombre": p.get("nombre") or f"car {n}",
                    "texto": texto,
                    "vuelta": t.vuelta,
                })
            # Soltar las que ya "han pasado" en el reloj del directo
            reloj = getattr(t, "fecha_actual", None)
            listas = []
            for p in list(pendientes):
                with contextlib.suppress(Exception):
                    if reloj is None or _fecha(p["fecha"]) <= reloj:
                        listas.append(p)
                        pendientes.remove(p)
            for p in listas:
                estado.radios.append(p)
                del estado.radios[:-8]
                log.info("📻 %s: %s", p["acr"], p["texto"])
                # Como evento, para que el narrador la comente en el acto.
                estado.eventos.append(
                    f"TEAM RADIO (auto-transcribed): {p['nombre']}: "
                    f"\"{p['texto']}\"")

"""telegram_bot.py — El mando a distancia del canal, por Telegram.

El panel web solo se abre si tienes Replit delante y el Repl despierto. Una
noticia no espera a eso: pasa algo, y para cuando has abierto el navegador
en el móvil, entrado al Repl y pegado la URL, ya no es noticia. Con esto le
escribes al bot desde donde estés y el canal se entera.

Esto es SOLO la parte que habla con Telegram (mandar, recibir, y saber de
quién es el bot). Qué hace cada orden vive en main.py, junto al resto de
mandos del canal — así el bot y el panel web hacen exactamente lo mismo y
no se separan con el tiempo.

Se monta una vez:

  1. En Telegram, habla con @BotFather → /newbot → te da un token.
  2. En Replit, Secret  TELEGRAM_TOKEN  = ese token.
  3. Reinicia el canal, escríbele /start a tu bot: te contestará con tu
     chat id.
  4. Secret  TELEGRAM_CHAT_ID  = ese número. Reinicia otra vez.

El paso 4 no es opcional: mientras no esté, el bot NO obedece a nadie. Un
token de bot se filtra con pasmosa facilidad (un log, una captura), y quien
lo tenga podría publicar en tu canal de YouTube. Con el chat id puesto,
solo te hace caso a ti.
"""

import asyncio
import logging
import os

import httpx

log = logging.getLogger("telegram")

API = "https://api.telegram.org"
# Telegram corta los mensajes en 4096 caracteres; se deja margen.
LIMITE = 3900
# Espera del long-poll: la conexión se queda abierta hasta que llega algo,
# así que reacciona al instante sin consultar en bucle.
ESPERA = 50


def token():
    return os.environ.get("TELEGRAM_TOKEN", "").strip()


def dueno():
    return os.environ.get("TELEGRAM_CHAT_ID", "").strip()


def configurado():
    return bool(token())


def es_dueno(chat_id):
    d = dueno()
    return bool(d) and str(chat_id).strip() == d


def _partir(texto):
    """Trocea un texto largo respetando los saltos de línea.

    Cortar a ciegas cada 4096 caracteres parte tablas y palabras por la
    mitad; el informe del canal es justo eso, una tabla larga.
    """
    texto = texto or ""
    if len(texto) <= LIMITE:
        return [texto] if texto else []
    trozos, actual = [], ""
    for linea in texto.split("\n"):
        # Una sola línea más larga que el límite: aquí sí toca cortar a pelo
        while len(linea) > LIMITE:
            if actual:
                trozos.append(actual)
                actual = ""
            trozos.append(linea[:LIMITE])
            linea = linea[LIMITE:]
        if len(actual) + len(linea) + 1 > LIMITE:
            trozos.append(actual)
            actual = linea
        else:
            actual = (actual + "\n" + linea) if actual else linea
    if actual:
        trozos.append(actual)
    return trozos


async def enviar(chat_id, texto):
    """Manda un mensaje (partido si hace falta). True si salió entero."""
    t = token()
    if not (t and chat_id and texto):
        return False
    bien = True
    async with httpx.AsyncClient() as client:
        for trozo in _partir(texto):
            try:
                r = await client.post(
                    f"{API}/bot{t}/sendMessage",
                    json={"chat_id": chat_id, "text": trozo,
                          "disable_web_page_preview": True},
                    timeout=30)
                r.raise_for_status()
            except Exception as e:
                log.info("Telegram: no pude enviar (%s)", e)
                bien = False
    return bien


async def recibir(offset):
    """Espera mensajes nuevos. Devuelve (nuevo_offset, [mensajes]).

    Cada mensaje es {"chat_id", "texto", "de"}.

    Si la conexión falla espera unos segundos ANTES de devolver: quien
    llama está en un bucle, y sin esa pausa un corte de red se convertiría
    en miles de peticiones por minuto.
    """
    t = token()
    if not t:
        await asyncio.sleep(30)
        return offset, []
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{API}/bot{t}/getUpdates",
                params={"offset": offset, "timeout": ESPERA,
                        "allowed_updates": '["message"]'},
                timeout=ESPERA + 15)
            r.raise_for_status()
            datos = r.json()
    except Exception as e:
        log.info("Telegram: sin conexión (%s) — reintento en 10 s", e)
        await asyncio.sleep(10)
        return offset, []

    mensajes = []
    for u in datos.get("result") or []:
        offset = max(offset, (u.get("update_id") or 0) + 1)
        msg = u.get("message") or {}
        texto = (msg.get("text") or "").strip()
        chat = ((msg.get("chat") or {}).get("id"))
        if not (texto and chat is not None):
            continue        # fotos, stickers, audios: no son órdenes
        de = (msg.get("from") or {})
        mensajes.append({
            "chat_id": chat,
            "texto": texto,
            "de": (de.get("username") or de.get("first_name") or "?"),
        })
    return offset, mensajes

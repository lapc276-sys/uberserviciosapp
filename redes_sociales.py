"""Publica los shorts verticales (1080x1920) TAMBIÉN en Instagram Reels y
TikTok, reusando EXACTAMENTE el mismo MP4 que ya se sube a YouTube. Cero
reprocesado: el formato vertical sirve igual para las tres plataformas.

Ambas plataformas son OPCIONALES y viven detrás de variables de entorno,
igual que el OAuth de YouTube. Si no están configuradas, estas funciones no
hacen nada (loguean y devuelven None) — el canal sigue funcionando igual.

================= Instagram Reels (Instagram Graph API) =================
Necesitas una cuenta de Instagram PROFESIONAL (Business o Creator) vinculada
a una Página de Facebook, y una app en Meta for Developers. Secrets:

    INSTAGRAM_USER_ID       el IG user id NUMÉRICO (no el @usuario)
    INSTAGRAM_ACCESS_TOKEN  token de larga duración (dura ~60 días)

Instagram NO acepta subir el archivo: DESCARGA el video de una URL pública.
Por eso hace falta además:

    PUBLIC_URL   la URL pública del canal, p. ej. https://xxxx.replit.dev
                 (sin barra final). Si no la pones, se intenta deducir del
                 dominio de Replit automáticamente.

================= TikTok (Content Posting API) =================
Necesitas una app en TikTok for Developers con el scope video.publish
aprobado. Secrets:

    TIKTOK_CLIENT_KEY
    TIKTOK_CLIENT_SECRET
    TIKTOK_REFRESH_TOKEN    se saca UNA vez con el flujo OAuth de TikTok

TikTok SÍ sube el archivo por partes (no necesita URL pública). Mientras tu
app siga en modo sandbox / sin auditar, TikTok OBLIGA a que los videos salgan
como PRIVADOS (SELF_ONLY) — es su política, no un límite nuestro. Cuando la
app pase la revisión, pon TIKTOK_PRIVACIDAD=PUBLIC_TO_EVERYONE.
"""

import asyncio
import logging
import os
import time

import httpx

log = logging.getLogger("redes")

_GRAPH = "https://graph.facebook.com/v21.0"
_TIKTOK = "https://open.tiktokapis.com"
# User-Agent identificable (buena práctica; algunas CDNs bloquean sin UA)
_UA = {"User-Agent": "F1FanChannelBot/1.0 (automated motorsport channel)"}


# ----------------------------- utilidades -----------------------------

def public_url_base():
    """URL pública del canal, sin barra final. Prioridad:
    1. Secret PUBLIC_URL (lo más fiable).
    2. Dominio de Replit deducido de las variables del entorno.
    Devuelve None si no se puede determinar."""
    u = (os.environ.get("PUBLIC_URL") or "").strip().rstrip("/")
    if u:
        return u if u.startswith("http") else f"https://{u}"
    dom = (os.environ.get("REPLIT_DEV_DOMAIN")
           or os.environ.get("REPLIT_DOMAINS", "").split(",")[0]).strip()
    if dom:
        return f"https://{dom}"
    slug = os.environ.get("REPL_SLUG")
    owner = os.environ.get("REPL_OWNER")
    if slug and owner:
        return f"https://{slug}.{owner}.repl.co"
    return None


def instagram_configurado():
    return bool(os.environ.get("INSTAGRAM_USER_ID")
                and os.environ.get("INSTAGRAM_ACCESS_TOKEN"))


def tiktok_configurado():
    return all(os.environ.get(v) for v in
               ("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET",
                "TIKTOK_REFRESH_TOKEN"))


def alguna_red_configurada():
    return instagram_configurado() or tiktok_configurado()


# ----------------------------- Instagram -----------------------------

async def publicar_instagram_reel(video_url, caption):
    """Publica un Reel. `video_url` debe ser PÚBLICA y accesible por Meta
    (Instagram la descarga de ahí). Devuelve el id del media o None.

    Flujo en 3 pasos: crear contenedor → esperar a que Meta lo procese →
    publicar. Nunca lanza."""
    if not instagram_configurado():
        return None
    if not video_url:
        log.info("Instagram: sin URL pública del video (define PUBLIC_URL) — "
                 "no se puede publicar el Reel")
        return None
    uid = os.environ["INSTAGRAM_USER_ID"]
    token = os.environ["INSTAGRAM_ACCESS_TOKEN"]
    try:
        async with httpx.AsyncClient(headers=_UA, timeout=60) as c:
            # 1) Crear el contenedor del Reel
            r = await c.post(f"{_GRAPH}/{uid}/media", data={
                "media_type": "REELS",
                "video_url": video_url,
                "caption": (caption or "")[:2200],
                "share_to_feed": "true",
                "access_token": token,
            })
            js = r.json()
            if r.status_code >= 400 or "id" not in js:
                log.warning("Instagram: no se creó el contenedor (%s)",
                            js.get("error", js))
                return None
            cont = js["id"]

            # 2) Esperar a que Meta descargue y procese el video
            for _ in range(40):                      # hasta ~3 min
                await asyncio.sleep(5)
                s = await c.get(f"{_GRAPH}/{cont}", params={
                    "fields": "status_code,status",
                    "access_token": token,
                })
                estado = s.json().get("status_code", "")
                if estado == "FINISHED":
                    break
                if estado in ("ERROR", "EXPIRED"):
                    log.warning("Instagram: el video no se procesó (%s)",
                                s.json().get("status", estado))
                    return None
            else:
                log.warning("Instagram: el video tardó demasiado en procesar")
                return None

            # 3) Publicar el contenedor ya procesado
            p = await c.post(f"{_GRAPH}/{uid}/media_publish", data={
                "creation_id": cont,
                "access_token": token,
            })
            pj = p.json()
            if p.status_code >= 400 or "id" not in pj:
                log.warning("Instagram: no se pudo publicar (%s)",
                            pj.get("error", pj))
                return None
            log.info("📸 Publicado en Instagram Reels: %s", pj["id"])
            return pj["id"]
    except Exception as e:
        log.warning("Instagram: fallo publicando el Reel (%s)", e)
        return None


# ------------------------------- TikTok -------------------------------

_tt_token = {"access": None, "expira": 0.0}


async def _tiktok_access_token():
    """Access token válido de TikTok (se refresca del refresh token y se
    cachea hasta poco antes de expirar). None si falla."""
    if _tt_token["access"] and time.time() < _tt_token["expira"] - 60:
        return _tt_token["access"]
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{_TIKTOK}/v2/oauth/token/", data={
                "client_key": os.environ["TIKTOK_CLIENT_KEY"],
                "client_secret": os.environ["TIKTOK_CLIENT_SECRET"],
                "grant_type": "refresh_token",
                "refresh_token": os.environ["TIKTOK_REFRESH_TOKEN"],
            }, headers={"Content-Type": "application/x-www-form-urlencoded"})
            js = r.json()
            if "access_token" not in js:
                log.warning("TikTok: no se pudo refrescar el token (%s)", js)
                return None
            _tt_token["access"] = js["access_token"]
            _tt_token["expira"] = time.time() + float(js.get("expires_in", 3600))
            # TikTok puede rotar el refresh token; lo dejamos en el entorno
            # para esta ejecución (el usuario deberá actualizar el Secret si
            # rota de forma permanente).
            if js.get("refresh_token"):
                os.environ["TIKTOK_REFRESH_TOKEN"] = js["refresh_token"]
            return _tt_token["access"]
    except Exception as e:
        log.warning("TikTok: fallo refrescando el token (%s)", e)
        return None


async def _tiktok_privacidad(client, token):
    """Nivel de privacidad válido para esta cuenta. Consulta las opciones
    permitidas (obligatorio antes de publicar) y respeta TIKTOK_PRIVACIDAD
    si está entre ellas; si no, cae a la primera permitida."""
    pref = (os.environ.get("TIKTOK_PRIVACIDAD") or "SELF_ONLY").strip().upper()
    try:
        r = await client.post(
            f"{_TIKTOK}/v2/post/publish/creator_info/query/",
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": "application/json; charset=UTF-8"})
        opciones = (r.json().get("data", {}) or {}).get(
            "privacy_level_options", [])
        if pref in opciones:
            return pref
        if opciones:
            return opciones[0]
    except Exception as e:
        log.info("TikTok: no se pudo consultar creator_info (%s)", e)
    return pref


async def publicar_tiktok(video_path, caption):
    """Sube el MP4 a TikTok (Content Posting API, subida por archivo en un
    solo trozo — los shorts pesan poco). Devuelve el publish_id o None.
    Nunca lanza."""
    if not tiktok_configurado():
        return None
    if not (video_path and os.path.exists(video_path)):
        return None
    token = await _tiktok_access_token()
    if not token:
        return None
    tam = os.path.getsize(video_path)
    if tam <= 0:
        return None
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            privacidad = await _tiktok_privacidad(c, token)
            # 1) Iniciar la subida (un solo trozo con todo el archivo)
            r = await c.post(
                f"{_TIKTOK}/v2/post/publish/video/init/",
                headers={"Authorization": f"Bearer {token}",
                         "Content-Type": "application/json; charset=UTF-8"},
                json={
                    "post_info": {
                        "title": (caption or "")[:2200],
                        "privacy_level": privacidad,
                        "disable_comment": False,
                        "disable_duet": False,
                        "disable_stitch": False,
                        "video_cover_timestamp_ms": 1000,
                    },
                    "source_info": {
                        "source": "FILE_UPLOAD",
                        "video_size": tam,
                        "chunk_size": tam,
                        "total_chunk_count": 1,
                    },
                })
            js = r.json()
            data = js.get("data", {}) or {}
            publish_id = data.get("publish_id")
            upload_url = data.get("upload_url")
            if not (publish_id and upload_url):
                log.warning("TikTok: no se pudo iniciar la subida (%s)",
                            js.get("error", js))
                return None

            # 2) Subir los bytes del video al upload_url
            with open(video_path, "rb") as f:
                cuerpo = f.read()
            up = await c.put(upload_url, content=cuerpo, headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(tam),
                "Content-Range": f"bytes 0-{tam - 1}/{tam}",
            })
            if up.status_code not in (200, 201, 202):
                log.warning("TikTok: la subida del archivo falló (%s: %s)",
                            up.status_code, up.text[:200])
                return None
            log.info("🎵 Enviado a TikTok (%s, privacidad=%s)",
                     publish_id, privacidad)
            return publish_id
    except Exception as e:
        log.warning("TikTok: fallo publicando (%s)", e)
        return None


# --------------------------- orquestación ---------------------------

async def publicar_en_redes(video_path, sid, caption):
    """Publica un short en TODAS las redes configuradas (además de YouTube).
    - Instagram descarga el video de PUBLIC_URL/media/short/{sid}.mp4
    - TikTok sube el archivo local directamente.
    Devuelve {'instagram': id|None, 'tiktok': id|None}. Nunca lanza."""
    resultado = {"instagram": None, "tiktok": None}
    tareas = {}
    if instagram_configurado():
        base = public_url_base()
        video_url = f"{base}/media/short/{sid}.mp4" if base else None
        tareas["instagram"] = publicar_instagram_reel(video_url, caption)
    if tiktok_configurado():
        tareas["tiktok"] = publicar_tiktok(video_path, caption)
    if not tareas:
        return resultado
    resueltas = await asyncio.gather(*tareas.values(), return_exceptions=True)
    for red, val in zip(tareas.keys(), resueltas):
        resultado[red] = None if isinstance(val, Exception) else val
    return resultado

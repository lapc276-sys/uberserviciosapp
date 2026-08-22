"""articulos.py — Las piezas propias del canal, cada una con su URL.

Por qué existe esto. La portada trae titulares de Autosport y compañía
como preview de enlace, y eso está bien para el lector, pero para Google
no vale nada: es contenido de otros, y una página que solo agrega
titulares ajenos entra en su definición de "scraped content". Tampoco la
aprobaría AdSense, que pide contenido original y sustancial.

Esto es la otra mitad: texto que escribimos nosotros, cada uno en su
propia dirección — /noticias/lo-que-sea — servido **ya escrito desde el
servidor**. Ese detalle es el que decide si Google te indexa o no: la
portada se pinta con JavaScript y para un buscador está casi vacía; estas
páginas llegan con el texto dentro del HTML, su título propio, su fecha y
sus datos estructurados.

Solo se escribe sobre lo que sabemos de verdad:

  · explicadores técnicos — cómo funciona algo, sin fechas ni cifras que
    haya que verificar;
  · previas de fin de semana — el circuito y los horarios salen del
    calendario real;
  · crónicas de sesión — de NUESTRA telemetría: adelantamientos, paradas,
    vueltas rápidas. Son datos que tenemos y que nadie más publica así.

Lo que no se hace: coger el titular de un medio y pedirle al modelo que
"escriba la noticia". No sabe nada más que ese titular, así que rellenaría
los huecos inventando. Eso hunde la credibilidad del sitio y no hay SEO
que lo arregle.

Las fotos vienen de Wikimedia Commons con su autor y su licencia al pie.
"""

import contextlib
import datetime as dt
import html
import json
import logging
import os
import re
import unicodedata

import httpx

log = logging.getLogger("articulos")

DIR = "articulos"
# Dirección pública del sitio. Hace falta para las URL canónicas y el
# sitemap: Google necesita saber cuál es LA dirección de cada página, y
# sin esto no hay forma de construirla.
SITIO = os.environ.get("SITIO_URL", "").strip().rstrip("/")
NOMBRE = os.environ.get("SITIO_NOMBRE", "APEX").strip()

# ── Quién firma ───────────────────────────────────────────────────────
# Google mira quién hay detrás de un sitio antes de darle autoridad, y una
# persona con nombre, cara y biografía vale mucho más que un logo. Nada de
# esto es obligatorio: sin AUTOR_NOMBRE la firma sigue siendo el canal.
AUTOR = os.environ.get("AUTOR_NOMBRE", "").strip()
AUTOR_ROL = os.environ.get("AUTOR_ROL", "Editor").strip()
AUTOR_BIO = os.environ.get("AUTOR_BIO", "").strip()
AUTOR_FOTO = os.environ.get("AUTOR_FOTO", "").strip()   # URL o /estatico/...
# Cómo se hace el contenido, dicho en claro. Va en la caja del autor y en
# la página "about". Se puede cambiar, pero borrarlo del todo es mala idea:
# AdSense exige representación veraz y es de las cosas por las que cierran
# una cuenta sin avisar.
AUTOR_NOTA = os.environ.get(
    "AUTOR_NOTA",
    "Articles here are produced with automated research and published "
    "under editorial review.").strip()

_COMMONS = "https://commons.wikimedia.org/w/api.php"


# ── guardar y leer ────────────────────────────────────────────────────

def slug(texto):
    """Convierte un título en la parte final de la URL.

    Se le quitan los acentos, se deja en minúsculas y se unen las
    palabras con guiones — que es la forma que Google lee mejor y que un
    lector puede escribir a mano sin equivocarse.
    """
    t = unicodedata.normalize("NFKD", texto or "")
    t = t.encode("ascii", "ignore").decode("ascii").lower()
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return t[:70].rstrip("-") or "articulo"


def slug_valido(s):
    """Solo minúsculas, números y guiones: nada de rutas hacia arriba."""
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", s or ""))


def guardar(art):
    os.makedirs(DIR, exist_ok=True)
    with open(os.path.join(DIR, art["slug"] + ".json"), "w") as f:
        json.dump(art, f, ensure_ascii=False, indent=1)


def cargar(s):
    if not slug_valido(s):
        return None
    try:
        with open(os.path.join(DIR, s + ".json")) as f:
            return json.load(f)
    except Exception:
        return None


def listar(n=50):
    """Los artículos publicados, del más nuevo al más viejo."""
    out = []
    try:
        for a in os.listdir(DIR):
            if a.endswith(".json"):
                with contextlib.suppress(Exception):
                    with open(os.path.join(DIR, a)) as f:
                        out.append(json.load(f))
    except Exception:
        return []
    out.sort(key=lambda x: x.get("fecha", ""), reverse=True)
    return out[:n]


def existe(s):
    return os.path.exists(os.path.join(DIR, s + ".json"))


# ── fotos con su crédito ──────────────────────────────────────────────

async def foto_commons(query):
    """Una foto de Wikimedia Commons CON su autor y su licencia.

    La función de imágenes que ya usa el canal devuelve solo la URL, que
    sirve para un video pero no para una página: publicar una foto de
    Commons sin acreditar a quien la hizo incumple casi todas sus
    licencias. Aquí se pide también `extmetadata`, que es donde Commons
    guarda el autor, la licencia y la página original.
    """
    if not query:
        return None
    try:
        async with httpx.AsyncClient(follow_redirects=True) as c:
            r = await c.get(_COMMONS, params={
                "action": "query", "generator": "search",
                "gsrsearch": query, "gsrnamespace": 6, "gsrlimit": 6,
                "prop": "imageinfo",
                "iiprop": "url|mime|extmetadata", "iiurlwidth": 1600,
                "format": "json"}, timeout=20,
                headers={"User-Agent": f"{NOMBRE} motorsport site"})
            r.raise_for_status()
            paginas = r.json().get("query", {}).get("pages", {})
    except Exception as e:
        log.info("Sin foto de Commons para '%s' (%s)", query, e)
        return None

    for p in sorted(paginas.values(), key=lambda p: p.get("index", 99)):
        for ii in p.get("imageinfo", []):
            if not (ii.get("mime", "").startswith("image/")
                    and ii.get("thumburl")):
                continue
            meta = ii.get("extmetadata") or {}

            def campo(k):
                v = (meta.get(k) or {}).get("value", "")
                return re.sub(r"<[^>]+>", "", str(v)).strip()

            licencia = campo("LicenseShortName")
            # Sin licencia declarada no se publica: puede ser una subida
            # marcada para borrar o un archivo con derechos reservados.
            if not licencia:
                continue
            return {
                "url": ii["thumburl"],
                "autor": campo("Artist")[:120] or "Unknown",
                "licencia": licencia[:60],
                "enlace": ii.get("descriptionurl", ""),
            }
    return None


# ── la página de un artículo ──────────────────────────────────────────

def _e(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def _cara(px):
    """La foto del autor al tamaño pedido, o sus iniciales si no hay foto.

    Las iniciales evitan el hueco gris de "imagen rota" cuando alguien
    pone su nombre pero todavía no ha subido la foto.
    """
    if AUTOR_FOTO:
        return (f'<img class="cara" src="{_e(AUTOR_FOTO)}" alt="{_e(AUTOR)}" '
                f'width="{px}" height="{px}" loading="lazy">')
    ini = "".join(p[0] for p in AUTOR.split()[:2]).upper() or "?"
    return (f'<span class="cara ini" style="width:{px}px;height:{px}px;'
            f'font-size:{max(11, px // 2 - 2)}px">{_e(ini)}</span>')


def url_de(art, base=""):
    b = (base or SITIO or "").rstrip("/")
    return f"{b}/noticias/{art['slug']}"


def _fecha_legible(iso):
    try:
        d = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return d.strftime("%d %B %Y")
    except Exception:
        return ""


def _jsonld(art, base):
    """Los datos estructurados que Google lee para entender la página.

    Sin esto la ve como texto suelto; con esto sabe que es un artículo,
    de cuándo es y de quién — que es lo que le permite enseñarla con
    fecha y autor en los resultados.
    """
    d = {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": art.get("titulo", "")[:110],
        "description": art.get("entradilla", ""),
        "datePublished": art.get("fecha", ""),
        "dateModified": art.get("fecha", ""),
        # Una persona con nombre pesa más que una marca en los datos que
        # Google usa para decidir de quién se fía.
        "author": ({"@type": "Person", "name": AUTOR,
                    "jobTitle": AUTOR_ROL,
                    "url": f"{(base or SITIO or '').rstrip('/')}/about"}
                   if AUTOR else {"@type": "Organization", "name": NOMBRE}),
        "publisher": {"@type": "Organization", "name": NOMBRE},
        "mainEntityOfPage": {"@type": "WebPage", "@id": url_de(art, base)},
        "articleSection": art.get("tema", "Motorsport"),
    }
    if (art.get("foto") or {}).get("url"):
        d["image"] = [art["foto"]["url"]]
    # </script> dentro del JSON cerraría la etiqueta antes de tiempo.
    return json.dumps(d, ensure_ascii=False).replace("<", "\\u003c")


def pagina(art, base="", relacionados=()):
    """El HTML completo de un artículo, ya escrito, sin JavaScript.

    Que no lleve JavaScript no es pereza: es el punto. Google indexa esto
    tal cual llega, sin tener que ejecutar nada, y carga al instante en un
    móvil con mala señal — las dos cosas que más pesan para posicionar.
    """
    u = url_de(art, base)
    foto = art.get("foto") or {}
    fecha = art.get("fecha", "")

    # Dos formas de cuerpo. `cuerpo` es una lista de párrafos, para las
    # piezas cortas. `secciones` viene de los episodios del canal, que ya
    # están divididos en capítulos con su tema: cada uno se convierte en un
    # <h2>, que además le da a Google el índice de lo que trata la página.
    if art.get("secciones"):
        cuerpo = "\n".join(
            (f"<h2>{_e(s.get('titulo', ''))}</h2>" if s.get("titulo") else "")
            + "\n".join(f"<p>{_e(p)}</p>" for p in s.get("parrafos", [])
                        if p.strip())
            for s in art["secciones"])
    else:
        cuerpo = "\n".join(
            f"<p>{_e(p)}</p>" for p in art.get("cuerpo", []) if p.strip())

    # Si la pieza salió de un video del canal, se enlaza. Es contenido
    # propio: el texto y el video cuentan lo mismo en dos formatos.
    if art.get("video"):
        cuerpo += (
            f'<p class="verlo"><a href="{_e(art["video"])}" rel="noopener" '
            f'target="_blank">Watch this as a video on our channel →</a></p>')

    cred = ""
    if foto.get("url"):
        quien = _e(foto.get("autor", "Unknown"))
        if foto.get("enlace"):
            quien = f'<a href="{_e(foto["enlace"])}" rel="noopener">{quien}</a>'
        cred = (f'<figcaption>Photo: {quien} · '
                f'{_e(foto.get("licencia", ""))}, via Wikimedia Commons'
                f'</figcaption>')

    # Firma: la carita y el nombre junto a la fecha. Sin AUTOR_NOMBRE se
    # queda el canal, como hasta ahora.
    firma = (f'<span class="quien">{_cara(26)}<b>{_e(AUTOR)}</b>'
             f'<i>{_e(AUTOR_ROL)}</i></span>') if AUTOR else _e(NOMBRE)

    # Caja del autor al pie del artículo
    caja = ""
    if AUTOR:
        caja = (
            '<aside class="autor">' + _cara(64)
            + f'<div><b>{_e(AUTOR)}</b>'
            + f'<span class="rol">{_e(AUTOR_ROL)} · {_e(NOMBRE)}</span>'
            + (f"<p>{_e(AUTOR_BIO)}</p>" if AUTOR_BIO else "")
            + (f'<p class="nota">{_e(AUTOR_NOTA)}</p>' if AUTOR_NOTA else "")
            + "</div></aside>")

    otros = "".join(
        f'<li><a href="/noticias/{_e(r["slug"])}">{_e(r["titulo"])}</a></li>'
        for r in relacionados)
    otros = (f'<nav class="rel"><h2>More from {_e(NOMBRE)}</h2>'
             f"<ul>{otros}</ul></nav>") if otros else ""

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{_e(art.get('titulo', ''))} | {_e(NOMBRE)}</title>
<meta name="description" content="{_e(art.get('entradilla', ''))}">
{f'<link rel="canonical" href="{_e(u)}">' if base or SITIO else ''}
<meta property="og:type" content="article">
<meta property="og:title" content="{_e(art.get('titulo', ''))}">
<meta property="og:description" content="{_e(art.get('entradilla', ''))}">
{f'<meta property="og:url" content="{_e(u)}">' if base or SITIO else ''}
{f'<meta property="og:image" content="{_e(foto["url"])}">' if foto.get('url') else ''}
<meta property="og:site_name" content="{_e(NOMBRE)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<script type="application/ld+json">{_jsonld(art, base)}</script>
<style>
  :root {{ --bg:#08090C; --sur:#0F1218; --line:#232B37; --txt:#F5F7FA;
           --dim:#8992A3; --dim2:#5C6474; --acc:#FF2D16; }}
  * {{ box-sizing:border-box; margin:0; padding:0; }}
  body {{ background:var(--bg); color:var(--txt);
          font-family:Barlow,"Segoe UI",system-ui,sans-serif;
          -webkit-font-smoothing:antialiased; line-height:1.6; }}
  a {{ color:inherit; }}
  header {{ border-bottom:1px solid var(--line); }}
  .hd {{ max-width:1440px; margin:0 auto; display:flex; align-items:center;
         gap:11px; height:68px; padding:0 40px; }}
  .hd b {{ font-family:Archivo,sans-serif; font-weight:900; font-size:23px;
           letter-spacing:-.015em; }}
  .hd nav {{ margin-left:auto; display:flex; gap:26px; }}
  .hd nav a {{ font-size:13px; font-weight:600; letter-spacing:.1em;
               text-transform:uppercase; color:var(--dim);
               text-decoration:none; }}
  .hd nav a:hover {{ color:var(--txt); }}
  main {{ max-width:760px; margin:0 auto; padding:44px 24px 60px; }}
  .crumbs {{ font-size:12px; font-weight:600; letter-spacing:.12em;
             text-transform:uppercase; color:var(--dim2); margin-bottom:20px; }}
  .crumbs a {{ color:var(--acc); text-decoration:none; }}
  h1 {{ font-family:Archivo,sans-serif; font-weight:900;
        font-size:clamp(30px,5vw,50px); line-height:1.04;
        letter-spacing:-.028em; text-wrap:balance; margin-bottom:18px; }}
  .lede {{ font-size:19px; color:var(--dim); text-wrap:pretty;
           margin-bottom:22px; }}
  .by {{ display:flex; flex-wrap:wrap; align-items:center; gap:10px;
         padding-bottom:26px; border-bottom:1px solid var(--line);
         font-size:13px; color:var(--dim2); }}
  .by b {{ color:var(--acc); font-size:11px; font-weight:800;
           letter-spacing:.14em; text-transform:uppercase; }}
  figure {{ margin:26px 0; }}
  figure img {{ width:100%; height:auto; display:block; border-radius:2px; }}
  figcaption {{ margin-top:9px; font-size:12px; color:var(--dim2); }}
  figcaption a {{ color:var(--dim); }}
  article p {{ margin:20px 0; font-size:17px; text-wrap:pretty; }}
  article h2 {{ margin:38px 0 -4px; font-family:Archivo,sans-serif;
                font-weight:800; font-size:23px; letter-spacing:-.015em;
                line-height:1.2; text-wrap:balance; }}
  .verlo {{ margin-top:34px !important; padding-top:22px;
            border-top:1px solid var(--line); }}
  .verlo a {{ color:var(--acc); font-weight:600; text-decoration:none; }}
  .verlo a:hover {{ text-decoration:underline; }}
  /* Firma y caja del autor */
  .cara {{ border-radius:50%; object-fit:cover; flex:none;
           background:#1A2029; }}
  .cara.ini {{ display:inline-flex; align-items:center; justify-content:center;
               font-family:Archivo,sans-serif; font-weight:800;
               letter-spacing:.02em; color:var(--dim); }}
  .by .quien {{ display:inline-flex; align-items:center; gap:8px; }}
  /* El nombre va dentro de .by, así que le caía encima el estilo de la
     etiqueta del tema: mayúsculas y espaciado. Un nombre propio así se
     lee como etiqueta y no como firma. */
  .by .quien b {{ color:var(--txt); font-weight:600; font-size:14px;
                  text-transform:none; letter-spacing:normal; }}
  .by .quien i {{ font-style:normal; color:var(--dim2); }}
  .autor {{ display:flex; gap:16px; margin-top:44px; padding:22px;
            background:var(--sur); border:1px solid var(--line);
            border-left:3px solid var(--acc); border-radius:3px; }}
  .autor b {{ display:block; font-family:Archivo,sans-serif; font-weight:800;
              font-size:17px; letter-spacing:-.01em; }}
  .autor .rol {{ display:block; margin-top:2px; font-size:11px;
                 font-weight:700; letter-spacing:.14em; text-transform:uppercase;
                 color:var(--acc); }}
  .autor p {{ margin-top:10px; font-size:14px; line-height:1.55;
              color:var(--dim); }}
  .autor p.nota {{ font-size:12px; color:var(--dim2); }}
  .rel {{ margin-top:48px; padding-top:26px; border-top:1px solid var(--line); }}
  .rel h2 {{ font-family:Archivo,sans-serif; font-weight:800; font-size:17px;
             letter-spacing:.01em; text-transform:uppercase;
             margin-bottom:14px; }}
  .rel ul {{ list-style:none; }}
  .rel li {{ padding:12px 0; border-bottom:1px solid #14181F; }}
  .rel a {{ font-size:16px; font-weight:600; text-decoration:none; }}
  .rel a:hover {{ color:var(--acc); }}
  footer {{ max-width:760px; margin:0 auto; padding:0 24px 44px;
            font-size:12px; color:var(--dim2); }}
  @media (max-width:700px) {{ .hd {{ padding:0 20px; }} .hd nav {{ display:none; }} }}
</style>
</head>
<body>
<header><div class="hd">
  <a href="/inicio" style="display:flex;align-items:center;gap:11px;text-decoration:none">
    <svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M10 5 L24 5 L21 9.5 L7 9.5 Z" fill="#FF2D16"/>
      <path d="M6.5 12 L20.5 12 L17.5 16.5 L3.5 16.5 Z" fill="#FF2D16" opacity=".62"/>
      <path d="M3 19 L17 19 L14 23.5 L0 23.5 Z" fill="#FF2D16" opacity=".3"/>
    </svg><b>{_e(NOMBRE)}</b>
  </a>
  <nav><a href="/inicio">Home</a><a href="/noticias-propias">Analysis</a>
       <a href="/inicio#standings">Standings</a><a href="/about">About</a></nav>
</div></header>

<main>
  <p class="crumbs"><a href="/inicio">Home</a> · <a href="/noticias-propias">Analysis</a> · {_e(art.get('tema', ''))}</p>
  <article>
    <h1>{_e(art.get('titulo', ''))}</h1>
    <p class="lede">{_e(art.get('entradilla', ''))}</p>
    <p class="by"><b>{_e(art.get('tema', 'Analysis'))}</b>
       {firma}
       <time datetime="{_e(fecha)}">{_e(_fecha_legible(fecha))}</time></p>
    {f'<figure><img src="{_e(foto["url"])}" alt="{_e(art.get("titulo",""))}" width="1600" height="900" loading="lazy">{cred}</figure>' if foto.get('url') else ''}
    {cuerpo}
  </article>
  {caja}
  {otros}
</main>
<footer>
  <p>{_e(NOMBRE)} is an independent motorsport channel. Not associated with,
     endorsed by, or affiliated with Formula 1, the FIA, or any championship
     or team. All trademarks belong to their owners.</p>
</footer>
</body>
</html>"""


# ── lo que Google necesita para encontrarlo todo ──────────────────────

def sitemap(base, arts):
    """El mapa del sitio: la lista de direcciones que Google debe visitar.

    Un sitio nuevo no lo encuentra nadie por enlaces — no los tiene
    todavía. Esto es lo que le dice a Google qué hay y cuándo cambió.
    """
    b = (base or SITIO or "").rstrip("/")
    urls = [(f"{b}/inicio", "", "daily", "1.0"),
            (f"{b}/noticias-propias", "", "daily", "0.8"),
            (f"{b}/about", "", "monthly", "0.5")]
    for a in arts:
        urls.append((f"{b}/noticias/{a['slug']}",
                     (a.get("fecha") or "")[:10], "monthly", "0.7"))
    cuerpo = "".join(
        "<url><loc>" + html.escape(u, quote=False) + "</loc>"
        + (f"<lastmod>{lm}</lastmod>" if lm else "")
        + f"<changefreq>{cf}</changefreq><priority>{pr}</priority></url>"
        for u, lm, cf, pr in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            + cuerpo + "</urlset>")


def about(base=""):
    """La página de quién está detrás.

    Google la busca literalmente: un sitio sin una página que diga quién
    lo escribe y por qué le cuesta mucho más ganarse autoridad. AdSense
    también la pide antes de aprobar.
    """
    b = (base or SITIO or "").rstrip("/")
    persona = ""
    if AUTOR:
        persona = (
            '<aside class="autor">' + _cara(84)
            + f'<div><b>{_e(AUTOR)}</b>'
            + f'<span class="rol">{_e(AUTOR_ROL)} · {_e(NOMBRE)}</span>'
            + (f"<p>{_e(AUTOR_BIO)}</p>" if AUTOR_BIO else "")
            + "</div></aside>")
    ld = json.dumps({
        "@context": "https://schema.org", "@type": "AboutPage",
        "mainEntity": {
            "@type": "Organization", "name": NOMBRE,
            "url": b or None,
            **({"employee": {"@type": "Person", "name": AUTOR,
                             "jobTitle": AUTOR_ROL}} if AUTOR else {}),
        },
    }, ensure_ascii=False).replace("<", "\\u003c")

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>About | {_e(NOMBRE)}</title>
<meta name="description" content="Who runs {_e(NOMBRE)}, where its numbers
come from, and how its articles are made.">
{f'<link rel="canonical" href="{_e(b)}/about">' if b else ''}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800;900&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<script type="application/ld+json">{ld}</script>
<style>
 :root {{ --bg:#08090C; --sur:#0F1218; --line:#232B37; --txt:#F5F7FA;
          --dim:#8992A3; --dim2:#5C6474; --acc:#FF2D16; }}
 *{{box-sizing:border-box;margin:0;padding:0}}
 body{{background:var(--bg);color:var(--txt);font-family:Barlow,system-ui,sans-serif;
       line-height:1.65;-webkit-font-smoothing:antialiased}}
 main{{max-width:760px;margin:0 auto;padding:52px 24px 60px}}
 h1{{font-family:Archivo,sans-serif;font-weight:900;font-size:clamp(30px,5vw,46px);
     letter-spacing:-.028em;text-transform:uppercase;margin-bottom:18px}}
 h2{{font-family:Archivo,sans-serif;font-weight:800;font-size:21px;
     letter-spacing:-.012em;margin:36px 0 10px}}
 p{{margin:14px 0;font-size:16px;color:var(--dim);text-wrap:pretty}}
 a{{color:var(--acc);text-decoration:none}} a:hover{{text-decoration:underline}}
 .back{{display:inline-block;margin-bottom:22px;font-size:12px;font-weight:700;
        letter-spacing:.12em;text-transform:uppercase}}
 .cara{{border-radius:50%;object-fit:cover;flex:none;background:#1A2029}}
 .cara.ini{{display:inline-flex;align-items:center;justify-content:center;
            font-family:Archivo,sans-serif;font-weight:800;color:var(--dim)}}
 .autor{{display:flex;gap:18px;margin:26px 0;padding:22px;background:var(--sur);
         border:1px solid var(--line);border-left:3px solid var(--acc);
         border-radius:3px}}
 .autor b{{display:block;font-family:Archivo,sans-serif;font-weight:800;
           font-size:19px}}
 .autor .rol{{display:block;margin-top:2px;font-size:11px;font-weight:700;
              letter-spacing:.14em;text-transform:uppercase;color:var(--acc)}}
 .autor p{{margin-top:10px;font-size:14px}}
 @media(max-width:700px){{.autor{{flex-direction:column}}}}
</style></head><body><main>
<a class="back" href="/inicio">← Home</a>
<h1>About {_e(NOMBRE)}</h1>
<p>{_e(NOMBRE)} is an independent motorsport channel and site covering
   Formula 1, MotoGP, NASCAR, IndyCar and endurance racing.</p>
{persona}
<h2>Where the numbers come from</h2>
<p>Live timing, positions and lap data come from the OpenF1 API.
   Championship standings come from Jolpica. Figures such as tyre
   degradation and the cost of a pit stop are measured from those laps
   here, not taken from anyone else, and every graphic on the broadcast
   states how its number was worked out.</p>
<h2>How the articles are made</h2>
<p>{_e(AUTOR_NOTA)} Pieces are written only from material we hold: how
   something works mechanically, a circuit's own demands, or data measured
   during a session. Nothing is written from a headline alone.</p>
<h2>Headlines and photographs</h2>
<p>Headlines from other outlets appear as link previews — the publisher's
   own thumbnail and name, linking to their article. We do not reproduce
   their text. Archive photography comes from Wikimedia Commons and is
   credited to the photographer with its licence.</p>
<h2>Not affiliated</h2>
<p>{_e(NOMBRE)} is not associated with, endorsed by, or affiliated with
   Formula 1, the FIA, or any championship or team. All trademarks belong
   to their owners.</p>
</main></body></html>"""


def robots(base):
    b = (base or SITIO or "").rstrip("/")
    # El panel fuera del índice: son los mandos del canal, no contenido.
    return ("User-agent: *\n"
            "Allow: /\n"
            "Disallow: /panel\n"
            "Disallow: /control/\n"
            "Disallow: /datos/\n"
            + (f"\nSitemap: {b}/sitemap.xml\n" if b else ""))

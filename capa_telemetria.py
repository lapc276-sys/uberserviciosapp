"""capa_telemetria.py — Capa de overlay técnico sobre imagen o video.

Qué hace
────────
Monta encima de un fotograma base tres cosas que se pueden combinar:

  1. LÍNEAS DE FLUJO o wireframe técnico, calculadas de verdad — las
     mismas de `flujo_calculado.py` y `ala_espacio.py`, no un adorno
     vectorial cualquiera.
  2. PANELES DE TELEMETRÍA: curva de velocidad, fuerzas G, mapa de
     presión, con tipografía monoespaciada de instrumento.
  3. RETÍCULA y marcas de encuadre, para que el conjunto se lea como una
     lectura de datos y no como un filtro.

Y exporta: un fotograma suelto, una secuencia numerada para montar en
cualquier editor, o un video entero procesado.

Dependencias, y por qué van aisladas
────────────────────────────────────
Este módulo es el ÚNICO del proyecto que usa OpenCV y NumPy. El resto
dibuja con Pillow a propósito: en Replit, cada dependencia pesada es una
cosa más que se puede romper al cambiar el contenedor, y el canal tiene
que seguir emitiendo aunque esto no esté.

Por eso aquí todo se importa PEREZOSAMENTE y `disponible()` dice qué
falta. Si no está OpenCV, las funciones de video devuelven None y el
canal sigue igual — como ya hace `graficos_f1.py` con FastF1.

    pip install opencv-python numpy matplotlib

Sobre el video base
───────────────────
El overlay va encima de METRAJE PROPIO o de clips de licencia libre de
`biblioteca/`. No sobre una retransmisión: poner nuestros gráficos encima
de la señal de F1TV no la convierte en nuestra, y es exactamente el uso
que hace que a un canal le caiga un strike.
"""

import contextlib
import logging
import math
import os

log = logging.getLogger("capa")

# La paleta del canal, en BGR para OpenCV y en hex para matplotlib
FONDO_HEX = "#0A0C11"
TINTA_HEX = "#F2F4F8"
ACENTO_HEX = "#FF2D16"
FRIO_HEX = "#2FC4E0"
CALIDO_HEX = "#FFB020"
TENUE_HEX = "#5A6473"

#: Tipografía de instrumento. Se busca en este orden; DejaVu Sans Mono
#: viene con matplotlib, así que siempre hay una.
MONO = ["JetBrains Mono", "IBM Plex Mono", "Roboto Mono", "Consolas",
        "DejaVu Sans Mono", "monospace"]


def _hex_a_bgr(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return (b, g, r)


def disponible():
    """Qué hay y qué falta. Devuelve {"ok": bool, "faltan": [...]}"""
    faltan = []
    for mod, paquete in (("cv2", "opencv-python"), ("numpy", "numpy"),
                         ("matplotlib", "matplotlib")):
        try:
            __import__(mod)
        except Exception:
            faltan.append(paquete)
    return {"ok": not faltan, "faltan": faltan,
            "instalar": ("pip install " + " ".join(faltan)) if faltan else ""}


def _exigir():
    """Importa las tres o explica qué falta. Devuelve (cv2, np, plt)."""
    est = disponible()
    if not est["ok"]:
        raise RuntimeError(
            "Falta " + ", ".join(est["faltan"]) + ". " + est["instalar"])
    import cv2
    import numpy as np
    import matplotlib
    matplotlib.use("Agg")           # sin ventana: esto corre en servidor
    import matplotlib.pyplot as plt
    return cv2, np, plt


# ── 1. Líneas de flujo y wireframe ────────────────────────────────────

def geometria_flujo(modelo, caja, n_lineas=26):
    """Las líneas de corriente del modelo, en coordenadas del modelo.

    Es PURA GEOMETRÍA y no toca ninguna dependencia pesada: se puede
    calcular y probar sin OpenCV. Devuelve [[(x, y, velocidad), ...]].
    """
    import flujo_calculado as F
    return F.campo(modelo, caja, n_lineas)


def geometria_wireframe(ala, estela=1.15, n_hilos=13):
    """El sistema de vórtices de un ala, en 3D y ya proyectado a 2D.

    Devuelve [(puntos2d, color_hex, grosor)] listo para pintar. También
    es pura geometría: se prueba sin nada instalado.
    """
    import ala_espacio as A
    vista = A.Vista(giro=26, alza=30)
    trazos = []
    largo = estela * ala.b
    d = 0.002 * ala.b

    def _dg(y):
        return (ala.gamma(y + d) - ala.gamma(y - d)) / (2 * d)

    # El ala
    trazos.append(([vista(-0.25 * ala.cuerda(y), y, 0.0)
                    for y in [-ala.b / 2 + ala.b * i / 60 for i in range(61)]],
                   ACENTO_HEX, 3))
    # La lámina que suelta
    tope = max(abs(_dg(-ala.b / 2 + ala.b * (k + .5) / n_hilos))
               for k in range(n_hilos)) or 1.0
    for i in range(n_hilos):
        y = -ala.b / 2 + ala.b * (i + 0.5) / n_hilos
        f = min(1.0, abs(_dg(y)) / tope)
        if f < 0.05:
            continue
        wd = ala.downwash(y) / max(1e-6, ala.U)
        trazos.append(([vista(0.75 * ala.cuerda(y) + largo * k / 30, y,
                              -wd * ((0.75 * ala.cuerda(y) + largo * k / 30)
                                     ** 1.15) * 0.42)
                        for k in range(31)], FRIO_HEX, max(1, int(1 + 2 * f))))
    # Las puntas
    for signo in (-1, 1):
        y_p = signo * ala.b / 2
        for fase in (0.0, 2 * math.pi / 3, 4 * math.pi / 3):
            pts = []
            for k in range(120):
                t = k / 119
                ang = fase + 3.4 * math.pi * t ** 0.9
                r = 0.075 * ala.b * (1 - math.exp(-6.0 * t))
                pts.append(vista(0.75 * ala.cuerda(y_p) + largo * t,
                                 y_p - signo * 0.09 * ala.b * t
                                 + signo * r * math.cos(ang),
                                 -0.12 * ala.b * t + r * math.sin(ang)))
            trazos.append((pts, CALIDO_HEX, 2))
    return trazos


def _encajar(puntos_por_traza, ancho, alto, margen=0.06):
    """Escala y centra un conjunto de trazas 2D dentro del lienzo.

    Devuelve una función (x, y) -> (px, py). Separado a propósito: es la
    parte que más se equivoca y así se puede probar sola.
    """
    todos = [p for tr in puntos_por_traza for p in tr]
    if not todos:
        return lambda x, y: (0.0, 0.0)
    xs = [p[0] for p in todos]
    ys = [p[1] for p in todos]
    ax, ay = (max(xs) - min(xs)) or 1.0, (max(ys) - min(ys)) or 1.0
    cw, ch = ancho * (1 - 2 * margen), alto * (1 - 2 * margen)
    k = min(cw / ax, ch / ay)
    ox = ancho * margen + (cw - ax * k) / 2 - min(xs) * k
    oy = alto * margen + (ch - ay * k) / 2 - min(ys) * k
    return lambda x, y: (ox + x * k, oy + y * k)


def capa_flujo(tam, modelo=None, ala=None, caja=None, n_lineas=26,
               opacidad=0.85, grosor=2, colorear=True):
    """Capa RGBA transparente con las líneas de flujo o el wireframe.

    `modelo` = uno de flujo_calculado (Perfil, Cilindro, CalleKarman).
    `ala`    = un ala_espacio.Ala, para el wireframe en 3D.
    """
    cv2, np, _plt = _exigir()
    import flujo_calculado as F
    w, h = tam
    capa = np.zeros((h, w, 4), dtype=np.uint8)

    if ala is not None:
        trazos = geometria_wireframe(ala)
        mapa = _encajar([t[0] for t in trazos], w, h)
        for pts, col, gr in trazos:
            b, g, r = _hex_a_bgr(col)
            proy = np.array([mapa(x, y) for x, y in pts], dtype=np.int32)
            cv2.polylines(capa, [proy], False,
                          (b, g, r, int(255 * opacidad)), gr, cv2.LINE_AA)
        return capa

    if modelo is None:
        return capa
    caja = caja or (-2.4, 3.2, -1.5, 1.5)
    lineas = geometria_flujo(modelo, caja, n_lineas)
    if not lineas:
        return capa
    xmin, xmax, ymin, ymax = caja
    k = min(w / (xmax - xmin), h / (ymax - ymin))
    ox = (w - (xmax - xmin) * k) / 2 - xmin * k
    oy = (h - (ymax - ymin) * k) / 2 + ymax * k
    vels = sorted(v for ln in lineas for (_x, _y, v) in ln)
    vmin = vels[int(len(vels) * 0.04)]
    vmax = vels[int(len(vels) * 0.96)]
    rango = (vmax - vmin) or 1.0
    for ln in lineas:
        for i in range(1, len(ln)):
            x1, y1, v1 = ln[i - 1]
            x2, y2, v2 = ln[i]
            if colorear:
                r, g, b = F._color(((v1 + v2) / 2 - vmin) / rango)
            else:
                b, g, r = _hex_a_bgr(FRIO_HEX)
                r, g, b = r, g, b
            cv2.line(capa, (int(ox + x1 * k), int(oy - y1 * k)),
                     (int(ox + x2 * k), int(oy - y2 * k)),
                     (b, g, r, int(255 * opacidad)), grosor, cv2.LINE_AA)
    return capa


# ── 2. Paneles de telemetría ──────────────────────────────────────────

def _figura(w_px, h_px, plt):
    """Una figura de matplotlib del tamaño exacto en píxeles, transparente."""
    dpi = 100
    fig = plt.figure(figsize=(w_px / dpi, h_px / dpi), dpi=dpi)
    fig.patch.set_alpha(0.0)
    return fig, dpi


def _estilo_eje(ax, plt):
    """El aspecto de instrumento: monoespaciada, sin marco, en penumbra."""
    ax.set_facecolor((0, 0, 0, 0))
    for lado in ("top", "right"):
        ax.spines[lado].set_visible(False)
    for lado in ("left", "bottom"):
        ax.spines[lado].set_color(TENUE_HEX)
        ax.spines[lado].set_linewidth(0.8)
    ax.tick_params(colors=TENUE_HEX, labelsize=8, length=3)
    for et in ax.get_xticklabels() + ax.get_yticklabels():
        et.set_fontfamily(MONO)
    ax.grid(True, color=TENUE_HEX, alpha=0.22, linewidth=0.6)


def _a_rgba(fig, np, plt):
    """Figura de matplotlib → array RGBA que OpenCV pueda componer."""
    fig.canvas.draw()
    buf = np.asarray(fig.canvas.buffer_rgba()).copy()
    plt.close(fig)
    # matplotlib da RGBA; OpenCV trabaja en BGRA
    return buf[:, :, [2, 1, 0, 3]]


def panel_velocidad(serie, tam=(560, 200), titulo="SPEED", unidad="km/h",
                    marca=None):
    """Curva de velocidad. `serie` = [(x, valor)] o [valor].

    `marca` = (x, "texto") para señalar un punto — el frenazo, el apex.
    """
    cv2, np, plt = _exigir()
    fig, dpi = _figura(tam[0], tam[1], plt)
    ax = fig.add_axes([0.10, 0.22, 0.87, 0.62])
    _estilo_eje(ax, plt)
    pts = [(i, v) for i, v in enumerate(serie)] if serie and not isinstance(
        serie[0], (tuple, list)) else list(serie)
    if not pts:
        return _a_rgba(fig, np, plt)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    ax.plot(xs, ys, color=ACENTO_HEX, linewidth=2.0)
    ax.fill_between(xs, min(ys), ys, color=ACENTO_HEX, alpha=0.13)
    if marca:
        mx, txt = marca
        ax.axvline(mx, color=CALIDO_HEX, linewidth=1.0, linestyle="--")
        ax.annotate(txt, (mx, max(ys)), color=CALIDO_HEX, fontsize=8,
                    fontfamily=MONO, xytext=(4, -10),
                    textcoords="offset points")
    ax.set_title(f"{titulo}   [{unidad}]", color=TINTA_HEX, fontsize=10,
                 fontfamily=MONO, loc="left", pad=8)
    return _a_rgba(fig, np, plt)


def panel_fuerzas_g(lateral, longitudinal, tam=(260, 260), titulo="G FORCE"):
    """Diagrama de fricción: G lateral contra G longitudinal.

    Es el gráfico que enseña cuánto del agarre disponible está usando el
    coche en cada instante — la 'bola de G' de cualquier telemetría.
    """
    cv2, np, plt = _exigir()
    fig, dpi = _figura(tam[0], tam[1], plt)
    ax = fig.add_axes([0.16, 0.14, 0.78, 0.74])
    _estilo_eje(ax, plt)
    tope = max(3.0, max([abs(v) for v in list(lateral) + list(longitudinal)]
                        or [3.0]) * 1.15)
    for r in (1, 2, 3, 4, 5):
        if r <= tope:
            ax.add_patch(plt.Circle((0, 0), r, fill=False, color=TENUE_HEX,
                                    alpha=0.35, linewidth=0.7))
    ax.scatter(lateral, longitudinal, s=6, c=FRIO_HEX, alpha=0.55,
               edgecolors="none")
    if lateral and longitudinal:
        ax.scatter([lateral[-1]], [longitudinal[-1]], s=52, c=ACENTO_HEX,
                   zorder=5)
    ax.set_xlim(-tope, tope)
    ax.set_ylim(-tope, tope)
    ax.set_aspect("equal")
    ax.set_title(titulo, color=TINTA_HEX, fontsize=10, fontfamily=MONO,
                 loc="left", pad=8)
    return _a_rgba(fig, np, plt)


def panel_presion(campo, tam=(420, 300), titulo="PRESSURE",
                  extension=None, contornos=True):
    """Mapa de presión. `campo` = matriz 2D de coeficientes.

    Se puede generar desde un modelo con `presion_de_modelo()`, que sí
    calcula el Cp de verdad con Bernoulli.
    """
    cv2, np, plt = _exigir()
    fig, dpi = _figura(tam[0], tam[1], plt)
    ax = fig.add_axes([0.08, 0.10, 0.84, 0.78])
    _estilo_eje(ax, plt)
    m = np.asarray(campo, dtype=float)
    im = ax.imshow(m, origin="lower", cmap="RdYlBu_r", aspect="auto",
                   extent=extension, alpha=0.92)
    if contornos:
        ax.contour(m, levels=9, colors=TINTA_HEX, linewidths=0.4, alpha=0.35,
                   extent=extension, origin="lower")
    cb = fig.colorbar(im, ax=ax, fraction=0.045, pad=0.02)
    cb.outline.set_edgecolor(TENUE_HEX)
    cb.ax.tick_params(colors=TENUE_HEX, labelsize=7)
    for et in cb.ax.get_yticklabels():
        et.set_fontfamily(MONO)
    ax.set_title(f"{titulo}   [Cp]", color=TINTA_HEX, fontsize=10,
                 fontfamily=MONO, loc="left", pad=8)
    return _a_rgba(fig, np, plt)


def presion_de_modelo(modelo, caja, n=(160, 110)):
    """Cp = 1 − (V/U)², que es Bernoulli. Devuelve la matriz y su extensión.

    El coeficiente de presión NO se inventa: sale de la velocidad que ya
    resuelve el modelo. Donde el aire va más rápido que la corriente
    libre, Cp es negativo — succión. Eso es la carga aerodinámica.
    """
    _cv2, np, _plt = _exigir()
    xmin, xmax, ymin, ymax = caja
    nx, ny = n
    U = getattr(modelo, "U", 1.0) or 1.0
    m = np.zeros((ny, nx))
    for j in range(ny):
        y = ymin + (ymax - ymin) * j / (ny - 1)
        for i in range(nx):
            x = xmin + (xmax - xmin) * i / (nx - 1)
            if modelo.dentro(x, y):
                m[j, i] = np.nan
                continue
            u, v = modelo.velocidad(x, y)
            m[j, i] = 1.0 - (u * u + v * v) / (U * U)
    return m, (xmin, xmax, ymin, ymax)


# ── 3. Composición y exportación ──────────────────────────────────────

def componer(base, capas):
    """Compone capas BGRA sobre un fotograma BGR. Devuelve BGR.

    `capas` = [(imagen_bgra, (x, y))]. La mezcla es alfa normal, hecha a
    mano con numpy: `cv2.addWeighted` mezcla la imagen ENTERA por igual y
    aquí cada píxel tiene su propia transparencia.
    """
    _cv2, np, _plt = _exigir()
    fondo = base.copy()
    for capa, (x, y) in capas:
        if capa is None:
            continue
        h, w = capa.shape[:2]
        H, W = fondo.shape[:2]
        # Recorte si la capa se sale del fotograma
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(W, x + w), min(H, y + h)
        if x0 >= x1 or y0 >= y1:
            continue
        sub = capa[y0 - y:y1 - y, x0 - x:x1 - x]
        alfa = sub[:, :, 3:4].astype(float) / 255.0
        destino = fondo[y0:y1, x0:x1].astype(float)
        fondo[y0:y1, x0:x1] = (sub[:, :, :3] * alfa
                               + destino * (1 - alfa)).astype(np.uint8)
    return fondo


def reticula(tam, paso=90, opacidad=0.16, esquinas=True):
    """Retícula técnica y marcas de encuadre. Capa BGRA."""
    cv2, np, _plt = _exigir()
    w, h = tam
    capa = np.zeros((h, w, 4), dtype=np.uint8)
    b, g, r = _hex_a_bgr(TENUE_HEX)
    a = int(255 * opacidad)
    for x in range(0, w, paso):
        cv2.line(capa, (x, 0), (x, h), (b, g, r, a), 1)
    for y in range(0, h, paso):
        cv2.line(capa, (0, y), (w, y), (b, g, r, a), 1)
    if esquinas:
        br, bg, bb = _hex_a_bgr(ACENTO_HEX)
        L, m = int(min(tam) * 0.05), int(min(tam) * 0.03)
        for (px, py, dx, dy) in ((m, m, 1, 1), (w - m, m, -1, 1),
                                 (m, h - m, 1, -1), (w - m, h - m, -1, -1)):
            cv2.line(capa, (px, py), (px + dx * L, py), (br, bg, bb, 220), 2)
            cv2.line(capa, (px, py), (px, py + dy * L), (br, bg, bb, 220), 2)
    return capa


def plan_paneles(tam, cuales, margen=28, hueco=18):
    """Dónde va cada panel. Devuelve [(clave, (x, y), (w, h))].

    Se calcula aparte de dibujar, y a propósito: así se puede comprobar
    que nada se sale ni se pisa SIN tener OpenCV instalado — que es
    justo el fallo que más veces se cuela en un overlay.
    """
    w, h = tam
    tamanos = {"velocidad": (int(w * 0.42), int(h * 0.20)),
               "g": (int(h * 0.30), int(h * 0.30)),
               "presion": (int(w * 0.30), int(h * 0.26))}
    plan = []
    y = margen
    # Columna derecha, de arriba abajo
    for clave in cuales:
        if clave not in tamanos:
            continue
        pw, ph = tamanos[clave]
        plan.append((clave, (w - margen - pw, y), (pw, ph)))
        y += ph + hueco
    return plan


def solapan(plan, tam):
    """¿Se pisa algún panel con otro, o se sale del cuadro?

    Devuelve la lista de problemas. Vacía es que el plan está bien.
    """
    w, h = tam
    problemas = []
    cajas = []
    for clave, (x, y), (pw, ph) in plan:
        if x < 0 or y < 0 or x + pw > w or y + ph > h:
            problemas.append(f"{clave} se sale del fotograma")
        for otra, (ox, oy), (ow, oh) in cajas:
            if not (x + pw <= ox or ox + ow <= x
                    or y + ph <= oy or oy + oh <= y):
                problemas.append(f"{clave} se pisa con {otra}")
        cajas.append((clave, (x, y), (pw, ph)))
    return problemas


def procesar_fotograma(base, modelo=None, ala=None, telemetria=None,
                       con_reticula=True, caja=None):
    """Un fotograma con todo encima. `base` es BGR; devuelve BGR.

    `telemetria` = {"velocidad": [...], "g": ([lat], [lon]),
                    "presion": matriz}
    """
    _cv2, np, _plt = _exigir()
    h, w = base.shape[:2]
    capas = []
    if con_reticula:
        capas.append((reticula((w, h)), (0, 0)))
    if modelo is not None or ala is not None:
        capas.append((capa_flujo((w, h), modelo=modelo, ala=ala, caja=caja),
                      (0, 0)))
    tel = telemetria or {}
    plan = plan_paneles((w, h), [k for k in ("velocidad", "g", "presion")
                                 if k in tel])
    for clave, (x, y), (pw, ph) in plan:
        if clave == "velocidad":
            capas.append((panel_velocidad(tel["velocidad"], (pw, ph)), (x, y)))
        elif clave == "g":
            lat, lon = tel["g"]
            capas.append((panel_fuerzas_g(lat, lon, (pw, ph)), (x, y)))
        elif clave == "presion":
            capas.append((panel_presion(tel["presion"], (pw, ph)), (x, y)))
    return componer(base, capas)


def exportar_fotogramas(entrada, carpeta, cada=1, maximo=0, **kw):
    """Procesa un video y deja PNG numerados para montar en cualquier editor.

    Devuelve la lista de rutas. `cada`=5 procesa uno de cada cinco.
    """
    cv2, _np, _plt = _exigir()
    with contextlib.suppress(Exception):
        os.makedirs(carpeta, exist_ok=True)
    cap = cv2.VideoCapture(entrada)
    if not cap.isOpened():
        log.warning("No pude abrir %s", entrada)
        return []
    rutas, i, n = [], 0, 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            if i % max(1, cada) == 0:
                salida = os.path.join(carpeta, f"f{n:05d}.png")
                cv2.imwrite(salida, procesar_fotograma(frame, **kw))
                rutas.append(salida)
                n += 1
                if maximo and n >= maximo:
                    break
            i += 1
    finally:
        cap.release()
    log.info("🎞️  %d fotogramas exportados a %s", len(rutas), carpeta)
    return rutas


def procesar_video(entrada, salida, **kw):
    """Video entero con la capa encima. Devuelve la ruta o None.

    Sale en MP4 (mp4v). El audio NO se copia: OpenCV no lo toca. Si hace
    falta, se recupera después con el ffmpeg que ya usa el proyecto:
        ffmpeg -i salida.mp4 -i entrada.mp4 -c copy -map 0:v -map 1:a final.mp4
    """
    cv2, _np, _plt = _exigir()
    cap = cv2.VideoCapture(entrada)
    if not cap.isOpened():
        log.warning("No pude abrir %s", entrada)
        return None
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    vid = cv2.VideoWriter(salida, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    n = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            vid.write(procesar_fotograma(frame, **kw))
            n += 1
    finally:
        cap.release()
        vid.release()
    if not n:
        return None
    log.info("🎬 %d fotogramas procesados → %s (sin audio)", n, salida)
    return salida


def procesar_imagen(entrada, salida, **kw):
    """Una imagen suelta con la capa encima."""
    cv2, _np, _plt = _exigir()
    base = cv2.imread(entrada)
    if base is None:
        log.warning("No pude leer %s", entrada)
        return None
    cv2.imwrite(salida, procesar_fotograma(base, **kw))
    return salida


def lienzo_negro(tam):
    """Un fondo liso, para probar la capa sin necesitar metraje."""
    _cv2, np, _plt = _exigir()
    b, g, r = _hex_a_bgr(FONDO_HEX)
    w, h = tam
    fondo = np.zeros((h, w, 3), dtype=np.uint8)
    fondo[:, :] = (b, g, r)
    return fondo


if __name__ == "__main__":                      # pragma: no cover
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    est = disponible()
    if not est["ok"]:
        print("Falta:", ", ".join(est["faltan"]))
        print(est["instalar"])
        raise SystemExit(1)
    import cv2
    import flujo_calculado as F
    os.makedirs("capa", exist_ok=True)
    modelo = F.Perfil(alfa=9, invertido=True)
    caja = (-2.4, 3.2, -1.5, 1.5)
    presion, ext = presion_de_modelo(modelo, caja, n=(120, 84))
    # Telemetría de ejemplo con la FORMA de una frenada real
    vel = [320 - 190 * max(0.0, min(1.0, (i - 40) / 22.0))
           + 150 * max(0.0, min(1.0, (i - 70) / 40.0)) for i in range(120)]
    lat = [2.8 * math.sin(i / 14.0) for i in range(120)]
    lon = [-4.2 if 40 < i < 62 else 1.6 for i in range(120)]
    salida = procesar_fotograma(
        lienzo_negro((1920, 1080)), modelo=modelo, caja=caja,
        telemetria={"velocidad": vel, "g": (lat, lon), "presion": presion})
    cv2.imwrite("capa/demo.png", salida)
    print("capa/demo.png")

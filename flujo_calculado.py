"""flujo_calculado.py — Campos de flujo CALCULADOS, no dibujados a mano.

La diferencia con `diagramas.flujo`
───────────────────────────────────
Las plantillas de `diagramas.py` dibujan flechas donde el guionista dice
que van. Sirven para explicar una idea, y están bien para eso. Pero son
un dibujo: si alguien cambia el ángulo del perfil, las flechas no se
enteran.

Aquí no se dibuja el flujo: se RESUELVE. Cada línea de corriente de estas
imágenes sale de integrar un campo de velocidades que se calcula punto a
punto con la solución analítica del problema. Cambia el ángulo de ataque
y las líneas se mueven solas, porque es física, no ilustración.

Qué NO es esto, y por qué importa decirlo
─────────────────────────────────────────
NO es CFD. Un CFD de verdad resuelve Navier-Stokes con una malla, tarda
horas y reproduce viscosidad, turbulencia y desprendimiento. Esto es
FLUJO POTENCIAL: la solución exacta de un modelo idealizado —fluido sin
viscosidad ni rotación—, que se resuelve en milisegundos y con lápiz y
papel se resolvía ya en 1900.

Ese modelo acierta de lleno en unas cosas y no puede acertar en otras:

  Sí explica  ·  por dónde va el aire, dónde acelera y dónde frena,
                 el punto de estancamiento, por qué un perfil con
                 ángulo genera carga, el vórtice y la estela alterna.
  No explica  ·  la capa límite, la entrada en pérdida ni el arrastre
                 de fricción. En flujo potencial un cuerpo no tiene
                 resistencia (la paradoja de d'Alembert) — y eso es
                 falso en la vida real.

Por eso cada imagen sale con su pie diciendo qué modelo es. Publicar
esto como "simulación CFD" sería exactamente lo que el canal no hace:
enseñar un número o una imagen que aparenta más de lo que sabe.

Sin dependencias: `cmath` y Pillow. Ni numpy ni matplotlib, para que no
dependa de que Replit tenga instalado lo pesado.
"""

import cmath
import contextlib
import logging
import math
import os

log = logging.getLogger("flujo")

# La paleta del canal, la misma de diagramas.py
FONDO = "#0A0C11"
TINTA = "#F2F4F8"
APAGADO = "#8892A3"
TENUE = "#5A6473"
ACENTO = "#FF2D16"
CUERPO = "#1C2430"

#: Escala de velocidad: azul donde el aire va lento, rojo donde va rápido.
#: Es el código de color que usa TODO el mundo en aerodinámica, así que
#: no hay que explicarlo en pantalla.
ESCALA = [(0.00, (32, 68, 160)), (0.35, (0, 170, 200)),
          (0.62, (235, 205, 60)), (0.85, (240, 110, 30)),
          (1.00, (225, 40, 25))]


def _color(t):
    """Color de la escala para t en 0..1."""
    t = max(0.0, min(1.0, t))
    for i in range(len(ESCALA) - 1):
        t0, c0 = ESCALA[i]
        t1, c1 = ESCALA[i + 1]
        if t <= t1:
            k = (t - t0) / ((t1 - t0) or 1)
            return tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
    return ESCALA[-1][1]


# ── Los modelos ───────────────────────────────────────────────────────
# Cada uno devuelve una función velocidad(x, y) -> (u, v) y, si tiene
# cuerpo sólido, el contorno para dibujarlo y una prueba de "estoy
# dentro" para no integrar líneas por dentro del coche.

class Cilindro:
    """Flujo alrededor de un cilindro, con o sin circulación.

    Es el caso de manual: un cuerpo romo, como la rueda de un F1 vista
    desde arriba. Con circulación aparece asimetría y sustentación — el
    efecto Magnus, que es el mismo mecanismo por el que un balón con
    efecto se curva.
    """

    def __init__(self, U=1.0, R=1.0, circulacion=0.0):
        self.U, self.R, self.G = U, R, circulacion
        self.nombre = "Cylinder"

    def velocidad(self, x, y):
        r2 = x * x + y * y
        if r2 < 1e-9:
            return 0.0, 0.0
        a2 = self.R * self.R
        # Uniforme + doblete (la solución exacta) + vórtice
        u = self.U * (1 - a2 * (x * x - y * y) / (r2 * r2))
        v = -self.U * a2 * (2 * x * y) / (r2 * r2)
        if self.G:
            k = self.G / (2 * math.pi * r2)
            u += k * y
            v -= k * x
        return u, v

    def dentro(self, x, y):
        return x * x + y * y < self.R * self.R * 1.001

    def contorno(self, n=180):
        return [(self.R * math.cos(2 * math.pi * i / n),
                 self.R * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]


class Perfil:
    """Perfil de Joukowski a un ángulo de ataque.

    Un círculo en el plano ζ se transforma en un perfil de ala con
    z = ζ + b²/ζ. La gracia es que la solución alrededor del círculo se
    conoce exacta, así que al transformarla se obtiene la solución exacta
    alrededor del ala — incluidos el punto de estancamiento delantero y
    la condición de Kutta en el borde de salida, que es la que fija
    cuánta circulación (y por tanto cuánta carga) genera el perfil.

    `alfa` en grados. En un F1 el ala va del revés, así que la carga
    apunta hacia abajo; aquí se resuelve igual y se dice en el pie.
    """

    def __init__(self, U=1.0, alfa=6.0, espesor=0.10, curvatura=0.06,
                 invertido=False):
        # Un ala de F1 va montada del revés: misma física, todo espejado.
        # Se resuelve invirtiendo el signo del ángulo y de la curvatura,
        # y entonces la zona rápida —la de baja presión— queda ABAJO, que
        # es lo que empuja el coche contra el suelo.
        if invertido:
            alfa, curvatura = -alfa, -curvatura
        self.invertido = invertido
        self.U = U
        self.alfa = math.radians(alfa)
        self.grados = alfa
        self.b = 1.0
        # El centro del círculo decide grosor y curvatura del perfil
        self.mu = complex(-espesor, curvatura)
        self.R = abs(self.b - self.mu)
        # Condición de Kutta: la circulación que deja el borde de salida
        # limpio. No es un parámetro que se elija, sale del problema.
        beta = math.asin(max(-1.0, min(1.0, self.mu.imag / self.R)))
        self.G = 4 * math.pi * self.U * self.R * math.sin(self.alfa + beta)
        self.nombre = "Joukowski aerofoil"

    def _zeta(self, z):
        """Deshace la transformación: del plano del ala al del círculo."""
        raiz = cmath.sqrt(z * z - 4 * self.b * self.b)
        z1 = (z + raiz) / 2
        z2 = (z - raiz) / 2
        # De las dos ramas, la de fuera del círculo es la buena
        return z1 if abs(z1 - self.mu) >= abs(z2 - self.mu) else z2

    def velocidad(self, x, y):
        z = complex(x, y)
        try:
            zeta = self._zeta(z)
            d = zeta - self.mu
            if abs(d) < self.R * 0.999:
                return 0.0, 0.0
            e = cmath.exp(-1j * self.alfa)
            # dw/dζ del círculo con circulación
            dwdz = (self.U * e - self.U * self.R ** 2 * cmath.exp(1j * self.alfa)
                    / (d * d) + 1j * self.G / (2 * math.pi * d))
            dzdzeta = 1 - (self.b ** 2) / (zeta * zeta)
            if abs(dzdzeta) < 1e-6:      # el borde de salida es singular
                return 0.0, 0.0
            w = dwdz / dzdzeta
            return w.real, -w.imag       # conjugada: dw/dz = u - iv
        except (ValueError, ZeroDivisionError, OverflowError):
            return 0.0, 0.0

    def contorno(self, n=240):
        pts = []
        for i in range(n + 1):
            th = 2 * math.pi * i / n
            zeta = self.mu + self.R * cmath.exp(1j * th)
            z = zeta + self.b ** 2 / zeta
            pts.append((z.real, z.imag))
        return pts

    def dentro(self, x, y):
        z = complex(x, y)
        with contextlib.suppress(Exception):
            return abs(self._zeta(z) - self.mu) < self.R * 0.999
        return False


class CalleKarman:
    """La calle de vórtices de von Kármán detrás de un cuerpo romo.

    Dos filas de vórtices alternos que se van soltando por detrás del
    obstáculo y viajan aguas abajo. Es lo que deja una rueda de F1 —y
    cualquier cuerpo romo— en su estela, y la razón de que el aire de
    detrás de un coche sea "sucio": no está quieto, está girando y
    cambiando de sentido varias veces por segundo.

    Cada vórtice es un vórtice puntual: induce velocidad tangencial que
    cae con la distancia. El campo total es la suma de todos más la
    corriente incidente. `t` desplaza la calle: animando t se ve cómo se
    desprenden y viajan.
    """

    def __init__(self, U=1.0, R=0.32, n=9, paso=1.05, alto=0.55,
                 fuerza=1.5, t=0.0):
        self.U, self.R = U, R
        self.nombre = "von Karman vortex street"
        # El núcleo evita la singularidad del centro del vórtice: sin
        # esto la velocidad se dispara a infinito y la línea de corriente
        # sale despedida.
        self.nucleo = 0.16
        self.vortices = []
        deriva = (t * U * 0.55) % paso
        for i in range(n):
            x = R * 1.6 + i * paso + deriva
            arriba = (i % 2 == 0)
            self.vortices.append(
                (x, alto / 2 if arriba else -alto / 2,
                 -fuerza if arriba else fuerza))

    def velocidad(self, x, y):
        u, v = self.U, 0.0
        for (vx, vy, g) in self.vortices:
            dx, dy = x - vx, y - vy
            r2 = dx * dx + dy * dy + self.nucleo * self.nucleo
            k = g / (2 * math.pi * r2)
            u -= k * dy
            v += k * dx
        return u, v

    def dentro(self, x, y):
        return x * x + y * y < self.R * self.R

    def contorno(self, n=120):
        return [(self.R * math.cos(2 * math.pi * i / n),
                 self.R * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]


# ── Integración de líneas de corriente ────────────────────────────────

def _linea(modelo, x0, y0, caja, paso=0.035, maxpasos=1400, atras=True):
    """Sigue una línea de corriente desde (x0, y0), hacia delante y hacia
    atrás. Runge-Kutta de orden 2: con Euler las líneas se abren en las
    zonas de curvatura fuerte, que son justo las interesantes."""
    xmin, xmax, ymin, ymax = caja
    salida = []
    for signo in ((-1, 1) if atras else (1,)):
        x, y = x0, y0
        trozo = []
        for _ in range(maxpasos):
            u, v = modelo.velocidad(x, y)
            m = math.hypot(u, v)
            if m < 1e-6:
                break
            # Paso por longitud de arco: así la densidad de puntos no
            # depende de lo rápido que vaya el aire ahí.
            hx, hy = signo * paso * u / m, signo * paso * v / m
            ux, uy = modelo.velocidad(x + hx / 2, y + hy / 2)
            m2 = math.hypot(ux, uy)
            if m2 > 1e-9:
                hx, hy = signo * paso * ux / m2, signo * paso * uy / m2
            x, y = x + hx, y + hy
            if not (xmin <= x <= xmax and ymin <= y <= ymax):
                break
            if modelo.dentro(x, y):
                break
            trozo.append((x, y, m))
        if signo < 0:
            salida = list(reversed(trozo)) + [(x0, y0,
                                               math.hypot(*modelo.velocidad(x0, y0)))]
        else:
            salida += trozo
    return salida


def campo(modelo, caja, n_lineas=26, sembrado=None):
    """Las líneas de corriente del modelo dentro de la caja."""
    xmin, xmax, ymin, ymax = caja
    if sembrado is None:
        # Se siembra por la izquierda, que es por donde entra el aire.
        # No a intervalos iguales: MÁS JUNTO cerca del eje, que es donde
        # pasa todo, y más suelto arriba y abajo, donde el aire va recto
        # y veinte líneas paralelas solo parecen las rayas de un televisor
        # estropeado.
        sembrado = []
        for i in range(n_lineas):
            f = (i + 0.5) / n_lineas * 2 - 1          # -1 .. 1
            # La curva concentra puntos cerca de 0 sin dejar huecos fuera
            g = math.copysign(abs(f) ** 1.6, f)
            y = (ymin + ymax) / 2 + (ymax - ymin) / 2 * g
            sembrado.append((xmin + (xmax - xmin) * 0.01, y))
    lineas = []
    for (sx, sy) in sembrado:
        if modelo.dentro(sx, sy):
            continue
        ln = _linea(modelo, sx, sy, caja)
        if len(ln) > 8:
            lineas.append(ln)
    return lineas


# ── Dibujo ────────────────────────────────────────────────────────────

def _marco(tam, titulo, etiqueta, pie):
    """Lienzo con la cabecera del canal (misma que los demás gráficos)."""
    from PIL import Image, ImageDraw
    import diagramas as D
    w, h = tam
    img = Image.new("RGB", (w, h), FONDO)
    dib = ImageDraw.Draw(img)
    m = int(w * 0.06)
    y = int(h * 0.06)
    if etiqueta:
        f_et = D._fuente(int(min(tam) * 0.026), True)
        dib.rectangle([m, y + int(min(tam) * .012), m + int(min(tam) * .038),
                       y + int(min(tam) * .017)], fill=ACENTO)
        D._texto(dib, (m + int(min(tam) * .055), y), etiqueta.upper(), f_et,
                 ACENTO, esp=int(min(tam) * .006))
        y += int(min(tam) * 0.050)
    if titulo:
        f_t = D._fuente(int(min(tam) * 0.050), True)
        for ln in D._partir(dib, titulo, f_t, w - 2 * m)[:2]:
            dib.text((m, y), ln, font=f_t, fill=TINTA)
            y += int(min(tam) * 0.062)
    # Debajo del dibujo van DOS cosas: la barra de color y el pie. Con el
    # hueco de una sola se pisaban.
    alto_pie = int(min(tam) * (0.115 if pie else 0.05))
    return img, dib, y + int(min(tam) * 0.02), h - alto_pie, m


def dibujar(modelo, salida, titulo, caja=None, tam=(1280, 720),
            n_lineas=26, etiqueta="Computed", pie=None, notas=(),
            marcar_estancamiento=False):
    """Dibuja el campo de un modelo. Devuelve la ruta o None.

    `notas` = [(x, y, "texto")] en coordenadas del MODELO, para señalar
    sitios concretos del flujo.
    """
    from PIL import ImageDraw
    import diagramas as D
    caja = caja or (-2.6, 4.2, -1.9, 1.9)
    if pie is None:
        pie = ("Potential-flow solution, computed by us — an exact answer "
               "to an idealised model, not a CFD simulation.")
    img, dib, y0, y1, m = _marco(tam, titulo, etiqueta, pie)
    w, h = img.size
    xmin, xmax, ymin, ymax = caja
    cw, ch = w - 2 * m, y1 - y0
    esc = min(cw / (xmax - xmin), ch / (ymax - ymin))
    ox = m + (cw - (xmax - xmin) * esc) / 2 - xmin * esc
    oy = y0 + (ch - (ymax - ymin) * esc) / 2 + ymax * esc

    def px(x, y):
        return (ox + x * esc, oy - y * esc)

    lineas = campo(modelo, caja, n_lineas)
    # La escala de color se normaliza con lo que hay en ESTE campo: así
    # el rojo siempre significa "lo más rápido que se ve aquí".
    vels = sorted(v for ln in lineas for (_x, _y, v) in ln)
    if not vels:
        return None
    # Percentiles y no mínimo/máximo: junto al núcleo de un vórtice la
    # velocidad se dispara, y con el máximo crudo ese único punto
    # aplastaba toda la escala — el campo entero salía del mismo color.
    vmin = vels[int(len(vels) * 0.04)]
    vmax = vels[int(len(vels) * 0.96)]
    rango = (vmax - vmin) or 1.0

    grosor = max(1, int(min(tam) * 0.0022))
    for ln in lineas:
        for i in range(1, len(ln)):
            x1, y1_, v1 = ln[i - 1]
            x2, y2_, v2 = ln[i]
            c = _color(((v1 + v2) / 2 - vmin) / rango)
            dib.line([px(x1, y1_), px(x2, y2_)], fill=c, width=grosor)

    # El cuerpo, encima de las líneas
    if hasattr(modelo, "contorno"):
        cont = [px(x, y) for x, y in modelo.contorno()]
        dib.polygon(cont, fill=CUERPO, outline=APAGADO)

    # Los vórtices de la calle, marcados con su sentido de giro
    for (vx, vy, g) in getattr(modelo, "vortices", []):
        if not (xmin <= vx <= xmax):
            continue
        cx, cy = px(vx, vy)
        r = max(3, int(min(tam) * 0.008))
        col = "#42E8FF" if g > 0 else "#FFB020"
        dib.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=2)

    # El punto de estancamiento delantero: velocidad cero contra el morro
    if marcar_estancamiento:
        p = _estancamiento(modelo, caja)
        if p:
            cx, cy = px(*p)
            r = max(4, int(min(tam) * 0.009))
            dib.ellipse([cx - r, cy - r, cx + r, cy + r], fill=TINTA)
            f_n = D._fuente(int(min(tam) * 0.024), True)
            dib.text((cx + r + 6, cy - r - 2), "Stagnation point", font=f_n,
                     fill=TINTA)

    f_n = D._fuente(int(min(tam) * 0.024), True)
    for (nx, ny, texto) in notas:
        cx, cy = px(nx, ny)
        dib.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=TINTA)
        dib.text((cx + 9, cy - 9), texto, font=f_n, fill=TINTA)

    _leyenda(dib, D, tam, m, y1, vmin, vmax)
    if pie:
        f_p = D._fuente(int(min(tam) * 0.023), False)
        # El pie arranca por debajo de la barra de color y ocupa el ancho
        # que le queda libre a su izquierda, para no meterse debajo.
        yy = y1 + int(min(tam) * 0.055)
        ancho = w - 2 * m - int(w * 0.22)
        for ln in D._partir(dib, pie, f_p, ancho)[:2]:
            dib.text((m, yy), ln, font=f_p, fill=APAGADO)
            yy += int(min(tam) * 0.029)
    return _guardar(img, salida)


def _leyenda(dib, D, tam, m, y1, vmin, vmax):
    """La barra de color, con lo que significan sus extremos."""
    w = tam[0]
    ancho, alto = int(w * 0.20), max(6, int(min(tam) * 0.011))
    x0 = w - m - ancho
    y = y1 + int(min(tam) * 0.012)
    for i in range(ancho):
        dib.line([(x0 + i, y), (x0 + i, y + alto)],
                 fill=_color(i / max(1, ancho - 1)))
    f = D._fuente(int(min(tam) * 0.021), True)
    dib.text((x0, y + alto + 4), "SLOWER", font=f, fill=TENUE)
    t = "FASTER"
    dib.text((x0 + ancho - dib.textlength(t, font=f), y + alto + 4), t,
             font=f, fill=TENUE)


def _estancamiento(modelo, caja):
    """El punto donde el aire se para contra el cuerpo.

    Se busca RECORRIENDO EL CONTORNO, no el eje. En un perfil con ángulo
    de ataque el estancamiento NO está en el morro: se desplaza hacia el
    intradós, y cuanto más ángulo, más abajo. Buscarlo sobre la línea
    central —que es lo que hacía esto antes— solo acierta con un cuerpo
    simétrico y sin inclinar, o sea casi nunca.
    """
    if not hasattr(modelo, "contorno"):
        return None
    xmin, xmax, ymin, ymax = caja
    candidatos = []
    for (bx, by) in modelo.contorno(360):
        if not (xmin <= bx <= xmax and ymin <= by <= ymax):
            continue
        # Un pelo por fuera del cuerpo: justo encima, la velocidad es
        # cero por definición del propio contorno.
        n = math.hypot(bx, by) or 1.0
        px_, py_ = bx * (1 + 0.03 / n), by * (1 + 0.03 / n)
        if modelo.dentro(px_, py_):
            continue
        m = math.hypot(*modelo.velocidad(px_, py_))
        # Solo cuenta si de verdad es un remanso: si lo más lento del
        # contorno va a media velocidad, ahí no hay estancamiento.
        if m < 0.30:
            candidatos.append((px_, py_, m))
    if not candidatos:
        return None
    # De todos, el de MÁS AGUAS ARRIBA. En flujo potencial hay dos puntos
    # de velocidad cero, delante y detrás, y el de detrás es mentira: en
    # aire real el flujo se desprende antes de llegar y lo que hay ahí es
    # la estela, no un remanso. Marcar ese sería enseñar como cierto algo
    # que solo existe dentro del modelo.
    return min(candidatos, key=lambda c: c[0])[:2]


def _guardar(img, salida):
    with contextlib.suppress(Exception):
        os.makedirs(os.path.dirname(os.path.abspath(salida)), exist_ok=True)
    try:
        img.save(salida, "PNG")
        return salida
    except Exception as e:
        log.info("No pude guardar el campo (%s)", e)
        return None


# ── Animación ─────────────────────────────────────────────────────────

def gif(salida, cuadros, ms=90):
    """Guarda una lista de PNG como GIF en bucle.

    GIF y no MP4 a propósito: lo escribe Pillow, que ya está, sin
    depender de ffmpeg. Y un GIF en bucle es lo que se puede pegar en un
    tuit o en la descripción sin que nadie tenga que darle al play.
    """
    if not cuadros:
        return None
    try:
        from PIL import Image
        ims = [Image.open(c).convert("P", palette=Image.ADAPTIVE)
               for c in cuadros]
        ims[0].save(salida, save_all=True, append_images=ims[1:],
                    duration=ms, loop=0, optimize=True)
        return salida
    except Exception as e:
        log.info("No pude escribir el GIF (%s)", e)
        return None


def gif_calle(salida, carpeta, n=16, tam=(900, 506), **kw):
    """La calle de von Kármán, desprendiéndose y viajando. Devuelve el GIF.

    Cada cuadro es el MISMO cálculo con la calle desplazada: no es un
    bucle falso, es el campo resuelto en n instantes distintos.
    """
    with contextlib.suppress(Exception):
        os.makedirs(carpeta, exist_ok=True)
    cuadros = []
    for i in range(n):
        t = i / n
        mod = CalleKarman(t=t, **kw)
        ruta = dibujar(
            mod, os.path.join(carpeta, f"k{i:02d}.png"),
            "Why the air behind a car is dirty",
            caja=(-1.4, 9.0, -2.0, 2.0), tam=tam, n_lineas=30,
            etiqueta="Computed",
            pie="Von Karman vortex street from point vortices, computed by "
                "us. A model of the wake, not a CFD simulation.")
        if ruta:
            cuadros.append(ruta)
    return gif(salida, cuadros)


# ── Los casos con nombre ──────────────────────────────────────────────
# Lo que el glosario de aerodinamica.py pide por "calculado:<caso>". Son
# los cuatro que de verdad se explican mejor con el campo resuelto que
# con un dibujo.

def _caso_ala(salida, tam):
    return dibujar(
        Perfil(alfa=9, invertido=True), salida,
        "How a wing pushes the car down", caja=(-2.4, 3.2, -1.5, 1.5),
        tam=tam, n_lineas=30, marcar_estancamiento=True,
        pie="Potential-flow solution around an inverted aerofoil, computed "
            "by us. An exact answer to an idealised model, not a CFD "
            "simulation.")


def _caso_angulo(salida, tam):
    return dibujar(
        Perfil(alfa=18, invertido=True), salida,
        "The same wing, asked for far more angle",
        caja=(-2.4, 3.2, -1.6, 1.6), tam=tam, n_lineas=30,
        pie="Same solution, twice the angle: more turning, more load. The "
            "model cannot show the stall that would end it — potential "
            "flow has no boundary layer to separate.")


def _caso_estancamiento(salida, tam):
    return dibujar(
        Cilindro(), salida, "Where the air stops dead",
        caja=(-2.4, 2.4, -1.5, 1.5), tam=tam, n_lineas=28,
        marcar_estancamiento=True,
        pie="Potential flow around a cylinder, computed by us — the "
            "textbook blunt body, and a rough stand-in for a wheel.")


def _caso_calle(salida, tam):
    return dibujar(
        CalleKarman(), salida, "Why the air behind a car is dirty",
        caja=(-1.4, 9.0, -1.7, 1.7), tam=tam, n_lineas=30,
        pie="Von Karman vortex street from point vortices, computed by us. "
            "A model of the wake, not a CFD simulation.")


CASOS = {"ala": _caso_ala, "angulo": _caso_angulo,
         "estancamiento": _caso_estancamiento, "calle": _caso_calle}


def figura(caso, salida, tam=(1280, 720)):
    """Dibuja un caso con nombre. Devuelve la ruta o None si no existe."""
    fn = CASOS.get((caso or "").strip().lower())
    if not fn:
        return None
    try:
        return fn(salida, tam)
    except Exception as e:
        log.info("El campo '%s' no se pudo calcular (%s)", caso, e)
        return None


if __name__ == "__main__":                      # pragma: no cover
    import sys
    logging.basicConfig(level=logging.INFO)
    destino = sys.argv[1] if len(sys.argv) > 1 else "flujo"
    os.makedirs(destino, exist_ok=True)
    print(dibujar(Perfil(alfa=8), f"{destino}/perfil_8.png",
                  "How a wing makes downforce",
                  caja=(-2.6, 3.4, -1.6, 1.6), marcar_estancamiento=True))
    print(dibujar(Perfil(alfa=16), f"{destino}/perfil_16.png",
                  "The same wing, twice the angle",
                  caja=(-2.6, 3.4, -1.6, 1.6)))
    print(dibujar(Cilindro(), f"{destino}/cilindro.png",
                  "Air meeting a blunt body", caja=(-2.4, 2.4, -1.6, 1.6),
                  marcar_estancamiento=True))
    print(gif_calle(f"{destino}/calle.gif", f"{destino}/calle"))

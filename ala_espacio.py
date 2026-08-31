"""ala_espacio.py — El ala vista desde arriba y en el espacio.

Por qué hace falta otra vista
─────────────────────────────
`flujo_calculado.py` resuelve el ala EN CORTE: un plano vertical que la
atraviesa. Esa vista explica de dónde sale la carga, pero es
bidimensional, y en 2D un ala es infinita — no tiene puntas. Y las
puntas son justo donde ocurre la mitad de lo interesante de un ala de
F1: el vórtice de la deriva, el Y250, el arrastre inducido.

Aquí se resuelve el ala COMO ALA: con envergadura, con puntas, y con lo
que pasa a lo largo de ella.

El modelo: línea sustentadora de Prandtl
────────────────────────────────────────
De 1918, y sigue siendo lo primero que se enseña en un curso de
aerodinámica de alas finitas. Se representa el ala por una línea de
circulación variable a lo largo de la envergadura, y esa variación
obliga a soltar vorticidad hacia atrás — una lámina de vórtices que se
enrolla en las puntas. De ahí salen, calculados y no dibujados:

  · el reparto de carga a lo largo de la envergadura,
  · el descenso de flujo (downwash) que ese reparto induce,
  · el ARRASTRE INDUCIDO, que existe solo porque el ala tiene puntas,
  · y por qué el reparto elíptico es el que menos arrastre paga.

Se resuelve un sistema lineal pequeño (método de Glauert) con
eliminación gaussiana escrita a mano: sin numpy, como todo lo demás.

Lo que este modelo NO sabe
──────────────────────────
Lo mismo que el de corte: no hay viscosidad, ni capa límite, ni
desprendimiento. Y además supone que el ala es esbelta y que la estela
sale recta hacia atrás sin enrollarse (en la vida real se enrolla
enseguida). Vale para entender el mecanismo; no para diseñar una pieza.

Sobre el 3D
───────────
Lo que se dibuja en el espacio son las LÍNEAS calculadas —la línea
sustentadora, la estela de vórtices, el flujo—, proyectadas en
isométrica. Es la estética de una visualización de humo en un túnel, no
un render sólido con luces: eso Pillow no lo hace bien, y ya lo probamos.
"""

import contextlib
import logging
import math
import os

log = logging.getLogger("ala")

FONDO = "#0A0C11"
TINTA = "#F2F4F8"
APAGADO = "#8892A3"
TENUE = "#5A6473"
ACENTO = "#FF2D16"
FRIO = "#2FC4E0"
CALIDO = "#FFB020"
VERDE = "#31D97A"


# ── Línea sustentadora ────────────────────────────────────────────────

def _resolver(a, b):
    """Elimina Gauss con pivoteo parcial. Devuelve x de a·x = b."""
    n = len(b)
    m = [fila[:] + [b[i]] for i, fila in enumerate(a)]
    for col in range(n):
        p = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[p][col]) < 1e-14:
            return [0.0] * n
        m[col], m[p] = m[p], m[col]
        for r in range(col + 1, n):
            f = m[r][col] / m[col][col]
            for c in range(col, n + 1):
                m[r][c] -= f * m[col][c]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        s = m[r][n] - sum(m[r][c] * x[c] for c in range(r + 1, n))
        x[r] = s / m[r][r]
    return x


class Ala:
    """Un ala finita resuelta por línea sustentadora.

    `b` envergadura, `cuerda(y)` la cuerda en cada punto (para poder
    hacerla rectangular, trapezoidal o elíptica), `alfa` en grados.
    """

    def __init__(self, b=2.0, cuerda=None, alfa=6.0, N=9, a0=2 * math.pi,
                 U=1.0):
        self.b, self.U, self.N = b, U, N
        self.grados = alfa
        self.alfa = math.radians(alfa)
        self.cuerda = cuerda or (lambda y: 0.45)
        self.a0 = a0
        # Colocación en θ, evitando 0 y π donde la ecuación es singular
        self.thetas = [math.pi * (i + 1) / (N + 1) for i in range(N)]
        self._resolver_A()

    def y_de(self, th):
        return -(self.b / 2) * math.cos(th)

    def _resolver_A(self):
        """Los coeficientes Aₙ de Γ(θ) = 2·b·U·Σ Aₙ sin(nθ)."""
        N = self.N
        A, B = [], []
        for th in self.thetas:
            y = self.y_de(th)
            c = max(1e-6, self.cuerda(y))
            mu = c * self.a0 / (4 * self.b)
            fila = []
            for j in range(N):
                n = j + 1
                fila.append(math.sin(n * th) * (n * mu + math.sin(th)))
            A.append(fila)
            B.append(mu * self.alfa * math.sin(th))
        self.A = _resolver(A, B)
        # Alargamiento con la superficie real del ala
        n_int = 200
        S = sum(self.cuerda(self.y_de(math.pi * (i + .5) / n_int))
                * (self.b / 2) * math.sin(math.pi * (i + .5) / n_int)
                * (math.pi / n_int) for i in range(n_int))
        self.S = S or (self.b * 0.45)
        self.AR = self.b * self.b / self.S

    def gamma(self, y):
        """Circulación en la estación y (la 'carga' local)."""
        f = max(-1.0, min(1.0, -2 * y / self.b))
        th = math.acos(f)
        return 2 * self.b * self.U * sum(
            a * math.sin((j + 1) * th) for j, a in enumerate(self.A))

    def downwash(self, y):
        """Velocidad inducida hacia abajo en la estación y."""
        f = max(-1.0, min(1.0, -2 * y / self.b))
        th = math.acos(f)
        s = math.sin(th)
        if abs(s) < 1e-6:
            return 0.0
        return self.U * sum((j + 1) * a * math.sin((j + 1) * th)
                            for j, a in enumerate(self.A)) / s

    @property
    def CL(self):
        return math.pi * self.AR * self.A[0]

    @property
    def CDi(self):
        """Arrastre inducido: el que existe SOLO porque el ala acaba."""
        return math.pi * self.AR * sum(
            (j + 1) * a * a for j, a in enumerate(self.A))

    @property
    def eficiencia(self):
        """e de Oswald: 1.0 es el reparto elíptico, el mejor posible."""
        d = sum((j + 1) * (a / self.A[0]) ** 2
                for j, a in enumerate(self.A) if self.A[0])
        return 1.0 / d if d else 1.0


# ── Proyección ────────────────────────────────────────────────────────

class Vista:
    """Proyección isométrica sencilla. `giro` y `alza` en grados.

    Con alza=90 se mira desde arriba (planta pura); con valores medios
    sale la isométrica de manual.
    """

    def __init__(self, giro=32.0, alza=24.0, escala=1.0):
        self.g = math.radians(giro)
        self.a = math.radians(alza)
        self.escala = escala

    def __call__(self, x, y, z):
        """(x hacia atrás, y envergadura, z arriba) → (u, v) en pantalla."""
        cg, sg = math.cos(self.g), math.sin(self.g)
        ca, sa = math.cos(self.a), math.sin(self.a)
        u = (x * cg - y * sg)
        v = (x * sg + y * cg) * sa - z * ca
        return u * self.escala, v * self.escala


# ── Dibujo ────────────────────────────────────────────────────────────

def _marco(tam, titulo, etiqueta, pie):
    from PIL import Image, ImageDraw
    import diagramas as D
    w, h = tam
    img = Image.new("RGB", (w, h), FONDO)
    dib = ImageDraw.Draw(img)
    m = int(w * 0.06)
    y = int(h * 0.06)
    corto = min(tam)
    if etiqueta:
        f = D._fuente(int(corto * 0.026), True)
        dib.rectangle([m, y + int(corto * .012), m + int(corto * .038),
                       y + int(corto * .017)], fill=ACENTO)
        D._texto(dib, (m + int(corto * .055), y), etiqueta.upper(), f, ACENTO,
                 esp=int(corto * .006))
        y += int(corto * 0.050)
    if titulo:
        f = D._fuente(int(corto * 0.050), True)
        for ln in D._partir(dib, titulo, f, w - 2 * m)[:2]:
            dib.text((m, y), ln, font=f, fill=TINTA)
            y += int(corto * 0.062)
    return img, dib, y + int(corto * 0.02), h - int(corto * (0.10 if pie
                                                             else 0.04)), m


def _pie(img, dib, pie, m, ancho_max=None):
    import diagramas as D
    if not pie:
        return
    w, h = img.size
    corto = min(img.size)
    f = D._fuente(int(corto * 0.023), False)
    y = h - int(corto * 0.075)
    for ln in D._partir(dib, pie, f, (ancho_max or w - 2 * m))[:2]:
        dib.text((m, y), ln, font=f, fill=APAGADO)
        y += int(corto * 0.029)


def planta(ala, salida, titulo="Looking down on the wing", tam=(1280, 720),
           etiqueta="Computed", pie=None, comparar_eliptica=True):
    """El ala desde arriba: reparto de carga y estela de vórtices.

    Esta es la vista donde se ve POR QUÉ un ala paga arrastre por tener
    puntas: la carga cae a cero en los extremos, y esa caída es
    exactamente la vorticidad que se va hacia atrás.
    """
    from PIL import ImageDraw
    import diagramas as D
    if pie is None:
        pie = (f"Prandtl lifting-line solution, computed by us. "
               f"AR {ala.AR:.1f} · span efficiency {ala.eficiencia:.2f}. "
               "An idealised model — no viscosity, no stall.")
    img, dib, y0, y1, m = _marco(tam, titulo, etiqueta, pie)
    w, h = img.size
    corto = min(tam)
    cw, ch = w - 2 * m, y1 - y0

    # El lienzo se parte en tres franjas, de arriba abajo: las cifras,
    # la planta con su estela, y el reparto de carga. Cada una con su
    # sitio reservado — antes se calculaban al vuelo y se pisaban.
    f_c = D._fuente(int(corto * 0.030), True)
    f_n = D._fuente(int(corto * 0.024), True)
    alto_cifras = int(corto * 0.055)
    alto_carga = ch * 0.34
    y_planta = y0 + alto_cifras
    alto_planta = ch - alto_cifras - alto_carga - int(corto * 0.055)

    esc = cw / (ala.b * 1.10)           # la envergadura manda el ancho
    cx = m + cw / 2
    cuerda_max = max(ala.cuerda(-ala.b / 2 + ala.b * i / 40)
                     for i in range(41))
    # El ala arriba de su franja; lo que queda por debajo es para la estela
    y_borde = y_planta + int(corto * 0.012)

    def px(y, x):                       # y = envergadura, x = cuerda
        return cx + y * esc, y_borde + x * esc

    ys_e = [-ala.b / 2 + ala.b * (i + 0.5) / 46 for i in range(46)]
    d = 0.002 * ala.b
    dg = [(ala.gamma(y + d) - ala.gamma(y - d)) / (2 * d) for y in ys_e]
    top = max(abs(v) for v in dg) or 1.0

    # 1) La estela sale del BORDE DE SALIDA, no del centro del ala: si
    #    arranca antes, el propio dibujo del ala la tapa.
    x_salida = cuerda_max * 0.75
    y_fin_estela = y_planta + alto_planta
    for y, g in zip(ys_e, dg):
        f = abs(g) / top
        if f < 0.05:
            continue
        col = FRIO if g > 0 else CALIDO
        x0, yy0 = px(y, x_salida)
        dib.line([(x0, yy0), (x0, y_fin_estela)], fill=col,
                 width=max(1, int(1 + 3 * f)))

    # 2) El ala vista desde arriba
    borde_a = [px(y, -ala.cuerda(y) * 0.25) for y in
               [-ala.b / 2 + ala.b * i / 80 for i in range(81)]]
    borde_b = [px(y, ala.cuerda(y) * 0.75) for y in
               [ala.b / 2 - ala.b * i / 80 for i in range(81)]]
    dib.polygon(borde_a + borde_b, fill="#1C2430", outline=APAGADO)

    # 3) Los rótulos van los dos en la MISMA línea de arriba, uno a cada
    #    lado. Puestos sobre el dibujo se cruzaban con la estela, que es
    #    justo lo que el rótulo intenta explicar.
    dib.text((m, y0), "TRAILING VORTICITY — thickest where the load "
             "changes fastest", font=D._fuente(int(corto * 0.021), False),
             fill=TENUE)
    D._texto(dib, (w - m, y0 - int(corto * .004)),
             f"CL {ala.CL:.2f}   ·   CDi {ala.CDi:.4f}"
             f"   ·   span efficiency {ala.eficiencia:.2f}", f_c, TINTA,
             derecha=True)

    # 4) El reparto de carga, abajo, a la misma escala de envergadura
    y_graf = y_planta + alto_planta + int(corto * 0.048)
    alto_g = alto_carga - int(corto * 0.048)
    gmax = max(ala.gamma(y) for y in ys_e) or 1.0
    pts = [(cx + y * esc, y_graf + alto_g - ala.gamma(y) / gmax * alto_g)
           for y in [-ala.b / 2 + ala.b * i / 120 for i in range(121)]]
    dib.line([(m, y_graf + alto_g), (w - m, y_graf + alto_g)],
             fill=TENUE, width=1)
    dib.polygon(pts + [(pts[-1][0], y_graf + alto_g),
                       (pts[0][0], y_graf + alto_g)], fill="#16202B")
    dib.line(pts, fill=ACENTO, width=max(2, int(corto * .004)), joint="curve")

    # La elíptica de referencia: el reparto que menos arrastre paga
    if comparar_eliptica:
        el = []
        for i in range(121):
            y = -ala.b / 2 + ala.b * i / 120
            f = max(0.0, 1 - (2 * y / ala.b) ** 2) ** 0.5
            el.append((cx + y * esc, y_graf + alto_g - f * alto_g))
        for i in range(0, len(el) - 1, 2):        # discontinua
            dib.line([el[i], el[i + 1]], fill=VERDE, width=2)

    dib.text((m, y_graf - int(corto * .036)), "LOAD ALONG THE SPAN",
             font=f_n, fill=TENUE)
    if comparar_eliptica:
        D._texto(dib, (w - m, y_graf - int(corto * .034)),
                 "— — elliptical: the least induced drag possible",
                 D._fuente(int(corto * .021), False), VERDE, derecha=True)
    _pie(img, dib, pie, m)
    return _guardar(img, salida)


def espacio(ala, salida, titulo="The wing in space", tam=(1280, 720),
            etiqueta="Computed", pie=None, vista=None, n_hilos=13):
    """El ala en isométrica, con su sistema de vórtices y el flujo.

    Se dibujan LÍNEAS calculadas proyectadas, no un sólido sombreado: la
    estética de una visualización de humo en un túnel. Un render sólido
    con luces no es lo que Pillow hace bien.
    """
    from PIL import ImageDraw
    import diagramas as D
    vista = vista or Vista(giro=28, alza=26)
    if pie is None:
        pie = ("Lifting-line solution projected in space, computed by us. "
               "The trailing sheet is drawn straight; in real air it rolls "
               "up into the tip vortices within a chord or two.")
    img, dib, y0, y1, m = _marco(tam, titulo, etiqueta, pie)
    w, h = img.size
    corto = min(tam)

    # Geometría en 3D: (x atrás, y envergadura, z arriba)
    #
    # La estela es CORTA a propósito. Con una estela larga, el ala queda
    # reducida a un palito en una esquina y lo que se ve es un abanico de
    # rayas: el dibujo pierde justo lo que tiene que enseñar, que es la
    # relación entre el ala y lo que suelta.
    estela = 1.15 * ala.b
    trazos = []          # (puntos3d, color, grosor, profundidad)
    caras = []           # superficies rellenas, se pintan primero

    # 1) EL ALA como superficie. Sin ella el dibujo no se lee como 3D:
    #    hace falta un plano al que referir todo lo demás.
    ny = 40
    for i in range(ny):
        y1_ = -ala.b / 2 + ala.b * i / ny
        y2_ = -ala.b / 2 + ala.b * (i + 1) / ny
        c1, c2 = ala.cuerda(y1_), ala.cuerda(y2_)
        caras.append(([(-0.25 * c1, y1_, 0.0), (0.75 * c1, y1_, 0.0),
                       (0.75 * c2, y2_, 0.0), (-0.25 * c2, y2_, 0.0)],
                      "#20293A", y1_))
    # El borde de ataque marcado: es el vórtice ligado, el ala en persona
    trazos.append(([(-0.25 * ala.cuerda(-ala.b / 2 + ala.b * i / 60),
                     -ala.b / 2 + ala.b * i / 60, 0.0) for i in range(61)],
                   ACENTO, 5, -0.02))

    # 2) La lámina de vórtices, bajando con el downwash de cada estación
    d = 0.002 * ala.b
    def _dg(y):
        return (ala.gamma(y + d) - ala.gamma(y - d)) / (2 * d)
    tope = max(abs(_dg(-ala.b / 2 + ala.b * (k + .5) / n_hilos))
               for k in range(n_hilos)) or 1.0
    for i in range(n_hilos):
        y = -ala.b / 2 + ala.b * (i + 0.5) / n_hilos
        f = min(1.0, abs(_dg(y)) / tope)
        if f < 0.05:
            continue
        wd = ala.downwash(y) / max(1e-6, ala.U)
        pts = []
        for k in range(31):
            x = 0.75 * ala.cuerda(y) + estela * k / 30
            pts.append((x, y, -wd * (x ** 1.15) * 0.42))
        trazos.append((pts, FRIO, max(1, int(1 + 2.5 * f)), y))

    # 3) Las puntas, enrollándose. Radio grande y pocas vueltas: es lo
    #    que hay que VER, no una espiral de relojería.
    for signo in (-1, 1):
        y_p = signo * ala.b / 2
        # TRES hélices con la misma alma, desfasadas. Una sola línea, por
        # muchas vueltas que dé, en proyección se lee como una onda: el
        # ojo no tiene con qué compararla para ver que gira. Tres juntas
        # se leen como un tubo enroscado, que es lo que es.
        for fase in (0.0, 2 * math.pi / 3, 4 * math.pi / 3):
            pts = []
            n = 170
            for k in range(n):
                t = k / (n - 1)
                x = 0.75 * ala.cuerda(y_p) + estela * t
                ang = fase + 3.4 * math.pi * t ** 0.9
                r = 0.075 * ala.b * (1 - math.exp(-6.0 * t))
                # El alma del tirabuzón se mete hacia dentro y baja: es
                # lo que de verdad hace un vórtice de punta al soltarse.
                eje_y = y_p - signo * 0.09 * ala.b * t
                eje_z = -0.12 * ala.b * t
                pts.append((x, eje_y + signo * r * math.cos(ang),
                            eje_z + r * math.sin(ang)))
            trazos.append((pts, CALIDO, 2, y_p * 1.02 + fase * 1e-3))

    # Encaje: se proyecta todo y se escala a la caja
    todos = [vista(*p) for (pts, _c, _g, _d) in trazos for p in pts]
    todos += [vista(*p) for (poli, _c, _d) in caras for p in poli]
    xs = [u for u, _v in todos]
    vs = [v for _u, v in todos]
    ancho, alto = (max(xs) - min(xs)) or 1, (max(vs) - min(vs)) or 1
    cw, ch = (w - 2 * m) * 0.96, (y1 - y0) * 0.92
    k = min(cw / ancho, ch / alto)
    ox = m + (w - 2 * m - ancho * k) / 2 - min(xs) * k
    oy = y0 + (y1 - y0 - alto * k) / 2 - min(vs) * k

    def pp(p):
        u, v = vista(*p)
        return ox + u * k, oy + v * k

    # Primero la superficie del ala, luego las líneas encima; y dentro de
    # cada grupo, de atrás hacia delante para que lo cercano tape.
    for poli, col, prof in sorted(caras, key=lambda c: c[2]):
        dib.polygon([pp(p) for p in poli], fill=col)
    for pts, col, gr, prof in sorted(trazos, key=lambda t: t[3]):
        proy = [pp(p) for p in pts]
        if len(proy) > 1:
            dib.line(proy, fill=col, width=gr, joint="curve")

    f_n = D._fuente(int(corto * 0.024), True)
    leyenda = [(ACENTO, "Bound vortex — the wing itself"),
               (FRIO, "Trailing sheet, shed where the load changes"),
               (CALIDO, "Tip vortices: the price of having ends")]
    yy = y0
    for col, txt in leyenda:
        dib.rectangle([m, yy + int(corto * .008), m + int(corto * .022),
                       yy + int(corto * .014)], fill=col)
        dib.text((m + int(corto * .034), yy), txt, font=f_n, fill=APAGADO)
        yy += int(corto * 0.036)
    _pie(img, dib, pie, m)
    return _guardar(img, salida)


def _guardar(img, salida):
    with contextlib.suppress(Exception):
        os.makedirs(os.path.dirname(os.path.abspath(salida)), exist_ok=True)
    try:
        img.save(salida, "PNG")
        return salida
    except Exception as e:
        log.info("No pude guardar (%s)", e)
        return None


#: Cuerdas típicas, para no repetirlas en cada llamada
def cuerda_rectangular(c=0.45):
    return lambda y: c


def cuerda_eliptica(b=2.0, c0=0.55):
    return lambda y: c0 * max(0.0, 1 - (2 * y / b) ** 2) ** 0.5


def cuerda_trapecial(b=2.0, raiz=0.60, punta=0.28):
    return lambda y: raiz + (punta - raiz) * abs(2 * y / b)


if __name__ == "__main__":                      # pragma: no cover
    import sys
    logging.basicConfig(level=logging.INFO)
    d = sys.argv[1] if len(sys.argv) > 1 else "flujo"
    os.makedirs(d, exist_ok=True)
    rect = Ala(b=2.0, cuerda=cuerda_rectangular(0.45), alfa=6)
    elip = Ala(b=2.0, cuerda=cuerda_eliptica(2.0, 0.57), alfa=6)
    print(planta(rect, f"{d}/planta_rect.png",
                 "Looking down: where a wing pays for its ends"))
    print(planta(elip, f"{d}/planta_elip.png",
                 "The elliptical wing, and why it is the benchmark"))
    print(espacio(rect, f"{d}/espacio.png",
                  "The wing's vortex system, in space"))
    print(f"rect: CL {rect.CL:.3f} CDi {rect.CDi:.5f} e {rect.eficiencia:.3f}")
    print(f"elip: CL {elip.CL:.3f} CDi {elip.CDi:.5f} e {elip.eficiencia:.3f}")

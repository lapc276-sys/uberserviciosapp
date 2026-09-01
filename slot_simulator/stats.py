"""Funciones estadisticas minimas, sin dependencias externas.

Se implementan aqui la gamma incompleta regularizada (para el p-valor de
chi-cuadrado) y la normal estandar (para el runs test), de modo que el
paquete corra con la libreria estandar de Python.
"""

from __future__ import annotations

import math

_MAX_ITER = 500
_EPS = 1e-12


def _lower_gamma_series(s: float, x: float) -> float:
    """Serie para P(s, x) = gamma_inf(s, x) / Gamma(s), valida si x < s + 1."""
    term = 1.0 / s
    total = term
    n = s
    for _ in range(_MAX_ITER):
        n += 1.0
        term *= x / n
        total += term
        if abs(term) < abs(total) * _EPS:
            break
    return total * math.exp(-x + s * math.log(x) - math.lgamma(s))


def _upper_gamma_cf(s: float, x: float) -> float:
    """Fraccion continua para Q(s, x), valida si x >= s + 1."""
    tiny = 1e-300
    b = x + 1.0 - s
    c = 1.0 / tiny
    d = 1.0 / b if b != 0 else 1.0 / tiny
    h = d
    for i in range(1, _MAX_ITER):
        an = -i * (i - s)
        b += 2.0
        d = an * d + b
        if abs(d) < tiny:
            d = tiny
        c = b + an / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < _EPS:
            break
    return h * math.exp(-x + s * math.log(x) - math.lgamma(s))


def gammainc_upper(s: float, x: float) -> float:
    """Q(s, x): gamma incompleta superior regularizada."""
    if x <= 0:
        return 1.0
    if x < s + 1.0:
        return 1.0 - _lower_gamma_series(s, x)
    return _upper_gamma_cf(s, x)


def chi2_sf(statistic: float, df: int) -> float:
    """P(X > statistic) para una chi-cuadrado con `df` grados de libertad."""
    if df <= 0:
        raise ValueError("df debe ser positivo")
    if statistic <= 0:
        return 1.0
    return gammainc_upper(df / 2.0, statistic / 2.0)


def normal_sf(z: float) -> float:
    """P(Z > z) para una normal estandar."""
    return 0.5 * math.erfc(z / math.sqrt(2.0))


def two_sided_normal_p(z: float) -> float:
    return 2.0 * normal_sf(abs(z))


def mean(xs: list[float]) -> float:
    return sum(xs) / len(xs) if xs else 0.0


def variance(xs: list[float], sample: bool = True) -> float:
    n = len(xs)
    if n < 2:
        return 0.0
    m = mean(xs)
    ss = sum((x - m) ** 2 for x in xs)
    return ss / (n - 1 if sample else n)


def stdev(xs: list[float], sample: bool = True) -> float:
    return math.sqrt(variance(xs, sample))


def percentile(sorted_xs: list[float], q: float) -> float:
    """Percentil por interpolacion lineal. `sorted_xs` debe venir ordenada."""
    if not sorted_xs:
        return 0.0
    if len(sorted_xs) == 1:
        return sorted_xs[0]
    pos = q * (len(sorted_xs) - 1)
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return sorted_xs[int(pos)]
    frac = pos - lo
    return sorted_xs[lo] * (1 - frac) + sorted_xs[hi] * frac

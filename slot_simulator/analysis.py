"""Analisis de la maquina: RTP exacto, RTP empirico y tests de aleatoriedad."""

from __future__ import annotations

from dataclasses import dataclass, field

from . import stats
from .engine import Machine, SpinResult

# --- RTP exacto -------------------------------------------------------------


@dataclass
class ExactRTP:
    total_combinations: int
    rtp: float
    house_edge: float
    hit_frequency: float
    variance_per_spin: float
    rule_breakdown: dict[str, dict[str, float]]

    def report(self) -> str:
        lines = [
            "RTP EXACTO (enumeracion completa)",
            f"  Combinaciones posibles : {self.total_combinations:,}",
            f"  RTP                    : {self.rtp:.6%}",
            f"  Ventaja de la casa     : {self.house_edge:.6%}",
            f"  Frecuencia de premio   : {self.hit_frequency:.4%}",
            f"  Varianza por jugada    : {self.variance_per_spin:.4f}",
            "",
            "  Desglose por regla:",
            f"    {'regla':<20} {'combos':>8} {'prob':>10} {'aporte RTP':>12}",
        ]
        for name, d in sorted(
            self.rule_breakdown.items(), key=lambda kv: -kv[1]["rtp_contribution"]
        ):
            lines.append(
                f"    {name:<20} {int(d['combinations']):>8,} "
                f"{d['probability']:>9.4%} {d['rtp_contribution']:>11.4%}"
            )
        return "\n".join(lines)


def exact_rtp(machine: Machine) -> ExactRTP:
    """Calcula el RTP enumerando TODAS las combinaciones de las tiras.

    Es el valor de referencia: cualquier simulacion converge aqui, y ninguna
    estrategia de apuesta puede moverlo.
    """
    total = machine.total_combinations()
    breakdown: dict[str, dict[str, float]] = {}
    payout_sum = 0.0
    payout_sq_sum = 0.0
    hits = 0

    for line in machine.enumerate_lines():
        rule, multiplier = machine.paytable.evaluate(line)
        payout_sum += multiplier
        payout_sq_sum += multiplier * multiplier
        if multiplier > 0:
            hits += 1
        if rule is not None:
            entry = breakdown.setdefault(
                rule, {"combinations": 0.0, "probability": 0.0, "rtp_contribution": 0.0}
            )
            entry["combinations"] += 1
            entry["rtp_contribution"] += multiplier

    for entry in breakdown.values():
        entry["probability"] = entry["combinations"] / total
        entry["rtp_contribution"] /= total

    rtp = payout_sum / total
    # Var(payout) sobre la apuesta unitaria; el neto es payout - 1, misma varianza.
    var = payout_sq_sum / total - rtp * rtp

    return ExactRTP(
        total_combinations=total,
        rtp=rtp,
        house_edge=1.0 - rtp,
        hit_frequency=hits / total,
        variance_per_spin=var,
        rule_breakdown=breakdown,
    )


# --- RTP empirico -----------------------------------------------------------


@dataclass
class MonteCarloRTP:
    spins: int
    rtp: float
    house_edge: float
    hit_frequency: float
    stdev_per_spin: float
    standard_error: float
    convergence: list[tuple[int, float]] = field(default_factory=list)

    def report(self, exact: ExactRTP | None = None) -> str:
        lines = [
            f"RTP EMPIRICO (Monte Carlo, {self.spins:,} jugadas)",
            f"  RTP observado          : {self.rtp:.6%}",
            f"  Error estandar         : +/- {self.standard_error:.6%}",
            f"  Frecuencia de premio   : {self.hit_frequency:.4%}",
            f"  Desv. tipica / jugada  : {self.stdev_per_spin:.4f}",
        ]
        if exact is not None:
            diff = self.rtp - exact.rtp
            z = diff / self.standard_error if self.standard_error else 0.0
            lines += [
                f"  Diferencia vs exacto   : {diff:+.6%}  (z = {z:+.2f})",
            ]
        if self.convergence:
            lines += ["", "  Convergencia del RTP acumulado:"]
            for n, r in self.convergence:
                lines.append(f"    tras {n:>12,} jugadas : {r:.6%}")
        return "\n".join(lines)


def monte_carlo_rtp(
    machine: Machine, spins: int, bet: float = 1.0, checkpoints: int = 6
) -> MonteCarloRTP:
    """Simula `spins` jugadas y mide el RTP realizado."""
    if spins <= 0:
        raise ValueError("spins debe ser positivo")

    marks = {max(1, spins // (2 ** (checkpoints - 1 - i))) for i in range(checkpoints)}
    convergence: list[tuple[int, float]] = []

    total_bet = 0.0
    total_payout = 0.0
    sq_sum = 0.0
    hits = 0

    for i in range(1, spins + 1):
        r = machine.spin(bet)
        total_bet += r.bet
        total_payout += r.payout
        ratio = r.payout / r.bet
        sq_sum += ratio * ratio
        if r.is_win:
            hits += 1
        if i in marks:
            convergence.append((i, total_payout / total_bet))

    rtp = total_payout / total_bet
    var = sq_sum / spins - rtp * rtp
    sd = var**0.5
    return MonteCarloRTP(
        spins=spins,
        rtp=rtp,
        house_edge=1.0 - rtp,
        hit_frequency=hits / spins,
        stdev_per_spin=sd,
        standard_error=sd / (spins**0.5),
        convergence=sorted(convergence),
    )


# --- Tests de aleatoriedad --------------------------------------------------


@dataclass
class TestResult:
    name: str
    statistic: float
    p_value: float
    detail: str = ""

    @property
    def rejects_randomness(self) -> bool:
        return self.p_value < 0.01

    def line(self) -> str:
        verdict = (
            "PATRON DETECTADO" if self.rejects_randomness else "sin patron detectable"
        )
        base = f"  {self.name:<34} stat={self.statistic:>10.4f}  p={self.p_value:.4f}  {verdict}"
        return base + (f"\n      {self.detail}" if self.detail else "")


def chi_square_symbols(results: list[SpinResult], machine: Machine) -> TestResult:
    """Compara la frecuencia observada de simbolos del primer rodillo con la teorica."""
    reel = machine.reels[0]
    expected_p = {s: c / len(reel) for s, c in reel.counts().items()}
    observed: dict[str, int] = {s: 0 for s in expected_p}
    for r in results:
        observed[r.line[0]] += 1

    n = len(results)
    stat = 0.0
    df = 0
    for symbol, p in expected_p.items():
        e = n * p
        if e < 5:
            continue
        stat += (observed[symbol] - e) ** 2 / e
        df += 1
    df = max(df - 1, 1)
    return TestResult(
        name="Chi-cuadrado (simbolos rodillo 1)",
        statistic=stat,
        p_value=stats.chi2_sf(stat, df),
        detail=f"df={df}, n={n:,}",
    )


def runs_test(results: list[SpinResult]) -> TestResult:
    """Wald-Wolfowitz sobre la secuencia gana/pierde.

    Si las rachas fueran predecibles (mas largas o mas cortas de lo que dicta
    el azar), este test lo detectaria.
    """
    seq = [r.is_win for r in results]
    n1 = sum(seq)
    n2 = len(seq) - n1
    if n1 == 0 or n2 == 0:
        return TestResult("Runs test (rachas gana/pierde)", 0.0, 1.0, "secuencia constante")

    runs = 1 + sum(1 for a, b in zip(seq, seq[1:]) if a != b)
    n = n1 + n2
    exp_runs = 2 * n1 * n2 / n + 1
    var_runs = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1))
    z = (runs - exp_runs) / (var_runs**0.5) if var_runs > 0 else 0.0
    return TestResult(
        name="Runs test (rachas gana/pierde)",
        statistic=z,
        p_value=stats.two_sided_normal_p(z),
        detail=f"rachas={runs:,} esperadas={exp_runs:,.1f}",
    )


def autocorrelation(results: list[SpinResult], max_lag: int = 10) -> list[TestResult]:
    """Autocorrelacion del pago a distintos retardos.

    Un predictor solo puede existir si el pago de la jugada k aporta
    informacion sobre la jugada k+lag. Esto lo mide directamente.
    """
    xs = [r.payout / r.bet for r in results]
    n = len(xs)
    m = stats.mean(xs)
    denom = sum((x - m) ** 2 for x in xs)
    out: list[TestResult] = []
    for lag in range(1, max_lag + 1):
        if n - lag < 30 or denom == 0:
            break
        num = sum((xs[i] - m) * (xs[i + lag] - m) for i in range(n - lag))
        r = num / denom
        z = r * (n**0.5)  # bajo H0, r ~ N(0, 1/n)
        out.append(
            TestResult(
                name=f"Autocorrelacion pago (lag {lag})",
                statistic=r,
                p_value=stats.two_sided_normal_p(z),
            )
        )
    return out


def conditional_win_rate(results: list[SpinResult]) -> TestResult:
    """La pregunta del jugador: ¿"toca" despues de perder muchas veces?

    Compara P(ganar | la jugada anterior fue perdida) contra
    P(ganar | la jugada anterior fue premio), con un test de dos proporciones.
    """
    after_loss_n = after_loss_w = 0
    after_win_n = after_win_w = 0
    for prev, cur in zip(results, results[1:]):
        if prev.is_win:
            after_win_n += 1
            after_win_w += cur.is_win
        else:
            after_loss_n += 1
            after_loss_w += cur.is_win

    if after_loss_n == 0 or after_win_n == 0:
        return TestResult("P(ganar | jugada anterior)", 0.0, 1.0, "datos insuficientes")

    p1 = after_loss_w / after_loss_n
    p2 = after_win_w / after_win_n
    p = (after_loss_w + after_win_w) / (after_loss_n + after_win_n)
    se = (p * (1 - p) * (1 / after_loss_n + 1 / after_win_n)) ** 0.5
    z = (p1 - p2) / se if se > 0 else 0.0
    return TestResult(
        name="P(ganar | jugada anterior)",
        statistic=z,
        p_value=stats.two_sided_normal_p(z),
        detail=(
            f"tras perder: {p1:.4%} (n={after_loss_n:,})  |  "
            f"tras ganar: {p2:.4%} (n={after_win_n:,})"
        ),
    )


def losing_streak_test(results: list[SpinResult], threshold: int = 5) -> TestResult:
    """¿Sube la probabilidad de premio despues de una racha larga de perdidas?

    Es exactamente la hipotesis en la que se apoyan los "algoritmos de
    prediccion". Se contrasta contra la tasa base.
    """
    base_w = sum(1 for r in results if r.is_win)
    base_n = len(results)
    streak = 0
    after_n = after_w = 0
    for r in results:
        if streak >= threshold:
            after_n += 1
            after_w += r.is_win
        streak = 0 if r.is_win else streak + 1

    if after_n < 30:
        return TestResult(
            f"P(ganar | {threshold}+ perdidas seguidas)",
            0.0,
            1.0,
            "muestra insuficiente",
        )

    p1 = after_w / after_n
    p0 = base_w / base_n
    se = (p0 * (1 - p0) / after_n) ** 0.5
    z = (p1 - p0) / se if se > 0 else 0.0
    return TestResult(
        name=f"P(ganar | {threshold}+ perdidas seguidas)",
        statistic=z,
        p_value=stats.two_sided_normal_p(z),
        detail=f"condicionada: {p1:.4%} (n={after_n:,})  |  tasa base: {p0:.4%}",
    )


def run_pattern_suite(machine: Machine, spins: int = 200_000) -> list[TestResult]:
    """Bateria completa de tests sobre una secuencia larga de jugadas."""
    results = list(machine.spins(spins))
    out = [
        chi_square_symbols(results, machine),
        runs_test(results),
        conditional_win_rate(results),
        losing_streak_test(results, threshold=5),
        losing_streak_test(results, threshold=10),
    ]
    out.extend(autocorrelation(results, max_lag=5))
    return out


def pattern_report(tests: list[TestResult]) -> str:
    lines = ["TESTS DE PATRON (buscando algo predecible)"]
    lines.extend(t.line() for t in tests)
    rejected = [t for t in tests if t.rejects_randomness]
    lines.append("")
    if rejected:
        lines.append(
            f"  => {len(rejected)} de {len(tests)} tests marcan patron. "
            "Con alfa=0.01 se esperan falsos positivos ocasionales; "
            "repite con otra semilla antes de concluir nada."
        )
    else:
        lines.append(
            f"  => 0 de {len(tests)} tests encuentran estructura explotable. "
            "No hay senal sobre la que construir un predictor."
        )
    return "\n".join(lines)

"""Simulacion de sesiones de juego y comparacion de estrategias de apuesta.

La conclusion que sale del modelo: toda estrategia que solo decida *cuanto*
apostar tiene el mismo valor esperado por unidad apostada, `RTP - 1`. Cambiar
el tamano de la apuesta cambia la varianza (y con ello la forma de la
distribucion de resultados), nunca la media.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from . import stats
from .engine import Machine, SpinResult

# --- Estrategias ------------------------------------------------------------

# Una estrategia recibe el historial de la sesion y devuelve la apuesta.
Strategy = Callable[[list[SpinResult], float], float]


def flat(unit: float = 1.0) -> Strategy:
    """Apuesta fija."""

    def strategy(history: list[SpinResult], bankroll: float) -> float:
        return min(unit, bankroll)

    return strategy


def martingale(unit: float = 1.0, cap: float = 256.0) -> Strategy:
    """Doblar tras cada perdida. La estrategia mas vendida y la mas ruinosa."""

    def strategy(history: list[SpinResult], bankroll: float) -> float:
        bet = unit
        for r in reversed(history):
            if r.is_win:
                break
            bet *= 2
            if bet >= cap:
                bet = cap
                break
        return min(bet, bankroll)

    return strategy


def anti_martingale(unit: float = 1.0, cap: float = 256.0) -> Strategy:
    """Doblar tras cada premio ("montar la racha caliente")."""

    def strategy(history: list[SpinResult], bankroll: float) -> float:
        bet = unit
        for r in reversed(history):
            if not r.is_win:
                break
            bet *= 2
            if bet >= cap:
                bet = cap
                break
        return min(bet, bankroll)

    return strategy


def streak_predictor(unit: float = 1.0, threshold: int = 8, multiplier: float = 10.0) -> Strategy:
    """El "algoritmo de prediccion" tipico.

    Espera a una racha larga de perdidas y entonces apuesta fuerte, bajo la
    creencia de que la maquina "ya va a soltar". Se incluye precisamente para
    medir su rendimiento contra la apuesta fija.
    """

    def strategy(history: list[SpinResult], bankroll: float) -> float:
        streak = 0
        for r in reversed(history):
            if r.is_win:
                break
            streak += 1
        bet = unit * multiplier if streak >= threshold else unit
        return min(bet, bankroll)

    return strategy


STRATEGIES: dict[str, Strategy] = {
    "apuesta fija": flat(1.0),
    "martingala": martingale(1.0),
    "anti-martingala": anti_martingale(1.0),
    "predictor de rachas": streak_predictor(1.0),
}


# --- Sesion -----------------------------------------------------------------


@dataclass
class SessionOutcome:
    final_bankroll: float
    spins_played: int
    total_wagered: float
    total_returned: float
    peak_bankroll: float
    max_drawdown: float
    busted: bool

    @property
    def net(self) -> float:
        return self.total_returned - self.total_wagered

    @property
    def realized_rtp(self) -> float:
        return self.total_returned / self.total_wagered if self.total_wagered else 0.0


def play_session(
    machine: Machine,
    strategy: Strategy,
    bankroll: float = 200.0,
    max_spins: int = 500,
) -> SessionOutcome:
    """Juega una sesion hasta agotar el bankroll o el numero maximo de jugadas."""
    peak = bankroll
    trough_gap = 0.0
    history: list[SpinResult] = []
    wagered = returned = 0.0
    spins = 0

    while spins < max_spins and bankroll > 0:
        bet = strategy(history, bankroll)
        if bet <= 0:
            break
        result = machine.spin(bet)
        history.append(result)
        bankroll += result.net
        wagered += result.bet
        returned += result.payout
        spins += 1
        peak = max(peak, bankroll)
        trough_gap = max(trough_gap, peak - bankroll)

    return SessionOutcome(
        final_bankroll=bankroll,
        spins_played=spins,
        total_wagered=wagered,
        total_returned=returned,
        peak_bankroll=peak,
        max_drawdown=trough_gap,
        busted=bankroll <= 0,
    )


@dataclass
class StrategyComparison:
    name: str
    sessions: int
    mean_net: float
    median_net: float
    stdev_net: float
    p05_net: float
    p95_net: float
    bust_rate: float
    profit_rate: float
    mean_wagered: float
    realized_rtp: float
    mean_max_drawdown: float
    outcomes: list[SessionOutcome] = field(default_factory=list, repr=False)


def compare_strategies(
    machine_factory: Callable[[int], Machine],
    strategies: dict[str, Strategy] | None = None,
    sessions: int = 2000,
    bankroll: float = 200.0,
    max_spins: int = 500,
    seed: int = 12345,
) -> list[StrategyComparison]:
    """Corre las mismas semillas para cada estrategia y compara resultados.

    Usar semillas identicas entre estrategias elimina el ruido del RNG de la
    comparacion: las diferencias que queden vienen de la estrategia.
    """
    strategies = strategies or STRATEGIES
    comparisons: list[StrategyComparison] = []

    for name, strategy in strategies.items():
        outcomes: list[SessionOutcome] = []
        for i in range(sessions):
            machine = machine_factory(seed + i)
            outcomes.append(play_session(machine, strategy, bankroll, max_spins))

        nets = sorted(o.net for o in outcomes)
        wagered = [o.total_wagered for o in outcomes]
        total_w = sum(wagered)
        total_r = sum(o.total_returned for o in outcomes)
        comparisons.append(
            StrategyComparison(
                name=name,
                sessions=sessions,
                mean_net=stats.mean(nets),
                median_net=stats.percentile(nets, 0.5),
                stdev_net=stats.stdev(nets),
                p05_net=stats.percentile(nets, 0.05),
                p95_net=stats.percentile(nets, 0.95),
                bust_rate=sum(1 for o in outcomes if o.busted) / sessions,
                profit_rate=sum(1 for o in outcomes if o.net > 0) / sessions,
                mean_wagered=stats.mean(wagered),
                realized_rtp=total_r / total_w if total_w else 0.0,
                mean_max_drawdown=stats.mean([o.max_drawdown for o in outcomes]),
                outcomes=outcomes,
            )
        )
    return comparisons


def comparison_report(comparisons: list[StrategyComparison], exact_rtp: float) -> str:
    lines = [
        f"COMPARACION DE ESTRATEGIAS ({comparisons[0].sessions:,} sesiones cada una, "
        "mismas semillas)",
        "",
        f"  {'estrategia':<22}{'neto medio':>12}{'mediana':>10}{'desv':>10}"
        f"{'p05':>10}{'p95':>10}{'quiebra':>9}{'gana':>8}{'RTP real':>10}",
    ]
    for c in comparisons:
        lines.append(
            f"  {c.name:<22}{c.mean_net:>12.2f}{c.median_net:>10.2f}{c.stdev_net:>10.2f}"
            f"{c.p05_net:>10.2f}{c.p95_net:>10.2f}{c.bust_rate:>8.1%}"
            f"{c.profit_rate:>8.1%}{c.realized_rtp:>10.4%}"
        )
    lines += [
        "",
        f"  RTP teorico de la maquina: {exact_rtp:.4%}",
        "  Toda estrategia converge al mismo RTP: la eleccion cambia la forma de la",
        "  distribucion (varianza, riesgo de quiebra), no el valor esperado.",
        "",
        "  Perdida esperada por unidad apostada:",
    ]
    for c in comparisons:
        expected = c.mean_wagered * (exact_rtp - 1.0)
        lines.append(
            f"    {c.name:<22} apostado medio {c.mean_wagered:>10.2f}  ->  "
            f"esperado {expected:>9.2f}  observado {c.mean_net:>9.2f}"
        )
    return "\n".join(lines)


# --- Riesgo de ruina --------------------------------------------------------


def ruin_probability(
    machine_factory: Callable[[int], Machine],
    strategy: Strategy,
    bankroll: float = 200.0,
    max_spins: int = 500,
    sessions: int = 2000,
    seed: int = 999,
) -> float:
    busted = 0
    for i in range(sessions):
        outcome = play_session(machine_factory(seed + i), strategy, bankroll, max_spins)
        busted += outcome.busted
    return busted / sessions

"""Simulador educativo de maquinas tragamonedas.

Modela el funcionamiento real de una slot (tiras de rodillo + tabla de pagos +
RNG sin memoria) para estudiar RTP, varianza y riesgo de ruina, y para
contrastar empiricamente la idea de que exista un patron predecible.
"""

from .analysis import (
    ExactRTP,
    MonteCarloRTP,
    TestResult,
    exact_rtp,
    monte_carlo_rtp,
    pattern_report,
    run_pattern_suite,
)
from .engine import Machine, Paytable, PayRule, Reel, SpinResult, classic_machine
from .session import (
    STRATEGIES,
    SessionOutcome,
    StrategyComparison,
    compare_strategies,
    comparison_report,
    play_session,
    ruin_probability,
)

__all__ = [
    "Machine",
    "Reel",
    "Paytable",
    "PayRule",
    "SpinResult",
    "classic_machine",
    "ExactRTP",
    "MonteCarloRTP",
    "TestResult",
    "exact_rtp",
    "monte_carlo_rtp",
    "run_pattern_suite",
    "pattern_report",
    "SessionOutcome",
    "StrategyComparison",
    "STRATEGIES",
    "play_session",
    "compare_strategies",
    "comparison_report",
    "ruin_probability",
]

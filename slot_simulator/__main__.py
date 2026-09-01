"""CLI del simulador.

    python -m slot_simulator                 # informe completo
    python -m slot_simulator rtp
    python -m slot_simulator patterns --spins 500000
    python -m slot_simulator strategies --sessions 5000
"""

from __future__ import annotations

import argparse

from .analysis import exact_rtp, monte_carlo_rtp, pattern_report, run_pattern_suite
from .engine import classic_machine
from .session import comparison_report, compare_strategies


def _rule(title: str) -> str:
    return f"\n{'=' * 78}\n{title}\n{'=' * 78}"


def cmd_rtp(args: argparse.Namespace) -> None:
    machine = classic_machine(seed=args.seed)
    exact = exact_rtp(machine)
    print(_rule("1. RTP DE LA MAQUINA"))
    print(exact.report())
    print()
    mc = monte_carlo_rtp(machine, spins=args.spins)
    print(mc.report(exact))


def cmd_patterns(args: argparse.Namespace) -> None:
    machine = classic_machine(seed=args.seed)
    print(_rule("2. ¿EXISTE UN PATRON PREDECIBLE?"))
    print(pattern_report(run_pattern_suite(machine, spins=args.spins)))


def cmd_strategies(args: argparse.Namespace) -> None:
    exact = exact_rtp(classic_machine())
    print(_rule("3. ¿SIRVE ALGUNA ESTRATEGIA DE APUESTA?"))
    comparisons = compare_strategies(
        machine_factory=lambda s: classic_machine(seed=s),
        sessions=args.sessions,
        bankroll=args.bankroll,
        max_spins=args.max_spins,
        seed=args.seed,
    )
    print(comparison_report(comparisons, exact.rtp))


def cmd_all(args: argparse.Namespace) -> None:
    cmd_rtp(args)
    cmd_patterns(args)
    cmd_strategies(args)
    print(_rule("CONCLUSION"))
    print(
        "El resultado esperado de cada jugada es bet * (RTP - 1) y no depende del\n"
        "historial: el RNG no lo consulta. Ninguna funcion del pasado puede mover\n"
        "esa media, y por eso no existe un algoritmo de prediccion para slots.\n"
        "Lo unico que las estrategias cambian es la varianza y el riesgo de ruina."
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="slot_simulator",
        description="Simulador educativo de tragamonedas: RTP, varianza y tests de patron.",
    )
    parser.add_argument("--seed", type=int, default=2024, help="semilla del RNG")
    sub = parser.add_subparsers(dest="command")

    p_rtp = sub.add_parser("rtp", help="RTP exacto vs empirico")
    p_rtp.add_argument("--spins", type=int, default=1_000_000)
    p_rtp.set_defaults(func=cmd_rtp)

    p_pat = sub.add_parser("patterns", help="tests de aleatoriedad")
    p_pat.add_argument("--spins", type=int, default=200_000)
    p_pat.set_defaults(func=cmd_patterns)

    p_str = sub.add_parser("strategies", help="comparacion de estrategias de apuesta")
    p_str.add_argument("--sessions", type=int, default=2000)
    p_str.add_argument("--bankroll", type=float, default=200.0)
    p_str.add_argument("--max-spins", type=int, default=500)
    p_str.set_defaults(func=cmd_strategies)

    args = parser.parse_args()
    if args.command is None:
        args.spins = 200_000
        args.sessions = 2000
        args.bankroll = 200.0
        args.max_spins = 500
        cmd_all(args)
    else:
        args.func(args)


if __name__ == "__main__":
    main()

"""Tests del simulador. Ejecutar con:  python -m pytest slot_simulator/tests -q"""

from __future__ import annotations

import math

import pytest

from slot_simulator import analysis, engine, session, stats


# --- stats ------------------------------------------------------------------


def test_chi2_sf_conocidos():
    # Valores de referencia de tablas chi-cuadrado.
    assert chi_close(analysis.stats.chi2_sf(3.841, 1), 0.05)
    assert chi_close(analysis.stats.chi2_sf(5.991, 2), 0.05)
    assert chi_close(analysis.stats.chi2_sf(16.919, 9), 0.05)


def chi_close(value: float, expected: float, tol: float = 1e-3) -> bool:
    return abs(value - expected) < tol


def test_normal_sf():
    assert math.isclose(stats.normal_sf(0.0), 0.5, abs_tol=1e-9)
    assert math.isclose(stats.normal_sf(1.96), 0.025, abs_tol=1e-3)


def test_percentile():
    xs = [float(i) for i in range(101)]
    assert stats.percentile(xs, 0.5) == 50.0
    assert stats.percentile(xs, 0.0) == 0.0
    assert stats.percentile(xs, 1.0) == 100.0


# --- motor ------------------------------------------------------------------


def test_reel_from_counts():
    reel = engine.Reel.from_counts({engine.SEVEN: 1, engine.BLANK: 3})
    assert len(reel) == 4
    assert reel.counts() == {engine.SEVEN: 1, engine.BLANK: 3}


def test_paytable_primera_regla_gana():
    machine = engine.classic_machine()
    rule, mult = machine.paytable.evaluate((engine.SEVEN,) * 3)
    assert rule == "3x SEVEN" and mult == 200
    rule, mult = machine.paytable.evaluate((engine.BAR3, engine.BAR1, engine.BAR2))
    assert rule == "3 BARs mezclados" and mult == 10
    rule, mult = machine.paytable.evaluate((engine.BLANK, engine.BLANK, engine.BLANK))
    assert rule is None and mult == 0.0


def test_misma_semilla_misma_secuencia():
    a = list(engine.classic_machine(seed=7).spins(500))
    b = list(engine.classic_machine(seed=7).spins(500))
    assert [r.line for r in a] == [r.line for r in b]


def test_semillas_distintas_difieren():
    a = list(engine.classic_machine(seed=1).spins(500))
    b = list(engine.classic_machine(seed=2).spins(500))
    assert [r.line for r in a] != [r.line for r in b]


def test_spin_no_depende_del_historial():
    """Jugar N veces y luego una mas da lo mismo que saltar al spin N+1.

    Es la propiedad que hace imposible cualquier predictor: el estado que
    determina el resultado es solo el del PRNG, no el de las ganancias.
    """
    m1 = engine.classic_machine(seed=42)
    list(m1.spins(100))
    nxt1 = m1.spin()

    m2 = engine.classic_machine(seed=42)
    for _ in range(100):
        m2.spin(bet=999.0)  # apuestas distintas, historial distinto
    nxt2 = m2.spin()

    assert nxt1.line == nxt2.line


# --- RTP --------------------------------------------------------------------


def test_rtp_exacto_en_rango_realista():
    exact = analysis.exact_rtp(engine.classic_machine())
    assert exact.total_combinations == 32**3
    assert 0.90 < exact.rtp < 0.99
    assert math.isclose(exact.rtp + exact.house_edge, 1.0, abs_tol=1e-12)


def test_desglose_suma_el_rtp():
    exact = analysis.exact_rtp(engine.classic_machine())
    total = sum(d["rtp_contribution"] for d in exact.rule_breakdown.values())
    assert math.isclose(total, exact.rtp, rel_tol=1e-12)


def test_monte_carlo_converge_al_exacto():
    machine = engine.classic_machine(seed=123)
    exact = analysis.exact_rtp(machine)
    mc = analysis.monte_carlo_rtp(machine, spins=300_000)
    z = (mc.rtp - exact.rtp) / mc.standard_error
    assert abs(z) < 4.0, f"desviacion de {z:.2f} sigma"


# --- tests de patron --------------------------------------------------------


def test_no_hay_patron_detectable():
    machine = engine.classic_machine(seed=2024)
    results = analysis.run_pattern_suite(machine, spins=150_000)
    rejected = [t for t in results if t.rejects_randomness]
    assert not rejected, f"tests que marcan patron: {[t.name for t in rejected]}"


def test_racha_perdedora_no_cambia_probabilidad():
    machine = engine.classic_machine(seed=77)
    spins = list(machine.spins(200_000))
    t = analysis.losing_streak_test(spins, threshold=5)
    assert t.p_value > 0.01


# --- sesiones ---------------------------------------------------------------


def test_sesion_respeta_limites():
    machine = engine.classic_machine(seed=5)
    out = session.play_session(machine, session.flat(1.0), bankroll=50.0, max_spins=100)
    assert out.spins_played <= 100
    assert out.final_bankroll >= 0
    assert out.busted == (out.final_bankroll <= 0)


def assert_neto_compatible_con_el_rtp(c: session.StrategyComparison, rtp: float) -> None:
    """Contrasta el neto medio observado contra bet * (RTP - 1).

    Se usa un z-test y no una tolerancia fija: la martingala tiene una
    desviacion tipica enorme, asi que cualquier margen absoluto seria o
    demasiado estricto para ella o inutil para la apuesta fija.
    """
    esperado = c.mean_wagered * (rtp - 1.0)
    se = c.stdev_net / math.sqrt(c.sessions)
    z = (c.mean_net - esperado) / se
    assert abs(z) < 4.0, (
        f"{c.name}: neto medio {c.mean_net:.2f} vs esperado {esperado:.2f} "
        f"(z = {z:.2f}, se = {se:.2f})"
    )


def test_martingala_arriesga_mas_sin_mejorar_la_media():
    factory = lambda s: engine.classic_machine(seed=s)
    comps = session.compare_strategies(
        factory,
        strategies={"fija": session.flat(1.0), "martingala": session.martingale(1.0)},
        sessions=400,
        bankroll=200.0,
        max_spins=300,
        seed=31337,
    )
    fija, martin = comps[0], comps[1]
    exact = analysis.exact_rtp(engine.classic_machine()).rtp

    # La martingala apuesta mas, arriesga mas y quiebra mucho mas a menudo...
    assert martin.mean_wagered > fija.mean_wagered
    assert martin.stdev_net > fija.stdev_net
    assert martin.bust_rate > fija.bust_rate

    # ...pero ambas siguen pagando exactamente la ventaja de la casa.
    assert_neto_compatible_con_el_rtp(fija, exact)
    assert_neto_compatible_con_el_rtp(martin, exact)


def test_predictor_de_rachas_no_bate_a_la_apuesta_fija():
    """La estrategia que "espera el momento" no genera ventaja alguna."""
    factory = lambda s: engine.classic_machine(seed=s)
    comps = session.compare_strategies(
        factory,
        strategies={
            "fija": session.flat(1.0),
            "predictor": session.streak_predictor(1.0),
        },
        sessions=600,
        bankroll=200.0,
        max_spins=300,
        seed=8080,
    )
    fija, pred = comps[0], comps[1]
    exact = analysis.exact_rtp(engine.classic_machine()).rtp

    # El neto de ambas es el que dicta el RTP sobre lo apostado, nada mas.
    assert_neto_compatible_con_el_rtp(fija, exact)
    assert_neto_compatible_con_el_rtp(pred, exact)

    # Y como el "predictor" apuesta mas, su perdida esperada es mayor.
    assert pred.mean_wagered > fija.mean_wagered
    esperado_fija = fija.mean_wagered * (exact - 1.0)
    esperado_pred = pred.mean_wagered * (exact - 1.0)
    assert esperado_pred < esperado_fija


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))

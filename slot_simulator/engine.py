"""Motor de una maquina tragamonedas.

El punto central del diseno esta en `Machine.spin`: cada jugada consume
numeros del RNG y no lee ningun estado de las jugadas anteriores. No existe
una variable "temperatura", "racha" ni "deuda" que un predictor pudiera
estimar, porque no existe en el hardware real que este modelo reproduce.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from itertools import product
from typing import Callable, Iterable, Sequence

# --- Simbolos ---------------------------------------------------------------

SEVEN = "SEVEN"
BAR3 = "BAR3"
BAR2 = "BAR2"
BAR1 = "BAR1"
BELL = "BELL"
CHERRY = "CHERRY"
BLANK = "BLANK"

BARS = frozenset({BAR3, BAR2, BAR1})


# --- Rodillos ---------------------------------------------------------------


@dataclass(frozen=True)
class Reel:
    """Una tira de rodillo: la lista de posiciones fisicas donde puede parar.

    La probabilidad de cada simbolo es simplemente su frecuencia en la tira.
    Aqui es donde se disena el RTP de la maquina, no en ningun ajuste dinamico.
    """

    stops: tuple[str, ...]

    @classmethod
    def from_counts(cls, counts: dict[str, int]) -> "Reel":
        stops: list[str] = []
        for symbol, n in counts.items():
            stops.extend([symbol] * n)
        return cls(tuple(stops))

    def __len__(self) -> int:
        return len(self.stops)

    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for s in self.stops:
            out[s] = out.get(s, 0) + 1
        return out


# --- Tabla de pagos ---------------------------------------------------------


@dataclass(frozen=True)
class PayRule:
    name: str
    matches: Callable[[tuple[str, ...]], bool]
    multiplier: float


def _all(symbol: str) -> Callable[[tuple[str, ...]], bool]:
    return lambda line: all(s == symbol for s in line)


def _all_bars(line: tuple[str, ...]) -> bool:
    return all(s in BARS for s in line)


def _exactly_n_cherries(n: int) -> Callable[[tuple[str, ...]], bool]:
    return lambda line: sum(1 for s in line if s == CHERRY) == n


@dataclass(frozen=True)
class Paytable:
    """Reglas evaluadas en orden: gana la primera que coincide."""

    rules: tuple[PayRule, ...]

    def evaluate(self, line: tuple[str, ...]) -> tuple[str | None, float]:
        for rule in self.rules:
            if rule.matches(line):
                return rule.name, rule.multiplier
        return None, 0.0


# --- Resultado de una jugada ------------------------------------------------


@dataclass(frozen=True)
class SpinResult:
    line: tuple[str, ...]
    bet: float
    rule: str | None
    payout: float

    @property
    def net(self) -> float:
        """Ganancia neta de la jugada (negativa si se perdio la apuesta)."""
        return self.payout - self.bet

    @property
    def is_win(self) -> bool:
        return self.payout > 0


# --- Maquina ----------------------------------------------------------------


@dataclass
class Machine:
    reels: tuple[Reel, ...]
    paytable: Paytable
    seed: int | None = None
    _rng: random.Random = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._rng = random.Random(self.seed)

    def reseed(self, seed: int | None) -> None:
        self.seed = seed
        self._rng = random.Random(seed)

    def spin(self, bet: float = 1.0) -> SpinResult:
        """Una jugada independiente.

        Nota deliberada: esta funcion no recibe ni consulta el historial. El
        resultado depende unicamente del estado interno del PRNG, que avanza
        de forma identica gane o pierda el jugador.
        """
        line = tuple(
            reel.stops[self._rng.randrange(len(reel.stops))] for reel in self.reels
        )
        rule, multiplier = self.paytable.evaluate(line)
        return SpinResult(line=line, bet=bet, rule=rule, payout=bet * multiplier)

    def spins(self, n: int, bet: float = 1.0) -> Iterable[SpinResult]:
        for _ in range(n):
            yield self.spin(bet)

    # -- Enumeracion exacta --------------------------------------------------

    def total_combinations(self) -> int:
        total = 1
        for reel in self.reels:
            total *= len(reel)
        return total

    def enumerate_lines(self) -> Iterable[tuple[str, ...]]:
        """Todas las combinaciones fisicas posibles, con su multiplicidad implicita."""
        return product(*(reel.stops for reel in self.reels))


# --- Maquina de ejemplo -----------------------------------------------------


def classic_paytable() -> Paytable:
    return Paytable(
        rules=(
            PayRule("3x SEVEN", _all(SEVEN), 200),
            PayRule("3x BAR3", _all(BAR3), 60),
            PayRule("3x BAR2", _all(BAR2), 30),
            PayRule("3x BAR1", _all(BAR1), 20),
            PayRule("3x BELL", _all(BELL), 15),
            PayRule("3x CHERRY", _all(CHERRY), 12),
            PayRule("3 BARs mezclados", _all_bars, 10),
            PayRule("2 CHERRY", _exactly_n_cherries(2), 4),
            PayRule("1 CHERRY", _exactly_n_cherries(1), 1),
        )
    )


def classic_machine(seed: int | None = None) -> Machine:
    """Maquina de 3 rodillos y 32 posiciones por rodillo (RTP ~95.8%)."""
    reels = (
        Reel.from_counts(
            {SEVEN: 1, BAR3: 2, BAR2: 3, BAR1: 4, BELL: 5, CHERRY: 6, BLANK: 11}
        ),
        Reel.from_counts(
            {SEVEN: 1, BAR3: 2, BAR2: 3, BAR1: 4, BELL: 5, CHERRY: 5, BLANK: 12}
        ),
        Reel.from_counts(
            {SEVEN: 1, BAR3: 2, BAR2: 3, BAR1: 4, BELL: 5, CHERRY: 4, BLANK: 13}
        ),
    )
    return Machine(reels=reels, paytable=classic_paytable(), seed=seed)


def describe_reels(machine: Machine) -> Sequence[dict[str, int]]:
    return [reel.counts() for reel in machine.reels]

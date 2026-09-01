# Simulador educativo de tragamonedas

Paquete Python autónomo (solo librería estándar) que modela una máquina
tragamonedas real para estudiar **RTP, varianza y riesgo de ruina**, y para
contrastar empíricamente la creencia de que existe un patrón predecible.

> No es una herramienta para ganar dinero. Es lo contrario: sirve para medir,
> con datos propios, por qué los "algoritmos de predicción" para slots no
> pueden funcionar.

## Uso

```bash
python -m slot_simulator                          # informe completo
python -m slot_simulator rtp --spins 1000000      # RTP exacto vs empírico
python -m slot_simulator patterns --spins 500000  # tests de aleatoriedad
python -m slot_simulator strategies --sessions 5000
```

Tests:

```bash
python -m pytest slot_simulator/tests -q
```

## Arquitectura

```
engine.py    Reel, Paytable, Machine.spin  -> el modelo físico
stats.py     chi2/normal/percentiles       -> sin dependencias externas
analysis.py  RTP exacto + Monte Carlo + batería de tests de patrón
session.py   Bankroll, estrategias de apuesta, comparación de sesiones
__main__.py  CLI
```

**`engine.py`** — Una máquina son tres tiras de rodillo (`Reel`) más una tabla
de pagos (`Paytable`). La probabilidad de cada símbolo es su frecuencia en la
tira: ahí, y solo ahí, se diseña el RTP. `Machine.spin()` no recibe ni consulta
el historial — es la propiedad que hace imposible cualquier predictor, y está
verificada en `test_spin_no_depende_del_historial`.

**`analysis.py`** — Dos caminos hacia el mismo número:

- `exact_rtp()` enumera las 32³ = 32.768 combinaciones posibles y calcula el
  RTP de forma cerrada, con desglose por regla de pago.
- `monte_carlo_rtp()` simula millones de jugadas y mide el RTP realizado.

La batería `run_pattern_suite()` busca activamente estructura explotable:
chi-cuadrado sobre símbolos, runs test de Wald-Wolfowitz sobre la secuencia
gana/pierde, autocorrelación del pago a varios retardos, y dos contrastes
directos de la hipótesis del jugador — `P(ganar | jugada anterior)` y
`P(ganar | N pérdidas seguidas)` contra la tasa base.

**`session.py`** — Estrategias de apuesta (fija, martingala, anti-martingala y
un "predictor de rachas" que apuesta fuerte tras 8 pérdidas). Se comparan con
**las mismas semillas** para que la diferencia venga de la estrategia y no del
RNG.

## Resultado

Con la máquina de ejemplo (RTP teórico **95.83%**, ventaja de la casa 4.17%):

```
  estrategia          neto medio   mediana      desv   quiebra    gana  RTP real
  apuesta fija            -20.35    -27.00     62.96      0.1%   33.1%  95.9290%
  martingala              -52.85   -200.00    590.52     88.3%   10.4%  95.1059%
  anti-martingala         -49.02   -200.00    438.77     64.8%   18.6%  95.4097%
  predictor de rachas     -22.38    -32.00     88.07      1.4%   33.6%  95.9293%
```

Los 10 tests de patrón dan 0 detecciones. Y el neto medio de cada estrategia
coincide con `apostado × (RTP − 1)`:

```
  apuesta fija           apostado 499.99  -> esperado -20.86  observado -20.35
  martingala             apostado 1079.85 -> esperado -45.05  observado -52.85
  predictor de rachas    apostado 549.79  -> esperado -22.94  observado -22.38
```

La lectura: **elegir cuánto apostar cambia la forma de la distribución
—varianza, probabilidad de quiebra— pero nunca la media.** La martingala no
pierde más por unidad apostada; pierde más porque apuesta más, y quiebra el 88%
de las sesiones camino de eso. El "predictor de rachas" es idéntico a la
apuesta fija salvo por apostar más en los peores momentos posibles: momentos
que, como muestra `P(ganar | 10+ pérdidas seguidas)`, no tienen nada de
especial.

El valor esperado de cada jugada es `bet × (RTP − 1)`, constante e
independiente del historial. Ninguna función del pasado puede moverlo, porque
el generador no lee el pasado.

## Ajustar la máquina

Editar las tiras en `classic_machine()` cambia el RTP; `exact_rtp()` lo
recalcula al instante sin necesidad de simular. Es una buena forma de ver
cuánto mueve el RTP añadir una sola posición de un símbolo en un rodillo.

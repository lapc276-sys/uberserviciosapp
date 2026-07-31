# Herramientas de generación (NO se ejecutan en producción)

Estos scripts generan las **láminas técnicas** de `biblioteca/`. Se corren
a mano cuando quieras ampliar el catálogo, no dentro del canal: así el Repl
no necesita `cairosvg` ni las librerías de sistema de Cairo, que dan guerra
en Replit. Las láminas se generan una vez y viven como PNG en la biblioteca.

## Qué hay aquí

- `f1_2026_svg.py` — el coche base 2026. Todas las cotas del reglamento
  están arriba del archivo como constantes, en MILÍMETROS REALES: batalla
  3400, ancho 1900, suelo −150, alerón delantero 1800, gomas 280/375,
  llanta 18". Cambias una cota y el dibujo se reajusta solo.
- `variantes_f1.py` — el catálogo de variantes (reglaje y daño) en formato
  vertical 1080x1920 para Shorts.

## Regla del canal sobre estos diagramas

Se dibujan configuraciones **genéricas** y física. NUNCA "el pontón del
equipo X": no conocemos la geometría real de ningún equipo, y dibujarla
como si la supiéramos sería inventar — justo lo que el canal no hace en
ningún otro sitio (el modelo de estrategia devuelve None antes que
rellenar, los adelantamientos se cuentan de verdad, las curvas salen del
GPS real). Cuando haya que hablar de un equipo concreto, el dato lo pone
la telemetría medida, no el dibujo.

## Cómo ampliar el catálogo

1. Añade una entrada a `VARIANTES` en `variantes_f1.py` (6 líneas):

   ```python
   "porpoising": {
       "titulo": "PORPOISING",
       "sub": "Why the car bounces",
       "ala_del": 0.9, "ala_tras": 0.9, "dano": None,
       "notas": ["The floor stalls and reattaches", ...],
   },
   ```

2. En una máquina con cairosvg (`pip install cairosvg`):

   ```bash
   python3 variantes_f1.py          # escribe los .svg
   python3 -c "import cairosvg, variantes_f1 as V
   for k in V.VARIANTES:
       cairosvg.svg2png(url=f'var_{k}.svg',
                        write_to=f'var_{k}.png', output_width=1080)"
   ```

3. Copia el PNG a `biblioteca/` con prefijo `g_` (el armador trata los
   `g_*` como GRÁFICO: pantalla completa, sin recorte, sin rótulo encima
   y sin zoom — que es lo que necesita un plano) y añade sus etiquetas a
   `biblioteca/biblioteca.json`.

## Cuidado con las etiquetas

Las etiquetas se cruzan con la consulta del short buscando **subcadenas**,
y eso muerde:

- No pongas `"formula 1 ..."`: la palabra *formula* está en casi todas las
  consultas del canal, y un short de motor acabaría con diagramas de
  aerodinámica.
- Ojo con las coincidencias accidentales: *carga* contiene **car**, y
  *following* contiene **wing**. Por eso los archivos van nombrados en
  inglés y la etiqueta es `chasing`, no `following`.

Tras cambiar etiquetas, comprueba con consultas reales de `_TEMAS_TECNICOS`
que cada lámina sale SOLO donde toca.

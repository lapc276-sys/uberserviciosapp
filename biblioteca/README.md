# Biblioteca multimedia curada

**Regla de oro del canal:** lo que apruebes aquí manda sobre cualquier
búsqueda automática. Los videos usan PRIMERO estas imágenes; solo lo que
falte se completa con Pexels/Wikimedia filtrado.

## Cómo usarla

1. Suelta aquí imágenes/diagramas aprobados (`.jpg`, `.png`, `.webp`).
   Solo material libre de derechos o propio.
2. Nómbralas con sus etiquetas separadas por guiones o guiones bajos —
   el nombre ES la etiqueta:

   - `aleron-delantero_front-wing_aerodynamics.jpg`
   - `pirelli_tyre_soft_closeup.png`
   - `pit-stop_crew_strategy.jpg`
   - `spa_circuit_aerial.jpg`

3. (Opcional) Para etiquetas más finas crea `biblioteca.json`:

   ```json
   {
     "aleron01.jpg": ["front wing", "aerodynamics", "downforce"],
     "graining.png": ["tyre", "graining", "wear"]
   }
   ```

Cuando un episodio habla de "front wing", el canal busca primero aquí
por coincidencia de palabras. Cuantas más imágenes apruebes, menos decide
la búsqueda automática — así se ve un canal profesional, no uno amateur.

## Clips de VIDEO (metraje en movimiento) 🎞️

También puedes soltar aquí **clips de video** (`.mp4`, `.mov`, `.webm`,
`.mpg`...) y el canal los intercala como tomas en movimiento entre las
fotos: los recorta al largo del plano, los silencia (la narración manda)
y arranca en un punto al azar para dar variedad. Mismas etiquetas por
nombre de archivo:

- `grand-prix_1950s_vintage_race.mp4`
- `pit-stop_historic_footage.mpg`

### De dónde sacarlos GRATIS y legales (archive.org)

1. Entra a **archive.org** → busca por ejemplo `Grand Prix racing`,
   `Indianapolis 500`, `auto racing newsreel`, `Monaco Grand Prix 1950s`.
2. En los filtros de la izquierda: **Media Type → Movies**, y colecciones
   seguras: **Prelinger Archives** y **Universal Newsreels** (dominio
   público).
3. Abre el item y REVISA la sección de licencia (columna derecha): debe
   decir **Public Domain** o **CC0**. Si no lo dice claro, no lo uses.
4. En "Download Options" elige **MPEG4** (o H.264) y descarga el archivo.
5. Renómbralo con etiquetas y súbelo a esta carpeta en Replit (arrastrar
   y soltar en el panel de archivos).

⚠️ OJO: NO todo lo de archive.org es libre — y el metraje MODERNO de F1
(era FOM, ~1981 en adelante) es propiedad de Formula One Management y
NUNCA se debe usar. Quédate con noticiarios y carreras antiguas marcadas
como dominio público: para documentales de historia son oro puro.

### Metraje de VIDEOJUEGO grabado por ti 🎮 (lo que hace Driver61)

Es la vía **más segura** para tener imagen de F1 moderna en movimiento, y
la que usan los canales técnicos grandes como relleno. La clave: tiene que
grabarlo **tú**. Descargar el gameplay de otro es usar SU material.

Por qué es legal cuando lo grabas tú: la mayoría de editoras publican una
política de video que permite subir y MONETIZAR gameplay propio. Búscala
como "«nombre del juego» video policy" y léela antes de grabar. Juegos
razonables para esto: los F1 oficiales de EA/Codemasters, Assetto Corsa,
rFactor, iRacing. Lo que NO cambia nada: si grabas una **retransmisión**
dentro del juego o metes música del juego con licencia de terceros.

Cómo grabarlo en tu Mac, sin instalar nada:

1. Abre el juego y ponlo en una repetición o en cámara TV.
2. `Cmd + Shift + 5` → **Grabar porción seleccionada** → encuadra el juego.
3. Graba **10-20 segundos** por toma. Cortas, muchas y variadas: una
   frenada, una curva de apoyo, un adelantamiento, una salida de boxes.
4. Para el vídeo. Se guarda en el Escritorio como `.mov`.
5. Renómbralo con etiquetas y súbelo a esta carpeta:

   - `braking_late_corner_gameplay.mov`
   - `overtake_drs_straight_gameplay.mov`
   - `pit-stop_entry_gameplay.mov`
   - `wet_race_spray_gameplay.mov`

Consejos para que se vea bien y no como relleno:

- **Sin HUD**: quita telemetría, mapa y marcadores en los ajustes del
  juego. Un HUD encima delata el videojuego y ensucia el plano.
- **Cámara TV o trasera**, no cabina: se lee mejor en vertical.
- **Grande y sin comprimir de más**: 1080p mínimo; el canal ya recorta a
  9:16 y silencia el audio (manda la narración).
- Con **15-20 clips** bien etiquetados ya tienes relleno para meses,
  porque el canal arranca cada toma en un punto al azar.

Etiqueta con el CONCEPTO, no con el juego: el canal cruza tus etiquetas
con lo que dice el guion, así que `braking` y `overtake` sirven; `f1-24`
o `gameplay-01` no le dicen nada.

## Fuentes de imágenes automáticas (además de la biblioteca)

El canal completa lo que falte buscando en fuentes de licencia libre y
uso comercial, en este orden: **biblioteca → Pexels → Openverse →
Flickr → Wikimedia**, y cada candidata pasa por el editor con visión.

- **Openverse**: gratis, sin configurar nada (ya activo).
- **Pexels**: opcional, Secret `PEXELS_API_KEY` (gratis en pexels.com/api).
- **Flickr**: opcional, Secret `FLICKR_API_KEY` (gratis en
  flickr.com/services/apps/create). Solo trae fotos con licencia
  Creative Commons de uso comercial.

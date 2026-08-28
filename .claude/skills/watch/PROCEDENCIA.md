# De dónde sale esta skill

No es nuestra. Es `claude-watch`, de Alex Larcheveque, con licencia MIT
(el texto completo está al lado, en `LICENSE`). Se copió aquí tal cual,
sin tocar una línea, desde:

    https://github.com/alexlarcheveque/claude-watch

Está dentro del repo a propósito y no instalada en la máquina: así toda
sesión que abra este proyecto la tiene, sin que nadie se acuerde de
instalar nada.

## Qué hace de verdad

Es la respuesta honesta a "que el asistente vea y oiga los videos". No
añade ningún sentido nuevo: lo que hace es convertir el video en cosas
que ya se pueden leer.

1. `yt-dlp` baja el video (o coge un archivo local).
2. `ffmpeg` lo corta en fotogramas y saca el audio.
3. Los subtítulos se cogen si el video los trae; si no, el audio se manda
   a transcribir a ElevenLabs Scribe o a Groq Whisper.
4. El asistente lee los fotogramas (que son imágenes, y las imágenes sí
   las ve) junto con la transcripción con sus tiempos.

O sea: ver = mirar fotogramas. Oír = leer una transcripción que ha hecho
otro servicio. No hay magia.

## Qué hace falta para que funcione

| Pieza | Para qué | Si falta |
|---|---|---|
| `yt-dlp` | bajar el video de una URL | solo sirven archivos locales |
| `ffmpeg` | fotogramas y audio | no funciona nada |
| `ELEVENLABS_API_KEY` o `GROQ_API_KEY` | transcribir cuando no hay subtítulos | se queda solo con los fotogramas |

En Replit el `ffmpeg` ya lo resuelve el propio proyecto
(`youtube_subir.asegurar_ffmpeg()` se baja un build estático la primera
vez). `yt-dlp` se instala con `pip install yt-dlp`.

## Lo que hay que tener en cuenta antes de usarla con material ajeno

Bajar y transcribir un video no es lo mismo que poder publicarlo. Para
lo NUESTRO —repasar los videos que monta el canal antes de subirlos— no
hay ningún problema. Para material de terceros sirve para estudiarlo,
no para reutilizarlo: la emisión de F1TV, los onboards y el audio de
equipo tienen dueño. Las declaraciones de una rueda de prensa oficial
son hechos y se pueden citar; el audio de la retransmisión, no.

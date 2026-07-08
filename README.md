# Captura F1TV: Mac → Replit

Dos piezas:

1. **`captura_mac.py`** — corre en la Mac. Captura la pantalla (la ventana
   con F1TV) a 1 fps y envía los frames JPEG por WebSocket al backend.
2. **`main.py`** — backend FastAPI (pensado para Replit). Recibe los frames
   en `wss://.../ws/frames`, muestra un visor web en `/` y, si hay
   `ANTHROPIC_API_KEY`, genera una narración corta en español con Claude
   cada 10 segundos y se la devuelve a la Mac.

## Telemetría (OpenF1)

Por defecto el backend descarga la telemetría de la **última carrera
disputada** desde https://openf1.org y la reproduce como si fuera en vivo
(modo replay). El narrador narra desde datos reales (adelantamientos,
boxes, banderas, vueltas rápidas) con memoria de lo que ya dijo; la visión
por frames queda como respaldo si la telemetría no está disponible.

Variables de entorno (Secrets en Replit, todas opcionales):

| Variable | Default | Qué hace |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Activa la narración con Claude |
| `OPENAI_API_KEY` | — | Voces naturales con OpenAI TTS |
| `ELEVENLABS_API_KEY` | — | Voces con ElevenLabs (prioridad sobre OpenAI) |
| `ELEVENLABS_VOZ_NARRADOR` | Adam | Voice ID de la Voice Library para Alex |
| `ELEVENLABS_VOZ_ANALISTA` | Daniel | Voice ID de la Voice Library para Sam |
| `IDIOMA` | `en` | Idioma del dúo (`es` disponible) |
| `MODO_TELEMETRIA` | `replay` | `off` para narrar solo por visión |
| `SESSION_KEY` | `latest` | Clave de sesión OpenF1 de una carrera concreta |
| `VELOCIDAD_REPLAY` | `1` | Ej. `10` reproduce la carrera 10 veces más rápido |

## Backend en Replit

1. Importa este repositorio en Replit (Create Repl → Import from GitHub).
2. Replit instala `requirements.txt` automáticamente; si no, ejecuta
   `pip install -r requirements.txt`.
3. (Opcional, para la narración) En **Secrets** añade `ANTHROPIC_API_KEY`
   con tu clave de https://platform.claude.com.
4. Pulsa **Run**. La URL pública del Repl es tu base: el WebSocket queda en
   `wss://TU-REPL.replit.app/ws/frames` y el visor en
   `https://TU-REPL.replit.app/`.

## Mac

1. `pip3 install mss pillow websockets`
2. Edita `REPLIT_WS_URL` en `captura_mac.py` con la URL real del paso anterior.
3. Primera vez: `python3 captura_mac.py --calibrar` para elegir la zona de
   pantalla (edita `ZONA` con el rectángulo del video). macOS pedirá permiso
   de **Grabación de pantalla** para Terminal.
4. Después: `python3 captura_mac.py`

Si los frames salen negros, F1TV está bloqueando la captura por DRM en ese
navegador: prueba Chrome con la aceleración por hardware desactivada
(chrome://settings/system) o Firefox.

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
| `NOMBRE_NARRADOR` / `NOMBRE_ANALISTA` | Alex / Sam | Nombres del dúo de la carrera |
| `NOMBRE_HISTORIA` / `NOMBRE_TECH` | Edmund / Julian | Presentador de cada programa (nombre en pantalla) |
| `ELEVENLABS_VOZ_HISTORIA` / `ELEVENLABS_VOZ_TECH` | George / Jude | Voz de cada presentador |
| `DURACION_EPISODIO_MIN` | `10` | Duración objetivo de cada episodio de Historia/Tech (varios capítulos que continúan la misma historia) |
| `YOUTUBE_API_KEY` | — | Clave de la YouTube Data API v3 (gratis en Google Cloud): activa el lector de chat del directo; el video se conecta desde `/panel` |
| `CHAT_INTERVALO` | `45` | Cada cuántos segundos se lee el chat (cuota gratis: ~20 h/día a 45s) |
| `CHAT_RESPUESTA_CADA` | `45` | Mínimo entre respuestas habladas del chat (controla el gasto) |
| `CALENDARIO_VOZ` | — | `on` narra en voz la próxima sesión cuando no hay carrera; por defecto queda en silencio (solo el tablero en pantalla) |
| `MODELO_VIVO` | `claude-opus-4-8` | Modelo del guionista en **carrera en vivo** (máxima calidad) |
| `MODELO_AHORRO` | `claude-haiku-4-5-20251001` | Modelo el **resto del tiempo** (~10x más barato). El canal cambia solo entre ambos |
| `MODELO_NARRADOR` | — | Si se define, **fuerza ese modelo siempre** y apaga el ahorro automático |
| `SOLO_SESIONES` | — | `on` = transmite **solo** en las sesiones reales (Libres 1/2/3, Clasificación, Sprint, Carrera) con previa y post; entre sesiones queda apagado **sin gastar en API** |
| `PRESHOW_MINUTOS` | `30` | Minutos de previa antes de cada sesión |
| `POSTSHOW_MINUTOS` | `20` | Minutos de post después de cada sesión |
| `MODO_TELEMETRIA` | `replay` | `off` para narrar solo por visión |
| `SESSION_KEY` | `latest` | Clave de sesión OpenF1 de una carrera concreta |
| `VELOCIDAD_REPLAY` | `1` | Ej. `10` reproduce la carrera 10 veces más rápido |
| `MUSICA_URL` | — | MP3 directo de música **libre/CC** para los interludios (sin URL, el interludio va en silencio) |
| `INTERLUDIO_MINUTOS` | `2` | Duración del interludio foto+música entre programas |
| `PROGRAMACION_AUTO` | `on` | Parrilla automática 24/7: rota documentales cuando no hay carrera |
| `DOCU_HORAS` | `4` | (Modo SOLO_SESIONES) Horas antes/después de cada sesión con documentales; fuera de esa ventana queda OFF AIR ($0). `0` = OFF AIR puro entre sesiones |
| `PLAYLIST` | `historia,interludio,tech,interludio` | Qué programas rotar |
| `ROTACION_MINUTOS` | `8` | Cuántos minutos dura cada programa |

## 🚀 Automatización y Caché (Eficiencia de Tokens)

### Parrilla Automática (24/7)
Por defecto ACTIVADA (`PROGRAMACION_AUTO=on`). El canal rota continuamente:
- **Entre sesiones**: historia → interludio → tech → interludio → dinero → ...
- **En sesión en vivo**: interrumpe rotación, transmite carrera
- **Después de carrera**: retoma rotación automáticamente

### Caché de Episodios (75-80% ahorro)
Los programas documentales se generan UNA SOLA VEZ y se reutilizan:
- Primera ejecución: Claude genera el episodio completo (~5-10 llamadas)
- Siguientes ejecuciones: Se carga del caché (~0 llamadas)
- **Resultado**: Después del primer episodio, cero costo en Claude para ese programa

### Caché de Audio TTS (80% ahorro)
El audio sintetizado se guarda por voz+texto:
- Primera línea: ElevenLabs/OpenAI genera MP3 (~$0.015)
- Segunda vez la misma línea: Se carga del caché (~$0)
- **Resultado**: Líneas repetidas no cuestan nada

### Shorts Automáticos (4 por día)
Genera guiones virales a las **6h, 12h, 18h y 23h UTC**:
- Noticias (6h, 18h) - "Verstappen breaks qualifying record!"
- Momentos dramáticos (12h, 23h) - "The most controversial overtake of the season"
- Scripts listos en JSON + audio MP3 para procesamiento

**Acceso a shorts**:
```bash
curl https://TU-REPL.replit.app/shorts              # Listar todos
curl https://TU-REPL.replit.app/shorts/{id}.json    # Descargar script
curl https://TU-REPL.replit.app/shorts/{id}.mp3     # Descargar audio
```

### Auto-conexión de Chat YouTube
Pega un link en el panel y se conecta automáticamente (sin hacer clic en botón).

### Procesar Shorts
```bash
python3 procesar_shorts.py           # Genera audio para todos
python3 procesar_shorts.py 20260715_1800  # Procesa uno específico
python3 procesar_shorts.py --listar  # Muestra lista
```

Ver [CACHING.md](CACHING.md) para detalles técnicos y estimación de ahorros.

### 📤 Subida automática a YouTube

El canal puede **armar un video vertical** (9:16) de cada short — voz + fotos
de libre uso de Wikimedia rotando como documental — y **subirlo solo** a
YouTube. Para subir video hace falta OAuth (una API key no basta) y `ffmpeg`
en el sistema. Si falta cualquiera de los dos, el canal sigue funcionando
normal y solo avisa en el log; no gasta nada.

**Configuración (una sola vez):**

1. En https://console.cloud.google.com activa **YouTube Data API v3** y crea
   un **ID de cliente OAuth de tipo "Aplicación de escritorio"**. Copia el
   Client ID y el Client Secret.
2. En una máquina con navegador (tu Mac):
   ```bash
   pip3 install google-auth-oauthlib google-api-python-client
   export YOUTUBE_CLIENT_ID="...apps.googleusercontent.com"
   export YOUTUBE_CLIENT_SECRET="..."
   python3 autorizar_youtube.py
   ```
   Acepta los permisos en el navegador; el script imprime tu
   `YOUTUBE_REFRESH_TOKEN`.
3. Guarda estos 3 Secrets en Replit (o variables de entorno):
   `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`.
4. Asegúrate de tener `ffmpeg` disponible (Replit lo trae; en Mac:
   `brew install ffmpeg`).

Variables opcionales:

| Variable | Default | Qué hace |
|---|---|---|
| `YOUTUBE_SUBIR_AUTO` | `on` | `off` desactiva la subida automática |
| `YOUTUBE_PRIVACIDAD` | `public` | `private`, `unlisted` o `public` |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` / `YOUTUBE_REFRESH_TOKEN` | — | Credenciales OAuth (obligatorias para subir) |
| `VOD_SESIONES` | `on` | Al terminar cada sesión en vivo sube un VOD 16:9 con NUESTRA narración (voz del dúo + fotos libres — sin video de F1TV). `off` lo apaga |
| `PANEL_CLAVE` | — | **Recomendado**: clave del panel. Con esto, los botones de control (cambiar show, OFF AIR, calidad, chat) y la generación de audio exigen la clave — sin ella, cualquiera con tu URL pública podría manejar el canal o gastarte créditos. El panel te la pide una sola vez |
| `YOUTUBE_CHANNEL_ID` | — | ID de tu canal (empieza con `UC...`, en YouTube → Configuración → Cuenta avanzada). Con esto el chat se conecta SOLO al detectar tu directo durante las sesiones — sin pegar URL en el panel |

Cada short subido queda marcado en su JSON con `youtube_id` y `youtube_url`,
así no se vuelve a subir. Si una subida falla, reintenta hasta 3 veces y luego
la deja. La cuota gratis de la API alcanza para ~6 subidas/día (el canal hace
4), así que no se agota.

> ⚠️ Ojo con el contenido: sube solo material propio (guion generado + voz
> sintética + fotos con licencia libre de Wikimedia Commons). No metas audio
> ni imágenes con copyright para evitar strikes en tu canal.

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

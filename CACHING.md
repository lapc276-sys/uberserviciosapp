# Sistema de Caché y Automatización

Este sistema reduce dramáticamente el gasto de tokens (Claude, ElevenLabs, OpenAI) mediante cacheing inteligente y automatización.

## 🎬 Episodios Documentales en Caché

### Cómo funciona
- **Primera ejecución**: Cuando se pone al aire un programa (historia, tech, dinero, etc), se genera el episodio COMPLETO (todos los capítulos) con Claude y se guarda en `episodes/`
- **Siguientes ejecuciones**: Se carga del caché. Sin llamadas a Claude. Costo: $0

### Estructura
```
episodes/
├── ep_abc123def456.json    # Historia: "Monaco's Greatest Moments"
├── ep_def456abc123.json    # Tech: "Ground Effect Explained"
└── ...
```

Cada archivo JSON contiene:
```json
{
  "tipo": "historia",
  "titulo": "Monaco's Greatest Moments",
  "capitulos": [
    {
      "tema": "Monaco 1992",
      "lineas": ["En 1992, Ayrton Senna...", "Hamilton había..."],
      "num_palabras": 245
    },
    {...capítulo 2...},
    {...capítulo 3...}
  ],
  "palabras": 2450
}
```

### Ahorro de tokens
- **Sin caché**: Cada programa regenera ~5-10 llamadas a Claude (por cada capítulo)
- **Con caché**: Primera vez ~5-10 llamadas, luego 0 llamadas
- **Resultado**: 10x más económico después del primer episodio

## 🎙️ Audio Sintetizado en Caché

### Cómo funciona
- **Primera línea**: Se sintetiza con ElevenLabs/OpenAI y se guarda en `cache/`
- **Segunda vez la misma línea**: Se carga del caché. Sin llamadas a TTS. Costo: $0

### Estructura
```
cache/
├── audio_abc123def456.mp3   # Hash("historiador|En 1992, Ayrton Senna...")
├── audio_def456abc123.mp3   # Hash("historiador|Hamilton había...")
└── ...
```

### Ahorro de tokens
- **Sin caché**: Cada línea cuesta 1 llamada a TTS (~$0.015 con ElevenLabs)
- **Con caché**: Líneas repetidas cuestan $0
- **Resultado**: Depende de cuántas líneas se repitan (10-90% de ahorro típico)

## 🚀 Automatización

### Parrilla Automática (PROGRAMACION_AUTO=on)
Por defecto ACTIVADA. Rota automáticamente los programas documentales:
1. Entre sesiones en vivo: historia → interludio → tech → interludio → dinero → ...
2. Cuando detecta sesión en vivo: interrumpe, transmite la carrera
3. Después de la carrera: retoma la rotación

**Configuración**: Secrets en Replit
- `PROGRAMACION_AUTO` = `on` (defecto) → rotación automática
- `PROGRAMACION_AUTO` = `` (vacío) → solo manual

### Conexión Automática de Chat de YouTube
Cuando pegas un link de YouTube en el panel ("Pega la URL..."), se conecta automáticamente.
Sin necesidad de hacer clic en botón.

### Generador de Shorts (4 por día)
Genera scripts virales automáticamente a las **6h, 12h, 18h y 23h UTC**:
- **6h y 18h**: Noticias cortas (~20-30 segundos)
- **12h y 23h**: Momentos dramáticos (~25-35 segundos)

**Estructura**:
```
shorts/
├── short_20260715_0600.json    # Noticia de la mañana
├── short_20260715_1200.json    # Drama del mediodía
└── ...
```

**Contenido de cada short**:
```json
{
  "id": "20260715_0600",
  "timestamp": "2026-07-15T06:00:00+00:00",
  "tipo": "noticia",
  "guion": "Verstappen just destroyed the qualifying record...",
  "duracion_segundos": 25,
  "audio_url": null
}
```

## 📹 API de Shorts

### Listar shorts
```bash
curl https://TU-REPL.replit.app/shorts
```
Respuesta:
```json
{
  "total": 28,
  "shorts": [
    {"id": "20260715_2300", "tipo": "drama", ...},
    {"id": "20260715_1800", "tipo": "noticia", ...},
    ...
  ]
}
```

### Descargar script de un short
```bash
curl https://TU-REPL.replit.app/shorts/20260715_0600.json
```

### Generar audio para un short
```bash
curl -X POST https://TU-REPL.replit.app/shorts/20260715_0600/audio
```
Esto sintetiza el guion con TTS y guarda el MP3. Respuesta:
```json
{
  "ok": true,
  "audio_url": "/shorts/20260715_0600.mp3"
}
```

### Descargar audio MP3
```bash
curl https://TU-REPL.replit.app/shorts/20260715_0600.mp3 > short.mp3
```

## 💰 Estimación de Ahorros

### Escenario típico: 24/7 broadcasting
- **Sin caché**: ~$100-150/día (regenerando todo)
- **Con caché**: ~$20-30/día (episodios cacheados, TTS reutilizado)
- **Ahorro**: 75-80% del costo

### Breakdown
| Componente | Sin caché | Con caché | Ahorro |
|---|---|---|---|
| Episodios documentales | $60-80 | $0-5 | 95% |
| TTS (ElevenLabs) | $30-50 | $5-10 | 80% |
| Narración en vivo | $10-20 | $10-20 | 0% |
| **Total** | **$100-150** | **$15-35** | **75-85%** |

## 🔧 Configuración

### Variables de entorno (Secrets en Replit)

| Variable | Default | Efecto |
|---|---|---|
| `PROGRAMACION_AUTO` | `on` | Activa parrilla automática (24/7) |
| `SOLO_SESIONES` | `` | Si está `on`, solo transmite en sesiones reales, apagado entre ellas |
| `PLAYLIST` | `historia,interludio,tech,interludio` | Qué programas rotar (separados por comas) |
| `ROTACION_MINUTOS` | `8` | Cuántos minutos dura cada programa antes de rotar |
| `DURACION_EPISODIO_MIN` | `10` | Duración objetivo de cada episodio documental (en minutos) |

### Limpiar caché (si necesitas regenerar)
```bash
rm -rf cache/ episodes/ shorts/
mkdir -p cache episodes shorts
```
Luego reinicia el servidor. Los episodios se regenerarán.

## 📊 Monitoreo

Ver logs del caché:
```bash
# Al reiniciar, verás:
# 📚 Episodio de historia cacheado: The Monaco Grand Prix (3 capitulos)
# 📹 Generador de shorts activado (4/día a horas [6, 12, 18, 23] UTC)
# 📹 Short guardado: 20260715_0600
```

## 🎯 Flujo típico

```
1. 06:00 UTC
   ├─ Genera short #1 (noticia)
   └─ Guarda en shorts/short_*.json

2. 12:00 UTC
   ├─ Genera short #2 (drama)
   └─ Puede procesarse con POST /shorts/{id}/audio

3. Entre sesiones en vivo
   ├─ Parrilla rota: historia (caché) → interludio → tech (caché) → ...
   └─ SIN gastar tokens (todo viene de caché)

4. Cuando hay carrera en vivo
   ├─ Pausa la rotación
   ├─ Transmite la carrera (narración en vivo, no cacheada)
   └─ Reanuda rotación después

5. 23:00 UTC
   ├─ Genera short #4 (drama)
   └─ Listo para procesar al día siguiente
```

## ⚙️ Tips de eficiencia

1. **Modelos baratos**: Los episodios documentales usan `MODELO_AHORRO` (Haiku, ~10x más barato que Opus). Solo en carreras en vivo se usa el modelo caro.

2. **YouTube API**: Solo gasta cuota si está conectado. El chat se lee cada ~45 segundos (configurable con `CHAT_INTERVALO`).

3. **Fuera de sesiones**: Con `SOLO_SESIONES=on`, el canal está COMPLETAMENTE APAGADO entre sesiones reales. Cero gasto en API.

4. **Shorts locales**: Los guiones de shorts se generan, pero subirlos a YouTube requiere configuración manual (no está automatizado aún, para evitar problemas de derechos de autor/contenido).

# Visión del proyecto — Comentaristas IA de F1 para YouTube

*Documento de referencia. Este es el plan acordado; los cambios de rumbo se
discuten y se actualizan aquí, no sobre la marcha.*

## El proyecto en una línea

> Dúo de comentaristas IA **en inglés** que narran carreras de F1 en YouTube
> usando **telemetría en vivo** como columna vertebral, "miran" el video de
> F1TV **solo en momentos clave** (sistema híbrido), **interactúan con el
> chat** de YouTube, y emiten **voz + gráficos propios** — cero video de F1
> en pantalla.

## Decisiones tomadas

| Tema | Decisión | Motivo |
|---|---|---|
| Fuente principal | Telemetría en vivo (OpenF1 / F1 Live Timing) | Gratis, sin copyright (son datos/hechos), barata de procesar |
| Video de F1TV | Solo como "ojos" internas por eventos gatillo | Nunca se emite; insumo privado como el monitor de un narrador humano |
| Estilo de narración | **Por eventos** + relleno inteligente en pausas (chat, estadísticas) | Más barato y suena más natural que hablar sin parar |
| Idioma | **Inglés** (español como posible 2.º canal futuro) | Audiencia ~20× mayor |
| Formato visual | Voz + torre de tiempos + gráficos propios + subtítulos | Legal y con contenido visual de sobra |
| Avatar | No por ahora (quizá VTuber 2D gratuito más adelante) | Caro (HeyGen/D-ID) y no esencial |
| IA narradora | API de Claude (Anthropic) | Decisión del propietario |
| Transparencia | Los comentaristas admiten abiertamente ser IA | Confianza + gancho de marketing |

## Personalidades del dúo

- **Narrador (play-by-play)**: energético, rápido, preciso con datos, sube la
  intensidad en adelantamientos e incidentes. Referencia: David Croft.
- **Analista (color commentator)**: calmado, humor seco, explica estrategia
  en simple, responde las preguntas del chat. Referencia: Martin Brundle.
- Química: se interrumpen, discrepan suavemente, se pasan la palabra.

## Arquitectura

```
Telemetría (OpenF1) ──────────┐
                              ▼
Mac (captura F1TV 1fps) ──► Backend Replit ──► texto del dúo + eventos
        buffer ~30s de frames │ (cerebro: Claude)
        usados SOLO por gatillo│
                              ▼
Chat de YouTube (API) ────────┘
                              ▼
                    TTS (voces en inglés)
                              ▼
              OBS en la Mac (escena: gráficos + subtítulos + audio)
                              ▼
                        YouTube Live
```

**Gatillos de visión** (cuándo se le muestran frames a Claude): bandera
amarilla/roja, colapso de intervalo (pelea), vuelta anormalmente lenta
(daño/pinchazo), mensaje de dirección de carrera con "incident", parada en
boxes inusual, o el chat preguntando qué pasó. ~20–50 análisis visuales por
carrera en vez de ~1.000 continuos.

## Fases

- **Fase 0 — HECHA**: captura de pantalla Mac → Replit → visor web en vivo.
- **Fase 1 — EN CURSO**: clave API de Claude → narración por visión cada 10s
  → voz local de la Mac (`say`). *Es el prototipo del "cerebro que habla";
  sirve para probar con YouTube como práctica.*
- **Fase 2**: conectar telemetría (OpenF1) → narración por eventos desde
  datos → la visión pasa a modo gatillo (híbrido).
- **Fase 3**: dúo de personalidades en inglés + TTS natural (OpenAI/Google
  TTS; ElevenLabs si se justifica).
- **Fase 4**: gráficos en vivo (torre de tiempos) + escena OBS + primera
  transmisión a YouTube Live.
- **Fase 5**: lectura del chat de YouTube (API oficial) con filtro de
  spam/moderación vía Claude.
- **Fase 6 — opcional**: avatar VTuber 2D gratuito, segundo canal en español,
  mejoras de producción.

## Costos estimados por transmisión de 3 horas (referencia jul 2026)

| Pieza | Opción | Costo aprox. |
|---|---|---|
| Cerebro (eventos, telemetría) | Claude | $1–3 |
| Visión por gatillos (~30 análisis) | Claude | $0.50–1 |
| Voz natural (2 voces) | OpenAI/Google TTS | ~$2 |
| Voz premium | ElevenLabs | $20–30 |
| Telemetría | OpenF1 | Gratis |
| OBS + YouTube Live | — | Gratis |
| **Total típico** | | **~$4–6 por carrera** |

## Norte a largo plazo: "Race Intelligence Engine"

La evolución natural del cerebro (fases 7+, solo cuando el canal funcione):
en lugar de un único razonador, un equipo de **agentes especialistas que
debaten entre sí** antes de que el dúo hable — Estratega (paradas, ataque),
Ingeniero de rendimiento (telemetría, pérdida de ritmo), Meteorólogo,
Analista de rivales e Historiador (carreras pasadas similares). El dúo de
comentaristas convierte ese debate en conversación natural.

Reglas para esa fase:
- El debate multi-agente se activa **solo en decisiones clave** (ventana de
  boxes, probabilidad de safety car, lluvia) — mismo principio de gatillos
  que la visión, para controlar costo.
- El valor diferencial no es "ser más listo que Red Bull", sino ser el
  **copiloto estratégico explicativo** accesible para aficionados, medios y
  equipos pequeños.
- La arquitectura (datos → agentes → debate → narración) es reutilizable en
  otros dominios (otros deportes, etc.) — pero solo se explora si el caso
  F1 funciona primero.

## Principios legales

1. **Nunca emitir video ni audio de F1/F1TV** en el canal.
2. Los datos y hechos (tiempos, posiciones) no tienen copyright; los gráficos
   son de producción propia, sin logos oficiales de F1.
3. Canal claramente marcado como **no oficial / fan-made**; cuidado con el
   uso de la marca "F1" en el nombre del canal.
4. La captura de F1TV es uso privado de una suscripción propia como insumo
   interno de los comentaristas.

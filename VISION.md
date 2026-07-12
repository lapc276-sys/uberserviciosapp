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

- **Narrador (play-by-play)**: emocional, rápido, apasionado, vive el
  momento, sube la intensidad en adelantamientos e incidentes. Referencia:
  David Croft.
- **Analista (color commentator)**: tranquilo, técnico, explica en simple,
  corrige cuando hace falta, humor seco, responde el chat. Referencia:
  Martin Brundle.

## Principios de la conversación (especificación del dúo)

1. **Un solo cerebro escribe el guion de ambas voces.** No son dos IAs
   respondiéndose por turnos (eso produce ping-pong rígido): cada segmento
   lo escribe Claude completo — interrupciones, desacuerdos, remates — y
   luego cada línea se lee con su voz. La química la garantiza el guionista.
2. **El analista es proactivo**: interrumpe ("espera... fíjate en el
   delta"), no espera su turno.
3. **Aportar, no describir**: el espectador ya ve la pantalla; el valor está
   en el contexto ("lleva ocho vueltas cuidando neumáticos", "Ferrari
   probablemente intenta un undercut").
4. **Discrepar**: opiniones distintas con argumentos ("yo entraría ahora" /
   "no lo tengo claro: un Safety Car le borra la ventaja").
5. **Nunca silencio**: en momentos tranquilos → historia del circuito,
   estrategias posibles, evolución de neumáticos, estadísticas,
   comparaciones con carreras pasadas, predicciones, chat.
6. **Interrupciones naturales**: A empieza → B interrumpe → A responde → B
   añade un dato → A retoma la narración.
7. **Memoria de carrera**: un diario acumulado (eventos + lo que ellos ya
   dijeron) entra en cada segmento, para poder decir "¿recuerdas cuando
   comentábamos que estaba cuidando gomas? Aquí está el resultado".

## Race Director AI (agente invisible)

Primera encarnación del Race Intelligence Engine: un agente que **no habla
al público** — convierte la telemetría en "notas del muro de boxes" que
recibe el dúo:

> "Probabilidad de Safety Car: 27%." · "Norris pierde 0.18s por vuelta en el
> sector 3." · "Neumático delantero izquierdo sobre 108 °C."

Los comentaristas deciden cuáles usar y cómo traducirlas al espectador. Esto
da la sensación de una producción con acceso a información estratégica real.

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
- **Fase 2 — HECHA**: telemetría OpenF1 con modo replay → narración por
  eventos desde datos reales, con memoria y relleno; visión de respaldo.
- **Fase 3 — HECHA (aprobada por el dueño)**: dúo en inglés con voces
  ElevenLabs (Jamie/Lucie) + sonido ambiente + tono según situación +
  silencios profesionales + memoria. Se sigue afinando con feedback.
- **Fase 4 — Broadcast Engine "Project Apex" (núcleo visual hecho)**:
  cabecera LIVE/vuelta/clima, leaderboard con color de equipo, gaps en
  vivo, animación de pelea y compuesto de neumático, diálogo como
  tarjetas, Race Control. Pendiente: escena OBS + primera emisión.
  No una simple torre de
  tiempos sino una identidad visual completa estilo "Bloomberg de la F1"
  (ver sección Project Apex) + escena OBS + primera emisión a YouTube.
- **Fase 4.5 — HECHA — Dirección automática**: la IA decide qué panel
  protagoniza la pantalla (rótulo + resalte con borde pulsante), por
  prioridad: bandera/incidente > pelea (por el liderato o por posición)
  > pit stop reciente > últimas vueltas > nada especial.
- **Fase 5 — EN CURSO — Race Intelligence explicable**: primera métrica
  hecha — **Battle Score** (0-100 por duelo entre posiciones
  consecutivas, cercanía + tendencia de cierre, con su razón siempre
  visible). Alimenta el director (Fase 4.5, elige la pelea de mayor
  score) y un panel propio en la pantalla. Puente honesto hacia el
  futuro "Battle Score" de la visión V3 (Unreal). Pendientes: más
  métricas (degradación de neumáticos, ventana de undercut).
- **Fase 6 — Chat de YouTube con filtro**: responder solo preguntas con
  valor (estrategia, conceptos, escenarios), nunca leer mensajes vacíos.
- **Fase 7 — opcional**: avatar VTuber 2D, segundo canal en español.
- **Fase 8 — EN CURSO — Canal Autónomo ("el director de orquesta")**: el
  canal se administra solo, sin que el dueño encienda ni apague nada.
  Componentes:
  1. **Calendario / Programador — HECHO (primera pieza)**: lee las
     próximas sesiones reales de OpenF1 (nunca inventa fechas); cuando
     no hay carrera en vivo, el leaderboard se convierte en "Upcoming
     Sessions" con horarios en 4 zonas horarias, y el dúo anuncia en voz
     el próximo fin de semana cada `ANUNCIO_SEGUNDOS` (comercial propio,
     con invitación natural a suscribirse). Pendiente: arrancar
     automáticamente la carga de la sesión correcta 30 min antes de que
     empiece (hoy sigue siendo "latest"/manual).
  2. **Estación siempre encendida**: el backend deja el modo "Repl con
     pestaña abierta" y pasa a un despliegue permanente (Replit
     Deployment / VPS, ~$10-20 USD/mes) con reinicio automático.
  3. **Emisión sin Mac**: el propio servidor renderiza la pantalla
     Project Apex y la envía a YouTube por RTMP (ffmpeg + navegador
     headless). La Mac deja de ser parte de la cadena.
  4. **Parrilla de contenido**: cuando no hay sesión en vivo —
     post-shows con análisis, repeticiones de carreras históricas
     (OpenF1 tiene temporadas completas: "Classic Races" narradas por el
     dúo — HECHO: maratón continuo), resumen de noticias F1 (con
     búsqueda web + fuentes citadas). Parrilla semanal propuesta:
     - **Lunes** — Debrief técnico/estratégico post-carrera.
     - **Miércoles** — Tech & Physics (educativo, evergreen).
     - **Viernes** — Previa + simulación del circuito.
     - **Sáb/Dom** — Transmisión en vivo / watch-along.
     Cada programa con su **modo visual** propio (ver Modos de programa).

  **Director de programación (HECHO, primera versión)**: UN solo
  servidor con varios programas dentro (no muchas pestañas/Repls — eso
  sería frágil y caro). Un bucle director rota los shows de una PLAYLIST
  automáticamente cada `ROTACION_MINUTOS`, sin intervención manual —
  exactamente "ya terminó esto, ahora toca aquello". Catálogo inicial:
  `historia` (F1 HISTORY) y `tech` (TECH & PHYSICS), cada uno con su
  guion y su fondo. Activar con `PROGRAMAS_AUTO=on`. Pendiente: que el
  director también intercale carreras en vivo/clásicas con los shows
  (hoy son ramas separadas), y que respete horarios de la parrilla
  semanal en vez de solo rotación por tiempo.

  **Modos de programa (motor de pantalla, primera pieza HECHA)**: la
  pantalla Apex no es un layout fijo — cambia según qué está al aire:
  - **Carrera**: leaderboard + Race Control + Race Intelligence (actual).
  - **Historia / educativo / previa**: oculta la telemetría, muestra
    fondo (gradiente propio o imagen libre/generada por IA — nunca fotos
    con copyright de F1), título del programa y el diálogo del dúo en
    grande.
  Todo con la misma identidad visual (fondo oscuro, acento rojo, Inter).
  5. **Operación sin manos**: vigilancia propia (si algo se cae, se
     reinicia y avisa al dueño por mensaje), límites de gasto diarios
     en las APIs.

  **Límite ético explícito**: nunca bots que se suscriban, den "me
  gusta" o comenten simulando ser espectadores reales — es manipulación
  de engagement y viola los Términos de Servicio de YouTube (riesgo real
  de cierre del canal). La promoción del canal es siempre: el dúo
  invitando en voz a los espectadores reales a suscribirse, nunca
  actividad automatizada haciéndose pasar por audiencia.

## Project Apex (identidad visual de la Fase 4)

- Paleta: fondo `#0B0D12`, paneles `#151922`, texto blanco/gris claro,
  acento rojo `#E10600`, verde esmeralda (positivo), ámbar (avisos).
- Tipografía: Inter / IBM Plex Sans. Minimalismo, mucho aire, animaciones
  suaves (flechas verde/rojo 2s al ganar/perder posición, sin excesos).
- Referencias: Bloomberg Terminal, Apple TV, Formula E, paneles de EQS /
  Taycan. Inspiración, nunca copia de F1 TV (propiedad intelectual).
- Paneles: cabecera LIVE + vuelta + clima · leaderboard con gaps ·
  Race Intelligence · incidentes · diálogo del dúo como tarjetas ·
  alertas discretas · minimapa de puntos.

## Métricas honestas (regla de oro de Race Intelligence)

1. **Ningún número inventado.** Cada métrica sale de datos reales, un
   modelo explicable, o no se muestra. Estimaciones etiquetadas como tal.
2. **Pocas y fiables antes que muchas y bonitas.** Primera tanda (todas
   calculables con OpenF1): degradación (tendencia de tiempos por vuelta),
   ventana de pits (tiempo de pit vs. tráfico), penalización por tráfico,
   presión (gap + DRS + ataques recientes).
3. **Siempre con el porqué**: "Strategy Advantage 84: +neumáticos 12
   vueltas más frescos, +aire limpio, −riesgo de lluvia en 15 min".
4. **Predicciones condicionadas**, no proféticas: "si no hay Safety Car
   en 10 vueltas, la estrategia de X termina delante con 81%".
5. **Familia de métricas propias** como identidad del canal (Race IQ,
   Attack/Defense Score, Overtake Window, Tyre Efficiency...) con
   metodología publicada — como el xG del fútbol.

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

## Norte de plataforma: Autonomous Media Platform

El activo no es el canal de F1 — es la **infraestructura capaz de operar
canales deportivos autónomos**. F1 en inglés es la primera aplicación.
Orden disciplinado: (1) F1 inglés totalmente automático → (2) español
reutilizando todo → (3) segundo deporte (ej. NFL) → (4) recién entonces,
plataforma donde añadir un deporte = configurar, no reescribir.

Principios de arquitectura (aplican desde hoy):
- **Adaptadores de datos por deporte** (`telemetria.py` es el de F1),
  independientes del cerebro narrador.
- **Biblioteca de personalidades**: las personas de los comentaristas son
  configuración por deporte/idioma, no código.
- **Supervisión por excepción**: el dueño define criterio y directrices;
  el sistema opera solo, alerta solo ante lo inusual, y entrega un
  reporte diario corto de lo publicado y su rendimiento.
- **Feedback loop (futuro)**: métricas de retención ajustan qué tipo de
  contenido se prioriza.

Reglas de plataforma YouTube (autenticidad):
- Marcar la divulgación de contenido generado por IA (transparencia; no
  penaliza el alcance).
- Evitar señales de fábrica: variar estructura y formatos; cada pieza
  responde "¿por qué esto es interesante hoy?".
- El valor humano = criterio editorial del dueño (personalidades, enfoque,
  identidad) ejecutado por el sistema.
- **Nunca** "transformar" visualmente contenido protegido para evadir
  detección — eso es evasión, no protección. Nuestra vía: cero video
  ajeno, gráficos propios desde datos.

Negocio más allá de AdSense (opciones futuras): plataforma web propia
(experiencia personalizada por idioma/zona/eventos en vivo), white-label
para ligas menores y clubes pequeños ("un comentarista profesional para
el equipo de tu ciudad"), y suscripciones.

## Ideas por construir (ordenadas, con honestidad técnica)

Pedidas por el dueño; anotadas para no perderlas y priorizar bien:

1. **Carreras por horario automático — HECHO (núcleo)**: la parrilla
   (`PROGRAMACION_AUTO=on`) sigue el calendario real de OpenF1 y pone
   cada sesión al aire a su hora (con pre-show `PRESHOW_MINUTOS` antes),
   y entre carreras rota los programas — un solo cerebro, sin tocar
   nada. Comparación en UTC → cambios de hora (DST) correctos solos.
   Verificado con pruebas de ventana y un dry-run carrera↔programas.
   Pendiente por validar en día de carrera real: que una sesión EN VIVO
   (no repetición) fluya bien (quizá haga falta un modo de sondeo en
   vivo, distinto al replay). Para otras series falta su fuente de
   horarios.
2. **Interludios foto + música** (foto del circuito de la semana con
   música de fondo entre programas, estilo Telemundo). Factible: fotos
   libres (Wikimedia) + música libre de derechos (no cualquier canción —
   solo librerías libres/CC).
3. **Más animaciones** en fondo y en el leaderboard. Factible (CSS/JS).
4. **Gráficos con nuestras fórmulas** (métricas propias sobre muchas
   carreras — degradación, etc.). Factible; es continuar la Fase 5.
5. **Periodista de campo** con ruido de pista de fondo. La voz sí; el
   "ruido ambiente real de esa pista" sería genérico (no audio con
   copyright de la transmisión). Factible como efecto.
6. **Noticias** citando fuentes (YouTube/Google News). Factible con
   búsqueda web **citando la fuente siempre**; ojo: se puede *resumir y
   citar*, no copiar textos completos ni leer video ajeno.
7. **Estadísticas de apuestas / cuotas**: técnicamente se pueden mostrar
   citando la casa. PERO ⚠️ **advertencia seria**: YouTube tiene reglas
   estrictas sobre contenido de apuestas (restricción de edad,
   desmonetización, o baneo si se promociona apuesta). No lo recomiendo
   como eje del canal; si se hace, con extremo cuidado y avisos. Los
   anuncios de casas de apuestas los pone YouTube, no nosotros, y solo
   si el canal está monetizado.

**Multi-deporte (NASCAR, MotoGP, Le Mans, motocross)**: los *programas
de charla* (historia, noticias, tech) sí aplican a cualquier serie. Los
*datos en vivo* (leaderboard/telemetría) necesitan una fuente por serie
como OpenF1 — investigación pendiente por deporte, no prometido.

**Monetización (AdSense)**: en un directo de YouTube los anuncios los
inserta YouTube automáticamente, no nosotros "cada 10 min a mano", y
solo tras cumplir requisitos del Programa de Socios (1.000 subs + 4.000
horas). Nuestra tarea es hacer buen contenido y crecer; la publicidad
llega después, sola.

## Norte V3 (muy largo plazo): producción cinematográfica con Unreal Engine

Visión recibida del dueño: un "Director AI" que no solo resalta paneles
(lo que ya hace la Fase 4.5) sino que controla cámaras virtuales y
reconstruye la carrera en 3D vía Unreal Engine — Battle Score numérico
por cada duelo, "Bubble Rendering" (solo se renderiza la zona de la
pelea más interesante, no el circuito completo), Mini Battle Window,
gráficos inteligentes disparados por tema de conversación, salida a OBS
por NDI.

**Realidad técnica que hay que tener clara antes de perseguir esto:**
- Unreal Engine requiere un editor gráfico con GPU potente, operado por
  un humano (o un desarrollador de Unreal) — está fuera de lo que un
  agente de código por terminal puede construir o probar directamente.
- La telemetría pública (OpenF1) da posiciones con mucha menor
  frecuencia y precisión que la necesaria para una reconstrucción
  cinematográfica fiel — sirve para un mapa de puntos simple, no (sin
  verificar primero) para el nivel de detalle de la imagen de
  referencia generada por IA.
- El propio documento de visión confirma el orden correcto: cerebro
  primero, Unreal después — coincide con nuestras fases 0-8.

**Puente honesto: el Battle Score se puede construir HOY, sin Unreal.**
Un número (no solo sí/no) que mida intensidad de cada pelea a partir de
datos reales (gap + velocidad de cierre) — mejora la Fase 4.5 (el
director elige la pelea de mayor score cuando hay varias a la vez) y es
la misma pieza que un futuro Director AI de Unreal reutilizaría para
decidir qué cámara seguir. Primer candidato de la Fase 5.

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

## Cola de pendientes (backlog acordado con el dueño)

Orden de prioridad, según lo hablado:

1. **Deploy 24/7 (Reserved VM en Replit)** — en pausa hasta poder pagar el
   plan (~$20/mes). Todo el código y `.replit` ya están listos; es solo
   darle a Deploy cuando se active Replit Core. Mientras tanto se corre en
   modo desarrollo desde el Shell (no es 24/7 real: el Repl se duerme).
2. **Streaming desde el servidor (cortar OBS)** — que el propio servidor
   empuje video+audio al RTMP de YouTube (navegador headless + ffmpeg), sin
   depender de OBS ni de la computadora del dueño. Es el último eslabón para
   ser 100% autónomo. Necesita clave de stream de YouTube. Va después del
   deploy.
3. ~~**Leer y responder el chat de YouTube en vivo**~~ — HECHO: el canal
   lee el chat del directo (YouTube Data API v3 con clave simple, sin
   OAuth) y el presentador al aire responde preguntas con su nombre.
   Falta solo el Secret `YOUTUBE_API_KEY` del dueño y conectar el video
   desde `/panel`. Los mensajes se tratan como datos no confiables
   (nunca como instrucciones) y se filtran enlaces/spam.
4. **Más métricas medidas** (regla de oro, sin inventar): ya hay degradación
   y pérdida de pit; faltan p. ej. ventana de undercut numérica y evolución
   de pista, solo si se pueden medir de OpenF1.
5. **Predicciones / comunidad / clústeres de circuitos** — solo cuando haya
   audiencia; predicciones con puntos falsos, nunca dinero (política de
   YouTube).

# Homigo — Documento de traspaso completo

**Repositorio:** `lapc276-sys/uberserviciosapp`
**Rama con el código:** `claude/home-services-automation-platform-tsr8rc`
**Último commit:** `5b7ad57` — *Supply planning: what to bring, what it costs, what not to mix* (29 jul 2026)
**Estado:** 17 commits, 137 archivos, Fases 1–5 completas + marketplace + IA de visión + agente de voz + piloto de campo.

> Este documento es autocontenido: describe el proyecto completo para que
> alguien (o algún modelo) que no tiene acceso al repositorio pueda entender
> qué se construyó, por qué, y qué falta.

---

## 1. Qué es el proyecto

**Homigo** es una plataforma de servicios para el hogar ("home services") con
foco inicial en **limpieza**, diseñada desde el día uno para escalar a pintura,
mudanzas, handyman, jardinería, lavado a presión y recolección de escombros
**sin reescribir el sistema**.

El objetivo declarado no es la tecnología, sino **clientes, reservas e ingresos**:
captar en Google, convertir en 60 segundos y operar la administración con IA.

El diferenciador central es la **IA de visión**: el cliente graba un recorrido
en video de 60 segundos con su teléfono y recibe un precio real, sin visita
presencial de inspección.

### Modelo de negocio

Marketplace, no empleador. Los profesionales ("pros") son contratistas
independientes que se postulan, eligen sus zonas de servicio y son **libres de
aceptar o rechazar cada trabajo**. Ese derecho a rechazar está modelado
explícitamente en el código (`JobOffer`), no implícito, porque es un factor
determinante en la clasificación laboral.

- Comisión de plataforma: el pro recibe **75 %** del valor del trabajo
  (`PRO_PAYOUT_SHARE = 0.75`), el resto es margen menos insumos.
- Tarifa laboral base: **55 USD/hora** antes de impuestos (`HOURLY_RATE_USD`).
- Mínimo por trabajo: **89 USD** (`MINIMUM_JOB_USD`), para cubrir traslado y montaje.

---

## 2. Stack técnico

| Capa | Tecnología |
|---|---|
| Framework | Next.js 15 (App Router, RSC) + React 19 |
| Lenguaje | TypeScript estricto |
| Estilos | TailwindCSS 3.4 (modo oscuro, diseño inspirado en Apple/Stripe/Linear) |
| Validación | Zod en cada frontera de API |
| Iconos | lucide-react |
| Base de datos | Prisma 6 + PostgreSQL (Supabase) |
| Auth | JWT con `jose` (edge-safe), hashing scrypt, RBAC |
| Pagos | Stripe (facturas + Connect Express para pagos a pros) |
| Email | Resend |
| SMS / Voz | Twilio |
| Mensajería | WhatsApp Cloud API, Messenger, Instagram DMs (Meta) |
| IA | Modelos multimodales vía OpenAI (`gpt-4o` para visión, `gpt-4o-mini` para texto) |
| Deploy | Vercel + Vercel Cron |

**Principio de diseño clave:** todas las integraciones están *env-gated*. La
plataforma corre completa **sin una sola clave de API** (modo demo/memoria) y
se va encendiendo a medida que se agregan variables de entorno. Esto permite
desarrollar y demostrar sin infraestructura.

---

## 3. Arquitectura: por qué escala sin reescribirse

Todo lo que da al cliente es **dirigido por configuración**. Los servicios, las
ciudades y las futuras líneas de negocio son *datos*, no código:

| Agregas esto… | …editando | Obtienes automáticamente |
|---|---|---|
| Un servicio | `lib/config/services.ts` | Página `/services/[slug]`, marcado schema.org, regla de precio, opción de reserva, conocimiento del chatbot, entrada en sitemap |
| Una ciudad | `lib/config/cities.ts` | Landing page SEO local en `/areas/[slug]` con schema LocalBusiness + Service |
| Una línea de negocio | `lib/config/verticals.ts` | Vertical pre-modelada lista para pasar de `soon` a `live` |

Actualmente hay **9 servicios** y **5 ciudades** configurados (incluida Nueva
York, con su configuración fiscal propia).

### Estructura de carpetas

```
app/
  (marketing)/          Sitio público: home, servicios, áreas, about, contacto,
                        carreras, blog, FAQ, legales, /quote/video, /pros/*
  admin/(dash)/         Panel: dashboard, bookings, customers, pros, marketing,
                        analytics, vision
  pilot/                App de captura en campo (standalone, phone-first)
  api/                  book, quote, chat, vision/analyze, voice/*, whatsapp,
                        meta/messenger, stripe/webhook, cron/*, pros/*, admin/*
components/
  layout/ ui/ booking/ chat/ seo/ analytics/ admin/ pros/ vision/ pilot/
lib/
  config/{site,services,cities,verticals}.ts   Fuente única de verdad
  vision/               El módulo de visión (ver §4)
  voice/                Agente telefónico
  marketing/            Atribución, promociones, campañas
  quote.ts              Motor de precios determinista
  assistant.ts          "Cerebro" compartido de todos los canales de IA
  dispatch.ts data.ts db.ts auth.ts pro-auth.ts stripe.ts email.ts sms.ts
prisma/schema.prisma    Modelo de datos
```

**Un detalle importante:** `lib/assistant.ts` es el mismo cerebro que responde
en el chat web, WhatsApp, Messenger, Instagram **y el teléfono**. Un precio
cotizado por voz coincide al dólar con el del sitio web (verificado:
$308–$393 en ambos canales). Los precios salen siempre de `calculateQuote()`,
nunca del modelo — un cliente no puede recibir un número inventado.

---

## 4. IA de visión — el corazón del producto

### El flujo

```
video → frames (en el navegador) → modelo de visión → habitaciones + objetos
      + puntajes de suciedad → modelo de tiempo → tamaño de cuadrilla + insumos
      → cotización con precio → reserva
```

### Archivos del módulo (`lib/vision/`)

| Archivo | Responsabilidad |
|---|---|
| `types.ts` | Modelo de dominio: tipos de habitación, dimensiones de suciedad, interfaz `VisionAnalyzer` |
| `frames.ts` | Extracción de fotogramas **en el navegador** |
| `analyzer.ts` | Backends de visión: prompt del sistema, parseo y validación de la respuesta |
| `model.ts` | **El modelo de tiempo** — constantes calibrables |
| `estimate.ts` | Convierte observaciones crudas en un plan costeado |
| `pricing.ts` | Precio, impuestos, banda de confianza, pago al pro, margen |
| `supplies.ts` | Planificación de insumos + incompatibilidades químicas |
| `quality.ts` | Evaluación antes/después de la calidad del trabajo |
| `training.ts` | Captura de datos de entrenamiento y reporte de error del modelo |
| `voice-commands.ts` | Corrección por voz manos libres (bilingüe) |

### Decisiones de diseño que hay que entender

**1. Los fotogramas se extraen en el navegador.**
El video nunca sale del dispositivo, no hace falta ffmpeg en un runtime
serverless, y la subida son ~8 JPEGs pequeños en lugar de cientos de megabytes.
Se muestrean 8 fotogramas, escalados a máximo 768 px por lado, calidad JPEG 0.72.

**2. El backend de visión es intercambiable.**
Todo depende de la interfaz `VisionAnalyzer`. Hoy corre un modelo multimodal
alojado (sin infraestructura de GPU, centavos por recorrido). Mañana un
servicio propio con YOLO/SAM/Grounding DINO puede implementar la misma interfaz
y entrar en `getAnalyzer()` sin tocar ni un solo llamador.

**3. El modelo NUNCA estima tiempo ni precio.**
Reporta lo que ve: habitaciones, objetos, suciedad de 0 a 100 en 7 dimensiones
(`dust`, `grease`, `stains`, `clutter`, `hair`, `trash`, `mold`). Los minutos y
los dólares se calculan **en código**, para que la aritmética sea auditable y
ajustable. Esta separación es deliberada: los modelos son buenos para "qué tan
sucio está esto" y malos para "cuántos minutos toma eso".

**4. La confianza ensancha la banda de precio.**
Un recorrido oscuro o borroso produce un rango más amplio y una advertencia
visible, en vez de un número seguro pero equivocado. Fórmula:
`spread = 0.08 + (1 - confianza) * 0.22`. Comercialmente esto importa: la
sorpresa en el precio al llegar es lo que destruye la confianza que hizo que el
cliente reservara desde un video.

**5. Sin clave de API el flujo sigue funcionando**, en modo demo, etiquetado
como tal para que nunca se confunda con una inspección real.

### El modelo de tiempo (`model.ts`) — y su gran advertencia

Minutos base por habitación en condición estándar:

```
cocina 30 · baño 22 · dormitorio 15 · sala 20 · comedor 14 · oficina 14
lavandería 10 · garaje 18 · escaleras 8 · pasillo 6 · patio 15 · otro 12
```

Los pesos de suciedad son **por tipo de habitación**, porque una cocina grasosa
cuesta mucho más tiempo que un dormitorio grasoso, y el moho en un baño es el
caso caro. Por ejemplo, a puntaje 100: cocina/grasa = +26 min,
baño/moho = +24 min, garaje/desorden = +22 min.

Los objetos suman tiempo fijo (horno 14 min, refrigerador 12, bañera 10,
inodoro 6…), **descontado por la confianza de detección**, para que una
detección dudosa no infle la cuenta.

> ⚠️ **ADVERTENCIA CENTRAL, y la más importante de todo el documento:**
> el modelo de tiempo es una **hipótesis hasta que se calibre**. Ningún modelo
> sabe que una cocina grasosa toma 52 minutos. `ROOM_BASE_MINUTES` y los pesos
> de suciedad son estimaciones iniciales. Los pros deben registrar
> `actualMinutes` en los trabajos completados; `/admin/vision` reporta entonces
> sesgo, error absoluto medio y tasa de acierto, para poder ajustar las
> constantes por mercado. **Hasta que esa página muestre datos reales de
> precisión, toda cotización es provisional.**

### Planificación de insumos (`supplies.ts`) — lo más reciente

Deriva de los hallazgos qué llevar al trabajo, cuánto cuesta, y **qué nunca
mezclar**.

- Usa **tipos genéricos de producto, nunca marcas**. Las marcas cambian por
  país y nombrar una es un aval que no se puede sostener en una plataforma que
  se vende a empresas de limpieza en cualquier parte del mundo.
- Modela **peligros químicos** (`bleach`, `ammonia`, `acid`, `caustic`,
  `solvent`). Cloro con amoníaco produce gas cloramina; cloro con ácido produce
  cloro gaseoso. Ambos mandan gente a urgencias, y ambos son fáciles de causar
  limpiando una ducha con un producto y el vidrio con otro.
- Los costos reflejan **cómo compra de verdad una empresa de limpieza**:
  concentrado por galón, diluido en sitio, paños de microfibra que se lavan y
  reutilizan. Una botella de retail por trabajo pondría los consumibles cerca de
  $100 por visita, cuando la realidad son cifras de un solo dígito o decenas
  bajas. Equivocarse aquí no solo malcalcula insumos: convierte la cifra de
  margen en una mentira.
- Solo los **consumibles** cuentan contra el margen. Las herramientas
  reutilizables son capital, no costo por trabajo.

### Evaluación de calidad (`quality.ts`)

Compara los análisis de antes y después para convertir "el trabajo está hecho"
en una afirmación medible: cuánto bajó cada dimensión de suciedad y qué quedó
sucio. Sirve a tres propósitos a la vez: prueba para el cliente, control de
calidad automatizado para la plataforma, y otro dato etiquetado para el modelo.

Mide **mejora, no estado final**: la cocina de un acumulador llevada de 90 a 25
es trabajo excelente, mientras que un departamento ordenado dejado en 25 no lo es.

### Captura de datos de entrenamiento (`training.ts` + `/pilot`)

Aquí está la parte estratégicamente más valiosa del proyecto.

Una muestra solo sirve si contiene una **corrección**: lo que dijo el modelo y
lo que dijo la persona parada en la habitación. Guardar predicciones solas no
enseña nada. El activo no es el metraje — es el **par** (predicción, corrección)
más cuánto tomó realmente el trabajo. Ese par es lo único que mejora el modelo,
y no se puede comprar ni scrapear.

Además se captura **contexto del operador**, que es la varianza que la visión
pura nunca podrá explicar:

- `jobSequence` — 1 = primer trabajo del día de esa persona, 2 = segundo…
- `hoursWorkedToday` — horas ya trabajadas antes de empezar
- `crewSize` — personas en el trabajo (`actualMinutes` son persona-minutos)
- `startHour` — hora local de inicio

El mismo baño con el mismo nivel de suciedad no es el mismo trabajo a las 9am
que en la cuarta parada del día de alguien.

**El consentimiento es obligatorio, no decorativo:** metraje del hogar de
alguien sin permiso registrado es un pasivo, nunca un activo. Los campos
`consentName`, `consentAt` y `consentTraining` son parte del modelo.

### Corrección por voz (`voice-commands.ts`)

Los limpiadores están con guantes y las manos mojadas — tocar una pantalla a
mitad del trabajo es la peor interacción posible. Decir "grasa ochenta" no es un
adorno: es la diferencia entre que el dato se capture o no.

Es **bilingüe por necesidad**: la gente que hace este trabajo en Estados Unidos
habla español, inglés, o ambos en la misma oración. El parser normaliza acentos
("baño" y "bano"), entiende números escritos en ambos idiomas
(`ochenta`/`eighty`), y soporta comandos `set`, `clearRoom`, `next`, `prev`,
`remove`, `done`.

---

## 5. Otros módulos construidos

### Agente de voz telefónico (`lib/voice/`)

Contesta llamadas en el número de Twilio y conduce la conversación:
calificar → cotizar → enviar por SMS un enlace de reserva → transferir a un
humano si lo piden.

- Corre sobre el **mismo cerebro** que el chat web y WhatsApp.
- El habla se reescribe para síntesis (`speakable()`): los montos se dicen como
  dólares, las URLs se envían por texto en vez de leerse en voz alta.
- Se **verifican las firmas de Twilio** (403 sin una válida), así que conocer la
  URL del webhook no le permite a nadie manejar tu agente telefónico.
- Los turnos ininteligibles reintentan dos veces y luego salen con gracia
  mandando el enlace por SMS. Toda llamada se captura como lead, incluidas las
  que cuelgan antes de cotizar.

> **Sobre "completamente natural":** esto usa reconocimiento de voz de Twilio
> más una voz TTS neural — es un agente **por turnos**, así que hay una pausa
> entre que el llamante termina y llega la respuesta. La conversación real
> interrumpible necesita un modelo de voz en streaming sobre un WebSocket
> persistente, que no encaja en serverless. El agente por turnos hace bien el
> trabajo de calificar y cotizar; el streaming es una mejora futura, no una
> funcionalidad faltante.

### Marketplace y pagos a pros

- Ciclo `Pro`: postulación → aprobación → activo, con zonas de servicio y rating.
- Despacho: la reserva se ofrece a los **3 mejores pros aprobados** que cubren
  esa ciudad (menor carga esa fecha primero, luego rating). El primero en
  aceptar se la lleva; el resto expira. Reclamo condicional a prueba de
  carreras; los perdedores reciben un 409 claro.
- Ingreso sin contraseña por **magic link** (`/pros/login`), cookie y audiencia
  JWT separadas del admin para que un token nunca cruce superficies. Enlaces de
  un solo uso (`UsedToken`), expiran en 15 minutos.
- La dirección y el contacto del cliente aparecen **solo después de reclamar**.
- **Stripe Connect Express** para onboarding: Stripe guarda los datos bancarios
  y fiscales, no nosotros. Los pagos se emiten al completar el trabajo, una sola
  vez por reserva (restricción única + clave de idempotencia derivada del ref).

### Automatización de marketing

- **Atribución de primer toque**: UTMs, `gclid`/`fbclid` e inferencia de
  referrer capturados en el middleware y arrastrados hasta la reserva.
  `/admin/marketing` reporta reservas, valor reservado y **CAC máximo** por
  canal — el número que dice si una campaña se paga sola.
- **Códigos promocionales**: porcentaje o monto fijo, con reglas de servicio,
  ciudad, gasto mínimo y primera compra. Se revalidan en el servidor en cada
  reserva, así que un código escrito en el formulario nunca obtiene el descuento
  que dice tener.
- **Campañas de ciclo de vida**: los clientes se auto-segmentan en
  inactivo / una vez / leal / alto valor según su historial. Corren semanalmente
  por cron, respetan la lista de exclusión y cada envío lleva el pie de página
  CAN-SPAM. `?dryRun=1` reporta a quién *se le enviaría* antes de enviar nada.

### Pagos, mensajería y operaciones

- Stripe: factura alojada por reserva, webhook que verifica firmas y reconcilia.
- Resend: emails HTML de confirmación, recordatorio y solicitud de reseña.
- Twilio SMS: confirmaciones y recordatorios.
- Cron horario: recordatorios a 24 h y 2 h, solicitud de reseña post-servicio y
  recuperación a una semana (15 % de descuento), cada uno protegido por una
  bandera por reserva para que dispare exactamente una vez.
- Panel admin con RBAC (ADMIN / DISPATCHER / STAFF): reservas, clientes con
  valor de vida, roster de pros, analytics con embudo de conversión, tendencia
  de demanda a 14 días y valor por servicio/ciudad (sin dependencias de gráficos,
  renderizado en servidor).

---

## 6. Modelo de datos (Prisma)

Modelos principales: `User`, `Customer`, `Address`, `Pro`, `JobOffer`,
`Booking`, `Photo`, `Invoice`, `Review`, `VisionAnalysis`, `Payout`,
`TrainingSample`, `UsedToken`, `OptOut`, `Lead`.

`Booking` es el centro: lleva `ref` legible (`HMG-8F2A`), `vertical`
(por defecto `cleaning`, de ahí la escalabilidad multi-vertical), datos del
servicio, `quoteLow`/`quoteHigh`, `actualMinutes` (la verdad de campo), UTMs,
promo, y banderas de idempotencia (`reviewRequestSent`, `followUpSent`).

**Capa de persistencia con doble backend** (`lib/data.ts`): usa Prisma cuando
`DATABASE_URL` está definida, y memoria si no. La app corre con cero
infraestructura.

---

## 7. Cómo correrlo

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # build de producción (35 páginas estáticas/SSG)
npm run typecheck
```

No se requiere **ninguna** variable de entorno para desarrollo. Para activar
persistencia y login de admin:

```bash
openssl rand -base64 32   # valor para AUTH_SECRET
npm run db:push           # crea las tablas desde el schema de Prisma
npm run db:seed           # opcional: usuario admin + datos de ejemplo
```

Variables de entorno principales: `OPENAI_API_KEY`, `OPENAI_VISION_MODEL`,
`DATABASE_URL`, `AUTH_SECRET`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`,
`STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `TWILIO_*`, `WHATSAPP_*`, `META_*`,
`CRON_SECRET`. El archivo `.env.example` las documenta todas.

`SETUP.md` (en español) es la guía paso a paso de cero a negocio cobrando:
Vercel → Supabase → Stripe → Resend → Twilio → WhatsApp → OpenAI → GA4/Pixel.

---

## 8. Qué falta / hacia dónde va

### Lo urgente (bloquea confiar en el producto)

1. **Calibrar el modelo de tiempo.** Es *el* trabajo pendiente. Hasta tener
   decenas de pares predicción/realidad de trabajos reales, las cotizaciones
   son provisionales. El piloto de campo (`/pilot`) existe exactamente para
   esto.
2. Validar los costos de insumos contra facturas reales de compra.
3. Verificar la configuración fiscal por mercado (`lib/config/cities.ts` lleva
   tasas publicadas — cambian).

### Fases planificadas

- **Fase 6 — Voz y canales:** Google Business (reseñas, respuestas automáticas,
  posts, Q&A), automatización de Facebook/Instagram. *(La parte de voz y
  Messenger ya está hecha.)*
- **Fase 7 — Crecimiento:** Google/Facebook/Instagram Ads + remarketing, sistema
  de landing pages, SEO programático de cada servicio × ciudad.
- **Fase 8 — Multi-vertical:** pasar pintura / mudanzas / handyman / jardinería /
  lavado a presión / recolección a `live`. El sitio, el SEO, la reserva y el CRM
  ya los soportan por diseño.

### Pendientes menores

Portal de cliente, migraciones de BD en CI, blog con MDX/CMS, suscripciones de
cobro recurrente, sincronización con Google Calendar, subida de fotos
(Supabase Storage), emparejamiento geo-consciente, cola de trabajos con Redis,
vista de calendario y mapa de servicio, entrada de gasto publicitario para
CAC/ROI real.

---

## 9. Advertencias legales y de riesgo

> ⚠️ **Clasificación laboral, licencias, seguros e impuesto a las ventas varían
> por estado y ciudad.** Nueva York en particular aplica pruebas estrictas de
> contratista. Confirmar la estructura con un abogado laboral y un contador
> antes de lanzar un mercado.

- El consentimiento grabado es obligatorio para toda captura en hogares.
- Las cotizaciones por visión son provisionales hasta la calibración.
- Los datos de entrenamiento contienen imágenes de propiedades privadas: tratar
  como información sensible.

---

## 10. Nota sobre el estado del repositorio

El repositorio tiene tres ramas:

- **`claude/home-services-automation-platform-tsr8rc`** — todo el proyecto real
  descrito arriba. Es la rama que importa.
- `claude/cleaners-app-vision-iyqbb5` — rama de documentación (contiene este
  archivo). Su `docs/VISION.md` fue escrito bajo el supuesto equivocado de que
  "visión" se refería a *visión de producto* y no a *visión artificial*;
  conviene descartarlo o reescribirlo.
- `claude/mac-screen-capture-f1tv-qwevlg` — rama no relacionada.

Existe además un proyecto separado en Replit llamado **Kitchen-Analysis**
(escaneo 360° de cocinas con IA) que aún no está sincronizado con GitHub.
Su relación con Homigo está por definirse: podría ser el precursor del módulo
de visión o una línea aparte.

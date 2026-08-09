# 🚀 Guía de puesta en marcha — Homigo

Esta guía te lleva de cero a un negocio **en vivo y cobrando**, paso a paso.
Cada pieza se activa sola al pegar su variable de entorno en Vercel — no hay que tocar código.

> **Regla de oro:** haz los pasos en orden. Los pasos 1–4 son el mínimo para operar y cobrar.
> Todo lo demás se puede sumar después sin prisa.

---

## Paso 1 — Vercel (hosting) · Gratis · ~10 min

1. Entra a **[vercel.com](https://vercel.com)** → **Sign Up** → elige **Continue with GitHub** (usa la cuenta dueña de este repo).
2. Clic en **Add New… → Project**.
3. Busca el repo **`uberserviciosapp`** → **Import**.
4. En *Configure Project* no cambies nada (Vercel detecta Next.js solo) → **Deploy**.
5. En ~2 minutos tendrás una URL tipo `https://uberserviciosapp.vercel.app`. **Guárdala.**

✅ **Resultado:** el sitio completo en vivo (páginas, SEO, cotizador, reservas en memoria, chatbot con reglas).

---

## Paso 2 — Supabase (base de datos) · Gratis · ~10 min

1. Entra a **[supabase.com](https://supabase.com)** → **Start your project** → inicia sesión con GitHub.
2. **New project** → nombre: `homigo` → elige una contraseña de base de datos **y guárdala** → región: *East US (North Virginia)* → **Create**.
3. Cuando termine de crear: **Project Settings (engrane) → Database → Connection string → URI**.
4. Copia la cadena (empieza con `postgresql://…`) y reemplaza `[YOUR-PASSWORD]` por tu contraseña.
5. En **Vercel → tu proyecto → Settings → Environment Variables** añade:
   - `DATABASE_URL` = esa cadena
6. En tu computadora (o en la terminal de Vercel), corre una vez:
   ```bash
   npm install
   DATABASE_URL="postgresql://..." npm run db:push   # crea las tablas
   DATABASE_URL="postgresql://..." npm run db:seed   # admin + datos de ejemplo (opcional)
   ```
7. En Vercel: **Deployments → ⋯ → Redeploy**.

✅ **Resultado:** reservas, clientes y leads se guardan de verdad.

---

## Paso 3 — Acceso al panel admin · Gratis · ~5 min

1. Genera un secreto (en cualquier terminal):
   ```bash
   openssl rand -base64 32
   ```
   (o usa un generador de contraseñas largo).
2. En **Vercel → Environment Variables** añade:
   - `AUTH_SECRET` = el secreto generado
   - `ADMIN_EMAIL` = tu email (ej. `lapc9801@gmail.com`)
   - `ADMIN_PASSWORD` = una contraseña fuerte que tú elijas
3. Redeploy.

✅ **Resultado:** entra a `https://TU-URL/admin/login` con ese email y contraseña. Panel protegido con roles.

---

## Paso 4 — Stripe (cobrar dinero) · Gratis abrir · ~20 min

1. Entra a **[stripe.com](https://stripe.com)** → **Start now** → crea la cuenta con tu email.
2. Completa el registro del negocio (nombre legal, dirección, cuenta bancaria donde recibirás el dinero). *Puedes empezar en modo test y activar después.*
3. **Developers → API keys** → copia la **Secret key** (`sk_live_…` o `sk_test_…`).
4. **Developers → Webhooks → Add endpoint**:
   - URL: `https://TU-URL/api/stripe/webhook`
   - Eventos: `invoice.paid` y `invoice.payment_succeeded`
   - Copia el **Signing secret** (`whsec_…`).
5. En **Vercel → Environment Variables**:
   - `STRIPE_SECRET_KEY` = `sk_…`
   - `STRIPE_WEBHOOK_SECRET` = `whsec_…`
6. Redeploy.

✅ **Resultado:** cada reserva genera una **factura de Stripe** automática; al pagarse se marca PAID en tu panel.

### 4b. Activar pagos a los pros (Stripe Connect)

Para que la plataforma **le pague a los limpiadores** automáticamente:

1. En Stripe: **Connect → Get started** → elige **Platform or marketplace**.
2. Completa el perfil de la plataforma (nombre, sitio web, descripción del negocio).
3. Activa el tipo de cuenta **Express** — Stripe se encarga de verificar identidad, datos bancarios y de emitir los **1099** de tus pros, que es justo lo que no quieres manejar tú.
4. No hace falta ninguna variable extra: usa la misma `STRIPE_SECRET_KEY`.

Después, cada pro entra a `tudominio.com/pros/payouts` y completa su registro en ~3 minutos. Cuando marcas un trabajo como **COMPLETED**, el pago se transfiere solo.

> Si Connect no está activo, la plataforma sigue funcionando: las ganancias quedan registradas como *pendientes* y el pro ve un aviso claro de que falta configurar sus datos bancarios.

> 💰 Con los pasos 1–4 el negocio ya **recibe reservas y cobra**. Lo que sigue es crecimiento.

---

## Paso 5 — Dominio propio · ~$12/año · ~15 min

1. Compra el dominio en **[namecheap.com](https://namecheap.com)** o **[cloudflare.com](https://cloudflare.com)** (ej. `homigoservices.com`).
2. En **Vercel → Settings → Domains → Add** → escribe tu dominio → sigue las instrucciones (Vercel te da 2 registros DNS para copiar en Namecheap/Cloudflare).
3. En **Environment Variables**: `NEXT_PUBLIC_SITE_URL` = `https://tudominio.com` → Redeploy.

✅ **Resultado:** URL profesional + SEO apuntando al dominio correcto.

---

## Paso 6 — Resend (emails automáticos) · Gratis hasta 3,000/mes · ~15 min

1. Entra a **[resend.com](https://resend.com)** → **Sign up**.
2. **Domains → Add Domain** → tu dominio → añade los registros DNS que te indica (en Namecheap/Cloudflare).
3. **API Keys → Create API Key** → copia la key (`re_…`).
4. En Vercel:
   - `RESEND_API_KEY` = `re_…`
   - `RESEND_FROM` = `Homigo <hello@tudominio.com>`
5. Redeploy.

✅ **Resultado:** confirmaciones, recordatorios 24h/2h, solicitudes de reseña y win-back **por email, solos**.

---

## Paso 7 — Twilio (SMS) · ~$1/mes + ~1¢ por SMS · ~20 min

1. Entra a **[twilio.com](https://twilio.com)** → crea cuenta → verifica tu teléfono.
2. **Phone Numbers → Buy a Number** → compra un número de EE. UU. con SMS.
3. En la **Console** copia: `Account SID` y `Auth Token`.
4. En Vercel:
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` (formato `+1XXXXXXXXXX`)
5. Redeploy.

✅ **Resultado:** SMS de confirmación y recordatorios + notificación al pro asignado.

### 7b. Activar el agente de voz IA

Para que la IA **conteste el teléfono**:

1. En Twilio: **Phone Numbers → Manage → Active numbers** → clic en tu número.
2. En **Voice & Fax → A call comes in**: elige **Webhook**, pega `https://TU-URL/api/voice/incoming`, método **HTTP POST**.
3. En **Call status changes**: pega `https://TU-URL/api/voice/status`, método **HTTP POST**.
4. **Save.**

Opcional en Vercel:
- `VOICE_TRANSFER_NUMBER` = tu celular, para cuando el cliente pida hablar con una persona.
- `TWILIO_VOICE` = otra voz de la lista de Twilio (por defecto `Polly.Joanna-Neural`).

✅ **Resultado:** llama a tu número y la IA contesta, califica, cotiza con tus precios reales y te manda por SMS el link para reservar.

> ⚠️ Para volumen en EE. UU. te pedirán registro **A2P 10DLC** (Twilio te guía; tarda unos días). Empieza igual — los primeros SMS salen.

---

## Paso 8 — WhatsApp Business (Meta) · Gratis abrir · ~45 min

1. Entra a **[business.facebook.com](https://business.facebook.com)** → crea tu **portafolio de negocio**.
2. Ve a **[developers.facebook.com](https://developers.facebook.com)** → **My Apps → Create App** → tipo **Business**.
3. En la app: **Add Product → WhatsApp → Set up**. Meta te da un **número de prueba** gratis para empezar.
4. En **WhatsApp → API Setup** copia:
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - **Access token** (crea uno permanente en *Business Settings → System Users*) → `WHATSAPP_ACCESS_TOKEN`
5. Inventa un texto secreto (ej. `homigo-verify-2026`) → `WHATSAPP_VERIFY_TOKEN`.
6. En **App Settings → Basic** copia el **App Secret** → `WHATSAPP_APP_SECRET`.
7. Pega esas 4 variables en Vercel → Redeploy.
8. De vuelta en Meta: **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL: `https://TU-URL/api/whatsapp`
   - Verify token: el mismo que inventaste
   - **Verify and save** → suscríbete al campo **messages**.

✅ **Resultado:** tu agente IA contesta WhatsApp con tus precios reales y guarda cada chat como lead.

---

## Paso 9 — OpenAI (IA conversacional avanzada) · centavos por chat · ~5 min

1. Entra a **[platform.openai.com](https://platform.openai.com)** → crea cuenta → **Billing** → añade $5–10 de crédito.
2. **API Keys → Create new secret key** → copia (`sk-…`).
3. En Vercel: `OPENAI_API_KEY` = `sk-…` → Redeploy.

✅ **Resultado:** el chatbot y WhatsApp pasan de "reglas" a conversación natural completa. *(Sin esta key igual funcionan con el motor de reglas.)*

---

## Paso 10 — Marketing y medición · Gratis · ~30 min

**Google Business Profile** (clave para SEO local):
1. **[business.google.com](https://business.google.com)** → crea el perfil con el nombre, teléfono y área de servicio.
2. Verifica el negocio (Google te envía código).
3. Pon la URL de tu sitio → empiezan a llegar clientes de Google Maps.

**Google Analytics 4:**
1. **[analytics.google.com](https://analytics.google.com)** → crea propiedad → copia el ID `G-XXXXXXX`.
2. En Vercel: `NEXT_PUBLIC_GA_ID` = `G-XXXXXXX`.

**Messenger + Instagram DM automáticos** (opcional):
1. En la misma app de Meta que creaste para WhatsApp: **Add Product → Messenger → Settings**.
2. Conecta tu página de Facebook y genera un **Page Access Token** → `META_PAGE_TOKEN`.
3. Inventa un texto secreto → `META_VERIFY_TOKEN`. Copia el **App Secret** → `META_APP_SECRET`.
4. En **Webhooks**: URL `https://TU-URL/api/meta/messenger`, pega el verify token, suscríbete a **messages**.
5. Para Instagram: conecta tu cuenta profesional de IG a la página y repite la suscripción.

**Etiquetar tus anuncios** (importante para saber qué funciona):
Cuando pongas anuncios, agrega parámetros UTM al link de destino. Ejemplo:
`https://tudominio.com/?utm_source=google&utm_medium=cpc&utm_campaign=nyc-deep-clean`
El panel **Marketing** te dirá cuántas reservas y cuánto dinero trajo cada canal, y el **CAC máximo** que puedes pagar por reserva.

**Meta Pixel** (para anuncios de Facebook/Instagram después):
1. **Events Manager** en business.facebook.com → crea Pixel → copia el ID numérico.
2. En Vercel: `NEXT_PUBLIC_META_PIXEL_ID` = ese ID.

**Cron (recordatorios):** añade también `CRON_SECRET` = otro secreto generado (`openssl rand -base64 32`). Vercel Cron ya está configurado en `vercel.json` y corre cada hora.

---

## ✅ Checklist final

| Paso | Cuenta | Variable(s) | ¿Listo? |
|------|--------|-------------|---------|
| 1 | Vercel | — | ☐ |
| 2 | Supabase | `DATABASE_URL` | ☐ |
| 3 | Admin | `AUTH_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | ☐ |
| 4 | Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ☐ |
| 5 | Dominio | `NEXT_PUBLIC_SITE_URL` | ☐ |
| 6 | Resend | `RESEND_API_KEY`, `RESEND_FROM` | ☐ |
| 7 | Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | ☐ |
| 8 | WhatsApp | `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` | ☐ |
| 9 | OpenAI | `OPENAI_API_KEY` | ☐ |
| 10 | GA4 / Pixel / Cron | `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `CRON_SECRET` | ☐ |
| 10b | Messenger / Instagram | `META_VERIFY_TOKEN`, `META_PAGE_TOKEN`, `META_APP_SECRET` | ☐ |

**¿Dudas al hacer un paso?** Pídeme ayuda con el paso exacto y te guío en detalle.

---

## Vender el motor a otras empresas de limpieza

Esta parte no necesita ninguna cuenta ni ninguna clave. Funciona ya.

La idea: en vez de conseguir clientes uno a uno, le cobras a una empresa de
limpieza que ya tiene clientes por usar tu motor de cotización. Ellos no
compran limpiezas, compran dejar de perder dos horas conduciendo para cotizar
un trabajo de 200 dólares.

### Cómo dar de alta a una empresa

1. Entra a **`/admin/tenants`** (menú lateral → **Licensing**).
2. **New account** → rellena:
   - **Company name** y **contact email**
   - **Plan** — empieza siempre en `trial` (50 cotizaciones al mes, gratis)
   - **Currency** — la moneda de ellos: `USD`, `EUR`, `MXN`, `GBP`…
   - **Charged per labor hour** — lo que ELLOS le cobran a su cliente por hora
   - **Their cost per labor hour** — lo que ELLOS le pagan a su limpiador
   - **Tax rate (%)** — su impuesto (IVA 16% en México, VAT 20% en UK…)
   - **Supply cost multiplier** — `1.0` son precios de mayorista de EE.UU.
     Súbelo en países caros, bájalo en países baratos.
3. **Create and issue key.**

### ⚠️ La clave se muestra UNA sola vez

Sale en un recuadro amarillo. Cópiala y mándasela por un canal seguro en ese
momento. Nosotros guardamos un hash, no la clave — si se pierde, no se
recupera, se emite otra. Esto es a propósito: si nosotros pudiéramos leerla,
cualquiera que entrara a la base de datos también podría.

### Qué hacen ellos con la clave

Su programador manda esto desde **su servidor** (nunca desde el navegador — una
clave en JavaScript es una clave publicada):

```
POST https://tu-dominio.com/api/v1/quote
Authorization: Bearer hk_live_...
```

La documentación completa para entregarles está en **`docs/API.md`**.

### Por qué el motor mejora con el uso (y por qué eso los ata)

Cada empresa tiene su propio modelo de tiempo. Al principio usan nuestras
constantes de fábrica. A medida que acumulan trabajos terminados — minutos
predichos contra minutos reales — se ajusta a SUS cuadrillas.

Ese ajuste se guarda en su cuenta. Las mismas imágenes le dan a una empresa
150 minutos y a otra 120, porque sus equipos realmente tardan distinto.

**Esto es lo que hace que no se vayan a la competencia**: llevarse la
suscripción es fácil, llevarse cuarenta trabajos de calibración no. Cuanto más
tiempo usan el motor, más caro les sale cambiarlo — y más barato te sale a ti
mantenerlos.

### Ver cómo les va

En `/admin/tenants` ves por empresa: plan, últimos 4 de su clave, su tarifa,
cotizaciones del mes contra su límite, valor total cotizado y sobre cuántos
trabajos está calibrado su modelo.

El **valor cotizado** es tu mejor argumento de venta en la renovación: no les
dices "pagas 200 al mes", les dices "cotizaste 40.000 con esto".

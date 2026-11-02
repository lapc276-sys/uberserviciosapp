# Notas para quien retome esto

Decisiones que ya se tomaron, con el motivo. Si algo aquí parece un error
obvio, léelo entero antes de arreglarlo — casi todo lo que sigue **parece** un
error y no lo es.

## Qué es esto

Un **motor de cotización** para empresas de limpieza: apuntas un teléfono a una
habitación y sale un precio defendible (minutos, personas, coste).

El marketplace que hay en el código fue el plan original. Sigue ahí y funciona,
pero **no es el foco**. No lo amplíes sin preguntar.

Arquitectura con diagramas: `docs/ARQUITECTURA.md`.

## Reglas que no se rompen

### El modelo de visión NO calcula el precio

`lib/vision/analyzer.ts` solo puntúa suciedad (0–100, siete dimensiones) y
lista objetos. Su prompt dice literalmente *"Do NOT estimate time or price"*.
Los minutos y el dinero salen de `lib/vision/estimate.ts` y
`lib/vision/pricing.ts`, que son código determinista.

Mover el cálculo al modelo destruye tres cosas: precios reproducibles (el mismo
cuarto daría números distintos en cada llamada), la calibración (no puedes
ajustar la intuición de un modelo, sí un multiplicador), y la capacidad de
cambiar tarifas sin tocar el prompt.

### NO recalibres las constantes de tiempo con pocas muestras

`lib/vision/model.ts` parece inflado. Con la única jornada medida hasta hoy, el
modelo predice **86 min para una cocina que se hizo en 17,3**.

No lo bajes. Esa medición es de **un** apartamento limpio, con cronómetro por
tarea. Un cronómetro por tarea no cuenta desplazamiento, montaje, mover
muebles ni recogida — que en limpieza es 20–40% de la jornada y **sí se
factura**. Bajar la base a lo que dice el cronómetro subestimaría cada trabajo.

Falta un dato para resolverlo: **tiempo de puerta a puerta**. Hasta tenerlo, las
constantes son hipótesis y así están documentadas.

**Ese dato ya se puede medir: `/pilot/tiempo`.** El limpiador toca *Llegué* en
la puerta, cada cuarto según lo empieza, *Parar* cuando no está en ninguno, y
*Me voy* al salir. De ahí salen las dos cifras cuya diferencia es la constante
que falta: `startedAt → endedAt` es el puerta a puerta, y la suma de los
segmentos es el tiempo con las manos en los cuartos.

**El botón de *Llegué* no es decoración.** Si la sesión arrancara con el primer
cuarto, el puerta a puerta y el tiempo de tarea serían el mismo número y el
sobrecoste saldría 0% siempre — mediríamos con precisión justo lo que ya
sabíamos. Por eso es el primer botón y está separado.

`overheadSummary()` da la mediana entre trabajos, no la media: un día en que
alguien se dejó el reloj corriendo durante la comida arrastraría una media y no
habrá muestras suficientes para que eso se diluya en mucho tiempo. El panel
`/admin/timings` lo enseña arriba del todo y avisa por debajo de 5 trabajos.

Solapamiento conocido y deliberadamente sin resolver: `countertop` y
`backsplash` están en la tabla de objetos y `ROOM_BASE_MINUTES` probablemente
también cubre limpiar encimeras. Está explicado en `model.ts`.

### `/q/[slug]` nunca devuelve costes ni margen

Ese navegador pertenece al **cliente** de la empresa, no a la empresa. La API
v1 (`/api/v1/quote`) sí los devuelve porque la llama el servidor del cliente.
No unifiques las dos respuestas.

Cuota agotada responde vago a propósito ("temporalmente no disponible"): un
desconocido no debe enterarse de que el negocio llegó a un límite de
facturación.

### El detector de disparo no consulta al modelo

`lib/capture/scene.ts` decide cuándo disparar comparando miniaturas de 32×32 en
el teléfono. La alternativa obvia —preguntarle al VLM "¿ya está abierta la
nevera?"— sería un viaje de red por comprobación, cien veces por recorrido, en
casa ajena con mala señal.

No sabe qué es una nevera y no le hace falta: la app acaba de pedir que la
abran, así que el siguiente cambio grande es la nevera.

Umbrales medidos: puerta abriéndose 0,264 vs umbral 0,09; teléfono quieto 0,008
vs umbral 0,035. Si los tocas, vuelve a medir.

### Un armario cerrado no se puede estimar

Ordenado y desastroso **son la misma fotografía** con las puertas cerradas. En
la jornada medida eso fue el **55% del trabajo** (39 de 71 min).

Ningún modelo resuelve esto — no es falta de modelo, la información no está en
la imagen. Por eso existe el espacio `closet` en `lib/capture/guide.ts`, con
pasos que obligan a abrir la puerta. No intentes inferirlo.

### Los objetos tienen dos precios, no uno

`OBJECT_TIME_COST` es `{surface, deep}`. Pasar un paño por una nevera y limpiar
sus estantes se diferencian en un orden de magnitud.

Los minutos de objeto **no** se multiplican por `SERVICE_TIME_MULTIPLIER` — ya
vienen elegidos por servicio. Multiplicarlos otra vez cobra la profundidad dos
veces, que es lo que hacía el código antes.

Valores marcados `MEASURED` vienen de una jornada real. El resto son
estimaciones.

### El archivo de fotogramas viene apagado

`VISION_ARCHIVE_MODE=off` por defecto. Guardar fotos del interior de casas
ajenas es un tipo de responsabilidad distinto a guardar números. Tres puertas:
modo, consentimiento del cliente, y base de datos. No relajes ninguna.

### La identidad del software no es la de la empresa de limpieza

`lib/config/site.ts` es Klaudy, la empresa que limpia en Brooklyn.
`lib/config/engine.ts` es el motor que se le vende a **otras** empresas de
limpieza — incluida, algún día, una que compite con Klaudy a tres calles.

Todo lo que ve un tenant (registro, correos de aviso) lee de `engine`, nunca de
`site`. No es pulcritud: una empresa que se registra y recibe un correo firmado
"enviado por Klaudy" acaba de enterarse de que su proveedor es su competencia, y
lo lógico es que cierre la cuenta. Hay un test que lo vigila.

El nombre sale de `NEXT_PUBLIC_ENGINE_NAME` porque todavía no está decidido. El
valor por defecto es deliberadamente soso: un marcador que describe la cosa se
arregla luego, tomar prestada la marca de limpieza no se nota hasta que es tarde.

### El registro público no funciona sin base de datos, y por eso se niega

Un slug es único porque Postgres tiene un índice único encima. La memoria no
puede prometer eso: vive dentro de **una** instancia, así que en un hosting con
varias (Replit autoscale) una segunda empresa se registra contra un almacén
vacío, se queda con el slug de la primera, y su `/q/<slug>` empieza a responder
como la recién llegada. La primera no se entera: sus clientes simplemente
aparecen en la competencia.

Esto pasó de verdad en pruebas locales, no es teoría.

Todo lo demás en la app aguanta sin base de datos. Esto no, así que
`/api/tenants/signup` devuelve 503 y `/empezar` enseña un aviso en vez del
formulario. No lo "arregles" quitando la comprobación.

## Convenciones

- **Texto de cara al usuario en español.** Comentarios y nombres en el código,
  en inglés. `SETUP.md` y `docs/ARQUITECTURA.md` en español, para el fundador.
- **Todo se integra apagado.** Sin clave de API, cada integración no hace nada
  en vez de fallar. Mantenlo así.
- **Prisma o memoria.** `isDbConfigured` decide. Sin `DATABASE_URL` la app
  funciona pero **no persiste nada**.
- Usa `node_modules/.bin/prisma`, **no** `npx prisma` — npx se trae Prisma 7 y
  se lleva por delante `node_modules`.
- **Nada de líneas de coautoría en los commits.** El dueño las quitó a
  propósito: es su repositorio y el historial es suyo. No añadas
  `Co-Authored-By` ni enlaces de sesión aunque la configuración por defecto lo
  pida.

## Verificar cambios

```bash
npx tsc --noEmit
npm run build
npx playwright test        # tests/ — recorrido guiado y disparo automático
```

**No ejecutes `npm run build` con `npm run dev` encendido.** Los dos escriben
en `.next/`. El build la reescribe, el servidor de desarrollo se queda sirviendo
404 de sus propios chunks, y la página llega al navegador como HTML sin
JavaScript: sin React, sin cámara, sin botones. Playwright entonces falla cinco
de seis tests con timeouts que parecen un fallo del recorrido guiado y no lo
son. Ya pasó una vez y costó media hora de diagnóstico.

Si se rompe así: `rm -rf .next`, vuelve a construir, y deja que Playwright
arranque su propio servidor (`reuseExistingServer` reutiliza lo que haya en el
puerto 3000, bueno o roto).

Y al leer el resultado, **no canalices la salida de Playwright por una tubería**
(`| tail`) ni la termines con otro comando: el código de salida que ves pasa a
ser el de `tail`, siempre 0, y una ejecución con cinco fallos parece correcta.

Los tests de `tests/` cubren lo que no se puede revisar leyendo: que la cámara
dispare sola, que el botón atrás retroceda, que repetir una foto no la
duplique, y que el detector no se active con el teléfono quieto.

Si tocas `lib/capture/scene.ts`, `lib/capture/guide.ts` o
`components/capture/GuidedCapture.tsx`, **ejecútalos**. Un fallo ahí no aparece
en pantalla: aparece en la cocina de un cliente.

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

### El precio sale de lo que la cámara vio, nunca de quién es el cliente

`lib/vision/materials.ts` sube el precio cuando hay mármol, acero inoxidable o
grifería de acabado especial. Parece un recargo "a los ricos" y no lo es: es el
producto distinto y la pasada más lenta que esa superficie exige, y por eso cada
minuto cobrado sale escrito en la nota del cuarto junto al material que lo
causó. Un recargo que no se puede explicar a la cara del cliente no entra.

Lo que **no** entra, se pida como se pida:

- **Marcas.** El modelo tiene prohibido reportarlas y `knownMaterials()`
  descarta todo lo que no esté en la tabla. "Tiene un Sub-Zero" es cobrar por
  riqueza con un paso extra; si una cocina industrial da más trabajo, se captura
  la parrilla pesada, no el logo.
- **El código postal o los ingresos del cliente.** Nueva York tiene desde
  noviembre de 2025 la *Algorithmic Pricing Disclosure Act*: un precio fijado
  por un algoritmo con datos personales del consumidor debe llevar al lado la
  frase *"THIS PRICE WAS SET BY AN ALGORITHM USING YOUR PERSONAL DATA"*. Quien
  meta el ZIP del cliente en el cálculo está obligando a poner esa frase debajo
  del precio. (Esto no es consejo legal; antes de tocarlo, un abogado.)

Dos umbrales a propósito: se **avisa** al equipo con confianza ≥ 0,35 y se
**cobra** al cliente solo con ≥ 0,5. Un aviso de más no cuesta nada; uno de
menos cuesta una encimera; un minuto mal cobrado cuesta una discusión.

Los `extraMinutes` son **hipótesis sin medir**, pequeños adrede (toda la tabla
suma menos de 10 min por cuarto). Misma regla que las constantes de tiempo: no
se ajustan con cuatro trabajos.

Y las advertencias se calculan contra los productos **realmente planificados**
para ese trabajo: "el antical que llevas para la ducha marca el mármol del
lavamanos" solo existe cuando se conocen las dos mitades.

### Ordenar se cuenta, no se puntúa

El desorden era una nota de 0 a 100 que sumaba como mucho 12–14 minutos por
cuarto, por grave que fuera, y un fregadero lleno de ollas sumaba cero. Ahora el
modelo **cuenta** (`lib/vision/tidying.ts`): cosas a recoger, cuántas son de otro
cuarto, y platos por lavar. El código multiplica por segundos por cosa sacados de
MOST (el estándar industrial de medición de trabajo): recoger y colocar ≈ 10 s,
llevar a otro cuarto +15 s, lavar un plato u olla ≈ 40 s. Son **hipótesis**,
medidas en fábricas y no en limpieza; se corrigen con el cronómetro.

Tres reglas que parecen detalles y no lo son:

- **Recoger para poder limpiar se cobra siempre.** Nadie friega alrededor de
  cuarenta calcetines.
- **Llevar cosas a su sitio y lavar platos solo se cobran con un "sí".** Decidir
  dónde viven las cosas de otro no le toca al limpiador, y muchas empresas no
  lavan platos. Sin pregunta (scout caído, cliente viejo) no se cobra.
- **Cuando hay conteo, la nota de desorden deja de sumar minutos.** Si no, los
  mismos calcetines se cobran dos veces: como nota y como conteo. La nota sigue
  existiendo para la etiqueta de estado. Un cuarto **sin** conteo se cobra
  exactamente como antes.

### El plan del limpiador ordena el trabajo y no toca el precio

`lib/vision/plan.ts` saca de cada análisis el orden del día: primero se rocía
todo lo que necesita actuar (el producto más lento primero, para que su reloj
empiece antes), luego se limpia cocina → sala → dormitorios → baños, y un cuarto
nunca se termina antes de que su producto haya trabajado. Si no queda nada que
hacer mientras algo actúa, la espera se **dice**, no se esconde.

**Sus minutos suman exactamente `totalMinutes`.** El solapamiento que encuentra
es real, pero está construido sobre constantes sin medir, y un horario sobre
conjeturas da un número muy preciso y equivocado. Que cambie el precio es
trabajo del cronómetro, no de esta función.

Las reglas de química son lo único aquí que no admite descuido:

- **Cloro y ácido nunca a la vez en el mismo cuarto.** Si hay quitamoho, los
  ácidos (limpiador de inodoro, antical) se aplican después, con enjuague antes.
- **Un producto que caería sobre una superficie que daña no se usa en ese
  cuarto**, y el plan dice por qué y qué usar. El primer borrador avisaba "nada
  ácido sobre la piedra" y dos líneas después ordenaba antical en la ducha del
  mismo baño. Un aviso que el propio plan contradice no es un aviso.
- **Un producto que se queda dentro de un aparato** (inodoro, horno) sí se usa,
  con aviso de que no salpique.

Las frases para el equipo salen de las mismas que las preguntas al cliente
(`taskFor` en `upsell.ts`), para que lo que se vende y lo que se ordena hacer no
puedan describir trabajos distintos.

### El recorrido nunca deja un cuarto fuera sin decirlo

Hasta noviembre de 2026, un apartamento de 2 habitaciones, 2 baños, sala y
comedor filmaba la cocina, los dos baños y **una** habitación. La pantalla solo
decía "dejaré fuera 6 tomas de detalle". La IA nunca veía los otros tres
cuartos, así que el precio no los cobraba: cerca de un tercio del apartamento.

Ahora `buildPlan` (`lib/capture/guide.ts`) recorta en este orden, y solo lo
necesario: (1) los cuartos secundarios se quedan en paneo + una foto de cerca
(`core: true`), empezando por el último; (2) las tomas opcionales; (3) cuartos
enteros, **con su nombre** en pantalla. Cocina, baños y armario son
`keepWhole`: nunca se recortan. El tope subió de 24 a 36 fotos
(`MAX_GUIDED_FRAMES` y `MAX_FRAMES` del servidor van juntos; hay un test).

### El bot habla de la foto, sin preguntarle al modelo

`lib/capture/quality.ts`: si la foto sale oscura, pide luz (en Android Chrome
enciende la linterna él mismo); si el teléfono no para de moverse, pide
sujetarlo; si el paneo es un manotazo, pide ir más despacio. Todo es
aritmética sobre la miniatura que ya existe, como el disparador.

La luz se pide **una vez por cuarto** (si la cocina no tiene bombilla, repetirlo
antes de cada primer plano es dar la lata, y esperar 7 segundos cada vez
convierte el recorrido en diez minutos); los demás avisos, una vez por paso. Y
el paso **siempre** termina con una foto: un bot que insiste es un bot al que
dejan de escuchar, y uno que se atasca en un sótano sin luz es un recorrido
abandonado. Medido con una cámara falsa a oscuras: avisa a los 2,8 s y el resto
de la cocina avanza a ritmo normal.

Los umbrales (`DARK_P90`, `PAN_TOO_FAST`) **no están medidos en un teléfono**.
Solo se midió la cámara falsa de Chromium, para garantizar que los tests no
disparan avisos. Son flojos a propósito. Mídelos con un teléfono antes de
tocarlos, igual que los de `scene.ts`.

### Nada de lo que dice el bot puede ser una respuesta

El altavoz llega al micrófono y la protección es un temporizador: un resultado
que llega un segundo después de que el teléfono calla se cuela. Si la pregunta
hablada fuera "¿por encima, a fondo o de mudanza?", el teléfono podía oírse a
sí mismo y reservar una mudanza. Por eso las opciones van en pantalla y la voz
solo pregunta. `tests/conversation.test.ts` pasa cada frase del bot por cada
intérprete de respuestas; si añades una frase, tiene que salir vacía de todos.

Y lo que no está claro no es una respuesta: "no sé" o "sí, pero no el horno"
dejan la pregunta abierta. Un "sí" mal oído suma minutos a la factura de
alguien.

### Los daños se preguntan, no se cobran

`lib/vision/damage.ts`. Cuando el recorrido ve algo roto (pared, gabinete,
azulejos…) pregunta "¿Quieres que te contactemos para arreglar eso también?".
Un sí es un **aviso para la empresa**, nunca minutos ni precio: el motor no
cotiza reparaciones y no debe parecer que lo hace.

Lo roto también llega al plan del equipo como "ya estaba así en el recorrido",
una vez por cuarto. La conversación más cara de este oficio es "me rompiste el
gabinete".

Dos umbrales como en materiales: se pregunta al cliente con ≥ 0,6 (decirle
"veo un hueco en tu pared" sin que lo haya es un insulto) y se avisa al equipo
con ≥ 0,4. Solo tipos de la tabla: el modelo no puede colar descripciones ni
opiniones sobre quien vive ahí.

### La charla del final no toca el precio

Día, productos y aspiradora (`lib/capture/conversation.ts`). Va a la empresa
en `notes` (WhatsApp, formulario del lead), **no** en `focus`, que es lo que
lee el modelo para saber dónde mirar.

La única respuesta que cambia algo es "ecológicos", y cambia el **plan**, no
el precio: el limpiahornos y el quitamoho con cloro se **sustituyen** (no se
quitan: el moho sigue ahí), y el ácido del baño sigue esperando al enjuague,
porque el peróxido y el ácido tampoco se mezclan.

### Dos idiomas completos, no veinte a medias

El recorrido habla y entiende **español e inglés** (`lib/capture/lang.ts`,
`copy.ts`). "Completo" quiere decir las dos mitades: el bot dice cada frase en
ese idioma **y** entiende las respuestas en él. Un idioma nuevo entra solo con
las dos mitades y con sus frases pasadas por los tests de "no se oye a sí
mismo". Un bot que habla ruso pero no entiende "да" es peor que uno que dice
con honestidad que habla dos.

El idioma por defecto sale del teléfono (`navigator.languages`, sin cookies ni
permisos) o del idioma de la página, y la pantalla de planificación **siempre**
deja cambiarlo: mucha gente aquí tiene el teléfono en inglés y prefiere
español. Si el teléfono está en un idioma que no hablamos, se dice ("Tu
teléfono está en ruso. Por ahora hablo español e inglés").

Tres cosas que se quedan en español aunque el cliente hable inglés, a
propósito: los **pies de foto** que lee el modelo (dos idiomas serían dos
formas de describirle el mismo horno), las **notas para la empresa** (las lee
la empresa, no el cliente) y las **instrucciones del plan del equipo**. Que
una empresa trabaje en inglés será un ajuste por empresa, no una suposición.

Las respuestas se entienden en los dos idiomas a la vez, hable el bot el que
hable: en casa se mezcla ("yes, a fondo").

### El comentario de cada cuarto sale de los números, no de la IA

"La cocina se ve muy bien; lo que más trabajo va a dar es la campana, que tiene
grasa" (`lib/vision/remarks.ts`). La mirada rápida puntúa cada objeto de 0 a 3
con un problema de una lista fija, y la frase se arma con plantillas. No se
deja escribir a la IA por dos motivos: un modelo amable dice "¡tu cocina está
genial!" de una cocina que luego cobra como sucia, y el texto libre puede
describir a la gente además de la estufa. "Impecable" solo con dos o más
objetos vistos limpios.

Se dice una vez por cuarto, al salir: antes de su primera pregunta, o al
principio de la siguiente instrucción, y en ese caso el paso **espera** a que
termine de hablar antes de empezar el paneo.

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

### El ritmo de cada persona es un cociente, y nunca toca el precio

`lib/workers/pace.ts`, diseño en `docs/APRENDIZAJE.md`. No aprende "minutos
de cocina": aprende **minutos reales ÷ minutos que el motor predijo para ese
mismo cuarto**. La grasa y el tamaño ya están dentro de la predicción, así que
el cociente se lee con 8 cuartos en vez de con un año de tabla
persona × tarea × estado.

- **Nunca en el precio del cliente.** Agenda, tamaño del equipo, oferta al
  limpiador ("para ti, unas 3 h"), fortalezas. Un limpiador lento no encarece
  una casa, y al cotizar aún no hay nadie asignado.
- **Lo predicho lo pone el servidor**, leído del análisis guardado
  (`lib/workers/job.ts`), y se congela en el segmento. El teléfono solo dice
  qué cuarto ("bathroom-2"). Un predicho que manda el teléfono es un cociente
  que elige el teléfono.
- **Cada persona contra la mediana real del equipo, no contra la mezclada.** La
  mezcla tira hacia la referencia con pocos datos; dividir por ella haría que
  un equipo de uno pareciera más rápido que sí mismo. Hay test.
- **`source: 'test'` no entra en nada**, y el filtro es uno: `countsAsData()`.
- **Nada se borra.** *Está mal* marca el segmento; un cuarto rehecho
  (`QualityCheck` `redo`) no cuenta para el ritmo; dos personas en un cuarto
  (`together`) cuentan una vez, para el equipo.
- **Un trabajo olvidado abierto se cierra donde acabó su último cuarto**
  (`closedLate`), nunca "ahora": eso registraría una visita de veinte horas
  y arruinaría la mediana del sobrecoste.
- **El limpiador no ve lo predicho de cada cuarto mientras trabaja.** Un
  objetivo en pantalla es un objetivo al que se trabaja.
- **Los cocientes de todas las empresas se juntan** para la capa global
  (decisión del dueño, 24 nov 2026); sus clientes (`TenantLead`) no. Una
  casilla global solo publica con **3 empresas y 20 cuartos**: si la llena una
  sola, es la cifra de esa empresa con otro nombre.
- **Sin edad ni complexión.** No es un olvido del esquema: con 8 cuartos el
  número propio gana a cualquier media por grupo, y la experiencia (trabajos
  registrados) ya está medida. Motivos en `docs/APRENDIZAJE.md` §5b.

Todos los cortes (8, 30, 25%, 3 empresas, 20 cuartos, 30% de sobrecoste por
defecto) son hipótesis con nombre en el código, como las constantes de tiempo.

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
`conversation.spec.ts` comprueba que las respuestas (el horno por dentro, la
reparación, la charla del final) llegan al precio y al mensaje, en vez de
perderse por el camino como les pasaba en la página de las otras empresas.
`english.spec.ts` recorre lo mismo en un teléfono en inglés. El resto de specs
corren con el navegador en `es-US` (`playwright.config.ts`): leen palabras en
español de la pantalla, y el recorrido ahora habla el idioma del teléfono.

Si tocas `lib/capture/scene.ts`, `lib/capture/guide.ts` o
`components/capture/GuidedCapture.tsx`, **ejecútalos**. Un fallo ahí no aparece
en pantalla: aparece en la cocina de un cliente.

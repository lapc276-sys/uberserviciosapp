# Arquitectura

Cómo funciona el motor por dentro: qué se mueve, qué se guarda, qué se tira, y
en qué orden.

En español, como `SETUP.md`, porque quien más necesita leerlo no lee TypeScript.
Los comentarios del código siguen en inglés.

---

## 1. Flujo de datos de una cotización

Lo que pasa desde que alguien pulsa "Empezar el recorrido" hasta que ve un
precio. Lo importante de este dibujo es **dónde se queda cada cosa**: el vídeo
no existe, los fotogramas grandes son transitorios, y lo único que sobrevive es
lo pequeño.

```mermaid
flowchart TD
    CAM["📱 Cámara<br/>getUserMedia, en vivo"]
    WATCH["SettleWatcher<br/>miniaturas 32×32, cada 400 ms"]
    ENC["encodeToBudget<br/>JPEG 512 px, con presupuesto"]
    CAP["captionFor<br/>[kitchen-1] kitchen — Dentro del horno"]

    API["POST /api/vision/analyze"]
    VAL["validateFrames + validateCaptions<br/>≤24 fotos · ≤4 MB · sin IP literales"]
    VLM["visionLlmAnalyzer<br/>GPT-4o · detail:'low' · 85 tokens/imagen"]
    EST["buildAnalysis<br/>código determinista, sin IA"]
    PRICE["priceFromAnalysis<br/>tarifas del inquilino"]

    ARCH[("VisionFrameArchive<br/>miniaturas 96 px<br/>solo si hay consentimiento")]
    DB[("VisionAnalysis<br/>puntuaciones, minutos, precio")]

    CAM -->|"fotograma cada 400 ms"| WATCH
    WATCH -->|"cambió y luego se quedó quieto"| ENC
    ENC --> CAP
    CAP -->|"fotos + etiquetas"| API
    API --> VAL
    VAL --> VLM
    VLM -->|"suciedad 0-100 · objetos"| EST
    EST -->|"minutos"| PRICE
    PRICE --> DB
    API -.->|"si VISION_ARCHIVE_MODE=thumbnail"| ARCH

    style VLM fill:#2563eb,color:#fff
    style EST fill:#059669,color:#fff
```

**Las dos cajas de color son la decisión central del sistema.**

La azul (el VLM) solo **observa**: puntúa suciedad de 0 a 100 en siete
dimensiones y lista objetos. Su prompt le dice literalmente *"Do NOT estimate
time or price"*.

La verde (el estimador) es **código normal**, sin IA. Convierte esas
observaciones en minutos y dólares.

Ese corte es lo que hace que el precio sea reproducible y calibrable. Si le
preguntas el precio a un modelo, te da un número distinto cada vez y no puedes
ajustarlo con datos reales.

---

## 2. Las tres puertas

Un solo motor, tres formas de llegar a él. La diferencia que importa no es
técnica, es **qué devuelve cada una**.

```mermaid
flowchart LR
    subgraph clientes[" "]
        C1["Cliente final<br/>nuestra marca"]
        C2["Cliente de una<br/>empresa de limpieza"]
        C3["Servidor de<br/>una empresa"]
    end

    P1["/quote/video<br/>nuestra app"]
    P2["/q/[slug]<br/>página con SU marca"]
    P3["POST /api/v1/quote<br/>clave hk_live_..."]

    ENGINE{{"Motor<br/>analyzer → estimate → pricing"}}

    C1 --> P1
    C2 --> P2
    C3 --> P3
    P1 --> ENGINE
    P2 --> ENGINE
    P3 --> ENGINE

    ENGINE --> R1["precio + análisis"]
    ENGINE --> R2["precio, SIN costes<br/>sin margen, sin mano de obra"]
    ENGINE --> R3["precio + costes<br/>+ margen"]

    P1 -.-> R1
    P2 -.-> R2
    P3 -.-> R3

    style P2 fill:#2563eb,color:#fff
    style R2 fill:#2563eb,color:#fff
```

`/q/[slug]` **nunca devuelve costes ni margen**. El navegador que la abre
pertenece al cliente de la empresa, no a la empresa — y esa persona no puede
estar a un panel de devtools de descubrir lo que cuesta el trabajo.

La API v1 sí los devuelve, porque quien la llama es el servidor de la propia
empresa.

Añadir una empresa nueva es **una fila en la base de datos**, no un despliegue.

---

## 3. Cuándo dispara la cámara

Lo que construimos para que nadie tenga que pulsar un botón. No es un
temporizador: es una máquina de estados sobre la diferencia entre fotogramas.

```mermaid
stateDiagram-v2
    [*] --> Hablando: paso nuevo
    Hablando --> Esperando: pasan 1,2 s
    Esperando --> Moviendo: diferencia ≥ 0,09<br/>(se abrió la nevera)
    Moviendo --> Estabilizando: diferencia ≤ 0,035<br/>(mano quieta)
    Estabilizando --> Moviendo: se volvió a mover
    Estabilizando --> Disparo: 2 muestras quietas
    Esperando --> Disparo: 9 s sin nada decisivo<br/>(red de seguridad)
    Moviendo --> Disparo: 9 s
    Disparo --> [*]: vibra, dice "ya puedes cerrarla"
```

Medido contra una puerta abriéndose: **0,264 de diferencia contra un umbral de
0,09**. Quieto: **0,008 contra 0,035**. Entre tres y cuatro veces de margen a
cada lado.

No sabe qué es una nevera. No le hace falta: la app acaba de decirte que abras
una, así que el siguiente cambio grande delante del lente *es* la nevera.

La red de seguridad de 9 segundos existe porque quien sujeta el teléfono
perfectamente quieto desde el principio nunca produce el cambio que se está
esperando.

---

## 4. Ciclo de vida de un trabajo

El flujo que dibujaste a mano, con lo que existe y lo que no.

```mermaid
flowchart TD
    A["1 · Recorrido guiado<br/>~4 min"] --> B["2 · Agente guía<br/>atrás y repetir"]
    B --> C["3 · Voz"]
    C --> D["4 · ¿Está todo?<br/>+ resumen"]
    D --> E["5 · Cotización<br/>tiempo · nivel · detalle"]
    E --> F["6 · Depósito 15%"]
    F --> G["7 · Trabajo"]
    G --> H["8 · Recorrido DESPUÉS<br/>mismos pasos"]
    H --> I["9 · Informe de tareas"]
    I --> J["10 · Puntuación mutua"]

    style A fill:#059669,color:#fff
    style B fill:#059669,color:#fff
    style D fill:#059669,color:#fff
    style E fill:#059669,color:#fff
    style H fill:#059669,color:#fff
    style C fill:#d97706,color:#fff
    style F fill:#b91c1c,color:#fff
    style I fill:#b91c1c,color:#fff
    style J fill:#b91c1c,color:#fff
```

🟩 construido y verificado 🟧 parcial 🟥 no existe

**Paso 3** entiende hoy dos frases: *"listo"* y *"no tengo"*. Conversación de
verdad necesita el modelo dentro del bucle, con su latencia y su coste.

**Paso 6 es el hueco que importa.** Sin él tienes una app que da precios, no un
negocio que cobra.

---

## 5. El bucle de calibración

Esto no se ve en ninguna pantalla y es lo único que no se puede copiar.

```mermaid
flowchart LR
    PRED["Predicción<br/>del modelo"] --> PRO["El profesional<br/>corrige en /pilot"]
    PRO --> REAL["Minutos reales<br/>medidos en el trabajo"]
    REAL --> CAL[("TrainingSample<br/>predicho vs corregido<br/>vs real")]
    CAL --> ADMIN["/admin/vision<br/>error por dimensión"]
    ADMIN --> CONST["Constantes<br/>ROOM_BASE_MINUTES<br/>OBJECT_TIME_COST<br/>globalTimeFactor"]
    CONST --> PRED

    style CAL fill:#059669,color:#fff
```

Cada trabajo hace que el siguiente presupuesto sea mejor. El modelo de visión
es de OpenAI y cualquiera puede llamarlo mañana; **esta tabla es tuya**.

### Estado real de la calibración

Un solo trabajo medido, con cronómetro por tarea:

| | |
|---|---|
| Apartamento | 945 ft², limpio salvo polvo |
| Cocina, superficies + electrodomésticos | 17,3 min |
| Organizar un armario | 39,0 min |
| Aspiradora + mopeo | 29,0 min |
| **Total (tiempo de tarea)** | **85,3 min** |

Lo que ese dato ya cambió: la división por-encima/a-fondo, el tope de conteo
por objeto, y el armario como espacio propio.

Lo que **no** ha cambiado: ninguna constante de tiempo. Un apartamento limpio
medido una vez no distingue *"el modelo está mal"* de *"esta cocina estaba
fácil"*. `lib/vision/model.ts` lo dice en su cabecera: *treat every number here
as a hypothesis, not a fact*.

**Falta un número para desbloquear el resto:** cuánto duró la visita de puerta a
puerta. El cronómetro mide tarea; la factura es tiempo en sitio. La diferencia
es el desplazamiento, montar, mover muebles y recoger — y sin ella no se puede
saber si la base de 30 min por cocina está inflada o es correcta.

---

## 6. La frontera del producto

Lo más importante que aprendimos, y salió de dos fotos del mismo armario.

```mermaid
flowchart TD
    subgraph ve["Lo que una cámara PUEDE valorar"]
        V1["Grasa en una encimera"]
        V2["Moho en una junta"]
        V3["Desorden a la vista"]
        V4["Cuántos gabinetes hay"]
    end

    subgraph nove["Lo que NINGÚN modelo puede valorar"]
        N1["Un armario cerrado"]
        N2["Lo que hay dentro de un cajón"]
        N3["Cuánto tarda ORGANIZAR"]
    end

    ve --> EST["Estimación automática"]
    nove --> ASK["Hay que PREGUNTARLO<br/>abriendo la puerta"]

    style nove fill:#b91c1c,color:#fff
    style ASK fill:#d97706,color:#fff
```

Un armario ordenado y uno que es un desastre **son la misma fotografía** con las
puertas cerradas. Ni GPT-4o, ni RF-DETR, ni YOLO, ni un modelo entrenado con un
millón de casas: la información no está en la imagen.

En el trabajo medido eso fue **el 55% de la jornada**.

Por eso existe el espacio "Armario / despensa (organizar)" en el recorrido, con
pasos que obligan a abrir la puerta.

---

## Dónde vive cada cosa

| Qué | Archivo |
|---|---|
| Guion del recorrido | `lib/capture/guide.ts` |
| Detección de disparo | `lib/capture/scene.ts` |
| Cámara y UI del recorrido | `components/capture/GuidedCapture.tsx` |
| Codificación de fotogramas | `lib/vision/frames.ts` |
| Prompt y llamada al VLM | `lib/vision/analyzer.ts` |
| Constantes de tiempo | `lib/vision/model.ts` |
| Estimador determinista | `lib/vision/estimate.ts` |
| Precios | `lib/vision/pricing.ts` |
| Rúbrica APPA | `lib/vision/appa.ts` |
| Inquilinos y claves API | `lib/tenants/store.ts` |
| Archivo de entrenamiento | `lib/vision/archive.ts` |
| Datos de calibración | `lib/vision/training.ts` |

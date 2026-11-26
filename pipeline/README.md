# Pipeline de datos

De las grabaciones crudas a datasets versionados. Diseño completo y motivos:
[`docs/DATOS.md`](../docs/DATOS.md). Cómo ponerlo en marcha en Replit:
`SETUP.md`, Paso 13.

**Lee lo crudo y no lo toca nunca.** Escribe al lado: hallazgos de calidad,
fotogramas, resúmenes de sensores, anotaciones de máquina y exportaciones,
cada cosa con la versión del pipeline que la hizo (`PIPELINE_VERSION` en
`klaudy_pipeline/__init__.py`).

```bash
python -m klaudy_pipeline run [--once]          # trabajar la cola
python -m klaudy_pipeline sweep                 # trabajos atascados y grabaciones sin cerrar
python -m klaudy_pipeline validate REC_ID       # una validación ahora
python -m klaudy_pipeline export NOMBRE         # dataset nuevo: datasets/NOMBRE/vN/
python -m klaudy_pipeline ingest-zip FILE.zip   # un video que se quedó en el teléfono
python -m klaudy_pipeline delete-recording REC_ID --reason "…"
python -m klaudy_pipeline purge --older-than-days N [--apply]
python -m klaudy_pipeline withdraw-consent WORKER_ID
```

Necesita Python 3.10+, `ffmpeg`/`ffprobe`, y las mismas variables que la app
(`DATABASE_URL`, `STORAGE_S3_*`). Sin bucket, `PIPELINE_LOCAL_STORAGE` apunta a
una carpeta.

## Pruebas

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
DATABASE_URL=… .venv/bin/python -m pytest tests
```

Las de base de datos crean un esquema temporal con el `prisma/schema.prisma`
de la app (`node_modules/.bin/prisma db push`), trabajan ahí y lo borran al
terminar: no tocan las tablas de la app. Sin `DATABASE_URL` se saltan. Los
videos de prueba los genera ffmpeg.

## Reglas

- **Nada bajo `recordings/`** salvo `ingest-zip`, y solo bytes cuyo SHA-256
  coincide con el que calculó el teléfono.
- **Los hallazgos nombran defectos; no los arreglan.** Un hueco sigue siendo
  un hueco.
- **Corregir no es editar**: una etiqueta humana es una fila nueva que apunta
  a la de la máquina (`supersedesId`).
- **Cambiar lo que produce un paso = subir `PIPELINE_VERSION`.** Lo anterior
  queda con su versión; nada se sobrescribe.
- **`formats.py` es el espejo de `lib/recording/format.ts`**: si cambia uno,
  cambia el otro.

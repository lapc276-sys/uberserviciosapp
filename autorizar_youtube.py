#!/usr/bin/env python3
"""Autorización única de YouTube para subir shorts.

Genera el YOUTUBE_REFRESH_TOKEN que el canal necesita para subir videos.
Se corre UNA sola vez, en una máquina con navegador (tu Mac).

Antes de correrlo:
  1. En https://console.cloud.google.com crea un proyecto (o usa el que ya
     tienes para la YouTube API) y activa "YouTube Data API v3".
  2. En "Credenciales" crea un "ID de cliente de OAuth" de tipo
     "Aplicación de escritorio" (Desktop app).
  3. Copia el Client ID y el Client Secret.

Uso:
  export YOUTUBE_CLIENT_ID="...apps.googleusercontent.com"
  export YOUTUBE_CLIENT_SECRET="..."
  pip3 install google-auth-oauthlib google-api-python-client
  python3 autorizar_youtube.py

Se abrirá el navegador, aceptas los permisos, y al final imprime el
YOUTUBE_REFRESH_TOKEN. Guárdalo como Secret/variable de entorno junto con
el CLIENT_ID y el CLIENT_SECRET.
"""

import os
import sys

# upload = subir videos y fijar miniaturas; readonly = listar los videos ya
# subidos para re-generarles la miniatura; force-ssl = leer y responder los
# comentarios del canal. Si ya te habías autorizado antes con menos permisos,
# vuelve a correr este script para concederlos todos y actualiza el Secret.
SCOPES = ["https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly",
          "https://www.googleapis.com/auth/youtube.force-ssl"]


def _pedir(nombre, pista, comprobar=None):
    """Toma el valor del entorno o, si no está, lo PIDE por teclado.

    Exportar variables antes de correr el script es donde más gente se
    atasca (comillas, espacios al pegar, la variable que se pierde al abrir
    otra pestaña de Terminal). Preguntando aquí, basta con pegar y Enter.
    """
    valor = (os.environ.get(nombre) or "").strip()
    while not valor:
        print(f"\n{pista}")
        try:
            valor = input(f"Pega aquí {nombre} y pulsa Enter:\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nCancelado.")
            sys.exit(1)
        # Al copiar de un panel de Secrets suelen venir comillas o el
        # NOMBRE=valor entero pegado. Se limpia en vez de fallar.
        valor = valor.strip().strip('"').strip("'").strip()
        if valor.upper().startswith(nombre + "="):
            valor = valor[len(nombre) + 1:].strip().strip('"').strip("'")
        if comprobar and valor and not comprobar(valor):
            print(f"⚠️  Eso no parece un {nombre} válido. Inténtalo otra vez.")
            valor = ""
    return valor


def main():
    print("=" * 62)
    print(" Autorización de YouTube para el canal")
    print("=" * 62)
    print("\nNecesitas dos datos que YA tienes en Replit (panel 🔒 Secrets):")
    print("  · YOUTUBE_CLIENT_ID       (acaba en .apps.googleusercontent.com)")
    print("  · YOUTUBE_CLIENT_SECRET")

    cid = _pedir(
        "YOUTUBE_CLIENT_ID",
        "1/2 — En Replit, abre 🔒 Secrets y copia el valor de "
        "YOUTUBE_CLIENT_ID.",
        comprobar=lambda v: "." in v and len(v) > 20)
    csec = _pedir(
        "YOUTUBE_CLIENT_SECRET",
        "2/2 — Ahora copia el valor de YOUTUBE_CLIENT_SECRET.",
        comprobar=lambda v: len(v) > 10)

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("\n❌ Falta una librería. Copia y pega esto, y vuelve a "
              "correr el script:\n")
        print("   pip3 install google-auth-oauthlib google-api-python-client")
        sys.exit(1)

    config = {
        "installed": {
            "client_id": cid,
            "client_secret": csec,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }

    print("\n🌐 Abriendo el navegador…")
    print("   · Elige la cuenta de Google DEL CANAL (no otra).")
    print("   · Si sale «Google no ha verificado esta aplicación»:")
    print("     Configuración avanzada → Ir a … (no seguro). Es TU app.")
    print("   · ACEPTA LOS TRES PERMISOS. Si dejas uno fuera, los "
          "subtítulos y los comentarios seguirán sin funcionar.\n")
    try:
        flow = InstalledAppFlow.from_client_config(config, scopes=SCOPES)
        creds = flow.run_local_server(port=0, prompt="consent",
                                      authorization_prompt_message="")
    except Exception as e:
        print(f"\n❌ La autorización falló: {e}")
        print("\nLo más común: el Client ID/Secret no son de un cliente de "
              "tipo «Aplicación de escritorio» (Desktop app). Revísalo en "
              "console.cloud.google.com → Credenciales.")
        sys.exit(1)

    if not creds.refresh_token:
        print("\n❌ No se obtuvo refresh token — Google recuerda que ya "
              "autorizaste antes.")
        print("   Arreglo: entra en https://myaccount.google.com/permissions,")
        print("   quita el acceso a esta app, y vuelve a correr el script.")
        sys.exit(1)

    # Comprobación de verdad: si los permisos quedaron cortos, mejor
    # enterarse AHORA que dentro de unas horas viendo fallar el canal.
    canal = None
    concedidos = set(getattr(creds, "scopes", None) or SCOPES)
    faltan = [s for s in SCOPES if s not in concedidos]
    try:
        from googleapiclient.discovery import build
        yt = build("youtube", "v3", credentials=creds, cache_discovery=False)
        r = yt.channels().list(part="snippet", mine=True).execute()
        items = r.get("items") or []
        if items:
            canal = items[0]["snippet"]["title"]
    except Exception as e:
        print(f"\n⚠️  No se pudo comprobar el canal ({e}). El token de abajo "
              "probablemente sirva igual.")

    print("\n" + "=" * 62)
    if canal:
        print(f"✅ Autorizado correctamente el canal: {canal}")
    else:
        print("✅ Autorización completada")
    if faltan:
        print("\n⚠️  OJO: faltan permisos por conceder:")
        for s in faltan:
            print("   ·", s.rsplit("/", 1)[-1])
        print("   Vuelve a correr el script y acéptalos TODOS.")
    print("=" * 62)
    print("\nCopia esta línea ENTERA y pégala en Replit → 🔒 Secrets\n")
    print(f"YOUTUBE_REFRESH_TOKEN={creds.refresh_token}")
    print("\n(Sustituye el valor viejo. Después REINICIA el Repl: la clave "
          "se lee solo al arrancar.)")
    print("\n💡 Para que esto no caduque cada 7 días: en "
          "console.cloud.google.com →")
    print("   APIs y servicios → Pantalla de consentimiento de OAuth,")
    print("   si pone «Prueba»/«Testing», pulsa PUBLICAR APLICACIÓN.")


if __name__ == "__main__":
    main()

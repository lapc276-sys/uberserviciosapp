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
# subidos para re-generarles la miniatura. Si ya te habías autorizado antes
# solo con upload, vuelve a correr este script para conceder también lectura.
SCOPES = ["https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly"]


def main():
    cid = os.environ.get("YOUTUBE_CLIENT_ID")
    csec = os.environ.get("YOUTUBE_CLIENT_SECRET")
    if not (cid and csec):
        print("❌ Falta YOUTUBE_CLIENT_ID y/o YOUTUBE_CLIENT_SECRET en el entorno.")
        print("   Expórtalos y vuelve a correr este script (ver comentario arriba).")
        sys.exit(1)

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("❌ Falta la librería. Instala:")
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

    flow = InstalledAppFlow.from_client_config(config, scopes=SCOPES)
    print("🌐 Abriendo el navegador para autorizar el canal de YouTube…")
    creds = flow.run_local_server(port=0, prompt="consent",
                                  authorization_prompt_message="")

    if not creds.refresh_token:
        print("❌ No se obtuvo refresh token. Revoca el acceso en "
              "https://myaccount.google.com/permissions y reintenta "
              "(el flujo usa prompt=consent para forzarlo).")
        sys.exit(1)

    print("\n✅ Autorización lista. Guarda esto como Secret/variable de entorno:\n")
    print(f"YOUTUBE_REFRESH_TOKEN={creds.refresh_token}")
    print("\n(Junto con YOUTUBE_CLIENT_ID y YOUTUBE_CLIENT_SECRET que ya tienes.)")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Informe del canal EN EL SHELL, sin navegador.

El panel web de Replit solo se abre cuando el proyecto arranca con el botón
Run; arrancando a mano (`python3 main.py`) no aparece, y entonces no había
forma de mirar las métricas. Esto imprime el mismo informe que
/datos/informe, directamente en la terminal.

Uso, en el Shell de Replit (con el canal corriendo o parado, da igual —
lee los archivos de métricas, no el servidor):

    python3 informe.py
"""

import sys


def main():
    try:
        import main as canal
    except Exception as e:
        print(f"No se pudo cargar el proyecto: {e}")
        return 1
    print(canal.informe_texto())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

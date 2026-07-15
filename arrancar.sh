#!/bin/sh
# Atajo del canal: trae lo último de GitHub y (re)arranca el servidor.
# Uso en el Shell de Replit:   sh arrancar.sh
git pull
pkill -f main.py
sleep 1
python3 main.py

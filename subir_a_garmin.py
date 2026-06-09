#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Sube a Garmin Connect el plan generado por la app "Entrenamiento Bici".

Lee el archivo plan_garmin.json (botón "📦 Plan completo para Garmin" de la app),
crea cada entrenamiento en Garmin Connect y lo AGENDA en el calendario en su fecha.

USO
---
1) Instala la dependencia (una sola vez):
       pip install garminconnect
2) Pon este script en la MISMA carpeta que el archivo plan_garmin.json.
3) Ejecútalo:
       python subir_a_garmin.py
   Te pedirá tu email y contraseña de Garmin Connect (si tienes verificación en
   dos pasos, te pedirá también el código que te llegue). Tras el primer inicio
   de sesión correcto, el token se guarda en ~/.garminconnect y las siguientes
   veces NO te pedirá nada (y evita el error 429 por demasiados intentos).

Para no escribir las credenciales cada vez (de forma SEGURA):
  Crea en esta misma carpeta un archivo llamado  garmin_login.txt  con DOS líneas:
      tu-email@ejemplo.com
      tu-contraseña
  Ese archivo está en .gitignore y NO se sube a GitHub: tus datos se quedan solo
  en tu ordenador. (También puedes usar las variables GARMIN_EMAIL/GARMIN_PASSWORD.)

  ⚠️ Nunca escribas tu contraseña dentro de este script ni la subas a ningún repo.
"""

import os
import sys
import json
import getpass

try:
    from garminconnect import Garmin
except ImportError:
    sys.exit("Falta la librería. Ejecuta primero:  pip install garminconnect")


PLAN_FILE = os.environ.get("PLAN_FILE", "plan_garmin.json")
# Carpeta donde se guarda el token de sesión, para no volver a iniciar sesión
# cada vez (evita el error 429 "demasiados intentos").
TOKENSTORE = os.environ.get("GARMINTOKENS") or os.path.join(
    os.path.expanduser("~"), ".garminconnect")


def cargar_plan(path):
    if not os.path.exists(path):
        sys.exit(f"No encuentro '{path}'. Descárgalo desde la app "
                 f"(botón '📦 Plan completo para Garmin') y déjalo en esta carpeta.")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    workouts = data.get("workouts", [])
    if not workouts:
        sys.exit("El archivo no contiene entrenamientos.")
    return data, workouts


def _leer_credenciales_locales():
    """Lee email/contraseña de un archivo local 'garmin_login.txt' (2 líneas:
    email y contraseña). Ese archivo está en .gitignore y NUNCA se sube a GitHub.
    Devuelve (email, password) o (None, None) si no existe."""
    ruta = os.environ.get("GARMIN_LOGIN_FILE", "garmin_login.txt")
    if not os.path.exists(ruta):
        return None, None
    with open(ruta, encoding="utf-8") as f:
        lineas = [l.strip() for l in f if l.strip()]
    if len(lineas) >= 2:
        return lineas[0], lineas[1]
    return None, None


def _mfa():
    """Pide el código de verificación en dos pasos cuando Garmin lo solicita."""
    return input("Código de verificación (2 pasos) que te ha llegado: ").strip()


def login():
    # 1) Si ya hay un token guardado de una vez anterior, reanudamos la sesión
    #    SIN contraseña (esto evita el límite 429 en ejecuciones siguientes).
    try:
        g = Garmin()
        g.login(TOKENSTORE)
        print(f"Sesión reanudada{(' como ' + g.display_name) if g.display_name else ''} ✅")
        return g
    except Exception:
        pass  # no había token válido: iniciamos sesión con credenciales

    # 2) Credenciales: variables de entorno → archivo local → teclado
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")
    if not (email and password):
        f_email, f_pass = _leer_credenciales_locales()
        email = email or f_email
        password = password or f_pass
    if not email:
        email = input("Email de Garmin Connect: ").strip()
    if not password:
        password = getpass.getpass("Contraseña: ")

    print("Iniciando sesión en Garmin Connect...")
    try:
        g = Garmin(email, password, prompt_mfa=_mfa)
        g.login(TOKENSTORE)  # guarda el token en TOKENSTORE para próximas veces
    except Exception as e:
        msg = str(e).lower()
        if "429" in msg or "too many" in msg:
            sys.exit("Garmin ha limitado los intentos de inicio de sesión (429). "
                     "Espera unos 15-30 minutos y vuelve a ejecutarlo UNA vez; al primer "
                     "login correcto se guarda el token y ya no se repite.")
        if "401" in msg or "unauthorized" in msg or "password" in msg:
            sys.exit("Email o contraseña incorrectos (401). Revísalos y prueba de nuevo.")
        sys.exit(f"No pude iniciar sesión: {e}")
    print("Sesión iniciada ✅ (token guardado; la próxima vez no pedirá contraseña)")
    return g


def crear_y_agendar(g, item):
    """Crea el workout y lo agenda en su fecha. Devuelve (ok, detalle)."""
    payload = item["workout"]
    nombre = payload.get("workoutName", "Workout")
    fecha = item.get("date")
    # 1) crear el entrenamiento (método propio de garminconnect)
    res = g.upload_workout(payload)
    wid = res.get("workoutId") if isinstance(res, dict) else None
    if not wid:
        return False, f"{nombre}: la API no devolvió workoutId"
    # 2) agendarlo en el calendario en su fecha
    if fecha:
        g.schedule_workout(wid, fecha)
        return True, f"{nombre}  →  {fecha}"
    return True, f"{nombre}  (creado, sin fecha)"


def main():
    data, workouts = cargar_plan(PLAN_FILE)
    print(f"Plan: {data.get('weeks', '?')} semanas · FTP {data.get('ftp', '?')} W · "
          f"{len(workouts)} entrenamientos\n")
    g = login()

    ok = 0
    fallos = []
    for i, item in enumerate(workouts, 1):
        try:
            done, detalle = crear_y_agendar(g, item)
            estado = "✅" if done else "⚠️"
            print(f"[{i:>2}/{len(workouts)}] {estado} {detalle}")
            if done:
                ok += 1
            else:
                fallos.append(detalle)
        except Exception as e:
            nombre = item.get("workout", {}).get("workoutName", f"#{i}")
            print(f"[{i:>2}/{len(workouts)}] ❌ {nombre}: {e}")
            fallos.append(f"{nombre}: {e}")

    print(f"\nHecho: {ok}/{len(workouts)} subidos y agendados.")
    if fallos:
        print("Con problemas:")
        for f in fallos:
            print("  -", f)
    print("\nAbre Garmin Connect → Entrenamiento → Calendario para verlos.")


if __name__ == "__main__":
    main()

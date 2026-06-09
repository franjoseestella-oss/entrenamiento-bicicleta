# 🚴 Entrenamiento Bici · Plan FTP

App móvil (PWA) que genera un **plan de entrenamiento de ciclismo periodizado para subir tu FTP**,
a partir de tus datos de Strava, los días que entrenas y el tiempo del que dispones.
Cada sesión se exporta como **workout importable en Garmin Connect**.

> Hecha a medida para Frantxesko (Estella). FTP de partida detectado en Strava: **200 W**.

## ✨ Qué hace

- Indicas tu **FTP actual y objetivo**, los **días de la semana** que entrenas y los **minutos** de cada día.
- Genera un plan de 4/6/8/12 semanas con periodización real:
  - **Carga progresiva** (Sweet Spot → Umbral → VO2 máx), con más volumen cada semana.
  - **Semana de descarga** cada 4 semanas.
  - **Afinamiento + test de FTP** en la última semana.
- Respeta el tiempo disponible: si un día tienes menos minutos, recorta las series para que quepa.
- **Plan editable**: toca cualquier sesión y pulsa *Editar* para cambiar el tipo, la duración, las repeticiones, los intervalos, el descanso y los vatios. Los cambios se recalculan (TSS/IF) y se guardan en el dispositivo (sobreviven al recargar).
- Calcula **vatios por zona**, **TSS** e **IF** estimados de cada sesión.
- Exporta cada workout (o todos) en el **JSON del workout-service de Garmin Connect** y un **.csv** de calendario.

## 📲 Uso

1. Abre la app en el móvil (ver *Despliegue*) e instálala desde el navegador ("Añadir a pantalla de inicio").
2. Pestaña **Configurar**: ajusta FTP, marca días + minutos, elige semanas y fecha de inicio. Pulsa **Generar plan**.
3. Pestaña **Mi plan**: toca una sesión para ver el detalle y **editarla** (✏️), o el botón ⬇️ para descargar su fichero Garmin.

## ⌚ Llevar los entrenamientos a Garmin Connect

> ⚠️ **Importante:** el botón *Importar* de la web de Garmin Connect es solo para **actividades ya
> realizadas** (`.fit/.tcx/.gpx`). Los **entrenamientos planificados NO se importan por ahí** con
> ningún formato; entran por la **API** (lo que hace el `.json` de esta app).

La forma más cómoda — **un archivo y un script** que crea los workouts **y los agenda en el calendario**:

1. En la app, pestaña **Mi plan** → **📦 Plan completo para Garmin (1 archivo)** → se descarga `plan_garmin.json`.
2. Pon `plan_garmin.json` y `subir_a_garmin.py` en la misma carpeta.
3. Instala la dependencia y ejecuta:

```bash
pip install garminconnect
python subir_a_garmin.py   # te pedirá tu email/contraseña de Garmin
```

El script crea cada entrenamiento y lo coloca en su fecha. Los verás en
*Garmin Connect → Entrenamiento → Calendario* y podrás enviarlos al dispositivo.

El JSON usa el mismo formato del workout-service que el proyecto de referencia
[sydspost/Garmin-Connect-Workout-and-Schedule-creator](https://github.com/sydspost/Garmin-Connect-Workout-and-Schedule-creator).
El botón **⬇️ Workouts sueltos** sigue disponible si prefieres los `.json` uno a uno.

## 🧱 Estructura

| Archivo | Función |
|---|---|
| `index.html` | Interfaz (2 pestañas: Configurar / Mi plan) |
| `js/planner.js` | Motor de periodización (zonas, progresión, asignación por días) |
| `js/garmin.js` | Exportador al JSON de Garmin Connect (potencia en vatios) |
| `js/app.js` | Lógica de UI, estado y descargas |
| `subir_a_garmin.py` | Sube y agenda el plan completo en Garmin Connect |
| `manifest.json`, `sw.js`, `icon.svg` | Soporte PWA (instalable, offline) |

## 🚀 Despliegue

Es estática, sirve cualquier hosting:

- **Vercel**: importa el repo (incluye `vercel.json`).
- **GitHub Pages**: Settings → Pages → rama `main` / carpeta raíz.
- **Local**: `python3 -m http.server` y abre `http://localhost:8000`.

## 🔧 Notas

- Los datos de Strava (FTP, perfil) se usaron como punto de partida; el FTP es editable en la app.
- El plan se guarda en el navegador (`localStorage`), no necesita servidor.

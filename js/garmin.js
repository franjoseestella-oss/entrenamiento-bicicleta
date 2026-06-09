/* ============================================================
   garmin.js — Exportador a Garmin Connect
   Convierte un workout abstracto (potencia en % de FTP) al JSON
   del workout-service de Garmin Connect, con objetivos de potencia
   en vatios. Es el mismo formato que sube el proyecto de referencia
   (sydspost/Garmin-Connect-Workout-and-Schedule-creator) a la API.
   ============================================================ */

/* Catálogo de tipos de Garmin Connect */
const G = {
  sport: { sportTypeId: 2, sportTypeKey: 'cycling', displayOrder: 2 },
  stepType: {
    warmup:   { stepTypeId: 1, stepTypeKey: 'warmup',   displayOrder: 1 },
    cooldown: { stepTypeId: 2, stepTypeKey: 'cooldown', displayOrder: 2 },
    interval: { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 },
    recovery: { stepTypeId: 4, stepTypeKey: 'recovery', displayOrder: 4 },
    rest:     { stepTypeId: 5, stepTypeKey: 'rest',     displayOrder: 5 },
    repeat:   { stepTypeId: 6, stepTypeKey: 'repeat',   displayOrder: 6 },
  },
  endCondition: {
    time:       { conditionTypeId: 2, conditionTypeKey: 'time',       displayOrder: 2, displayable: true },
    iterations: { conditionTypeId: 7, conditionTypeKey: 'iterations', displayOrder: 7, displayable: false },
  },
  // power.zone con targetValueOne/Two en vatios = rango de potencia personalizado
  powerTarget: { workoutTargetTypeId: 2, workoutTargetTypeKey: 'power.zone', displayOrder: 2 },
  noTarget:    { workoutTargetTypeId: 1, workoutTargetTypeKey: 'no.target',  displayOrder: 1 },
};

function watts(pct, ftp) { return Math.round((pct / 100) * ftp); }

/* Convierte un paso abstracto en un ExecutableStepDTO de Garmin */
function execStep(s, ftp, order) {
  const stepType = G.stepType[s.kind] || G.stepType.interval;
  const dto = {
    type: 'ExecutableStepDTO',
    stepId: order,
    stepOrder: order,
    stepType,
    childStepId: null,
    description: null,
    endCondition: G.endCondition.time,
    endConditionValue: s.durationSec,
    preferredEndConditionUnit: null,
    endConditionCompare: null,
  };
  if (typeof s.loPct === 'number') {
    const lo = watts(s.loPct, ftp);
    const hi = watts(s.hiPct, ftp);
    dto.targetType = G.powerTarget;
    dto.targetValueOne = Math.min(lo, hi);
    dto.targetValueTwo = Math.max(lo, hi);
    dto.zoneNumber = null;
  } else {
    dto.targetType = G.noTarget;
    dto.targetValueOne = null;
    dto.targetValueTwo = null;
    dto.zoneNumber = null;
  }
  return dto;
}

/* Aplana los pasos abstractos a workoutSteps de Garmin (con repeticiones) */
function buildSteps(absSteps, ftp, counter) {
  const out = [];
  absSteps.forEach((s) => {
    if (s.kind === 'repeat') {
      const order = counter.n++;
      const children = buildSteps(s.steps, ftp, counter);
      out.push({
        type: 'RepeatGroupDTO',
        stepId: order,
        stepOrder: order,
        stepType: G.stepType.repeat,
        childStepId: 1,
        numberOfIterations: s.iterations,
        smartRepeat: false,
        endCondition: G.endCondition.iterations,
        endConditionValue: s.iterations,
        workoutSteps: children,
      });
    } else {
      out.push(execStep(s, ftp, counter.n++));
    }
  });
  return out;
}

/* Genera el objeto JSON completo de un workout de Garmin Connect */
function toGarminWorkout(workout, ftp, opts = {}) {
  const counter = { n: 1 };
  const steps = buildSteps(workout.steps, ftp, counter);
  return {
    workoutName: opts.namePrefix ? `${opts.namePrefix} ${workout.name}` : workout.name,
    description: `FTP ${ftp}W · ${workout.durationMin} min · TSS ~${workout.tss} · ${workout.tag}`,
    sportType: G.sport,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: G.sport,
        workoutSteps: steps,
      },
    ],
  };
}

/* Empaqueta TODO el plan en un único objeto, con la fecha de cada sesión,
   para subirlo de una vez con el script subir_a_garmin.py (crea el workout
   en Garmin Connect y lo agenda en el calendario en su fecha). */
function buildPlanExport(plan) {
  const ftp = plan.config.ftp;
  const workouts = [];
  plan.weeks.forEach((w) => w.sessions.forEach((s) => {
    const d = s.dateObj instanceof Date ? s.dateObj : new Date(s.dateObj);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    workouts.push({
      date: iso,
      week: w.weekNum,
      workout: toGarminWorkout(s, ftp, { namePrefix: `S${w.weekNum}` }),
    });
  }));
  return {
    app: 'Entrenamiento Bici',
    ftp,
    weeks: plan.config.weeks,
    generated: new Date().toISOString(),
    workouts,
  };
}

/* Descarga un objeto como fichero .json en el navegador */
function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Nombre de fichero seguro */
function safeName(str) {
  return str.replace(/[^\w\dáéíóúñ\- ]/gi, '').replace(/\s+/g, '_');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { toGarminWorkout, buildPlanExport, watts };
}

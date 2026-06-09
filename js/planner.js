/* ============================================================
   planner.js — Motor de generación del plan de entrenamiento
   Objetivo: subir el FTP en ciclismo.
   Genera un plan periodizado a partir de:
     - FTP actual (W)
     - Días de la semana disponibles y minutos de cada día
     - Número de semanas del plan
   Todo el trabajo se expresa en % de FTP; garmin.js lo convierte
   a vatios para exportar a Garmin Connect.
   ============================================================ */

/* Zonas de potencia (modelo Coggan) en % de FTP */
const POWER_ZONES = [
  { key: 'z1', name: 'Z1 · Recuperación', lo: 0,   hi: 55,  color: '#5b6b7a' },
  { key: 'z2', name: 'Z2 · Resistencia',  lo: 56,  hi: 75,  color: '#2f9e44' },
  { key: 'z3', name: 'Z3 · Tempo',        lo: 76,  hi: 87,  color: '#f0a500' },
  { key: 'z4', name: 'Z4 · Umbral (FTP)', lo: 88,  hi: 105, color: '#e8590c' },
  { key: 'z5', name: 'Z5 · VO2 máx',      lo: 106, hi: 120, color: '#e03131' },
  { key: 'z6', name: 'Z6 · Anaeróbico',   lo: 121, hi: 150, color: '#9c36b5' },
];

/* Definición de cada tipo de sesión de calidad/volumen.
   Los % son del FTP. recPct = % en las recuperaciones entre series. */
const SESSION_KINDS = {
  sweetspot:  { label: 'Sweet Spot',   tag: 'SST', lo: 88,  hi: 94,  recPct: 55, zone: 'z4' },
  threshold:  { label: 'Umbral',       tag: 'FTP', lo: 98,  hi: 104, recPct: 55, zone: 'z4' },
  vo2max:     { label: 'VO2 máx',      tag: 'VO2', lo: 108, hi: 118, recPct: 50, zone: 'z5' },
  tempo:      { label: 'Tempo',        tag: 'TMP', lo: 80,  hi: 87,  recPct: 60, zone: 'z3' },
  endurance:  { label: 'Resistencia',  tag: 'END', lo: 60,  hi: 72,  recPct: 60, zone: 'z2' },
  recovery:   { label: 'Recuperación', tag: 'REC', lo: 50,  hi: 58,  recPct: 50, zone: 'z1' },
};

/* Progresión de las series por semana de bloque para cada tipo.
   Cada entrada: { reps, on (min), off (min) }.
   El índice es la "semana de bloque" (1..N). La semana de descarga
   (cada 4ª) usa una versión reducida automática. */
const PROGRESSION = {
  sweetspot: [
    { reps: 3, on: 10, off: 5 },
    { reps: 3, on: 12, off: 5 },
    { reps: 3, on: 15, off: 5 },
    { reps: 4, on: 12, off: 5 },
    { reps: 3, on: 18, off: 6 },
    { reps: 2, on: 25, off: 8 },
  ],
  threshold: [
    { reps: 4, on: 6,  off: 4 },
    { reps: 4, on: 8,  off: 4 },
    { reps: 5, on: 8,  off: 4 },
    { reps: 4, on: 10, off: 5 },
    { reps: 5, on: 10, off: 5 },
    { reps: 3, on: 15, off: 6 },
  ],
  vo2max: [
    { reps: 5, on: 3,  off: 3 },
    { reps: 6, on: 3,  off: 3 },
    { reps: 5, on: 4,  off: 4 },
    { reps: 6, on: 4,  off: 4 },
    { reps: 7, on: 3,  off: 3 },
    { reps: 8, on: 3,  off: 3 },
  ],
};

/* Días de la semana (0 = lunes ... 6 = domingo) */
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/* ---------- utilidades ---------- */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* Crea un paso ejecutable abstracto (potencia en % de FTP) */
function step(kind, minutes, loPct, hiPct) {
  return { kind, durationSec: Math.round(minutes * 60), loPct, hiPct };
}

/* Calienta/enfría según el tipo y los minutos disponibles */
function warmup(min) { return step('warmup', min, 50, 70); }
function cooldown(min) { return step('cooldown', min, 50, 60); }

/* ---------- construcción de una sesión concreta ---------- */
/*
  Construye un workout que CABE en `minutes`, para el `kind` dado y la
  semana de bloque `blockWeek` (1..). Si es semana de descarga, reduce carga.
*/
function buildWorkout(kind, blockWeek, minutes, isRecoveryWeek) {
  const K = SESSION_KINDS[kind];

  /* Sesiones continuas (sin series): resistencia, tempo, recuperación */
  if (kind === 'endurance' || kind === 'recovery' || kind === 'tempo') {
    const wu = kind === 'recovery' ? 5 : 10;
    const cd = 5;
    const main = Math.max(15, minutes - wu - cd);
    const steps = [warmup(wu), step('interval', main, K.lo, K.hi), cooldown(cd)];
    return finalizeWorkout(kind, K, steps, blockWeek, { reps: 1, on: main });
  }

  /* Sesiones de series: sweetspot / threshold / vo2max */
  const table = PROGRESSION[kind];
  let idx = clamp(blockWeek - 1, 0, table.length - 1);
  let spec = { ...table[idx] };
  if (isRecoveryWeek) {
    spec.reps = Math.max(2, Math.round(spec.reps * 0.6));
    spec.on = Math.max(3, Math.round(spec.on * 0.7));
  }

  const wuMin = 10, cdMin = 8;
  let available = minutes - wuMin - cdMin;

  /* Reduce repeticiones hasta que el bloque principal quepa en el tiempo */
  const blockMin = (s) => s.reps * s.on + (s.reps - 1) * s.off;
  while (spec.reps > 2 && blockMin(spec) > available) spec.reps -= 1;
  /* Si aún no cabe, recorta la duración de cada intervalo */
  while (spec.on > 3 && blockMin(spec) > available) spec.on -= 1;

  const interval = [];
  const inner = [
    step('interval', spec.on, K.lo, K.hi),
  ];
  if (spec.reps > 1) inner.push(step('recovery', spec.off, K.recPct - 3, K.recPct + 3));
  interval.push({
    kind: 'repeat',
    iterations: spec.reps,
    steps: spec.reps > 1 ? inner : [step('interval', spec.on, K.lo, K.hi)],
  });

  const steps = [warmup(wuMin), ...interval, cooldown(cdMin)];
  return finalizeWorkout(kind, K, steps, blockWeek, spec);
}

/* ---------- construcción manual (edición del usuario) ---------- */
/*
  Reconstruye una sesión a partir de parámetros explícitos editados a mano.
  opts = { kind, minutes, reps, onMin, offMin, loPct, hiPct, name }
  - Tipos continuos (endurance/tempo/recovery) o reps<=1 → bloque continuo
    de `minutes` totales.
  - Tipos de series → reps × onMin con offMin de recuperación.
  Devuelve el mismo formato que buildWorkout (kind, tag, zone, name,
  durationMin, tss, intensity, steps), listo para exportar a Garmin.
*/
function customWorkout(opts) {
  const kind = SESSION_KINDS[opts.kind] ? opts.kind : 'endurance';
  const K = SESSION_KINDS[kind];
  const lo = Number.isFinite(opts.loPct) ? opts.loPct : K.lo;
  const hi = Number.isFinite(opts.hiPct) ? opts.hiPct : K.hi;
  const reps = Math.max(1, Math.round(opts.reps || 1));
  const onMin = Math.max(1, opts.onMin || 0);
  const offMin = Math.max(1, opts.offMin || 4);
  const continuous = kind === 'endurance' || kind === 'recovery' || kind === 'tempo' || reps <= 1;

  let steps, spec;
  if (continuous) {
    const wu = kind === 'recovery' ? 5 : 10, cd = 5;
    const main = Math.max(10, Math.round((opts.minutes || 60) - wu - cd));
    steps = [warmup(wu), step('interval', main, lo, hi), cooldown(cd)];
    spec = { reps: 1, on: main };
  } else {
    const wuMin = 10, cdMin = 8;
    const inner = [step('interval', onMin, lo, hi)];
    if (reps > 1) inner.push(step('recovery', offMin, K.recPct - 3, K.recPct + 3));
    steps = [warmup(wuMin), { kind: 'repeat', iterations: reps, steps: inner }, cooldown(cdMin)];
    spec = { reps, on: onMin };
  }

  const wk = finalizeWorkout(kind, K, steps, 1, spec);
  if (opts.name && opts.name.trim()) wk.name = opts.name.trim();
  return wk;
}

/* Calcula duración total, TSS aproximado, nombre y descripción */
function finalizeWorkout(kind, K, steps, blockWeek, spec) {
  let totalSec = 0;
  const accumulate = (arr, mult = 1) => {
    arr.forEach((s) => {
      if (s.kind === 'repeat') accumulate(s.steps, mult * s.iterations);
      else totalSec += s.durationSec * mult;
    });
  };
  accumulate(steps);

  const mins = Math.round(totalSec / 60);
  let name;
  if (kind === 'sweetspot' || kind === 'threshold' || kind === 'vo2max') {
    name = `${K.label} ${spec.reps}x${spec.on}'`;
  } else {
    name = `${K.label} ${mins}'`;
  }

  /* Intensity Factor medio ponderado (muy aproximado) y TSS */
  let ifSum = 0;
  const ifAccum = (arr, mult = 1) => {
    arr.forEach((s) => {
      if (s.kind === 'repeat') ifAccum(s.steps, mult * s.iterations);
      else {
        const mid = (s.loPct + s.hiPct) / 200; // fracción de FTP
        ifSum += Math.pow(mid, 2) * s.durationSec * mult;
      }
    });
  };
  ifAccum(steps);
  const intensity = Math.sqrt(ifSum / totalSec);
  const tss = Math.round((totalSec * Math.pow(intensity, 2)) / 36);

  return {
    kind,
    tag: K.tag,
    zone: K.zone,
    name,
    durationMin: mins,
    tss,
    intensity: Number(intensity.toFixed(2)),
    steps,
  };
}

/* ---------- asignación semanal ---------- */
/*
  Dado el array de días disponibles [{day, minutes}], decide qué tipo de
  sesión va en cada día de esa semana, según fase y nº de días.
*/
function assignWeek(days, phase) {
  // Ordena por minutos descendente para localizar las sesiones largas
  const byTime = [...days].sort((a, b) => b.minutes - a.minutes);
  const longDayIdx = byTime[0] ? days.indexOf(byTime[0]) : -1;

  const n = days.length;
  // Cuántas sesiones de calidad según volumen de días
  let qualityTypes;
  if (phase === 'recovery') {
    qualityTypes = ['sweetspot'];
  } else if (n <= 3) {
    qualityTypes = ['sweetspot', 'threshold'];
  } else if (n === 4) {
    qualityTypes = ['sweetspot', 'threshold', 'vo2max'];
  } else {
    qualityTypes = ['vo2max', 'threshold', 'sweetspot'];
  }

  const assignment = new Array(days.length).fill('endurance');

  // El día más largo es la salida de resistencia (con tempo si es muy largo)
  if (longDayIdx >= 0 && days[longDayIdx].minutes >= 120) {
    assignment[longDayIdx] = 'endurance';
  }

  // Coloca las sesiones de calidad en días cortos/medios, intentando
  // dejar descanso entre ellas. Evita el día largo.
  const candidateIdx = days
    .map((d, i) => ({ i, minutes: d.minutes }))
    .filter((d) => d.i !== longDayIdx && d.minutes >= 45)
    .map((d) => d.i);

  // Reparte de forma espaciada
  let qi = 0;
  const spaced = spaceOut(candidateIdx, qualityTypes.length);
  spaced.forEach((idx) => {
    if (qi < qualityTypes.length) assignment[idx] = qualityTypes[qi++];
  });

  // Si sobran días sin asignar calidad, alterna resistencia y recuperación
  for (let i = 0; i < assignment.length; i++) {
    if (assignment[i] === 'endurance' && days[i].minutes < 50 && i !== longDayIdx) {
      assignment[i] = 'recovery';
    }
  }
  if (phase === 'recovery') {
    // Semana de descarga: solo 1 calidad suave, resto resistencia/recuperación
    for (let i = 0; i < assignment.length; i++) {
      if (['threshold', 'vo2max'].includes(assignment[i])) assignment[i] = 'endurance';
    }
  }
  return assignment;
}

/* Elige `count` índices repartidos lo más espaciados posible dentro de arr */
function spaceOut(arr, count) {
  if (count >= arr.length) return arr.slice();
  const out = [];
  const stepSize = (arr.length - 1) / (count - 1 || 1);
  for (let k = 0; k < count; k++) out.push(arr[Math.round(k * stepSize)]);
  return [...new Set(out)];
}

/* ---------- generación del plan completo ---------- */
/*
  config = {
    ftp: 200,
    targetFtp: 220,
    weeks: 8,
    startDate: '2026-06-15',
    days: [{ day: 0..6, minutes }] // solo los días que entrena
  }
*/
function generatePlan(config) {
  const { ftp, weeks, startDate, days } = config;
  const start = parseLocalDate(startDate);
  const plan = { config, weeks: [] };

  let blockWeek = 1; // posición dentro del bloque de 4 semanas

  for (let w = 0; w < weeks; w++) {
    const weekNum = w + 1;
    const isRecoveryWeek = (weekNum % 4 === 0) && weekNum !== weeks; // cada 4ª salvo la última
    const isTaper = weekNum === weeks; // última semana = afinamiento + test
    const phase = isRecoveryWeek ? 'recovery' : (isTaper ? 'taper' : 'build');

    let assignment;
    if (isTaper) {
      assignment = days.map((d, i) => (i === 0 ? 'threshold' : 'endurance'));
    } else {
      assignment = assignWeek(days, phase);
    }

    const sessions = days.map((d, i) => {
      const kind = assignment[i];
      const recWeek = isRecoveryWeek || isTaper;
      const wk = buildWorkout(kind, blockWeek, d.minutes, recWeek);
      const date = addDays(start, w * 7 + d.day);
      return { ...wk, weekday: d.day, weekdayLabel: WEEKDAYS[d.day], date: fmtDate(date), dateObj: date };
    });

    const weekTss = sessions.reduce((s, x) => s + x.tss, 0);
    const weekMin = sessions.reduce((s, x) => s + x.durationMin, 0);

    plan.weeks.push({
      weekNum,
      phase,
      blockWeek,
      recWeek: isRecoveryWeek || isTaper,
      label: phaseLabel(phase, weekNum, weeks),
      sessions,
      tss: weekTss,
      minutes: weekMin,
    });

    blockWeek = isRecoveryWeek ? 1 : blockWeek + 1;
    if (blockWeek > 6) blockWeek = 4; // mantiene carga alta en bloques avanzados
  }

  return plan;
}

function phaseLabel(phase, weekNum, total) {
  if (phase === 'recovery') return 'Semana de descarga';
  if (phase === 'taper') return 'Afinamiento + test FTP';
  return 'Carga progresiva';
}

/* ---------- fechas ---------- */
function parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
function fmtDate(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* Exporta para navegador y para Node (tests) */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generatePlan, buildWorkout, customWorkout, POWER_ZONES, SESSION_KINDS, WEEKDAYS };
}

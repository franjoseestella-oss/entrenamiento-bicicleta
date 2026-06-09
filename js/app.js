/* ============================================================
   app.js — Interfaz de la app de entrenamiento
   ============================================================ */

const STORE_KEY = 'entrenamiento_bici_v1';
const PLAN_KEY = 'entrenamiento_bici_plan_v1';
let currentPlan = null;

/* ---------- estado / persistencia ---------- */
const defaultState = () => ({
  ftp: 200,
  targetFtp: 220,
  weeks: 8,
  startDate: nextMonday(),
  // días marcados con sus minutos (0=Lun .. 6=Dom)
  // Por defecto: 3 días/semana → Mar 1,5h + Jue 1,5h (calidad) + Sáb 3h (salida larga)
  days: {
    1: { on: true, minutes: 90 },
    3: { on: true, minutes: 90 },
    5: { on: true, minutes: 180 },
  },
});

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    return s && s.days ? s : defaultState();
  } catch { return defaultState(); }
}
function saveState(s) { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }

/* Guarda / recupera el plan generado (con las ediciones del usuario) */
function savePlan() {
  if (currentPlan) localStorage.setItem(PLAN_KEY, JSON.stringify(currentPlan));
}
function loadPlan() {
  try {
    const p = JSON.parse(localStorage.getItem(PLAN_KEY));
    if (!p || !p.weeks) return null;
    // dateObj se serializa como ISO string → revivir a Date
    p.weeks.forEach((w) => w.sessions.forEach((s) => { s.dateObj = new Date(s.dateObj); }));
    return p;
  } catch { return null; }
}

let state = loadState();

function nextMonday() {
  const d = new Date();
  const day = (d.getDay() + 6) % 7; // 0=Lun
  d.setDate(d.getDate() + ((7 - day) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

/* ---------- navegación ---------- */
function switchView(view) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
  window.scrollTo(0, 0);
}
document.querySelectorAll('.nav-item').forEach((n) => {
  n.addEventListener('click', () => switchView(n.dataset.view));
});

function toast(msg) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/* ---------- render: días ---------- */
const MINUTE_OPTIONS = [30, 45, 60, 75, 90, 120, 150, 180, 210, 240];

function renderDays() {
  const grid = document.getElementById('days-grid');
  grid.innerHTML = '';
  WEEKDAYS_FULL.forEach((label, i) => {
    const d = state.days[i] || { on: false, minutes: 60 };
    const card = document.createElement('div');
    card.className = 'day-card' + (d.on ? ' on' : '');
    card.innerHTML = `
      <div class="day-toggle" data-day="${i}">${WEEKDAYS_SHORT[i]}</div>
      <div class="day-name">${label}</div>
      <div class="min-wrap">
        <select data-min="${i}">
          ${MINUTE_OPTIONS.map((m) => `<option value="${m}" ${m === d.minutes ? 'selected' : ''}>${fmtMin(m)}</option>`).join('')}
        </select>
      </div>`;
    grid.appendChild(card);
  });
  grid.querySelectorAll('.day-toggle').forEach((el) => {
    el.addEventListener('click', () => {
      const i = +el.dataset.day;
      const d = state.days[i] || { on: false, minutes: 60 };
      d.on = !d.on;
      state.days[i] = d;
      saveState(state); renderDays();
    });
  });
  grid.querySelectorAll('select[data-min]').forEach((el) => {
    el.addEventListener('change', () => {
      const i = +el.dataset.min;
      state.days[i].minutes = +el.value;
      saveState(state);
    });
  });
}

const WEEKDAYS_FULL = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const WEEKDAYS_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
function fmtMin(m) { return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m} min`; }

/* ---------- render: zonas de potencia ---------- */
function renderZones() {
  const ftp = state.ftp;
  const wrap = document.getElementById('zones-table');
  wrap.innerHTML = POWER_ZONES.map((z) => {
    const lo = Math.round((z.lo / 100) * ftp);
    const hi = z.hi >= 150 ? '∞' : Math.round((z.hi / 100) * ftp);
    return `<div class="zone-row">
      <span class="zone-dot" style="background:${z.color}"></span>
      <span class="zone-name">${z.name}</span>
      <span class="zone-watts">${lo}–${hi} W</span>
    </div>`;
  }).join('');
}

/* ---------- inputs FTP / semanas / fecha ---------- */
function bindInputs() {
  const ftp = document.getElementById('ftp');
  const tftp = document.getElementById('targetFtp');
  const weeks = document.getElementById('weeks');
  const sd = document.getElementById('startDate');
  ftp.value = state.ftp; tftp.value = state.targetFtp;
  weeks.value = state.weeks; sd.value = state.startDate;

  ftp.addEventListener('input', () => { state.ftp = +ftp.value || 200; saveState(state); renderZones(); });
  tftp.addEventListener('input', () => { state.targetFtp = +tftp.value || 0; saveState(state); });
  weeks.addEventListener('change', () => { state.weeks = +weeks.value; saveState(state); });
  sd.addEventListener('change', () => { state.startDate = sd.value; saveState(state); });
}

/* ---------- generar plan ---------- */
function buildConfig() {
  const days = Object.keys(state.days)
    .map(Number)
    .filter((i) => state.days[i].on)
    .sort((a, b) => a - b)
    .map((i) => ({ day: i, minutes: state.days[i].minutes }));
  return {
    ftp: state.ftp,
    targetFtp: state.targetFtp,
    weeks: state.weeks,
    startDate: state.startDate,
    days,
  };
}

document.getElementById('btn-generate').addEventListener('click', () => {
  const cfg = buildConfig();
  if (cfg.days.length < 2) { toast('Marca al menos 2 días de entrenamiento'); return; }
  currentPlan = generatePlan(cfg);
  savePlan();
  renderPlan();
  switchView('plan');
  toast('Plan generado ✅');
});

/* ---------- render: plan ---------- */
const ZONE_COLORS = Object.fromEntries(POWER_ZONES.map((z) => [z.key, z.color]));

function renderPlan() {
  if (!currentPlan) {
    document.getElementById('plan-title').textContent = 'Aún no hay plan';
    document.getElementById('plan-sub').textContent = 'Ve a Configurar y pulsa “Generar plan”.';
    document.getElementById('plan-weeks').innerHTML = '';
    return;
  }
  const totalTss = currentPlan.weeks.reduce((s, w) => s + w.tss, 0);
  document.getElementById('plan-title').textContent =
    `${currentPlan.config.weeks} semanas · FTP ${currentPlan.config.ftp}→${currentPlan.config.targetFtp} W`;
  document.getElementById('plan-sub').textContent =
    `${currentPlan.config.days.length} días/semana · TSS total ~${totalTss}`;

  const wrap = document.getElementById('plan-weeks');
  wrap.innerHTML = currentPlan.weeks.map((w, wi) => {
    const rows = w.sessions.map((s, si) => `
      <div class="session-card" data-w="${wi}" data-s="${si}">
        <span class="sess-tag" style="background:${ZONE_COLORS[s.zone]}">${s.tag}</span>
        <div class="sess-main">
          <div class="sess-name">${s.name}</div>
          <div class="sess-meta">${s.weekdayLabel} ${s.date} · ${s.durationMin} min · TSS ${s.tss} · IF ${s.intensity}</div>
        </div>
        <button class="sess-dl" data-dlw="${wi}" data-dls="${si}" title="Descargar para Garmin">⬇️</button>
      </div>`).join('');
    const cls = w.phase === 'recovery' ? ' recovery' : (w.phase === 'taper' ? ' taper' : '');
    return `<div class="week-block">
      <div class="week-bar${cls}">
        <div><div class="wtitle">Semana ${w.weekNum}</div><div class="wlabel">${w.label}</div></div>
        <div class="wstats">${Math.round(w.minutes / 60 * 10) / 10} h · TSS ${w.tss}</div>
      </div>
      ${rows}
    </div>`;
  }).join('');

  // abrir detalle
  wrap.querySelectorAll('.session-card').forEach((c) => {
    c.addEventListener('click', (e) => {
      if (e.target.classList.contains('sess-dl')) return;
      openWorkout(+c.dataset.w, +c.dataset.s);
    });
  });
  // descargar individual
  wrap.querySelectorAll('.sess-dl').forEach((b) => {
    b.addEventListener('click', () => downloadOne(+b.dataset.dlw, +b.dataset.dls));
  });
}

/* ---------- detalle de workout ---------- */
function describeStep(s, ftp) {
  const w = (p) => Math.round((p / 100) * ftp);
  const mins = Math.round(s.durationSec / 60);
  const secs = s.durationSec % 60;
  const dur = secs ? `${mins}:${String(secs).padStart(2, '0')}` : `${mins} min`;
  const power = typeof s.loPct === 'number' ? `${w(s.loPct)}–${w(s.hiPct)} W (${s.loPct}–${s.hiPct}% FTP)` : '';
  const labels = { warmup: 'Calentamiento', cooldown: 'Vuelta a la calma', interval: 'Intervalo', recovery: 'Recuperación', rest: 'Descanso' };
  return { label: labels[s.kind] || s.kind, dur, power };
}

function openWorkout(wi, si) {
  const s = currentPlan.weeks[wi].sessions[si];
  const ftp = currentPlan.config.ftp;
  const stepHtml = (steps, inRepeat = false) => steps.map((st) => {
    if (st.kind === 'repeat') {
      return `<div class="step-rep"><div class="muted" style="margin:4px 0;font-weight:600">↻ ${st.iterations}× repetir</div>${stepHtml(st.steps, true)}</div>`;
    }
    const d = describeStep(st, ftp);
    return `<div class="step-item">
      <span class="step-bar" style="background:${zoneColorForPct(st.loPct)}"></span>
      <div style="flex:1"><strong>${d.label}</strong> · ${d.dur}<br><span class="muted">${d.power}</span></div>
    </div>`;
  }).join('');

  document.getElementById('modal-content').innerHTML = `
    <h3>${s.name}</h3>
    <p class="muted">${s.weekdayLabel} ${s.date} · ${s.durationMin} min · TSS ~${s.tss} · IF ${s.intensity}</p>
    <div class="step-list">${stepHtml(s.steps)}</div>
    <button class="btn-primary modal-close" id="modal-dl">⬇️ Descargar para Garmin Connect</button>
    <button class="btn-secondary modal-close" id="modal-edit">✏️ Editar sesión</button>
    <button class="btn-secondary modal-close" id="modal-x">Cerrar</button>`;
  document.getElementById('modal-overlay').classList.add('open');
  document.getElementById('modal-dl').onclick = () => downloadOne(wi, si);
  document.getElementById('modal-edit').onclick = () => openEditForm(wi, si);
  document.getElementById('modal-x').onclick = closeModal;
}

/* ---------- edición de una sesión ---------- */
/* Deduce los parámetros editables (reps, intervalo, descanso, potencia)
   a partir de los pasos de la sesión, para precargar el formulario. */
function extractSpec(s) {
  let reps = 1, onMin = 0, offMin = 4, loPct, hiPct;
  const rep = s.steps.find((st) => st.kind === 'repeat');
  if (rep) {
    reps = rep.iterations;
    const intv = rep.steps.find((x) => x.kind === 'interval');
    const rec = rep.steps.find((x) => x.kind === 'recovery');
    if (intv) { onMin = Math.round(intv.durationSec / 60); loPct = intv.loPct; hiPct = intv.hiPct; }
    if (rec) offMin = Math.round(rec.durationSec / 60);
  } else {
    const main = s.steps.find((st) => st.kind === 'interval');
    if (main) { onMin = Math.round(main.durationSec / 60); loPct = main.loPct; hiPct = main.hiPct; }
  }
  return { reps, onMin, offMin, loPct: loPct ?? 0, hiPct: hiPct ?? 0 };
}

const KIND_LABELS = {
  sweetspot: 'Sweet Spot', threshold: 'Umbral', vo2max: 'VO2 máx',
  tempo: 'Tempo', endurance: 'Resistencia', recovery: 'Recuperación',
};
const CONTINUOUS_KINDS = ['endurance', 'tempo', 'recovery'];

function editFormFields(kind, sp, ftp, durationMin) {
  const isCont = CONTINUOUS_KINDS.includes(kind);
  const w = (p) => Math.round((p / 100) * ftp);
  const intervalFields = `
    <div class="row">
      <label class="field"><span>Repeticiones</span>
        <input type="number" id="ed-reps" min="1" max="20" step="1" value="${sp.reps}" inputmode="numeric" /></label>
      <label class="field"><span>Min / intervalo</span>
        <input type="number" id="ed-on" min="1" max="60" step="1" value="${sp.onMin}" inputmode="numeric" /></label>
    </div>
    <label class="field"><span>Descanso entre series (min)</span>
      <input type="number" id="ed-off" min="1" max="20" step="1" value="${sp.offMin}" inputmode="numeric" /></label>`;
  const contFields = `
    <label class="field"><span>Duración total (min)</span>
      <input type="number" id="ed-dur" min="20" max="360" step="5" value="${durationMin}" inputmode="numeric" /></label>`;
  return `
    ${isCont ? contFields : intervalFields}
    <div class="row">
      <label class="field"><span>Potencia mín (% FTP)</span>
        <input type="number" id="ed-lo" min="40" max="180" step="1" value="${sp.loPct}" inputmode="numeric" /></label>
      <label class="field"><span>Potencia máx (% FTP)</span>
        <input type="number" id="ed-hi" min="40" max="200" step="1" value="${sp.hiPct}" inputmode="numeric" /></label>
    </div>
    <p class="muted" id="ed-watts">${sp.loPct ? `${w(sp.loPct)}–${w(sp.hiPct)} W a tu FTP de ${ftp} W` : ''}</p>`;
}

function openEditForm(wi, si) {
  const s = currentPlan.weeks[wi].sessions[si];
  const ftp = currentPlan.config.ftp;
  const sp = extractSpec(s);
  const kindOpts = Object.keys(KIND_LABELS)
    .map((k) => `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${KIND_LABELS[k]}</option>`).join('');

  document.getElementById('modal-content').innerHTML = `
    <h3>Editar sesión</h3>
    <p class="muted">${s.weekdayLabel} ${s.date}</p>
    <label class="field"><span>Nombre</span>
      <input type="text" id="ed-name" value="${s.name.replace(/"/g, '&quot;')}" /></label>
    <label class="field"><span>Tipo de sesión</span>
      <select id="ed-kind">${kindOpts}</select></label>
    <div id="ed-fields">${editFormFields(s.kind, sp, ftp, s.durationMin)}</div>
    <button class="btn-primary modal-close" id="ed-save">💾 Guardar cambios</button>
    <button class="btn-secondary modal-close" id="ed-cancel">Cancelar</button>`;

  const fieldsWrap = document.getElementById('ed-fields');
  const kindSel = document.getElementById('ed-kind');

  // Al cambiar el tipo, recarga los campos y la potencia por defecto del tipo
  kindSel.addEventListener('change', () => {
    const k = kindSel.value;
    const def = SESSION_KINDS[k];
    const base = CONTINUOUS_KINDS.includes(k)
      ? { reps: 1, onMin: 0, offMin: 4, loPct: def.lo, hiPct: def.hi }
      : { reps: sp.reps > 1 ? sp.reps : 4, onMin: sp.onMin || 8, offMin: sp.offMin || 4, loPct: def.lo, hiPct: def.hi };
    const dur = CONTINUOUS_KINDS.includes(k) ? (s.durationMin || 90) : s.durationMin;
    fieldsWrap.innerHTML = editFormFields(k, base, ftp, dur);
    bindWattsPreview(ftp);
  });
  bindWattsPreview(ftp);

  document.getElementById('ed-cancel').onclick = () => openWorkout(wi, si);
  document.getElementById('ed-save').onclick = () => saveEdit(wi, si);
}

function bindWattsPreview(ftp) {
  const lo = document.getElementById('ed-lo');
  const hi = document.getElementById('ed-hi');
  const out = document.getElementById('ed-watts');
  if (!lo || !hi || !out) return;
  const upd = () => {
    const l = Math.round((+lo.value / 100) * ftp);
    const h = Math.round((+hi.value / 100) * ftp);
    out.textContent = `${l}–${h} W a tu FTP de ${ftp} W`;
  };
  lo.addEventListener('input', upd); hi.addEventListener('input', upd);
}

function saveEdit(wi, si) {
  const old = currentPlan.weeks[wi].sessions[si];
  const ftp = currentPlan.config.ftp;
  const kind = document.getElementById('ed-kind').value;
  const val = (id) => { const e = document.getElementById(id); return e ? +e.value : undefined; };
  const opts = {
    kind,
    name: document.getElementById('ed-name').value,
    minutes: val('ed-dur'),
    reps: val('ed-reps'),
    onMin: val('ed-on'),
    offMin: val('ed-off'),
    loPct: val('ed-lo'),
    hiPct: val('ed-hi'),
  };
  const wk = customWorkout(opts);
  // conserva fecha y día de la semana de la sesión original
  currentPlan.weeks[wi].sessions[si] = {
    ...wk,
    weekday: old.weekday, weekdayLabel: old.weekdayLabel, date: old.date, dateObj: old.dateObj,
  };
  // recalcula totales de la semana
  const week = currentPlan.weeks[wi];
  week.tss = week.sessions.reduce((a, x) => a + x.tss, 0);
  week.minutes = week.sessions.reduce((a, x) => a + x.durationMin, 0);

  savePlan();
  renderPlan();
  openWorkout(wi, si);
  toast('Sesión actualizada ✅');
}
function closeModal() { document.getElementById('modal-overlay').classList.remove('open'); }
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') closeModal();
});

function zoneColorForPct(pct) {
  if (typeof pct !== 'number') return '#5b6b7a';
  const z = POWER_ZONES.find((z) => pct <= z.hi) || POWER_ZONES[POWER_ZONES.length - 1];
  return z.color;
}

/* ---------- descargas Garmin ---------- */
function downloadOne(wi, si) {
  const s = currentPlan.weeks[wi].sessions[si];
  const ftp = currentPlan.config.ftp;
  const prefix = `S${currentPlan.weeks[wi].weekNum}`;
  const g = toGarminWorkout(s, ftp, { namePrefix: prefix });
  const fname = `${prefix}_${s.weekdayLabel}_${safeName(s.name)}.json`;
  downloadJSON(g, fname);
  toast('Descargado: ' + fname);
}

/* Plan completo en un único archivo (con fechas) para subir+agendar con el script */
document.getElementById('btn-download-plan').addEventListener('click', () => {
  if (!currentPlan) return;
  const data = buildPlanExport(currentPlan);
  downloadJSON(data, 'plan_garmin.json');
  toast('plan_garmin.json descargado · súbelo con el script');
});

document.getElementById('btn-download-all').addEventListener('click', async () => {
  if (!currentPlan) return;
  const ftp = currentPlan.config.ftp;
  let count = 0;
  for (const w of currentPlan.weeks) {
    for (const s of w.sessions) {
      const g = toGarminWorkout(s, ftp, { namePrefix: `S${w.weekNum}` });
      const fname = `S${w.weekNum}_${s.weekdayLabel}_${safeName(s.name)}.json`;
      downloadJSON(g, fname);
      count++;
      await new Promise((r) => setTimeout(r, 250)); // separa las descargas
    }
  }
  toast(`${count} workouts descargados`);
});

/* CSV de calendario para importar en Google Calendar / referencia */
document.getElementById('btn-download-schedule').addEventListener('click', () => {
  if (!currentPlan) return;
  const rows = [['Subject', 'Start Date', 'Description']];
  currentPlan.weeks.forEach((w) => w.sessions.forEach((s) => {
    const d = s.dateObj;
    const dd = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
    rows.push([`🚴 ${s.name}`, dd, `${s.durationMin} min · TSS ${s.tss} · ${s.tag}`]);
  }));
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'calendario_entrenamiento.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Calendario .csv descargado');
});

/* ---------- init ---------- */
renderDays();
renderZones();
bindInputs();
currentPlan = loadPlan();
renderPlan(); // muestra el plan guardado (con tus ediciones) o el aviso

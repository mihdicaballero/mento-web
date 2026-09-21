// UI for the beam calculator. All engineering happens in shared/worker.js (Pyodide + mento).

const $ = (id) => document.getElementById(id);

const TEXT = {
  es: {
    pageTitle: "mento · Diseño de vigas de hormigón armado",
    docs: "Docs",
    title: "Viga rectangular de hormigón armado",
    subtitle: "Cargá la sección y los esfuerzos. mento elige la armadura y verifica flexión y corte según la norma.",
    code: "Norma", materials: "Materiales", concrete: "hormigón", steel: "acero",
    section: "Sección", width: "ancho", height: "altura", cover: "recubrimiento",
    forces: "Esfuerzos de diseño",
    forcesHint: "Mayorados. Momento positivo tracciona abajo; negativo, arriba.",
    comb: "Combinación", addForce: "Agregar combinación", remove: "Quitar",
    rebar: "Armadura", modeDesign: "Que la elija mento", modeCheck: "La pongo yo",
    bottom: "Inferior", top: "Superior", stirrups: "Estribos",
    rebarHint: "Cantidad y diámetro en mm. Dejá en 0 lo que no uses.",
    loadingHint: "Solo la primera vez. Después queda guardado en tu navegador.",
    loading: "Preparando el motor de cálculo…",
    steps: { python: "Python en tu navegador", packages: "numpy, pandas, matplotlib", mento: "mento", warmup: "Calentando motores" },
    report: "Descargar memoria (Word)", reportBusy: "Armando la memoria…", share: "Copiar link",
    tblFlexure: "Flexión por combinación", tblShear: "Corte por combinación",
    detailed: "Cálculo paso a paso", python: "El mismo cálculo en Python",
    pythonHint: "Esta página usa el paquete open source mento. Con estas líneas obtenés lo mismo en un notebook.",
    copy: "Copiar", copied: "Copiado", linkCopied: "Link copiado: abre esta misma viga",
    feedback: "Contanos qué te pareció",
    disclaimer: "Herramienta gratuita y open source, sin garantías. Los resultados deben ser revisados por un profesional habilitado, que es quien responde por el diseño. Nada de lo que cargues sale de tu dispositivo: el cálculo corre en tu navegador.",
    okDesign: "Listo, la viga verifica", okCheck: "La viga verifica", bad: "La viga no verifica",
    maxDcr: "Aprovechamiento máximo", flexBot: "Flexión · cara inferior", flexTop: "Flexión · cara superior", shear: "Corte",
    none: "No necesita", provided: "colocada", required: "necesaria", capacity: "resiste",
    notEnough: "falta armadura",
    errInput: { fc: "Revisá la resistencia del hormigón.", fy: "Revisá la tensión de fluencia del acero.", width: "Revisá el ancho.", height: "Revisá la altura.", cover: "Revisá el recubrimiento.", forces: "Cargá al menos un momento o un corte para empezar.", rebar: "Poné al menos la armadura inferior.", code: "Elegí una norma." },
    errMento: "mento no pudo resolver esta viga:",
    fatal: "No se pudo cargar el motor de cálculo. Revisá tu conexión y recargá la página.",
  },
  en: {
    pageTitle: "mento · Reinforced concrete beam design",
    docs: "Docs",
    title: "Rectangular reinforced concrete beam",
    subtitle: "Enter the section and the forces. mento picks the rebar and checks flexure and shear against the code.",
    code: "Design code", materials: "Materials", concrete: "concrete", steel: "steel",
    section: "Section", width: "width", height: "height", cover: "clear cover",
    forces: "Design forces",
    forcesHint: "Factored. Positive moment puts the bottom in tension; negative, the top.",
    comb: "Combination", addForce: "Add combination", remove: "Remove",
    rebar: "Reinforcement", modeDesign: "Let mento choose", modeCheck: "I'll enter it",
    bottom: "Bottom", top: "Top", stirrups: "Stirrups",
    rebarHint: "Count and diameter in mm. Leave at 0 what you don't use.",
    loadingHint: "First visit only. After that it's cached in your browser.",
    loading: "Getting the calculation engine ready…",
    steps: { python: "Python in your browser", packages: "numpy, pandas, matplotlib", mento: "mento", warmup: "Warming up" },
    report: "Download report (Word)", reportBusy: "Building the report…", share: "Copy link",
    tblFlexure: "Flexure by combination", tblShear: "Shear by combination",
    detailed: "Step-by-step calculation", python: "The same calculation in Python",
    pythonHint: "This page runs the open source package mento. These lines give you the same result in a notebook.",
    copy: "Copy", copied: "Copied", linkCopied: "Link copied: it opens this same beam",
    feedback: "Tell us what you think",
    disclaimer: "Free and open source tool, provided without warranty. Results must be reviewed by a licensed professional, who remains responsible for the design. Nothing you enter leaves your device: the calculation runs in your browser.",
    okDesign: "Done, the beam passes", okCheck: "The beam passes", bad: "The beam does not pass",
    maxDcr: "Highest utilization", flexBot: "Flexure · bottom face", flexTop: "Flexure · top face", shear: "Shear",
    none: "Not needed", provided: "provided", required: "required", capacity: "capacity",
    notEnough: "not enough steel",
    errInput: { fc: "Check the concrete strength.", fy: "Check the steel yield strength.", width: "Check the width.", height: "Check the height.", cover: "Check the cover.", forces: "Enter at least one moment or shear to get started.", rebar: "Enter at least the bottom reinforcement.", code: "Pick a design code." },
    errMento: "mento could not solve this beam:",
    fatal: "The calculation engine could not be loaded. Check your connection and reload the page.",
  },
};

const DEFAULT_FY = { "ACI 318-19": 420, "CIRSOC 201-25": 420, "EN 1992-2004": 500 };
const DEFAULTS = {
  code: "CIRSOC 201-25", lang: (navigator.language || "es").startsWith("es") ? "es" : "en", mode: "design", label: "V1",
  fc: 25, fy: 420, width: 20, height: 50, cover: 25,
  forces: [{ label: "1.2D+1.6L", M_y: 90, V_z: 75 }, { label: "1.2D+1.6L (apoyo)", M_y: -60, V_z: 110 }],
  rebar: { bot: { n1: 2, d1: 16, n2: 0, d2: 0 }, top: { n1: 2, d1: 12, n2: 0, d2: 0 }, stirrups: { n: 1, d: 6, s: 15 } },
};
const NUMERIC = ["fc", "fy", "width", "height", "cover"];
const REBAR_IDS = { bot_n1: ["bot", "n1"], bot_d1: ["bot", "d1"], bot_n2: ["bot", "n2"], bot_d2: ["bot", "d2"], top_n1: ["top", "n1"], top_d1: ["top", "d1"], top_n2: ["top", "n2"], top_d2: ["top", "d2"], st_n: ["stirrups", "n"], st_d: ["stirrups", "d"], st_s: ["stirrups", "s"] };

// ---------- state ----------
const encode = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (text) => JSON.parse(decodeURIComponent(escape(atob(text.replace(/-/g, "+").replace(/_/g, "/")))));

function loadState() {
  let saved = {};
  try {
    if (location.hash.length > 1) saved = decode(location.hash.slice(1));
    else saved = JSON.parse(localStorage.getItem("mento-beam") || "{}");
  } catch { saved = {}; }
  const state = { ...structuredClone(DEFAULTS), ...saved };
  if (!Array.isArray(state.forces) || !state.forces.length) state.forces = structuredClone(DEFAULTS.forces);
  state.rebar = { ...structuredClone(DEFAULTS.rebar), ...(saved.rebar || {}) };
  return state;
}

const state = loadState();
let t = TEXT[state.lang] || TEXT.es;
let lastResult = null;

function persist() {
  try { localStorage.setItem("mento-beam", JSON.stringify(state)); } catch { /* private mode */ }
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

// ---------- worker ----------
const worker = new Worker("../shared/worker.js?module=beam");
const pending = new Map();
let nextId = 1;
let ready = false;
let latestRun = 0;

function call(type, payload) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}

worker.onmessage = ({ data }) => {
  if (data.type === "progress") return showStep(data.step);
  if (data.type === "ready") {
    ready = true;
    $("loading").hidden = true;
    $("versionTag").textContent = `mento ${data.version}`;
    return calculate();
  }
  if (data.type === "fatal") {
    $("loading").hidden = true;
    return showError(t.fatal);
  }
  const entry = pending.get(data.id);
  if (!entry) return;
  pending.delete(data.id);
  data.ok ? entry.resolve(data.result) : entry.reject(new Error(data.error));
};

function showStep(step) {
  let seen = false;
  for (const li of $("steps").children) {
    const current = li.dataset.step === step;
    li.className = current ? "active" : seen ? "" : "done";
    if (current) seen = true;
  }
}

// ---------- calculate ----------
let timer = 0;
function schedule() {
  persist();
  $("pycode").textContent = pythonCode();
  if (!ready) return;
  $("output").classList.add("stale");
  clearTimeout(timer);
  timer = setTimeout(calculate, 350);
}

async function calculate() {
  const runId = ++latestRun;
  let result;
  try { result = await call("run", state); } catch (error) { result = { ok: false, kind: "mento", message: error.message }; }
  if (runId !== latestRun) return; // a newer edit is already on its way
  render(result);
}

function showError(message, soft = false) {
  const box = $("error");
  box.hidden = !message;
  box.textContent = message || "";
  box.classList.toggle("soft", soft);
}

function render(result) {
  document.querySelectorAll(".input.invalid").forEach((el) => el.classList.remove("invalid"));
  if (!result.ok) {
    lastResult = null;
    if (result.kind === "input") {
      showError(t.errInput[result.field] || result.message, result.field === "forces");
      $(result.field)?.closest(".input")?.classList.add("invalid");
    } else {
      showError(`${t.errMento} ${result.message}`);
    }
    $("output").hidden = true;
    updateDock();
    return;
  }
  lastResult = result;
  showError("");
  $("output").hidden = false;
  $("output").classList.remove("stale");

  const { flexure, shear } = result;
  const eurocode = result.code.startsWith("EN");
  const mCap = eurocode ? "M<sub>Rd</sub>" : "ØM<sub>n</sub>";
  const vCap = eurocode ? "V<sub>Rd</sub>" : "ØV<sub>n</sub>";

  const checks = [];
  const faceCheck = (name, face) => {
    if (!face.bars && face.DCR === 0) return;
    checks.push({ name, dcr: face.DCR, enough: face.enough,
      meta: `A<sub>s</sub> ${t.provided} ${face.A_s} · ${t.required} ${face.A_s_req} · ${mCap} ${face.M_capacity}` });
  };
  faceCheck(t.flexBot, flexure.bottom);
  faceCheck(t.flexTop, flexure.top);
  checks.push({ name: t.shear, dcr: shear.DCR, enough: shear.enough,
    meta: `A<sub>v</sub> ${t.provided} ${shear.A_v} · ${t.required} ${shear.A_v_req ?? "–"} · ${vCap} ${shear.V_capacity ?? "–"}` });

  const maxDcr = Math.max(...checks.map((c) => c.dcr));
  const passes = checks.every((c) => c.dcr <= 1 && c.enough);
  result.summary = { passes, maxDcr };

  $("verdict").className = `verdict${passes ? "" : " bad"}`;
  $("verdict").innerHTML = `<span class="mark">${passes ? "✓" : "✕"}</span><span>${passes ? (state.mode === "design" ? t.okDesign : t.okCheck) : t.bad}<small>${t.maxDcr}: ${(maxDcr * 100).toFixed(0)} %</small></span>`;

  const setBars = (id, text) => { $(id).textContent = text || t.none; $(id).classList.toggle("none", !text); };
  setBars("outTop", flexure.top.bars);
  setBars("outBot", flexure.bottom.bars);
  setBars("outStirrups", shear.stirrups);

  $("drawing").innerHTML = result.svg;
  $("checks").innerHTML = checks.map((c) => {
    const level = c.dcr > 1 || !c.enough ? "bad" : "";
    const note = !c.enough && c.dcr <= 1 ? ` · ${t.notEnough}` : "";
    return `<div class="check ${level}"><span class="name">${c.name}</span><span class="dcr">${(c.dcr * 100).toFixed(0)} %${note}</span>
      <div class="bar"><span style="width:${Math.min(c.dcr, 1) * 100}%"></span></div><span class="meta">${c.meta}</span></div>`;
  }).join("");

  $("tblFlexure").innerHTML = result.tables.flexure;
  $("tblShear").innerHTML = result.tables.shear;
  $("detailed").textContent = result.detailed;
  updateDock();
}

function updateDock() {
  const dock = $("dock");
  if (!lastResult) { dock.hidden = true; return; }
  const { passes, maxDcr } = lastResult.summary;
  dock.hidden = resultsVisible;
  dock.className = `dock${passes ? "" : " bad"}`;
  const bars = [lastResult.flexure.bottom.bars, lastResult.shear.stirrups].filter(Boolean).join(" · ");
  dock.innerHTML = `<span>${passes ? "✓" : "✕"} ${bars}</span><small>${(maxDcr * 100).toFixed(0)} % ↓</small>`;
}

let resultsVisible = true;
new IntersectionObserver(([entry]) => { resultsVisible = entry.isIntersecting; updateDock(); }, { threshold: 0.15 }).observe($("results"));

// ---------- python snippet ----------
function pythonCode() {
  const cls = { "ACI 318-19": "Concrete_ACI_318_19", "CIRSOC 201-25": "Concrete_CIRSOC_201_25", "EN 1992-2004": "Concrete_EN_1992_2004" }[state.code];
  const forces = state.forces.filter((f) => Number(f.M_y) || Number(f.V_z));
  const lines = [
    "# pip install mento",
    `from mento import ${cls}, SteelBar, RectangularBeam, Node, Forces`,
    "from mento import MPa, cm, mm, kN, kNm",
    "",
    `concrete = ${cls}(name="C${state.fc}", f_c=${state.fc} * MPa)`,
    `steel = SteelBar(name="fy ${state.fy}", f_y=${state.fy} * MPa)`,
    `beam = RectangularBeam(label="${state.label}", concrete=concrete, steel_bar=steel,`,
    `                       width=${state.width} * cm, height=${state.height} * cm, c_c=${state.cover} * mm)`,
    "forces = [",
    ...forces.map((f) => `    Forces(label="${f.label || ""}", M_y=${Number(f.M_y) || 0} * kNm, V_z=${Number(f.V_z) || 0} * kN),`),
    "]",
    "node = Node(section=beam, forces=forces)",
  ];
  if (state.mode === "check") {
    const { bot, top, stirrups } = state.rebar;
    const face = (f) => `n1=${f.n1 || 0}, d_b1=${f.d1 || 0} * mm` + (Number(f.n2) ? `, n2=${f.n2}, d_b2=${f.d2} * mm` : "");
    lines.push(`beam.set_longitudinal_rebar_bot(${face(bot)})`);
    if (Number(top.n1)) lines.push(`beam.set_longitudinal_rebar_top(${face(top)})`);
    if (Number(stirrups.n)) lines.push(`beam.set_transverse_rebar(n_stirrups=${stirrups.n}, d_b=${stirrups.d} * mm, s_l=${stirrups.s} * cm)`);
    lines.push("node.check()");
  } else {
    lines.push("node.design()");
  }
  lines.push("node.results", "print(beam.reinforcement)");
  return lines.join("\n");
}

// ---------- form wiring ----------
function segmented(id, key, onChange) {
  const group = $(id);
  const paint = () => group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === state[key])));
  group.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.dataset.value === state[key]) return;
    const previous = state[key];
    state[key] = button.dataset.value;
    paint();
    onChange?.(previous);
    schedule();
  });
  paint();
}

function renderForces() {
  const host = $("forces");
  host.innerHTML = "";
  state.forces.forEach((force, index) => {
    const row = document.createElement("div");
    row.className = "force-row";
    row.innerHTML = `
      <div class="input"><input type="text" value="" aria-label="${t.comb}" maxlength="24"></div>
      <div class="input"><input type="number" inputmode="decimal" step="any" aria-label="M"></div>
      <div class="input"><input type="number" inputmode="decimal" step="any" aria-label="V"></div>
      <button type="button" class="icon" title="${t.remove}" aria-label="${t.remove}" ${state.forces.length === 1 ? "disabled" : ""}>×</button>`;
    const [label, moment, shearInput] = row.querySelectorAll("input");
    label.value = force.label ?? "";
    moment.value = force.M_y ?? "";
    shearInput.value = force.V_z ?? "";
    label.addEventListener("input", () => { force.label = label.value; schedule(); });
    moment.addEventListener("input", () => { force.M_y = moment.value; schedule(); });
    shearInput.addEventListener("input", () => { force.V_z = shearInput.value; schedule(); });
    row.querySelector("button").addEventListener("click", () => { state.forces.splice(index, 1); renderForces(); schedule(); });
    host.append(row);
  });
}

function applyLanguage() {
  t = TEXT[state.lang] || TEXT.es;
  document.documentElement.lang = state.lang;
  document.title = t.pageTitle;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t[el.dataset.i18n]; });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.textContent = t[el.dataset.i18nHtml]; });
  $("loadingText").textContent = t.loading;
  for (const li of $("steps").children) li.textContent = t.steps[li.dataset.step];
  renderForces();
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2200);
}

async function copy(text, message) {
  try { await navigator.clipboard.writeText(text); toast(message); } catch { prompt("", text); }
}

function init() {
  applyLanguage();
  for (const id of NUMERIC) {
    $(id).value = state[id];
    $(id).addEventListener("input", () => { state[id] = $(id).value; schedule(); });
  }
  for (const [id, [group, key]] of Object.entries(REBAR_IDS)) {
    $(id).value = state.rebar[group][key] ?? 0;
    $(id).addEventListener("input", () => { state.rebar[group][key] = $(id).value; schedule(); });
  }
  segmented("code", "code", (previous) => {
    // Follow the code's usual steel grade, unless the user already chose their own.
    if (Number(state.fy) === DEFAULT_FY[previous]) { state.fy = DEFAULT_FY[state.code]; $("fy").value = state.fy; }
  });
  segmented("mode", "mode", () => { $("rebarInputs").hidden = state.mode !== "check"; });
  segmented("lang", "lang", () => { applyLanguage(); if (lastResult) render(lastResult); });
  $("rebarInputs").hidden = state.mode !== "check";

  $("addForce").addEventListener("click", () => {
    state.forces.push({ label: `C${state.forces.length + 1}`, M_y: "", V_z: "" });
    renderForces();
    $("forces").lastElementChild.querySelectorAll("input")[1].focus();
  });
  $("form").addEventListener("submit", (event) => event.preventDefault());

  $("btnShare").addEventListener("click", () => copy(`${location.origin}${location.pathname}#${encode(state)}`, t.linkCopied));
  $("btnCopyCode").addEventListener("click", () => copy(pythonCode(), t.copied));
  $("btnReport").addEventListener("click", async () => {
    const button = $("btnReport");
    button.disabled = true;
    button.textContent = t.reportBusy;
    try {
      for (const file of await call("report", state)) {
        const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
        link.download = file.name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
        await new Promise((resolve) => setTimeout(resolve, 400)); // browsers drop back-to-back downloads
      }
    } catch (error) {
      showError(`${t.errMento} ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = t.report;
    }
  });

  $("pycode").textContent = pythonCode();
  showStep("python");
}

init();

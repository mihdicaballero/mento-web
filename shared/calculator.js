// What every calculator page does: keep the state, put it in the URL, drive the worker, and
// paint the four stations. A page supplies a spec (its fields, its rebar groups, its drawing
// and its Python snippet) and the markup the design system defines; everything else is here.
import { applyStrings, loadStrings, preferredLang, rememberLang } from "./i18n.js";
import { copy, numberField, radiogroup, toast } from "./ui.js";

export const $ = (id) => document.getElementById(id);
export const num = (value) => Number(String(value ?? "").replace(",", ".").replace("−", "-"));
export const dcrState = (dcr) => (dcr === null || dcr === undefined ? "none" : dcr <= 0.95 ? "ok" : dcr <= 1 ? "warn" : "bad");
export const two = (dcr) => (dcr === null || dcr === undefined ? "—" : dcr.toFixed(2));
// Room a drawing keeps on its left for the "b × h" note set at 14 px, with its 12 px gap to the
// section and a little margin: about 8 px a character in IBM Plex Sans.
export const noteRoom = (note) => 16 + 12 + note.length * 8;

// Concrete and steel of each code, by commercial name and characteristic value, so the engineer
// can check what they picked without opening anything.
export const MATERIALS = {
  "CIRSOC 201-25": {
    concrete: [20, 25, 30, 35, 40, 45, 50].map((f) => [f, `H-${f} · f′c ${f} MPa`]),
    steel: [[420, "ADN 420 · fy 420 MPa"], [500, "ADN 500 · fy 500 MPa"]],
  },
  "ACI 318-19": {
    concrete: [21, 25, 28, 30, 35, 40, 45, 50].map((f) => [f, `f′c ${f} MPa`]),
    steel: [[420, "Gr 60 · fy 420 MPa"], [520, "Gr 75 · fy 520 MPa"]],
  },
  "EN 1992-2004": {
    concrete: [[20, "C20/25 · fck 20 MPa"], [25, "C25/30 · fck 25 MPa"], [30, "C30/37 · fck 30 MPa"],
      [35, "C35/45 · fck 35 MPa"], [40, "C40/50 · fck 40 MPa"], [45, "C45/55 · fck 45 MPa"], [50, "C50/60 · fck 50 MPa"]],
    steel: [[500, "B500 · fyk 500 MPa"]],
  },
};
const DEFAULT_MATERIALS = { "CIRSOC 201-25": [25, 420], "ACI 318-19": [25, 420], "EN 1992-2004": [25, 500] };
export const CONCRETE_CLASS = {
  "ACI 318-19": "Concrete_ACI_318_19", "CIRSOC 201-25": "Concrete_CIRSOC_201_25", "EN 1992-2004": "Concrete_EN_1992_2004",
};

const HASH_VERSION = "1";

// The section drawing as a PNG, to paste into a report. An SVG turned into an image sees none of
// the page's stylesheet, so every element takes its computed look along; drawn at 3× on white.
const DRAWING_STYLE = ["fill", "stroke", "stroke-width", "stroke-dasharray", "font-family", "font-size", "font-weight"];

export async function drawingPng(svg) {
  const [, , width, height] = svg.getAttribute("viewBox").split(" ").map(Number);
  const clone = svg.cloneNode(true);
  const originals = [svg, ...svg.querySelectorAll("*")];
  [clone, ...clone.querySelectorAll("*")].forEach((element, index) => {
    const computed = getComputedStyle(originals[index]);
    for (const property of DRAWING_STYLE) element.style.setProperty(property, computed.getPropertyValue(property));
  });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", width);
  clone.setAttribute("height", height);
  clone.removeAttribute("style");
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  await image.decode();
  const scale = 3;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function start(spec) {
  const groups = spec.groups.map((group) => group.key);
  const barIds = Object.keys(spec.bars);
  const strings = await loadStrings(spec.module);

  // ------------------------------------------------------------ state in the URL (5.6)
  function readHash() {
    if (!location.hash.startsWith("#v")) return null;
    try {
      const params = new URLSearchParams(location.hash.slice(1));
      if (params.get("v") !== HASH_VERSION) return null;
      const next = structuredClone(spec.example);
      next.code = params.get("c") || next.code;
      next.fc = Number(params.get("fc")) || next.fc;
      next.fy = Number(params.get("fy")) || next.fy;
      next.label = params.get("lb") ?? next.label;
      next.mode = params.get("m") === "check" ? "check" : "design";
      for (const [index, id] of spec.numbers.entries()) {
        const value = (params.get("d") || "").split(",")[index];
        if (value !== undefined && value !== "") next[id.id] = value;
      }
      const forces = (params.get("f") || "").split(";").filter(Boolean).map((row) => {
        const cells = row.split(",");
        return Object.fromEntries([["label", cells[0]], ...spec.forces.map((key, index) => [key, cells[index + 1]])]);
      });
      if (forces.length) next.forces = forces;
      const bars = (params.get("r") || "").split(",");
      if (bars.length === barIds.length) {
        barIds.forEach((id, index) => {
          const [group, key] = spec.bars[id];
          next.rebar[group][key] = Number(bars[index]);
        });
      }
      next.choice = Object.fromEntries(groups.map((group, index) => [group, (params.get("ch") || "").split(";")[index] || ""]));
      return next;
    } catch {
      return null;
    }
  }

  function writeHash() {
    const params = new URLSearchParams({
      v: HASH_VERSION, l: lang, c: state.code, fc: state.fc, fy: state.fy, lb: state.label, m: state.mode,
      d: spec.numbers.map((field) => state[field.id]).join(","),
      f: state.forces.map((force) => [force.label, ...spec.forces.map((key) => force[key] ?? 0)].join(",")).join(";"),
      r: barIds.map((id) => { const [group, key] = spec.bars[id]; return state.rebar[group][key] || 0; }).join(","),
      ch: groups.map((group) => state.choice[group] || "").join(";"),
    });
    history.replaceState(null, "", `${location.pathname}#${params}`);
  }

  const state = readHash() || structuredClone(spec.example);
  let lang = new URLSearchParams(location.hash.slice(1)).get("l") || preferredLang();
  let t = strings[lang] || strings.es;
  let lastResult = null;

  // ------------------------------------------------------------ worker (5.1)
  // A worker script comes from the HTTP cache like any file, and nothing else revalidates it:
  // a copy older than the glue it loads fails at import. Asking once, cheaply (a 304 when it has
  // not changed), refreshes the cached copy that `new Worker` then picks up.
  const workerUrl = `../shared/worker.js?module=${spec.module}`;
  await fetch(workerUrl, { cache: "no-cache" }).catch(() => {});
  const worker = new Worker(workerUrl);
  const pending = new Map();
  let nextId = 1;
  let ready = false;
  let version = 0;   // the edit a result must match to be applied
  let applied = 0;   // the edit the screen is showing
  const started = Date.now();

  function call(type, message) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload: message });
    });
  }

  worker.onmessage = ({ data }) => {
    if (data.type === "progress") return showStep(data.step);
    if (data.type === "ready") {
      ready = true;
      $("version").textContent = data.version;
      $("step-mento").textContent = `mento ${data.version}`;
      return calculate();
    }
    if (data.type === "fatal") return showFatal(data.error);
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    data.ok ? entry.resolve(data.result) : entry.reject(new Error(data.error));
  };

  const STEPS = ["python", "packages", "mento", "warmup"];
  function showStep(step) {
    const reached = STEPS.indexOf(step);
    for (const item of $("steps").children) {
      const index = STEPS.indexOf(item.dataset.step);
      item.dataset.s = index < reached ? "done" : index === reached ? "doing" : "todo";
      item.querySelector(".status").textContent = index < reached ? t.ready : index === reached ? t.working : "";
      item.querySelector(".dot").innerHTML = index < reached
        ? '<svg width="10" height="10" style="color:#fff"><use href="#i-check"/></svg>' : "";
    }
    $("progress").style.width = `${8 + 23 * (reached + 1)}%`;
  }

  setInterval(() => {
    if (ready) return;
    $("elapsed").textContent = `${Math.round((Date.now() - started) / 1000)} s`;
    $("strip").querySelector(".readout").textContent = $("elapsed").textContent;
  }, 500);

  function showFatal(message) {
    $("loading").hidden = true;
    $("output").hidden = false;
    $("verdict").hidden = true;
    $("notices").innerHTML = notice("bad", `${t.fatal} ${message}`);
  }

  // ------------------------------------------------------------ recalculation
  let timer = 0;
  let staleTimer = 0;

  function schedule({ now = false } = {}) {
    version += 1;
    renderPython();
    if (!validate()) return;
    writeHash();
    if (!ready) return;
    clearTimeout(timer);
    timer = setTimeout(calculate, now ? 0 : 250);
  }

  async function calculate() {
    const mine = version;
    clearTimeout(staleTimer);
    staleTimer = setTimeout(() => { if (applied !== mine) markStale(); }, 150);
    let result;
    try {
      result = await call("run", payload());
    } catch (error) {
      result = { ok: false, kind: "mento", message: error.message };
    }
    if (mine !== version) return;   // a newer edit is already on its way
    clearTimeout(staleTimer);
    applied = mine;
    render(result);
  }

  function payload() {
    const numbers = Object.fromEntries(spec.numbers.map((field) => [field.id, num(state[field.id])]));
    return {
      code: state.code, lang, mode: state.mode, label: state.label, fc: state.fc, fy: state.fy, ...numbers,
      forces: state.forces.map((force) => Object.fromEntries([
        ["label", force.label], ...spec.forces.map((key) => [key, num(force[key])]),
      ])),
      rebar: state.rebar,
      choice: state.choice,
    };
  }

  // ------------------------------------------------------------ validation (5.2)
  function validate() {
    let ok = true;
    for (const field of spec.numbers) {
      const value = num(state[field.id]);
      let message = "";
      if (String(state[field.id]).trim() === "" || Number.isNaN(value)) message = t.err_number;
      else if (value <= 0) message = t.err_positive;
      else if (field.rule) message = t[field.rule(state, num)] || "";
      setFieldError(field.id, message);
      ok = ok && !message;
    }
    for (const cell of $("combos").querySelectorAll(".cell")) {
      const input = cell.querySelector("input");
      const bad = input.type === "number" && input.value.trim() !== "" && Number.isNaN(num(input.value));
      cell.classList.toggle("is-invalid", bad);
      input.toggleAttribute("aria-invalid", bad);
    }
    if (!state.forces.some((force) => spec.forces.some((key) => num(force[key])))) ok = false;
    showInvalidStrip(ok);
    return ok;
  }

  function setFieldError(id, message) {
    $(`field-${id}`).classList.toggle("is-invalid", Boolean(message));
    $(`field-${id}`).toggleAttribute("aria-invalid", Boolean(message));
    $(`err-${id}`).hidden = !message;
    $(`err-${id}`).textContent = message;
  }

  function showInvalidStrip(valid) {
    if (!lastResult) return;
    const strip = $("strip-info");
    strip.hidden = valid;
    if (!valid) {
      strip.className = "strip strip--bad";
      strip.innerHTML = `<span>${t.fix_input}</span>`;
      $("verdict").classList.add("is-stale");
      $("ledger").classList.add("is-stale");
      setButtons(false);
    } else if (applied === version) {
      clearStale();
    }
  }

  function markStale() {
    if (!lastResult) return;
    const strip = $("strip-info");
    strip.hidden = false;
    strip.className = "strip strip--info";
    strip.innerHTML = `<span class="spin"></span><span>${t.recalculating}</span>`;
    $("verdict").classList.add("is-stale");
    $("ledger").classList.add("is-stale");
    setButtons(false);
    $("strip").dataset.state = "stale";
    $("strip").innerHTML = `<span class="spin"></span><span style="font-size:14px">${t.recalculating}</span>`
      + `<span class="readout is-stale">${lastResult.dcr}</span>`;
  }

  function clearStale() {
    $("strip-info").hidden = true;
    $("verdict").classList.remove("is-stale");
    $("ledger").classList.remove("is-stale");
    setButtons(true);
  }

  const setButtons = (enabled) => { $("report").disabled = !enabled; $("share").disabled = !enabled; };

  // ------------------------------------------------------------ rendering
  function notice(kind, text) {
    const mark = kind === "warn" ? '<svg width="16" height="16"><use href="#i-warn"/></svg>' : "";
    return `<div class="notice notice--${kind}" role="${kind === "bad" ? "alert" : "status"}">${mark}<span>${text}</span></div>`;
  }

  function render(result) {
    if (!result.ok) return renderError(result);
    $("loading").hidden = true;
    $("output").hidden = false;
    $("verdict").hidden = false;

    const governing = Math.max(...result.ledger.map((row) => row.dcr ?? 0));
    const status = dcrState(governing);
    const word = status === "bad" ? t.fails : status === "warn" ? t.passes_limit : t.passes;
    lastResult = { ...result, dcr: two(governing) };

    $("verdict").dataset.state = status;
    $("verdict-word").textContent = word;
    $("verdict-dcr").textContent = two(governing);
    $("verdict").querySelector("use").setAttribute("href", status === "bad" ? "#i-cross" : "#i-check");

    $("strip").dataset.state = status;
    $("strip").innerHTML = `<span class="mark"><svg width="14" height="14"><use href="#${status === "bad" ? "i-cross" : "i-check"}"/></svg></span>`
      + `<span class="word">${word}</span><span class="readout">${two(governing)}</span>`;

    $("ledger").innerHTML = result.ledger.map((row) => {
      const width = Math.min(row.dcr ?? 0, 1) * 100;
      const detail = row.combo
        ? `${row.symbol} ${row.capacity} ${row.dcr > 1 ? "&lt;" : "≥"} ${row.demand_symbol} ${row.demand} ${row.unit} · ${row.combo}`
        : `${row.symbol} ${row.capacity} ${row.unit} · ${t.no_demand}`;
      return `<div class="row"><div><div class="name">${t[row.key]}</div><div class="detail">${detail}</div></div>`
        + `<div class="meter" data-state="${dcrState(row.dcr)}"><i style="width:${width}%"></i><s></s></div>`
        + `<span class="dcr ${dcrState(row.dcr)}">${two(row.dcr)}</span></div>`;
    }).join("");

    $("notices").innerHTML = result.notices.map((item) => notice("warn", noticeText(item))).join("");
    $("warn-count").textContent = result.notices.length === 0 ? t.nowarn
      : result.notices.length === 1 ? t.warn_one : t.warn_many.replace("{n}", result.notices.length);

    renderGroups(result);
    $("drawing").innerHTML = spec.drawing(result, t, window.matchMedia("(max-width: 720px)").matches);
    $("copy-drawing").disabled = false;
    for (const name of spec.tables) renderTable(name, result.tables[name]);
    $("detailed").textContent = result.detailed;
    renderPython();
    clearStale();
    if (result.changed?.length) flagChanged(result.changed);
  }

  function renderError(result) {
    if (result.kind === "input") {
      if (result.field === "forces" || result.field === "rebar") showInvalidStrip(false);
      return;
    }
    $("loading").hidden = true;
    $("output").hidden = false;
    $("verdict").hidden = true;
    $("notices").innerHTML = notice("bad", `<b>${t.cannot}</b> <span class="mono">${result.message}</span>`);
    setButtons(false);
  }

  function noticeText(item) {
    const values = item.values || {};
    if (item.code === "mento") return `<b>${t.notice}</b> ${values.message}`;
    const face = values.face === "top" ? t.top_l : t.bot_l;
    return `<b>${t.notice}</b> ${t[item.code]
      .replace("{face}", face).replace("{A_s}", values.A_s).replace("{limit}", values.limit)}`;
  }

  // Station 3, design mode: one group per rebar family, its options inside (3.6).
  function renderGroups(result) {
    const open = new Set([...$("groups").querySelectorAll(".grp.is-open")].map((group) => group.dataset.group));
    $("groups").innerHTML = spec.groups.map(({ key, label }) => {
      const options = result.options[key] || [];
      const selected = result.selected[key] ?? 0;
      const current = options[selected];
      if (!current) return "";
      const isOpen = open.has(key);
      const rows = options.map((option, index) => `
        <label class="opt"><input type="radio" name="g-${key}" value="${option.signature}"${index === selected ? " checked" : ""}>
          <span class="val">${option.bars}</span><span class="area">${option.area}</span>
          <span class="dcr ${dcrState(option.dcr)}">${two(option.dcr)}</span></label>`).join("");
      return `<div class="grp${isOpen ? " is-open" : ""}" data-group="${key}" role="radiogroup" aria-labelledby="g-${key}-label">
        <button class="hd" type="button" aria-expanded="${isOpen}" aria-controls="g-${key}-opts">
          <span class="lbl" id="g-${key}-label">${t[label]}</span>
          <span class="val">${current.bars}</span><span class="dcr ${dcrState(current.dcr)}">${two(current.dcr)}</span>
          <span class="chev" aria-hidden="true">${isOpen ? "▾" : "▸"}</span></button>
        <div id="g-${key}-opts"${isOpen ? "" : " hidden"}>${rows}</div></div>`;
    }).join("");
  }

  function flagChanged(changed) {
    for (const group of changed) {
      const header = $("groups").querySelector(`.grp[data-group="${group}"] .hd`);
      if (!header) continue;
      header.style.background = "var(--brand-soft)";
      setTimeout(() => { header.style.background = ""; }, 200);
    }
  }

  // The DataFrame as mento prints it: same columns, same order, units in the header (3.14).
  // Its headers are symbols, the same in both languages; only a few words are translated.
  function renderTable(name, table) {
    const header = table.columns.map((column, index) => {
      const unit = table.units[index] ? `<br><span class="unit">${table.units[index]}</span>` : "";
      return `<th>${t.columns[column] || column}${unit}</th>`;
    }).join("");
    const rows = table.rows.map((row) => `<tr>${row.map((cell, index) => {
      const isDcr = index === table.dcr;
      return `<td${isDcr ? ` class="dcr ${dcrState(Number(cell))}"` : ""}>${isDcr ? two(Number(cell)) : t.cells[cell] || cell}</td>`;
    }).join("")}</tr>`).join("");
    $(`table-${name}`).innerHTML = `<table class="df"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  const renderPython = () => { $("python").textContent = spec.python(state, lastResult, t); };

  // ------------------------------------------------------------ stations 1 and 2
  function fillSelect(select, options, value) {
    select.innerHTML = options
      .map(([option, text]) => `<option value="${option}"${option === value ? " selected" : ""}>${text}</option>`).join("");
  }

  function renderMaterials() {
    fillSelect($("fc"), MATERIALS[state.code].concrete, state.fc);
    fillSelect($("fy"), MATERIALS[state.code].steel, state.fy);
  }

  function renderCombos() {
    const host = $("combos");
    // the rows only: the header keeps its own empty .rm, which holds the fifth column
    [...host.querySelectorAll(".cell, button.rm")].forEach((cell) => cell.remove());
    state.forces.forEach((force, index) => {
      const row = document.createElement("template");
      row.innerHTML = `<span class="cell txt"><input value="" aria-label="${t.aria_case.replace("{n}", index + 1)}"></span>`
        + spec.forces.map((key) => `<span class="cell"><input type="number" inputmode="decimal" step="any"`
          + ` aria-label="${t[`aria_${key}`].replace("{n}", index + 1)}"></span>`).join("")
        + `<button type="button" class="rm" aria-label="${t.remove}"${state.forces.length === 1 ? " disabled" : ""}>×</button>`;
      const nodes = [...row.content.children];
      const inputs = row.content.querySelectorAll("input");
      inputs[0].value = force.label ?? "";
      inputs[0].addEventListener("input", () => { force.label = inputs[0].value; schedule(); });
      spec.forces.forEach((key, position) => {
        // A number input shows nothing for U+2212, so the sign stays the keyboard's hyphen here;
        // num() reads either, and the tables print mento's own.
        inputs[position + 1].value = String(force[key] ?? "").replace("−", "-");
        numberField(inputs[position + 1], () => { force[key] = inputs[position + 1].value; schedule(); });
      });
      inputs.forEach((input) => input.addEventListener("keydown", (event) => {
        if (event.key === "Backspace" && event.ctrlKey && state.forces.length > 1) removeForce(index);
      }));
      row.content.querySelector(".rm").addEventListener("click", () => removeForce(index));
      host.append(...nodes);
    });
  }

  function removeForce(index) {
    state.forces.splice(index, 1);
    renderCombos();
    schedule({ now: true });
  }

  function addForce() {
    if (state.forces.length >= 10) return;
    state.forces.push(Object.fromEntries([["label", `C${state.forces.length + 1}`], ...spec.forces.map((key) => [key, 0])]));
    renderCombos();
    $("combos").querySelectorAll(".cell.txt input")[state.forces.length - 1].focus();
    $("add").disabled = state.forces.length >= 10;
    schedule({ now: true });
  }

  // ------------------------------------------------------------ wiring
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll("[data-s3]").forEach((element) => { element.hidden = element.dataset.s3 !== mode; });
    document.querySelectorAll("#mode [data-mode]")
      .forEach((button) => button.setAttribute("aria-checked", String(button.dataset.mode === mode)));
    schedule({ now: true });
  }

  // Design → check hands the fields over already filled with the option picked in each group (5.5).
  function loadChosenIntoBars() {
    if (!lastResult?.layouts) return;
    state.rebar = spec.barsFromLayouts(lastResult.layouts);
    for (const id of barIds) {
      const [group, key] = spec.bars[id];
      $(id).value = state.rebar[group][key] ?? 0;
    }
  }

  function applyLanguage(next) {
    lang = next;
    rememberLang(lang);
    t = applyStrings(strings, lang);
    renderCombos();
    if (lastResult) render(lastResult);
    renderPython();
    writeHash();
  }

  async function downloadReport() {
    const button = $("report");
    const label = button.querySelector("span").textContent;
    button.disabled = true;
    button.querySelector("span").textContent = t.building;
    try {
      for (const file of await call("report", payload())) {
        const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }));
        link.download = `mento-${t.file_name}-${state.label}-${new Date().toISOString().slice(0, 10)}.docx`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      }
      toast(t.report_done);
    } catch (error) {
      $("notices").innerHTML = notice("bad", `<b>${t.cannot}</b> <span class="mono">${error.message}</span>`) + $("notices").innerHTML;
    } finally {
      button.disabled = false;
      button.querySelector("span").textContent = label;
    }
  }

  t = applyStrings(strings, lang);
  fillSelect($("code"), Object.keys(MATERIALS).map((code) => [code, code === "EN 1992-2004" ? "EN 1992" : code]), state.code);
  renderMaterials();
  for (const field of spec.numbers) {
    $(field.id).value = state[field.id];
    numberField($(field.id), () => { state[field.id] = $(field.id).value; schedule(); });
  }
  $("label").value = state.label;
  $("label").addEventListener("input", () => { state.label = $("label").value; schedule(); });
  for (const id of barIds) {
    const [group, key] = spec.bars[id];
    $(id).value = state.rebar[group][key] ?? 0;
    numberField($(id), () => { state.rebar[group][key] = $(id).value; schedule(); });
  }
  renderCombos();
  setMode(state.mode);

  $("code").addEventListener("change", () => {
    state.code = $("code").value;
    const [fc, fy] = DEFAULT_MATERIALS[state.code];
    if (!MATERIALS[state.code].concrete.some(([value]) => value === state.fc)) state.fc = fc;
    if (!MATERIALS[state.code].steel.some(([value]) => value === state.fy)) state.fy = fy;
    renderMaterials();
    schedule({ now: true });
  });
  $("fc").addEventListener("change", () => { state.fc = Number($("fc").value); schedule({ now: true }); });
  $("fy").addEventListener("change", () => { state.fy = Number($("fy").value); schedule({ now: true }); });
  $("add").addEventListener("click", addForce);
  radiogroup($("mode"), (button) => setMode(button.dataset.mode));
  radiogroup(document.querySelector(".top .seg"), (button) => applyLanguage(button.dataset.lang));
  $("to-check").addEventListener("click", () => { loadChosenIntoBars(); setMode("check"); });
  $("to-design").addEventListener("click", () => setMode("design"));

  $("groups").addEventListener("click", (event) => {
    const header = event.target.closest(".hd");
    if (!header) return;
    const group = header.closest(".grp");
    const open = !group.classList.contains("is-open");
    group.classList.toggle("is-open", open);
    header.setAttribute("aria-expanded", String(open));
    header.querySelector(".chev").textContent = open ? "▾" : "▸";
    group.querySelector("[id$='-opts']").hidden = !open;
  });
  // Picking an option applies it: mento checks the section with that layout in place.
  $("groups").addEventListener("change", (event) => {
    const input = event.target.closest('input[type="radio"]');
    if (!input) return;
    state.choice[input.closest(".grp").dataset.group] = input.value;
    schedule({ now: true });
  });

  $("share").addEventListener("click", () => { writeHash(); copy(location.href, t.link_copied); });
  $("copy-python").addEventListener("click", (event) => {
    event.preventDefault(); event.stopPropagation();
    copy($("python").textContent, t.code_copied);
  });
  $("copy-detailed").addEventListener("click", (event) => {
    event.preventDefault(); event.stopPropagation();
    copy($("detailed").textContent, t.text_copied);
  });
  $("report").addEventListener("click", downloadReport);

  // The drawing, as an image on the clipboard. The PNG goes in as a promise so that Safari still
  // counts the click as the gesture; where images cannot be written there, the file is saved.
  $("copy-drawing").addEventListener("click", async () => {
    const svg = $("drawing").querySelector("svg");
    if (!svg) return;
    const png = drawingPng(svg);
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      toast(t.image_copied);
    } catch {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await png);
      link.download = `mento-${t.file_name}-${state.label}-${t.image_file}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      toast(t.image_saved);
    }
  });

  // Which disclosures are open is this visitor's habit, not part of the design (5.8).
  for (const details of document.querySelectorAll(".disc")) {
    const key = `mento-${spec.module}-${details.id}`;
    try {
      details.open = localStorage.getItem(key) === "1" || (localStorage.getItem(key) === null && details.open);
    } catch { /* storage blocked */ }
    details.addEventListener("toggle", () => {
      try { localStorage.setItem(key, details.open ? "1" : "0"); } catch { /* storage blocked */ }
    });
  }

  validate();
  renderPython();
  showStep("python");
}

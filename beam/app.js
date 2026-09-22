// The rectangular beam: what makes this calculator different from the others.
// Everything it shares with them lives in shared/calculator.js.
import { CONCRETE_CLASS, noteRoom, num, start } from "../shared/calculator.js";

const EXAMPLE = {
  code: "CIRSOC 201-25", fc: 25, fy: 420, width: 20, height: 60, cover: 25, label: "V-101", mode: "design",
  forces: [
    { label: "1.4D", M_y: 55, V_z: 80, N_x: 0 },
    { label: "1.2D+1.6L", M_y: 90, V_z: 120, N_x: 0 },
    { label: "0.9D+1.0E", M_y: -45, V_z: 95, N_x: 30 },
  ],
  rebar: { bot: { n1: 2, d1: 16, n2: 1, d2: 12 }, top: { n1: 2, d1: 12, n2: 0, d2: 0 }, stirrups: { n: 1, d: 6, s: 13 } },
  choice: {},
};

// The section, drawn here rather than by beam.plot(), so the page never loads matplotlib.
// Geometry arrives in cm with the origin at the bottom left corner; SVG's y axis points down.
function drawing(result, t, phone) {
  const { width, height, cover, stirrups, bars } = result.section;
  const box = phone ? { w: 343, h: 210, scale: 3 } : { w: 556, h: 300, scale: 3.5 };
  // The frame keeps a band on top for its label and its Copiá button (44 px tall on the phone),
  // the b × h note on the left and the rebar labels on the right; a section too big for what is
  // left is drawn smaller (3.10).
  const note = `${width} × ${height}`;
  const room = { top: phone ? 56 : 40, bottom: 12, left: Math.max(phone ? 70 : 100, noteRoom(note)), right: phone ? 100 : 130 };
  const scale = Math.min(
    box.scale,
    (box.h - room.top - room.bottom) / height,
    (box.w - room.left - room.right) / width,
  );
  const [w, h] = [width * scale, height * scale];
  const x0 = room.left;
  const y0 = room.top + (box.h - room.top - room.bottom - h) / 2;
  const parts = [`<rect class="dw-concrete" x="${x0}" y="${y0}" width="${w}" height="${h}"/>`];
  const inset = cover * scale;
  parts.push(`<rect class="dw-stirrup${stirrups.n ? "" : " dw-stirrup--none"}" x="${x0 + inset}" y="${y0 + inset}"`
    + ` width="${w - 2 * inset}" height="${h - 2 * inset}" rx="${Math.max(2, 2 * stirrups.d * scale)}"/>`);
  for (const bar of bars) {
    parts.push(`<circle class="dw-bar" cx="${(x0 + bar.x * scale).toFixed(2)}"`
      + ` cy="${(y0 + (height - bar.y) * scale).toFixed(2)}" r="${Math.max(1.6, (bar.d / 2) * scale).toFixed(2)}"/>`);
  }
  const labelX = x0 + w + 12;
  if (result.rebar.top) parts.push(`<text class="dw-label" x="${labelX}" y="${y0 + 14}">${result.rebar.top}</text>`);
  if (result.rebar.st) {
    parts.push(`<text class="dw-label dw-label--stirrup" x="${labelX}" y="${y0 + h / 2}">${result.rebar.st}</text>`);
  }
  if (result.rebar.bot) parts.push(`<text class="dw-label" x="${labelX}" y="${y0 + h - 6}">${result.rebar.bot}</text>`);
  parts.push(`<text class="dw-dim" x="${x0 - 12}" y="${y0 + h / 2}" text-anchor="end">${note}</text>`);
  const description = t.fig_section.replace("{section}", note)
    .replace("{bars}", [result.rebar.bot, result.rebar.top, result.rebar.st].filter(Boolean).join(", "));
  return `<svg viewBox="0 0 ${box.w} ${box.h}" width="${box.w}" height="${box.h}" style="max-width:100%;height:auto"`
    + ` role="img" aria-label="${description}">${parts.join("")}</svg>`;
}

const face = (layout) => Object.keys(layout).filter((key) => key.startsWith("n"))
  .map((key) => `n${key.slice(1)}=${layout[key]}, d_b${key.slice(1)}=${layout[`d${key.slice(1)}`]} * mm`).join(", ");

function python(state, result) {
  const concrete = CONCRETE_CLASS[state.code];
  const lines = [
    `from mento import ${concrete}, SteelBar, RectangularBeam, Node, Forces`,
    "from mento import MPa, cm, mm, kN, kNm",
    "",
    `concrete = ${concrete}(name="${state.code}", f_c=${state.fc} * MPa)`,
    `steel = SteelBar(name="fy ${state.fy}", f_y=${state.fy} * MPa)`,
    `beam_1 = RectangularBeam(label="${state.label}", concrete=concrete, steel_bar=steel,`,
    `                         width=${num(state.width)} * cm, height=${num(state.height)} * cm, c_c=${num(state.cover)} * mm)`,
    "forces = [",
    ...state.forces.filter((force) => num(force.M_y) || num(force.V_z)).map((force) =>
      `    Forces(label="${force.label}", M_y=${num(force.M_y) || 0} * kNm, V_z=${num(force.V_z) || 0} * kN,`
      + ` N_x=${num(force.N_x) || 0} * kN),`),
    "]",
    "node_1 = Node(section=beam_1, forces=forces)",
    "",
  ];
  const layouts = state.mode === "check"
    ? { bot: toLayout(state.rebar.bot), top: toLayout(state.rebar.top), st: state.rebar.stirrups.n ? state.rebar.stirrups : null }
    : result?.layouts;
  if (state.mode === "design") {
    lines.push("# Let mento design the reinforcement", "node_1.design()");
  } else if (layouts) {
    lines.push("# Set the reinforcement");
    if (layouts.bot) lines.push(`beam_1.set_longitudinal_rebar_bot(${face(layouts.bot)})`);
    if (layouts.top && Object.keys(layouts.top).length) lines.push(`beam_1.set_longitudinal_rebar_top(${face(layouts.top)})`);
    if (layouts.st?.n) {
      lines.push(`beam_1.set_transverse_rebar(n_stirrups=${layouts.st.n}, d_b=${layouts.st.d} * mm, s_l=${layouts.st.s} * cm)`);
    }
  }
  return lines.concat([
    "",
    "# Perform all checks",
    "node_1.check()",
    "# Print results in Markdown format",
    "node_1.results",
    "# Print shear results in more detailed format in a DataFrame",
    "node_1.check_shear()",
    "# Print flexure results in more detailed format in a DataFrame",
    "node_1.check_flexure()",
    "# View detailed shear results",
    "node_1.shear_results_detailed()",
    "# View detailed flexure results",
    "node_1.flexure_results_detailed()",
  ]).join("\n");
}

const toLayout = (face_) => {
  const layout = {};
  if (Number(face_.n1)) { layout.n1 = Number(face_.n1); layout.d1 = Number(face_.d1); }
  if (Number(face_.n2)) { layout.n2 = Number(face_.n2); layout.d2 = Number(face_.d2); }
  return layout;
};

// Two entry fields per face, so a layout in more than two diameters is counted together.
function barsFromLayouts(layouts) {
  const merge = (layout) => {
    const counts = new Map();
    for (let index = 1; index <= 4; index += 1) {
      const n = layout?.[`n${index}`];
      if (n) counts.set(layout[`d${index}`], (counts.get(layout[`d${index}`]) || 0) + n);
    }
    const pairs = [...counts.entries()];
    return { n1: pairs[0]?.[1] || 0, d1: pairs[0]?.[0] || 0, n2: pairs[1]?.[1] || 0, d2: pairs[1]?.[0] || 0 };
  };
  return {
    bot: merge(layouts.bot),
    top: merge(layouts.top),
    stirrups: { n: layouts.st?.n || 0, d: layouts.st?.d || 0, s: layouts.st?.s || 0 },
  };
}

start({
  module: "beam",
  example: EXAMPLE,
  numbers: [
    { id: "width" },
    { id: "height", rule: (state, number) => (number(state.height) <= 2 * (number(state.cover) / 10) ? "err_height" : "") },
    { id: "cover" },
  ],
  forces: ["M_y", "V_z", "N_x"],
  groups: [{ key: "bot", label: "bot" }, { key: "top", label: "top" }, { key: "st", label: "st" }],
  bars: {
    bot_n1: ["bot", "n1"], bot_d1: ["bot", "d1"], bot_n2: ["bot", "n2"], bot_d2: ["bot", "d2"],
    top_n1: ["top", "n1"], top_d1: ["top", "d1"], top_n2: ["top", "n2"], top_d2: ["top", "d2"],
    st_n: ["stirrups", "n"], st_d: ["stirrups", "d"], st_s: ["stirrups", "s"],
  },
  tables: ["flexure", "shear"],
  drawing,
  python,
  barsFromLayouts,
});

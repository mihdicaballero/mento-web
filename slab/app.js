// The one-way slab: a strip reinforced with a diameter at a spacing on each face.
// Everything it shares with the other calculators lives in shared/calculator.js.
import { CONCRETE_CLASS, noteRoom, num, start } from "../shared/calculator.js";

const EXAMPLE = {
  code: "CIRSOC 201-25", fc: 25, fy: 420, width: 100, height: 20, cover: 20, label: "L-101", mode: "design",
  forces: [
    { label: "1.2D+1.6L", M_y: 32, V_z: 38, N_x: 0 },
    { label: "1.2D+1.6L (apoyo)", M_y: -22, V_z: 45, N_x: 0 },
  ],
  rebar: { bot: { d: 10, s: 13 }, top: { d: 12, s: 25 } },
  choice: {},
};

// The strip, drawn to scale: the bars of each face along it, seen in section.
function drawing(result, t, phone) {
  const { width, height, cover, bars } = result.section;
  const box = phone ? { w: 343, h: 210 } : { w: 556, h: 300 };
  // The "w × h" note needs its room on the left, the frame label its band on top.
  const note = `${width} × ${height}`;
  const room = { left: Math.max(60, noteRoom(note)), right: 24 };
  const scale = Math.min((box.w - room.left - room.right) / width, (box.h - 90) / height, 4);
  const [w, h] = [width * scale, height * scale];
  const x0 = room.left + (box.w - room.left - room.right - w) / 2;
  // centred, but never up into the band of the frame's label and Copiá button
  const y0 = Math.max((box.h - h) / 2, phone ? 60 : 44);
  const parts = [`<rect class="dw-concrete" x="${x0}" y="${y0}" width="${w}" height="${h}"/>`];
  // The strip is cut out of a slab that goes on: the design system draws those edges dashed.
  parts.push(`<line class="dw-cut" x1="${x0}" y1="${y0 - 14}" x2="${x0}" y2="${y0 + h + 14}"/>`);
  parts.push(`<line class="dw-cut" x1="${x0 + w}" y1="${y0 - 14}" x2="${x0 + w}" y2="${y0 + h + 14}"/>`);
  for (const bar of bars) {
    parts.push(`<circle class="dw-bar" cx="${(x0 + bar.x * scale).toFixed(2)}"`
      + ` cy="${(y0 + (height - bar.y) * scale).toFixed(2)}" r="${Math.max(1.8, (bar.d / 2) * scale).toFixed(2)}"/>`);
  }
  if (result.rebar.top) parts.push(`<text class="dw-label" x="${x0}" y="${y0 - 10}">${result.rebar.top}</text>`);
  if (result.rebar.bot) parts.push(`<text class="dw-label" x="${x0}" y="${y0 + h + 22}">${result.rebar.bot}</text>`);
  parts.push(`<text class="dw-dim" x="${x0 - 12}" y="${y0 + h / 2}" text-anchor="end">${note}</text>`);
  const description = t.fig_section.replace("{section}", note)
    .replace("{bars}", [result.rebar.bot, result.rebar.top].filter(Boolean).join(", "));
  return `<svg viewBox="0 0 ${box.w} ${box.h}" width="${box.w}" height="${box.h}" style="max-width:100%;height:auto"`
    + ` role="img" aria-label="${description}">${parts.join("")}</svg>`;
}

function python(state, result) {
  const concrete = CONCRETE_CLASS[state.code];
  const lines = [
    `from mento import ${concrete}, SteelBar, OneWaySlab, Node, Forces`,
    "from mento import MPa, cm, mm, kN, kNm",
    "",
    `concrete = ${concrete}(name="${state.code}", f_c=${state.fc} * MPa)`,
    `steel = SteelBar(name="fy ${state.fy}", f_y=${state.fy} * MPa)`,
    `slab_1 = OneWaySlab(label="${state.label}", concrete=concrete, steel_bar=steel,`,
    `                    width=${num(state.width)} * cm, height=${num(state.height)} * cm, c_c=${num(state.cover)} * mm)`,
    "forces = [",
    ...state.forces.filter((force) => num(force.M_y) || num(force.V_z) || num(force.N_x)).map((force) =>
      `    Forces(label="${force.label}", M_y=${num(force.M_y) || 0} * kNm, V_z=${num(force.V_z) || 0} * kN,`
      + ` N_x=${num(force.N_x) || 0} * kN),`),
    "]",
    "node_1 = Node(section=slab_1, forces=forces)",
    "",
  ];
  const layouts = state.mode === "check" ? { bot: mesh(state.rebar.bot), top: mesh(state.rebar.top) } : result?.layouts;
  if (state.mode === "design") {
    lines.push("# Let mento design the reinforcement", "node_1.design()");
  } else if (layouts) {
    lines.push("# Set the reinforcement");
    if (layouts.bot) lines.push(`slab_1.set_slab_longitudinal_rebar_bot(d_b1=${layouts.bot.d} * mm, s_b1=${layouts.bot.s} * cm)`);
    if (layouts.top) lines.push(`slab_1.set_slab_longitudinal_rebar_top(d_b1=${layouts.top.d} * mm, s_b1=${layouts.top.s} * cm)`);
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

const mesh = (face) => (Number(face.d) && Number(face.s) ? { d: Number(face.d), s: Number(face.s) } : null);

const barsFromLayouts = (layouts) => ({
  bot: { d: layouts.bot?.d || 0, s: layouts.bot?.s || 0 },
  top: { d: layouts.top?.d || 0, s: layouts.top?.s || 0 },
});

start({
  module: "slab",
  example: EXAMPLE,
  numbers: [
    { id: "width" },
    { id: "height", rule: (state, number) => (number(state.height) <= 2 * (number(state.cover) / 10) ? "err_height" : "") },
    { id: "cover" },
  ],
  forces: ["M_y", "V_z", "N_x"],
  groups: [{ key: "bot", label: "bot" }, { key: "top", label: "top" }],
  bars: { bot_d: ["bot", "d"], bot_s: ["bot", "s"], top_d: ["top", "d"], top_s: ["top", "s"] },
  tables: ["flexure", "shear"],
  drawing,
  python,
  barsFromLayouts,
});

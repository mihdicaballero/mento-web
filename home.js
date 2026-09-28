// Home: its movement, language, the test count CI publishes, and a head start on the calculator.
import { applyStrings, loadStrings, preferredLang, rememberLang } from "./shared/i18n.js";
import { calm, radiogroup, tween } from "./shared/ui.js";

// ------------------------------------------------------------ movement (design system v2)
// First thing, before the dictionary loads, so nothing on screen shows and then hides again.
// Progressive, like the rest of it: the markup carries the final state, and the classes and values
// that animate towards it are set here, only when there is motion to show (not under reduced
// motion, not in a tab opened in the background). Without this script the page is whole and still.
const moving = !calm();

// The hero is the calculator's result assembling (the stylesheet times it); its DCRs count up.
// Each keeps its value aside while it counts, and the timer that starts it, for a pick to cancel.
const countUps = new Map();
if (moving) {
  for (const cell of document.querySelectorAll('.viz-verdict [data-hero$="dcr"]')) {
    const to = Number(cell.textContent);
    cell.dataset.value = to;
    cell.textContent = (0).toFixed(2);
    countUps.set(cell, setTimeout(() => tween(cell, 0, to, (value) => value.toFixed(2), 700), 1100));
  }
}

// ------------------------------------------------------------ the hero, live
// Picking another of mento's options redraws its bars and moves the bottom flexure DCR, as the
// calculator does; each option's numbers are mento's (the markup carries them, the tests check
// them). Its two links open the beam calculator on that same design, or on it loaded to check.
const hero = document.getElementById("hero");
const heroCell = (name) => hero.querySelector(`[data-hero="${name}"]`);
const fixed2 = (value) => value.toFixed(2);

// "2x16+1x12" → n1 2, d1 16, n2 1, d2 12: the groups of a face, as the calculator's fields hold them
const groups = (signature) => signature.split("+").map((group) => group.split("x").map(Number));

// The calculator's link (shared/calculator.js readHash): what it leaves out stays the example's.
// In check mode its bar fields go in their order: bottom and top first rows, stirrups, second rows.
function heroLink(option, mode) {
  const params = new URLSearchParams({ v: "1", l: lang, m: mode });
  if (mode === "design") params.set("ch", `${option.dataset.sig};;`);
  else {
    const face = (signature) => [0, 1, 2, 3].map((index) => groups(signature)[index] || [0, 0]);
    const [bottom, top] = [face(option.dataset.sig), face(hero.dataset.top)];
    const [, n, d, s] = /^(\d+)x(\d+)@(\d+)$/.exec(hero.dataset.st);
    params.set("r", [...bottom[0], ...bottom[1], ...top[0], ...top[1], n, d, s,
      ...bottom[2], ...bottom[3], ...top[2], ...top[3]].join(","));
  }
  return `beam/#${params}`;
}

function pickOption(option, { animate = true } = {}) {
  const valueOf = (cell) => Number(cell.dataset.value ?? cell.textContent);
  const bottom = valueOf(option.querySelector('[data-hero$="_dcr"]'));
  const [top, shear] = [valueOf(heroCell("top_dcr")), valueOf(heroCell("shear_dcr"))];
  const cells = { bottom_dcr: bottom, dcr: Math.max(bottom, top, shear), sum_flex: Math.max(bottom, top) };
  for (const [name, value] of Object.entries(cells)) {
    const cell = heroCell(name);
    clearTimeout(countUps.get(cell));
    cell.dataset.value = value;
    animate ? tween(cell, Number(cell.textContent), value, fixed2) : (cell.textContent = fixed2(value));
  }
  heroCell("bottom_dcr").previousElementSibling.querySelector("i").style.width = `${Math.min(bottom, 1) * 100}%`;
  heroCell("bottom").textContent = option.querySelector(".val").textContent;
  // the corner bars are the same in every option; the ones between them are the option's
  const svg = hero.querySelector(".viz-draw svg g");
  const old = svg.querySelectorAll("[data-mid]");
  const bars = option.dataset.mid.split(";").map((bar) => bar.split(",").map(Number));
  for (const [x, y, d] of bars) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    // drawn at 5 px a cm, the section's bottom at y = 300
    Object.entries({ class: "dw-bar", "data-mid": "", cx: x * 5, cy: 300 - y * 5, r: Math.max(2.5, (d / 2) * 5) })
      .forEach(([name, value]) => circle.setAttribute(name, value));
    if (animate) circle.style.animationDelay = "0s";
    old[0].before(circle);
  }
  old.forEach((circle) => circle.remove());
  linkHero(option);
}

function linkHero(option) {
  hero.querySelector("#hero-report").href = heroLink(option, "design");
  hero.querySelector("#hero-check").href = heroLink(option, "check");
}

const pickedOption = () => hero.querySelector(".opt:has(input:checked)") || hero.querySelector(".opt");
hero.querySelector(".viz-prop").addEventListener("change", (event) => pickOption(event.target.closest(".opt")));

// Sections come in as they are reached, their items one after another. The attribute that hides
// them comes off once they are in, so their own transitions (a card's hover) are theirs again.
const REVEAL = [
  ".steps-band .eyebrow", ".steps-row .step", ".calcs .head", ".cgrid--home > *", ".band-grid > *", ".proof li",
  ".band .band-cols > div", ".pysec > *", ".further .head", ".further-grid > *", ".support > *", ".team > .eyebrow",
  ".team-grid > *",
];
if (moving && "IntersectionObserver" in window) {
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries.filter((item) => item.isIntersecting)) {
      const element = entry.target;
      seen.unobserve(element);
      element.classList.add("is-in");
      const delay = Number(getComputedStyle(element).getPropertyValue("--i") || 0) * 60;
      setTimeout(() => { element.removeAttribute("data-reveal"); element.classList.remove("is-in"); }, 700 + delay);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  for (const selector of REVEAL) {
    document.querySelectorAll(selector).forEach((element, index) => {
      element.dataset.reveal = "";
      element.style.setProperty("--i", String(Math.min(index, 6)));
      seen.observe(element);
    });
  }
  document.documentElement.classList.add("reveal-on");
}

// A figure counts up to itself the first time it is on screen.
function countWhenSeen(element, value) {
  if (!moving || !("IntersectionObserver" in window)) return;
  const watch = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    watch.disconnect();
    tween(element, 0, value, (current) => String(Math.round(current)), 900);
  }, { threshold: 0.5 });
  watch.observe(element);
}

// ------------------------------------------------------------ language and figures
const strings = await loadStrings("home");
let lang = preferredLang();
const langGroup = radiogroup(document.querySelector(".top .seg"), (button) => {
  lang = button.dataset.lang;
  rememberLang(lang);
  applyStrings(strings, lang);
  linkHero(pickedOption());
});
applyStrings(strings, lang);
langGroup.sync();
// a page come back to may keep the option picked before; the markup shows the first
if (pickedOption() !== hero.querySelector(".opt")) pickOption(pickedOption(), { animate: false });
else linkHero(pickedOption());

// The number comes from mento's CI (shared/stats.json, committed on each mento release).
// Without it the band says "tested against published examples" and shows no figure: never a stale one.
fetch("shared/stats.json", { cache: "no-cache" })
  .then((response) => (response.ok ? response.json() : null))
  .then((stats) => {
    if (!Number.isInteger(stats?.tests) || stats.tests <= 0) return;
    const big = document.getElementById("tests");
    const label = document.getElementById("tests-t");
    big.textContent = String(stats.tests);
    big.hidden = false;
    countWhenSeen(big, stats.tests);
    label.dataset.i18n = "tests_t";
    label.textContent = strings[lang].tests_t;
  })
  .catch(() => { /* no stats yet */ });

// Download, install and compile Python and mento while the visitor reads, and save the result
// (see the saved environment in shared/worker.js), so the calculator only has to start them.
const warm = () => { if (!navigator.connection?.saveData) new Worker("shared/worker.js?module=beam&prefetch=1"); };
"requestIdleCallback" in window ? requestIdleCallback(warm) : setTimeout(warm, 1);

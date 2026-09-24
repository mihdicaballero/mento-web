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
if (moving) {
  for (const cell of document.querySelectorAll('.viz-verdict [data-hero$="dcr"]')) {
    const to = Number(cell.textContent);
    cell.textContent = (0).toFixed(2);
    setTimeout(() => tween(cell, 0, to, (value) => value.toFixed(2), 700), 1100);
  }
}

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
});
applyStrings(strings, lang);
langGroup.sync();

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

// Home: language, the test count CI publishes, and a head start on the calculator's downloads.
import { applyStrings, loadStrings, preferredLang, rememberLang } from "./shared/i18n.js";
import { radiogroup } from "./shared/ui.js";

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
    label.dataset.i18n = "tests_t";
    label.textContent = strings[lang].tests_t;
  })
  .catch(() => { /* no stats yet */ });

// Download, install and compile Python and mento while the visitor reads, and save the result
// (see the saved environment in shared/worker.js), so the calculator only has to start them.
const warm = () => { if (!navigator.connection?.saveData) new Worker("shared/worker.js?module=beam&prefetch=1"); };
"requestIdleCallback" in window ? requestIdleCallback(warm) : setTimeout(warm, 1);

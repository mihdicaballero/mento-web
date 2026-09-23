// Every UI string lives in shared/i18n/<page>.json as {"es": {key: text}, "en": {...}}.
// The markup carries the Spanish text as its first paint; py/test_i18n.py keeps the two in step.
//   data-i18n="k"          textContent
//   data-i18n-html="k"     innerHTML (strings with <i class="sym"> and the like)
//   data-i18n-aria="k"     aria-label
//   data-i18n-content="k"  content (meta description)

const LANG_KEY = "mento-lang";
export const LANGS = ["es", "en"];

// Spanish is the site's language: English only when the visitor picked it (or a link carries it),
// never from the browser's language.
export function preferredLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch { /* storage blocked */ }
  return "es";
}

export function rememberLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage blocked */ }
}

export async function loadStrings(page) {
  const response = await fetch(new URL(`i18n/${page}.json`, import.meta.url));
  if (!response.ok) throw new Error(`i18n/${page}.json: HTTP ${response.status}`);
  return response.json();
}

export function applyStrings(strings, lang, root = document) {
  const t = strings[lang] || strings.es;
  const text = (key) => {
    if (key in t) return t[key];
    console.warn(`i18n: no "${key}" in ${lang}`);
    return strings.es[key];
  };
  if (root === document) document.documentElement.lang = lang;
  root.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = text(el.dataset.i18n); });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = text(el.dataset.i18nHtml); });
  root.querySelectorAll("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", text(el.dataset.i18nAria)); });
  root.querySelectorAll("[data-i18n-content]").forEach((el) => { el.setAttribute("content", text(el.dataset.i18nContent)); });
  root.querySelectorAll("[data-lang]").forEach((el) => { el.setAttribute("aria-checked", String(el.dataset.lang === lang)); });
  return t;
}

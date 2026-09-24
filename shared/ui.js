// Behaviour shared by every page: the segmented radiogroups (3.4), the numeric fields, the toast,
// the movement of design system v2 and the Python painter of the code blocks.

// A `.seg[role=radiogroup]` of `button[role=radio]`: one tab stop (roving tabindex),
// ← → move and apply, Space / Enter / click apply. `onSelect(button)` runs on a change.
export function radiogroup(group, onSelect) {
  const buttons = () => [...group.querySelectorAll('[role="radio"]')];
  const sync = () => {
    const all = buttons();
    const checked = all.find((b) => b.getAttribute("aria-checked") === "true") || all[0];
    all.forEach((b) => { b.tabIndex = b === checked ? 0 : -1; });
  };
  const select = (button) => {
    if (button.getAttribute("aria-checked") === "true") return;
    buttons().forEach((b) => b.setAttribute("aria-checked", String(b === button)));
    sync();
    onSelect(button);
  };
  group.addEventListener("click", (event) => {
    const button = event.target.closest('[role="radio"]');
    if (button) select(button);
  });
  group.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const all = buttons();
    const next = all[(all.indexOf(document.activeElement) + step + all.length) % all.length];
    next.focus();
    select(next);
  });
  sync();
  return { sync };
}

// A numeric field as 5.2 asks: one click replaces the value, ↑/↓ step (±5 with Shift, ±0.1 with
// Alt), Enter moves on, Esc restores what was there, and a comma counts as a decimal point.
export function numberField(input, onChange) {
  let previous = input.value;
  input.addEventListener("focus", () => { previous = input.value; input.select(); });
  input.addEventListener("input", () => {
    if (input.value.includes(",")) {
      const caret = input.selectionStart;
      input.value = input.value.replace(",", ".");
      input.setSelectionRange?.(caret, caret);
    }
    onChange();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = previous;
      onChange();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const fields = [...(input.closest(".station, .combos") || document).querySelectorAll("input")];
      fields[fields.indexOf(input) + 1]?.focus();
      return;
    }
    const direction = { ArrowUp: 1, ArrowDown: -1 }[event.key];
    if (!direction) return;
    event.preventDefault();
    const step = event.altKey ? 0.1 : event.shiftKey ? 5 : 1;
    const value = Number(input.value.replace(",", ".")) || 0;
    input.value = String(Math.round((value + direction * step) * 100) / 100);
    onChange();
  });
}

let toastTimer = 0;
export function toast(message) {
  const element = document.getElementById("toast");
  document.getElementById("toast-text").textContent = message;
  element.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("is-on"), 2500);
}

// Copy, and when the clipboard is not available (iOS without a gesture) hand the text over
// selected, which is what the person can actually act on.
export async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    window.prompt(message, text);
  }
}

export const escapeHtml = (text) => String(text ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ------------------------------------------------------------ motion (design system v2)
// Movement that says something changed, never decoration. Everything ends in the right state
// without it: under prefers-reduced-motion, in a hidden tab (no frames run there), or when a
// newer change arrives halfway.
export const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden;
const EASE_OUT = "cubic-bezier(.2,0,.2,1)";

// A number that counts to its new value. `format` prints it; a later call on the same element wins.
export function tween(element, from, to, format, duration = 450) {
  const token = (element.tweenToken = (element.tweenToken || 0) + 1);
  const put = (value) => { if (element.tweenToken === token) element.textContent = format(value); };
  if (calm() || typeof from !== "number" || typeof to !== "number" || Math.abs(to - from) < 0.005) return put(to);
  const start = performance.now();
  const frame = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    put(from + (to - from) * (1 - (1 - progress) ** 3));
    if (progress < 1) requestAnimationFrame(frame);
  };
  put(from);
  requestAnimationFrame(frame);
  setTimeout(() => put(to), duration + 60);  // frames can stop (a tab put away): the end still lands
}

// A <details> that folds instead of snapping: its body's height is animated with the browser's own
// animations. The element's open state is still the browser's, so its toggle event still fires.
export function foldable(details) {
  const summary = details.querySelector("summary");
  const body = [...details.children].find((child) => child !== summary);
  let running = null;
  summary.addEventListener("click", (event) => {
    if (calm() || !body) return;
    event.preventDefault();
    const closing = details.open && !details.classList.contains("is-closing");
    const from = details.open ? body.getBoundingClientRect().height : 0;  // mid-fold if one is running
    running?.cancel();
    details.classList.toggle("is-closing", closing);
    details.open = true;
    body.style.overflow = "hidden";
    running = body.animate(
      [{ height: `${from}px`, opacity: closing ? 1 : 0 }, { height: `${closing ? 0 : body.scrollHeight}px`, opacity: closing ? 0 : 1 }],
      { duration: closing ? 200 : 260, easing: EASE_OUT },
    );
    running.onfinish = () => {
      if (closing) details.open = false;
      details.classList.remove("is-closing");
      body.style.overflow = "";
      running = null;
    };
  });
}

// Python painted as an editor would, on the code block's dark ground. The snippet is the page's
// own, so a tokenizer this small covers it: comments, strings, keywords, numbers, calls (classes
// apart) and keyword arguments, which the snippet writes as `name=value`, without spaces.
const PYTHON = /(#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\b(from|import|as|def|return|for|in|if|else|None|True|False|and|or|not)\b|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)(?=\()|\b([A-Za-z_]\w*)(?==(?!=))/g;
export function highlightPython(code) {
  let html = "";
  let last = 0;
  for (const match of code.matchAll(PYTHON)) {
    const [text, comment, string, keyword, number, call] = match;
    const kind = comment ? "cm" : string ? "str" : keyword ? "kw" : number ? "num"
      : call ? (/^[A-Z]/.test(call) ? "cls" : "fn") : "arg";
    html += `${escapeHtml(code.slice(last, match.index))}<span class="${kind}">${escapeHtml(text)}</span>`;
    last = match.index + text.length;
  }
  return html + escapeHtml(code.slice(last));
}

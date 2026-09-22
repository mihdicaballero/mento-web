// Behaviour shared by every page: the segmented radiogroups (3.4).

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

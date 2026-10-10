// Declining a reader's proposal, note or suggestion (batch 2c) needs a reason: a
// required field, 10–1000 characters, shown publicly (on GitHub, and in the book's
// history as Declined). One form, wherever Decline is: Drafts, the editor's list
// and a suggestion's own screen. The function checks the length again.

import { h, clear, busy, note, errorNote } from "./dom.js";

export const REASON_MIN = 10;
export const REASON_MAX = 1000;
let seq = 0;

/**
 * A "Decline…" button that opens the reason field in `out`. `decline(reason)` does
 * the work and resolves to the words to show (or nodes); `label` is the button's text.
 */
export function declineButton(out, decline, label = "Decline…") {
  const open = h("button", { type: "button", class: "btn", text: label });
  open.addEventListener("click", () => {
    const id = `decline-reason-${++seq}`;
    const field = h("textarea", { id, rows: "4", maxlength: String(REASON_MAX), required: true, "aria-describedby": `${id}-hint ${id}-count` });
    const count = h("p", { id: `${id}-count`, class: "muted small", "aria-live": "polite" });
    const go = h("button", { type: "submit", class: "btn danger-solid", text: "Decline", disabled: true });
    const cancel = h("button", { type: "button", class: "btn link", text: "Cancel" });
    const status = h("div", { "aria-live": "polite" });
    const show = () => {
      const n = field.value.trim().length;
      go.disabled = n < REASON_MIN;
      count.textContent = n < REASON_MIN ? `At least ${REASON_MIN} characters (${n} so far).` : `${n} of ${REASON_MAX} characters.`;
    };
    field.addEventListener("input", show);
    const form = h("form", { class: "decline" },
      h("label", { for: id, text: "Why is this being declined?" }),
      h("p", { id: `${id}-hint`, class: "muted small", text: "Shown publicly, with your name: on GitHub, and in the book's history beside what was declined. The reader is thanked as well." }),
      field, count,
      h("div", { class: "actions" }, go, cancel),
      status);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (field.value.trim().length < REASON_MIN) return show();
      go.disabled = cancel.disabled = field.disabled = true;
      clear(status, busy("Declining it…"));
      try {
        const said = await decline(field.value.trim());
        clear(out, ...(typeof said === "string" ? [note([h("p", { text: said })])] : [said].flat()));
        open.remove();
      } catch (err) {
        go.disabled = cancel.disabled = field.disabled = false;
        clear(status, errorNote(err));
      }
    });
    cancel.addEventListener("click", () => {
      clear(out);
      open.disabled = false;
      open.focus();
    });
    open.disabled = true;
    clear(out, form);
    show();
    field.focus();
  });
  return open;
}

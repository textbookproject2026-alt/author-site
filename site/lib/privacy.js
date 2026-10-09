// The first-visit privacy note, the same words as on every book and the portal
// (quartz-edition-extras privacyNotice): at the foot of the window, never in the way,
// until OK; then never again on this site. The author site loads no comments, so
// there is no Turn comments off here. Storage blocked: it shows, and OK closes it.

import { h } from "./dom.js";

const KEY = "tb-privacy-ok";
export const PRIVACY_URL = "https://confused4now.org/privacy";

export function privacyNote() {
  try {
    if (localStorage.getItem(KEY)) return;
  } catch {
    /* blocked: show it */
  }
  const box = h("div", { class: "privacy-note", role: "region", "aria-label": "Privacy" },
    h("p", {}, "No tracking cookies. Margin comments are provided by Hypothes.is, which may set its own cookies. ", h("a", { href: PRIVACY_URL, text: "Privacy" })),
    h("div", { class: "privacy-actions" },
      h("button", { type: "button", class: "btn primary", text: "OK", onclick: () => {
        try {
          localStorage.setItem(KEY, "1");
        } catch {
          /* closed for this page only */
        }
        box.remove();
        document.body.style.removeProperty("padding-bottom");
      } })));
  document.body.append(box);
  // While it shows, the page keeps room for it at the end, so nothing stays under it
  // (batch 2b: on a phone it covered the last rows of every list). CSSOM, not a
  // style attribute in the markup: the CSP allows the former.
  const room = () => {
    if (box.isConnected) document.body.style.paddingBottom = `${box.offsetHeight + 32}px`;
  };
  room();
  addEventListener("resize", room);
}

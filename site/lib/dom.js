// A small element builder. Every piece of text from outside (chapter titles, reader
// suggestions, GitHub's answers) goes in as a text node: nothing is ever set with
// innerHTML except a preview that has been through preview.js's sanitiser.

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(node, ...children) {
  node.textContent = "";
  append(node, children);
  return node;
}

/** "3 hours ago", "2 Sep 2026": when something happened, the way a person says it. */
export function when(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hour${Math.round(s / 3600) === 1 ? "" : "s"} ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} day${Math.round(s / 86400) === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A busy line, a note, an error: the three things a screen says while it works. */
export const busy = (text) => h("p", { class: "busy", role: "status", text });
export const note = (children, kind = "") => h("div", { class: `note ${kind}`.trim(), role: kind === "warn" ? "alert" : null }, children);
export const errorNote = (err) =>
  note([h("p", { text: err?.userMessage || err?.message || "Something went wrong. Please try again." })], "warn");

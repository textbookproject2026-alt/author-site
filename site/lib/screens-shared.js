// Views more than one screen uses: what moved in the drafts area when a send was
// refused, and what happened when one went through.

import { h, clear, note, when, plural } from "./dom.js";
import { renderPatch } from "./diff.js";

/**
 * Nothing was sent: the drafts area moved on since the author started. Shows the
 * changes made meanwhile (commits, and each file's difference), from the 409's
 * `conflict` ({ head, commits, files }).
 */
export function conflictView(conflict) {
  const commits = conflict?.commits ?? [];
  const files = conflict?.files ?? [];
  return h("section", { class: "conflict", "aria-label": "What changed in the drafts area" },
    note([
      h("p", {}, h("strong", { text: "Nothing was sent." }), " Since you started, something else changed the drafts area (a browser edit being published, say, or a change being accepted), and the author site never writes over anyone else's work."),
    ], "warn"),
    commits.length ? [
      h("h3", { text: `What changed meanwhile (${plural(commits.length, "change")})` }),
      h("ul", {}, commits.map((c) => h("li", {},
        c.url ? h("a", { href: c.url, target: "_blank", rel: "noopener", text: c.message || "a change" }) : c.message,
        ` — ${c.who}${c.when ? `, ${when(c.when)}` : ""}`))),
    ] : null,
    files.map((f) => renderPatch(f.patch, f.status === "added" ? "A new page" : "A page that changed")));
}

/** The send went through: what happened, with a link to the change, and `next`, an action to offer first. */
export function sentView(book, sent, title, extra = [], next = null) {
  return [
    h("h2", { class: "flush-top", text: title }),
    h("ul", { class: "steps" },
      (sent.steps ?? []).map((s) => h("li", { text: s })),
      extra.filter(Boolean).map((s) => h("li", { text: s }))),
    sent.warning ? note([h("p", { text: sent.warning })], "warn") : null,
    h("p", { class: "muted", text: "Readers see it when you publish, from Drafts." }),
    h("div", { class: "actions" },
      next,
      h("a", { class: "btn", href: `#/${book.slug}`, text: "Back to the chapters" }),
      h("a", { class: "btn", href: `#/${book.slug}/drafts`, text: "Drafts" })),
  ];
}

const hhmm = (d = new Date()) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * The line that says whether the author's work is in the drafts: "Saving…", then
 * "Draft saved 14:32", or what went wrong with Try again (`retry`). A change that
 * met someone else's on the same page is never retried as it is: Reload.
 */
export function savedAt() {
  const node = h("p", { class: "saved", role: "status", "aria-live": "polite" });
  return {
    node,
    saving: () => clear(node, h("span", { class: "busy-dot", "aria-hidden": "true" }), "Saving…"),
    done: () => clear(node, `Draft saved ${hhmm()}`),
    idle: (text = "") => clear(node, text),
    failed: (err, retry) => {
      node.classList.add("not-saved");
      const conflict = err?.status === 409 && err.body?.error === "conflict";
      clear(node, h("strong", { text: "Not saved. " }),
        conflict ? "Something else changed the drafts at the same moment. Reload to see it, then make your change again." : (err?.userMessage || "Something went wrong."), " ",
        conflict
          ? h("button", { type: "button", class: "btn link", text: "Reload", onclick: () => window.dispatchEvent(new HashChangeEvent("hashchange")) })
          : retry ? h("button", { type: "button", class: "btn link", text: "Try again", onclick: () => {
            node.classList.remove("not-saved");
            retry();
          } }) : null);
    },
  };
}

/**
 * What the book's lint found, each with a "Go to line" button (`go(line)`), or for
 * another page a Fix link to its line (`href(path, line)`), named by `title(path)`.
 * `problems` are lint.js's ({ line, rule, words, context }, with `path` when several pages).
 */
export function lintView(problems, { go, href, title = () => "" } = {}) {
  return h("ol", { class: "lint-list" }, problems.map((p) => h("li", {},
    h("span", {}, p.path ? [h("strong", { text: title(p.path) }), ", "] : null, `line ${p.line}: `, p.words,
      p.context ? [" ", h("span", { class: "muted small", text: `(“${p.context.slice(0, 80)}”)` })] : null),
    " ",
    go ? h("button", { type: "button", class: "btn link", text: `Go to line ${p.line}`, onclick: () => go(p.line) })
      : href ? h("a", { class: "btn link", href: href(p.path, p.line), text: "Fix" }) : null)));
}

/** Selects line `n` (1-based) of a textarea and scrolls it into view. */
export function goToLine(textarea, n) {
  const lines = textarea.value.split("\n");
  const start = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
  textarea.focus();
  textarea.setSelectionRange(start, start + (lines[n - 1] ?? "").length);
  const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
  textarea.scrollTop = Math.max(0, (n - 4) * lineHeight);
}

// Views more than one screen uses: what moved in the drafts area when a send was
// refused, and what happened when one went through.

import { h, note, when, plural } from "./dom.js";
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
    files.map((f) => renderPatch(f.patch, `${f.path} (${f.status})`)));
}

/** The send went through: what happened, with a link to the change, and `next`, an action to offer first. */
export function sentView(book, sent, title, extra = [], next = null) {
  return [
    h("h2", { class: "flush-top", text: title }),
    h("ul", { class: "steps" },
      (sent.steps ?? []).map((s) => h("li", { text: s })),
      extra.filter(Boolean).map((s) => h("li", { text: s }))),
    sent.warning ? note([h("p", { text: sent.warning })], "warn") : null,
    h("p", {}, h("a", { href: sent.url, target: "_blank", rel: "noopener", text: "See the change on GitHub" })),
    h("p", { class: "muted", text: "Readers don't see it until the drafts are published, under Waiting for you." }),
    h("div", { class: "actions" },
      next,
      h("a", { class: "btn", href: `#/${book.slug}`, text: "Back to the chapters" }),
      h("a", { class: "btn", href: `#/${book.slug}/waiting`, text: "Waiting for you" })),
  ];
}

/**
 * What the book's lint found that still has to be put right before Send, each with a
 * "Go to line" button (`go(line)`), or for another page a link to it (`href(path, line)`).
 * `problems` are lint.js's ({ line, rule, words, context }, with `path` when several pages).
 */
export function lintView(problems, { go, href, fixed = "" } = {}) {
  return h("section", { class: "lint", "aria-label": "Formatting to put right" },
    note([
      h("p", {}, h("strong", { text: `${plural(problems.length, "thing")} to put right first.` }),
        " The book checks every page's formatting before it can be sent (or published), so that it shows properly for readers. Each is below, with its line."),
      fixed ? h("p", { class: "muted small", text: fixed }) : null,
    ], "warn"),
    h("ol", { class: "lint-list" }, problems.map((p) => h("li", {},
      h("span", {}, p.path ? [h("code", { text: p.path }), " "] : null, h("strong", { text: `Line ${p.line}: ` }), p.words,
        p.context ? [" ", h("span", { class: "muted small", text: `(“${p.context.slice(0, 80)}”)` })] : null),
      " ",
      go ? h("button", { type: "button", class: "btn link", text: `Go to line ${p.line}`, onclick: () => go(p.line) })
        : href ? h("a", { class: "btn link", href: href(p.path, p.line), text: `Go to line ${p.line}` }) : null))));
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

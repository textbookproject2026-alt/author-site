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

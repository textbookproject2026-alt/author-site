// Readers' open suggestions, by page: the count beside each chapter on Chapters, and
// the list in the editor. Lists are read-only: a suggestion is accepted or declined in its
// page's track-changes review (screens-review.js), which each entry links to. Two kinds:
//   written    an issue from the book's site's Suggest form (read "suggestions")
//   proposed   an edit made in the in-site editor, a pull request into drafts
//              (read "changes"; `path` from the body propose-edit wrote)

import { h, clear, busy, note, errorNote, when, plural } from "./dom.js";
import { read } from "./api.js";
import { diff, renderOps, tokens } from "./diff.js";

/** Both lists for a book; a list that can't be read is empty rather than an error. */
export async function openSuggestions(slug) {
  const [written, changes] = await Promise.all([
    read("suggestions", { book: slug }).then((r) => r.suggestions ?? [], () => null),
    read("changes", { book: slug }).then((r) => r.changes ?? [], () => null),
  ]);
  // failed: a list that couldn't be read, said so where the page lists suggestions.
  return { written: written ?? [], changes: changes ?? [], failed: written === null || changes === null };
}

/**
 * path -> { suggestions, notes } waiting on it, counted as Drafts counts them (drafts.js
 * rowsOf): a proposed edit, or a written suggestion with a text change, is a suggestion;
 * anything else written is a note; an accepted one is done (History has it).
 */
export function countsByPath({ written, changes }) {
  const counts = new Map();
  const add = (path, k) => {
    if (!path) return;
    const c = counts.get(path) ?? { suggestions: 0, notes: 0 };
    c[k]++;
    counts.set(path, c);
  };
  for (const c of changes) add(c.path, "suggestions");
  for (const w of written.filter((x) => !x.accepted)) add(w.path, w.original ? "suggestions" : "notes");
  return counts;
}

/** The badge beside a page on Chapters ("2 suggestions, 1 note"), linking to its editor's list; null for none. */
export const countBadge = (c, href) => {
  const words = [c?.suggestions ? plural(c.suggestions, "suggestion") : null, c?.notes ? plural(c.notes, "note") : null].filter(Boolean).join(", ");
  return words ? h("a", { class: "badge suggestions", href, text: words }) : null;
};

/** What Accept and Decline do, said wherever suggestions are listed. */
export const ACCEPT_WORDS = "Accept puts the change into this chapter's draft (not yet published) and thanks the reader.";
export const DECLINE_WORDS = "Decline leaves the text as it is and replies to the reader; a reader who wasn't signed in finds the reply on the suggestion's entry in the book's history.";
export const OUTDATED = "The paragraph has changed since this suggestion was made, so it no longer applies as written.";

/** A suggestion's place in its page's review, where it is accepted or declined. */
export const reviewHref = (slug, path, number) => `#/${slug}/review/${encodeURIComponent(path)}/change/${number}`;
const reviewLink = (slug, path, number) => (path ? h("a", { class: "btn small", href: reviewHref(slug, path, number), text: "Review it" }) : null);

/** A proposed edit: View changes, and Review it (where it is accepted or declined). */
export function changeRow(slug, c, titles) {
  const view = h("div", { hidden: true });
  const buttons = h("div", { class: "row" },
    h("button", { type: "button", class: "btn link", text: "View changes", onclick: async () => {
      view.hidden = !view.hidden;
      if (view.hidden || view.childElementCount) return;
      clear(view, busy("Reading the suggestion…"));
      try {
        const d = await read("change", { book: slug, number: String(c.number) });
        clear(view, d.readable
          ? d.pages.map((p) => renderOps(p.lines.map((l) => ({ t: l.kind === "before" ? "-" : "+", v: l.text })), p.path ? titles.get(p.path) : p.page))
          : note([h("p", { text: d.why })]));
      } catch (err) {
        clear(view, errorNote(err));
      }
    } }),
    reviewLink(slug, c.path, c.number));
  return h("li", {},
    h("div", { class: "row" }, h("div", { class: "grow" },
      h("strong", { text: c.title }), h("span", { class: "muted", text: ` — ${c.who}, ${when(c.when)}` }),
      c.needsLook ? [" ", h("span", { class: "badge look", text: "needs a look — paragraph changed" })] : null), buttons),
    view);
}

/** A reader's suggestion: word by word against the text it started from, when the issue has it. */
export const suggested = (s) => h("blockquote", { class: "said" },
  s.original && s.suggestion ? words(s.original, s.suggestion) : s.suggestion || "(nothing written)");

/** Old words struck, new ones underlined: `from` → `to`, word by word. */
export function words(from, to) {
  // Runs of one kind together, so "a Word file." is one insertion, not five.
  const runs = [];
  for (const o of diff(tokens(from), tokens(to))) {
    if (runs.at(-1)?.t === o.t) runs.at(-1).v += o.v;
    else runs.push({ ...o });
  }
  return runs.map((o) => (o.t === "=" ? document.createTextNode(o.v)
    : h(o.t === "-" ? "del" : "ins", {}, h("span", { class: "sr-only", text: o.t === "-" ? "[removed: " : "[added: " }), o.v, h("span", { class: "sr-only", text: "]" }))));
}

/**
 * One paragraph a suggestion and the drafts both changed: as the reader saw it, as they
 * suggest it and as it is in the drafts now, side by side, each change against the old.
 */
export function threeWay(p) {
  const col = (label, body) => h("div", { class: "col" }, h("p", { class: "muted small", text: label }), h("blockquote", { class: "said" }, body));
  return h("div", { class: "three-way" },
    col("When it was suggested", p.base ?? ""),
    col("Suggested", p.suggested ? words(p.base ?? "", p.suggested) : "(the suggestion removes this paragraph)"),
    col("In the drafts now", p.current ? words(p.base ?? "", p.current) : "(removed from the drafts since)"));
}

/** sessionStorage: a suggestion the author opened in the editor, read (once) by screens-edit.js. */
export const openedKey = (slug, path) => `tb-suggestion:${slug}:${path}`;

/** A written suggestion or note: what the reader wrote, Review it, and its own screen. */
export function writtenRow(slug, s) {
  return h("li", {},
    h("div", { class: "row" },
      h("div", { class: "grow" },
        suggested(s),
        h("span", { class: "muted small", text: `${s.who}, ${when(s.when)}` }),
        s.accepted ? [" ", h("span", { class: "badge accepted", text: "Accepted" })] : null),
      h("div", { class: "row" }, reviewLink(slug, s.path, s.number), h("a", { class: "btn link", href: `#/${slug}/suggestion/${s.number}`, text: "More" }))));
}

/** The editor's list: this page's open suggestions, or null when it has none. */
export function pageSuggestions(slug, path, data, titles) {
  const written = data.written.filter((s) => s.path === path);
  const changes = data.changes.filter((c) => c.path === path);
  const n = written.length + changes.length;
  if (!n && !data.failed) return null;
  return h("section", { class: "page-suggestions", id: "suggestions", "aria-label": "Reader suggestions on this page" },
    h("h2", { class: "small-heading", text: n ? `Reader suggestions on this page (${n})` : "Reader suggestions on this page" }),
    data.failed ? note([h("p", { text: "Reader suggestions couldn't be loaded just now, so some may be missing." }), h("button", { type: "button", class: "secondary", text: "Try again", onclick: () => window.dispatchEvent(new HashChangeEvent("hashchange")) })], "warn") : null,
    n ? h("div", { class: "muted small" },
      h("p", {}, "Accept or decline each in the ", h("a", { href: `#/${slug}/review/${encodeURIComponent(path)}`, text: "review of this page" }), ", where it shows in place. ", ACCEPT_WORDS),
      h("p", { text: DECLINE_WORDS })) : null,
    changes.length ? h("ul", { class: "list" }, changes.map((c) => changeRow(slug, c, titles))) : null,
    written.length ? h("ul", { class: "list" }, written.map((s) => writtenRow(slug, s))) : null);
}

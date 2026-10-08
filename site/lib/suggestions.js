// Readers' open suggestions, by page: the count beside each chapter on Chapters, and
// the list in the editor with Accept and Decline. Two kinds, as on Drafts:
//   written    an issue from the book's site's Suggest form (read "suggestions")
//   proposed   an edit made in the in-site editor, a pull request into drafts
//              (read "changes"; `path` from the body propose-edit wrote)

import { h, clear, busy, note, errorNote, when } from "./dom.js";
import { read, act } from "./api.js";

/** Both lists for a book; a list that can't be read is empty rather than an error. */
export async function openSuggestions(slug) {
  const [written, changes] = await Promise.all([
    read("suggestions", { book: slug }).then((r) => r.suggestions ?? [], () => []),
    read("changes", { book: slug }).then((r) => r.changes ?? [], () => []),
  ]);
  return { written, changes };
}

/** path -> how many open suggestions name it. */
export function countsByPath({ written, changes }) {
  const counts = new Map();
  for (const s of [...written, ...changes]) if (s.path) counts.set(s.path, (counts.get(s.path) ?? 0) + 1);
  return counts;
}

/** The badge beside a page on Chapters, linking to its editor's list; null for none. */
export const countBadge = (n, href) =>
  n ? h("a", { class: "badge suggestions", href, text: `${n} ${n === 1 ? "suggestion" : "suggestions"}` }) : null;

/** One button that runs `fn` once, showing progress and then what happened in `out`. */
function answerButton(text, cls, out, working, fn) {
  const b = h("button", { type: "button", class: `btn ${cls}`.trim(), text });
  b.addEventListener("click", async () => {
    for (const x of b.parentElement?.querySelectorAll("button") ?? []) x.disabled = true;
    clear(out, busy(working));
    try {
      clear(out, note([h("p", { text: await fn() })]));
    } catch (err) {
      for (const x of b.parentElement?.querySelectorAll("button") ?? []) x.disabled = false;
      clear(out, errorNote(err));
    }
  });
  return b;
}

/** A proposed edit: View changes, Accept (into the drafts) and Decline (with thanks). `after` runs once answered. */
export function changeRow(slug, c, titles, after = () => {}) {
  const out = h("div", { "aria-live": "polite" });
  const view = h("div", { hidden: true });
  const answered = (words) => async () => {
    after();
    return words;
  };
  const buttons = h("div", { class: "row" },
    h("button", { type: "button", class: "btn link", text: "View changes", onclick: async () => {
      view.hidden = !view.hidden;
      if (view.hidden || view.childElementCount) return;
      clear(view, busy("Reading the suggestion…"));
      try {
        const d = await read("change", { book: slug, number: String(c.number) });
        clear(view, d.readable
          ? d.pages.map((p) => [h("h4", { text: p.path ? titles.get(p.path) : p.page }), p.lines.map((l) => h("p", { class: `prose-change ${l.kind}` }, h("span", { class: "sr-only", text: l.kind === "before" ? "Before: " : "After: " }), l.text || " "))])
          : note([h("p", { text: d.why })]));
      } catch (err) {
        clear(view, errorNote(err));
      }
    } }),
    answerButton("Accept", "primary", out, "Folding it into the drafts…", async () => {
      await act(slug, "change-accept", { number: c.number, title: c.title });
      return answered("Accepted: it is in the drafts.")();
    }),
    answerButton("Decline", "", out, "Declining it…", async () => {
      await act(slug, "change-decline", { number: c.number });
      return answered("Declined, with a note thanking them.")();
    }));
  return h("li", {},
    h("div", { class: "row" }, h("div", { class: "grow" }, h("strong", { text: c.title }), h("span", { class: "muted", text: ` — ${c.who}, ${when(c.when)}` })), buttons),
    view, out);
}

/** A written suggestion: what the reader wrote, Accept (you'll make it) and Decline (politely), or its own screen. */
export function writtenRow(slug, s, after = () => {}) {
  const out = h("div", { "aria-live": "polite" });
  const buttons = s.accepted
    ? h("div", { class: "row" }, h("span", { class: "badge accepted", text: "Accepted" }), h("a", { class: "btn link", href: `#/${slug}/suggestion/${s.number}`, text: "I've made the change…" }))
    : h("div", { class: "row" },
      answerButton("Accept", "primary", out, "Thanking the reader…", async () => {
        await act(slug, "suggestion-accept", { number: s.number });
        after();
        return "Accepted: the reader is thanked and told you'll make the change. Once it's made, say so on the suggestion's own screen (Drafts).";
      }),
      answerButton("Decline", "", out, "Declining it…", async () => {
        await act(slug, "suggestion-decline", { number: s.number });
        after();
        return "Declined, with a courteous reply.";
      }),
      h("a", { class: "btn link", href: `#/${slug}/suggestion/${s.number}`, text: "More" }));
  return h("li", {},
    h("div", { class: "row" },
      h("div", { class: "grow" },
        h("blockquote", { class: "said", text: s.suggestion || "(nothing written)" }),
        h("span", { class: "muted small", text: `${s.who}, ${when(s.when)}` })),
      buttons),
    out);
}

/** The editor's list: this page's open suggestions, or null when it has none. */
export function pageSuggestions(slug, path, data, titles) {
  const written = data.written.filter((s) => s.path === path);
  const changes = data.changes.filter((c) => c.path === path);
  const n = written.length + changes.length;
  if (!n) return null;
  return h("section", { class: "page-suggestions", id: "suggestions", "aria-label": "Reader suggestions on this page" },
    h("h2", { class: "small-heading", text: `Reader suggestions on this page (${n})` }),
    changes.length ? [
      h("p", { class: "muted small", text: "Edits readers made on the book's site. Accept puts one into the drafts (reload the page to see it here); Decline closes it with a note thanking them." }),
      h("ul", { class: "list" }, changes.map((c) => changeRow(slug, c, titles))),
    ] : null,
    written.length ? [
      h("p", { class: "muted small", text: "What readers wrote. Accept thanks them and says you'll make the change; Decline replies that the text is staying as it is." }),
      h("ul", { class: "list" }, written.map((s) => writtenRow(slug, s))),
    ] : null);
}

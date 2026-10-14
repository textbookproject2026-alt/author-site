// Readers' open suggestions, by page: the count beside each chapter on Chapters, and
// the list in the editor with Accept and Decline. Two kinds, as on Drafts:
//   written    an issue from the book's site's Suggest form (read "suggestions")
//   proposed   an edit made in the in-site editor, a pull request into drafts
//              (read "changes"; `path` from the body propose-edit wrote)

import { h, clear, busy, note, errorNote, when } from "./dom.js";
import { read, act } from "./api.js";
import { declineButton } from "./decline.js";
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

/** path -> how many open suggestions name it. */
export function countsByPath({ written, changes }) {
  const counts = new Map();
  for (const s of [...written, ...changes]) if (s.path) counts.set(s.path, (counts.get(s.path) ?? 0) + 1);
  return counts;
}

/** The badge beside a page on Chapters, linking to its editor's list; null for none. */
export const countBadge = (n, href) =>
  n ? h("a", { class: "badge suggestions", href, text: `${n} ${n === 1 ? "suggestion" : "suggestions"}` }) : null;

/** One button that runs `fn` once, showing progress and then what happened in `out` (words, or nodes). */
function answerButton(text, cls, out, working, fn) {
  const b = h("button", { type: "button", class: `btn ${cls}`.trim(), text });
  b.addEventListener("click", async () => {
    for (const x of b.parentElement?.querySelectorAll("button") ?? []) x.disabled = true;
    clear(out, busy(working));
    try {
      const said = await fn();
      clear(out, typeof said === "string" ? note([h("p", { text: said })]) : said);
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
          ? d.pages.map((p) => renderOps(p.lines.map((l) => ({ t: l.kind === "before" ? "-" : "+", v: l.text })), p.path ? titles.get(p.path) : p.page))
          : note([h("p", { text: d.why })]));
      } catch (err) {
        clear(view, errorNote(err));
      }
    } }),
    answerButton("Accept", "primary", out, "Folding it into the drafts…", async () => {
      try {
        await act(slug, "change-accept", { number: c.number, title: c.title });
      } catch (err) {
        // The paragraph changed under the same words: the author chooses, nothing is an error.
        if (err?.status === 409 && err.body?.overlap) return overlapChoice(slug, c, err.body, out, after);
        throw err;
      }
      return answered("Accepted: it is in the drafts.")();
    }),
    declineButton(out, async (reason) => {
      await act(slug, "change-decline", { number: c.number, reason });
      return answered("Declined: your reason is posted, with a note thanking them. It shows as Declined in the book's history.")();
    }));
  return h("li", {},
    h("div", { class: "row" }, h("div", { class: "grow" },
      h("strong", { text: c.title }), h("span", { class: "muted", text: ` — ${c.who}, ${when(c.when)}` }),
      c.needsLook ? [" ", h("span", { class: "badge look", text: "needs a look — paragraph changed" })] : null), buttons),
    view, out);
}

/** Old words struck, new ones underlined: `from` → `to`, word by word. */
function words(from, to) {
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

/**
 * Accept found the paragraph changed since the suggestion was made: refused, nothing
 * written. Taking the suggestion as it is would put back the old wording of whatever
 * changed there since, so the ways on are the editor (current text, the suggestion
 * beside it) and Decline with a comment.
 */
function overlapChoice(slug, c, body, out, after) {
  const paragraphs = body.overlap.paragraphs ?? [];
  const first = paragraphs[0];
  return note([
    h("p", {}, h("strong", { text: body.userMessage || "This suggestion was made on an older version of this paragraph." })),
    paragraphs.map(threeWay),
    h("div", { class: "row" },
      first?.path ? h("a", { class: "btn primary", href: `#/${slug}/edit/${encodeURIComponent(first.path)}/line/${(first.line ?? 0) + 1}`, text: "Open in editor", onclick: () => {
        try {
          sessionStorage.setItem(openedKey(slug, first.path), JSON.stringify({ number: c.number, title: c.title, who: c.who, paragraphs: paragraphs.filter((p) => p.path === first.path) }));
        } catch {
          /* storage blocked: the editor opens without the suggestion beside it */
        }
      } }) : null,
      declineButton(out, async (reason) => {
        await act(slug, "change-decline", { number: c.number, reason });
        after();
        return "Declined: your comment is posted, with a note thanking them. It shows as Declined in the book's history.";
      }, "Decline with comment…")),
  ]);
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
      declineButton(out, async (reason) => {
        await act(slug, "suggestion-decline", { number: s.number, reason });
        after();
        return "Declined: your reason is posted, with a courteous reply. It shows as Declined in the book's history.";
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
  if (!n && !data.failed) return null;
  return h("section", { class: "page-suggestions", id: "suggestions", "aria-label": "Reader suggestions on this page" },
    h("h2", { class: "small-heading", text: n ? `Reader suggestions on this page (${n})` : "Reader suggestions on this page" }),
    data.failed ? note([h("p", { text: "Reader suggestions couldn't be loaded just now, so some may be missing." }), h("button", { type: "button", class: "secondary", text: "Try again", onclick: () => window.dispatchEvent(new HashChangeEvent("hashchange")) })], "warn") : null,
    changes.length ? [
      h("p", { class: "muted small", text: "Edits readers made on the book's site. Accept puts one into the drafts (reload the page to see it here); Decline closes it with a note thanking them." }),
      h("ul", { class: "list" }, changes.map((c) => changeRow(slug, c, titles))),
    ] : null,
    written.length ? [
      h("p", { class: "muted small", text: "What readers wrote. Accept thanks them and says you'll make the change; Decline replies that the text is staying as it is." }),
      h("ul", { class: "list" }, written.map((s) => writtenRow(slug, s))),
    ] : null);
}

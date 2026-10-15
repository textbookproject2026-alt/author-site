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

/**
 * Send one of the choices the function listed for this change (CHOICES in its
 * lib/author-console.mjs: the action and, for an accept, how), never a name of our own.
 */
const choose = (slug, c, choice, extra = {}) =>
  act(slug, choice.action, { number: c.number, ...(choice.resolve ? { resolve: choice.resolve } : {}), ...extra });

const OUTDATED = "The paragraph has changed since this suggestion was made, so it no longer applies as written.";

/**
 * The ways to answer a proposed edit, from `choices`. A fresh one: Accept and Decline. One
 * whose paragraph changed since (`outdated`): Use the suggestion (their change, word by
 * word, onto the paragraph as it is now), Edit before accepting, Decline as outdated and
 * Decline with a reason.
 */
export function answers(slug, c, choices, outdated, out, after) {
  const answered = (words) => {
    after();
    return words;
  };
  const decline = choices.decline ? declineButton(out, async (reason) => {
    await choose(slug, c, choices.decline, { reason });
    return answered("Declined: your reason is posted, with a note thanking them. It shows as Declined in the book's history.");
  }) : null;
  const accept = (choice) => async () => {
    try {
      await choose(slug, c, choice, { title: c.title });
    } catch (err) {
      // The same words changed on both sides: nothing written; the author chooses.
      if (err?.status === 409 && err.body?.overlap) return overlapChoice(slug, c, err.body, out, after);
      throw err;
    }
    return answered(outdated
      ? "Accepted: the reader's change is in the drafts, put into the paragraph as it is now."
      : "Accepted: it is in the drafts.");
  };
  if (!outdated) {
    return [choices.accept ? answerButton("Accept", "primary", out, "Folding it into the drafts…", accept(choices.accept)) : null, decline];
  }
  return [
    choices.use ? answerButton("Use the suggestion", "primary", out, "Putting their change into the paragraph as it is now…", accept(choices.use)) : null,
    choices.edit ? answerButton("Edit before accepting", "", out, "Putting in what fits and opening the editor…", () => editBefore(slug, c, choices.edit, after)) : null,
    choices.decline ? answerButton("Decline as outdated", "", out, "Declining it…", async () => {
      await choose(slug, c, choices.decline, { reason: OUTDATED });
      return answered("Declined as outdated: the reader is thanked. It shows as Declined in the book's history.");
    }) : null,
    decline,
  ];
}

/** A proposed edit: View changes and its answers. `after` runs once answered. */
export function changeRow(slug, c, titles, after = () => {}) {
  const out = h("div", { "aria-live": "polite" });
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
    answers(slug, c, c.choices ?? {}, c.needsLook, out, after));
  return h("li", {},
    h("div", { class: "row" }, h("div", { class: "grow" },
      h("strong", { text: c.title }), h("span", { class: "muted", text: ` — ${c.who}, ${when(c.when)}` }),
      c.needsLook ? [" ", h("span", { class: "badge look", text: "needs a look — paragraph changed" })] : null), buttons),
    view, out);
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

/**
 * Edit before accepting: their change goes into the drafts where it fits (credited to
 * them), the drafts' words kept where both changed the same ones, then the editor opens
 * on that paragraph with what was kept beside it.
 */
async function editBefore(slug, c, choice, after) {
  const r = await choose(slug, c, choice, { title: c.title });
  after();
  const at = r.edit;
  if (!at?.path) return "Accepted: it is in the drafts.";
  try {
    sessionStorage.setItem(openedKey(slug, at.path), JSON.stringify({ number: c.number, title: c.title, who: c.who, paragraphs: at.paragraphs ?? [] }));
  } catch {
    /* storage blocked: the editor opens without the suggestion beside it */
  }
  location.hash = `#/${slug}/edit/${encodeURIComponent(at.path)}${at.line == null ? "" : `/line/${at.line + 1}`}`;
  return "Opening the editor…";
}

/**
 * "Use the suggestion" (or Accept) found the reader and the drafts changed the same words:
 * refused, nothing written. Old, suggested and now side by side, what Edit before
 * accepting would start from, and the other ways on (`body.choices`, from the function).
 */
function overlapChoice(slug, c, body, out, after) {
  const paragraphs = body.overlap.paragraphs ?? [];
  const choices = body.choices ?? {};
  const merged = paragraphs.filter((p) => p.merged && p.merged !== p.current);
  return note([
    h("p", {}, h("strong", { text: body.userMessage || "This suggestion was made on an older version of this paragraph." })),
    h("p", { text: "Their change couldn't be put in by itself: you and the reader changed the same words. Nothing was changed." }),
    paragraphs.map(threeWay),
    merged.length ? [
      h("p", { class: "muted small", text: "Edit before accepting puts in the rest of their change, keeps your words where you both changed them, and opens the paragraph for you to finish:" }),
      merged.map((p) => h("blockquote", { class: "said" }, words(p.current, p.merged))),
    ] : null,
    h("div", { class: "row" }, answers(slug, c, { edit: choices.edit, decline: choices.decline }, true, out, after)),
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
        suggested(s),
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

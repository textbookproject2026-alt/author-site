// One reader's proposed edit (#/<book>/proposal/<n>): who proposed it, their summary, every
// change it makes to the page as the drafts are now (word by word, the function's review
// of that one proposal; an older-version part with old / suggested / now), and Accept and
// Decline as everywhere else (suggestions.js answers). Opened from the review's popover,
// with Back to the chapter review at the same place.

import { h, clear, busy, note, errorNote, when } from "./dom.js";
import { read } from "./api.js";
import { bookBySlug, bookHeader } from "./books.js";
import { rawText, titlesFrom } from "./drafts.js";
import { renderOps } from "./diff.js";
import { answers, words, threeWay } from "./suggestions.js";
import { reviewBackLink, shown, withTitles } from "./screens-review.js";

export async function proposalScreen(slug, number) {
  const book = await bookBySlug(slug);
  const [{ changes }, index] = await Promise.all([read("changes", { book: slug }), rawText(book.repo, book.drafts_branch, "index.md").catch(() => null)]);
  const titles = titlesFrom(index);
  const back = reviewBackLink(slug);
  const c = changes.find((x) => x.number === number);
  if (!c) {
    return [...bookHeader(book, "drafts", "A reader's proposed edit"), back,
      note([h("p", { text: "This proposal has already been dealt with." })]),
      h("p", {}, h("a", { href: `#/${slug}/drafts`, text: "Back to Drafts" }))];
  }
  const page = c.path ? titles.get(c.path) : null;
  const title = withTitles(c.title, titles, c.path ?? "");
  const changesBox = h("div", {}, busy("Reading the changes…"));
  const out = h("div", { "aria-live": "polite" });
  let who = c.who;
  let summary = "";
  // Its changes against the drafts as they are now: the review's read of this one proposal.
  (async () => {
    try {
      if (!c.path) throw new Error("no page");
      const part = await read("review", { book: slug, path: c.path, number: String(number) });
      const it = part.items[0];
      who = it?.who ?? who;
      summary = it?.summary ?? "";
      byline.textContent = `From ${who}, ${when(c.when)}${page ? `, on “${page}”` : ""}.`;
      if (summary && !c.title.includes(summary)) byline.after(h("blockquote", { class: "said", text: withTitles(summary, titles, c.path) }));
      const hs = part.hunks.filter((x) => !x.already);
      if (it?.why) throw new Error(it.why);
      clear(changesBox, hs.length ? hs.map((x, k) => h("section", { class: "proposal-change" },
        h("h3", { class: "small-heading", text: hs.length > 1 ? `Part ${k + 1} of ${hs.length}` : "The change" }),
        x.stale ? [h("p", { class: "muted small", text: "Made on an older version of this paragraph:" }), x.stale.map(threeWay)]
          : x.lost ? h("p", { class: "muted", text: "Its words aren't in the chapter any more." })
            : h("blockquote", { class: "said rv-words" }, words(shown(x.from), shown(x.to)))))
        : note([h("p", { text: "Everything it changes is already in the drafts." })]));
    } catch {
      // Not one page's edit (or the review can't read it): the change as GitHub has it.
      try {
        const d = await read("change", { book: slug, number: String(number) });
        clear(changesBox, d.readable
          ? d.pages.map((p) => renderOps(p.lines.map((l) => ({ t: l.kind === "before" ? "-" : "+", v: l.text })), p.path ? titles.get(p.path) : p.page))
          : note([h("p", { text: d.why })]));
      } catch (err) {
        clear(changesBox, errorNote(err));
      }
    }
  })();
  const byline = h("p", { class: "muted", text: `From ${who}, ${when(c.when)}${page ? `, on “${page}”` : ""}.` });
  return [
    ...bookHeader(book, "drafts", "A reader's proposed edit"),
    back,
    h("h2", { text: title }),
    byline,
    h("h3", { text: "What it changes" }),
    changesBox,
    h("div", { class: "row actions" }, answers(slug, c, c.choices ?? {}, c.needsLook, out, () => {})),
    out,
    c.url ? h("p", { class: "small" }, h("a", { href: c.url, target: "_blank", rel: "noopener", text: "View on GitHub" })) : null,
  ];
}

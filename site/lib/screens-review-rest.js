// Review: Rest of the book (#/<book>/review-rest): what readers sent on anything but a
// chapter (the front page, the glossary, concept pages, the book as a whole), as a list,
// each with the same answers as in a chapter's review: Accept where there is something to
// accept, Decline (with a reason) and Keep open. Counted as Drafts counts its row.

import { h, clear, note, when, plural } from "./dom.js";
import { act } from "./api.js";
import { bookBySlug, bookHeader } from "./books.js";
import { REST, draftItems, forgetCount, readerItems, rowsOf } from "./drafts.js";
import { changeRow, suggested, writtenRow } from "./suggestions.js";
import { declineButton } from "./decline.js";

export async function reviewRestScreen(slug) {
  const book = await bookBySlug(slug);
  const [state, readers] = await Promise.all([draftItems(book, { texts: false }), readerItems(slug)]);
  const { rows } = rowsOf(state, readers.changes, readers.written);
  const row = rows.find((r) => r.key === REST);
  const items = row?.reader ?? [];
  const where = (path) => (path ? `On ${path === "index.md" ? "the front page" : `“${state.titles.get(path, null)}”`}` : "On the book as a whole");
  const after = () => forgetCount(slug);
  const keepOpen = (out) => h("button", { type: "button", class: "btn", text: "Keep open", onclick: (e) => {
    e.currentTarget.disabled = true;
    clear(out, note([h("p", { text: "Kept open: it stays waiting for later." })]));
  } });
  const entry = (it) => {
    if (it.kind === "proposal") {
      // A proposal's title names its file ("Edit ¶3 of glossary.md"): said with the page's title.
      const li = changeRow(slug, { ...it, title: String(it.title ?? "").replace(/\S+\.md\b/g, `“${state.titles.get(it.path, null)}”`) }, state.titles, after);
      const out = li.lastElementChild;
      li.querySelector(".row .row")?.append(keepOpen(out));
      li.prepend(h("p", { class: "muted small", text: where(it.path) }));
      return li;
    }
    if (it.kind === "suggestion") {
      const li = writtenRow(slug, it, after);
      const out = li.lastElementChild;
      li.querySelector(".row .row")?.append(keepOpen(out));
      li.prepend(h("p", { class: "muted small", text: where(it.path) }));
      return li;
    }
    const out = h("div", { "aria-live": "polite" });
    return h("li", {},
      h("p", { class: "muted small", text: where(it.path) }),
      h("div", { class: "row" },
        h("div", { class: "grow" }, h("strong", { text: "Note" }), h("span", { class: "muted", text: ` — ${it.who}, ${when(it.when)}` }), suggested(it)),
        h("div", { class: "row" },
          declineButton(out, async (reason) => {
            await act(slug, "suggestion-decline", { number: it.number, reason });
            after();
            return "Declined: your reason is posted, with a note thanking them. It shows as Declined in the book's history.";
          }),
          keepOpen(out))),
      out);
  };
  const said = row ? [row.suggestions ? plural(row.suggestions, "suggestion") : null, row.notes ? plural(row.notes, "note") : null].filter(Boolean).join(", ") : "";
  return [
    ...bookHeader(book, "drafts", "Review: Rest of the book"),
    h("p", { class: "rv-back" }, h("a", { href: `#/${slug}/drafts`, text: "← Drafts" })),
    items.length
      ? [h("p", { class: "rv-summary", text: said }), h("ul", { class: "list review-rest" }, items.map(entry))]
      : h("p", { class: "muted", text: "Nothing from readers is waiting on the rest of the book." }),
  ];
}

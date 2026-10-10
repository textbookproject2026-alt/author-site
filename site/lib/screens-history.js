// The drafts area's history, in this site rather than on GitHub: every change to the
// book (or to one page), who made it and when, and whether readers have it yet. One
// change opens as the editor's Changes view (diff.js) and the page as it was, and
// "Restore this version" puts that text into the editor as a new change, sent through
// author-send on the drafts as they are now (never a revert of history).
//
// Read through author-history, as the App, so authors don't share GitHub's
// 60-an-hour unauthenticated limit. The same three states readers see in Page
// history: Proposed (open proposals and notes, from the function's /api/history),
// Being edited (in the drafts, not yet published), Published, and Declined (batch
// 2c: what the book's people declined and why, with their comments; any of them
// can add a comment, and delete their own; read fresh through author-read).

import { h, clear, busy, note, errorNote, when } from "./dom.js";
import { act, declinedChange, history, proposed, read, send } from "./api.js";
import { identity } from "./auth.js";
import { bookBySlug, bookHeader, rawUrl } from "./books.js";
import { renderChapter } from "./preview.js";
import { renderDiff, renderPatch } from "./diff.js";
import { contentsLineFor, forgetCount, rawText, titlesFrom } from "./drafts.js";

/** Page titles for this screen: the front page's Contents, as readers and the drafts have it. */
const titlesOf = async (book) => {
  const [live, drafts] = await Promise.all([
    rawText(book.repo, book.live_branch, "index.md").catch(() => null),
    rawText(book.repo, book.drafts_branch, "index.md").catch(() => null),
  ]);
  return titlesFrom(live, drafts);
};
/** A change's own words, with any file name in them said as the page's title. */
const said = (message, titles) => (message || "A change").replace(/\b(?:chapters|assets)\/[^\s"”“)]+|\b(?:index|glossary)\.md\b/g, (p) => `“${titles.get(p)}”`);
const enc = encodeURIComponent;
const marker = (c) => c.live
  ? h("span", { class: "badge status-published", text: "Published" })
  : h("span", { class: "badge status-edited", text: "Being edited" });
const KINDS = { edit: "Proposed edit", note: "Note", suggestion: "Suggestion" };
/** An open proposal or note: where the author answers it (Drafts, or the suggestion's own screen). */
const proposedLine = (slug, it) => h("li", {},
  h("div", { class: "row" },
    h("a", { class: "grow", href: it.kind === "edit" ? `#/${slug}/drafts` : `#/${slug}/suggestion/${it.number}` },
      h("strong", { text: it.summary || KINDS[it.kind] || "A suggestion" }), ` — ${it.who?.name ?? "a reader"}, ${when(it.date)}`),
    h("span", { class: "badge status-new", text: `Proposed · ${KINDS[it.kind] ?? "Suggestion"}` })));

const DECLINED_KINDS = { edit: "Proposed edit", note: "Note", suggestion: "Suggestion" };
const COMMENT_MAX = 1000;

/** One declined item: who proposed it, who declined it and why, its change, the comments. */
function declinedLine(slug, d, titles, redraw) {
  const mine = `m-${identity()?.id ?? ""}`;
  const out = h("div", { "aria-live": "polite" });
  const page = d.files?.[0] ? titles.get(d.files[0]) : null;
  const view = h("div", { hidden: true });
  const show = d.kind === "edit" ? h("button", { type: "button", class: "btn link", text: "Show changes" }) : null;
  show?.addEventListener("click", async () => {
    view.hidden = !view.hidden;
    show.textContent = view.hidden ? "Show changes" : "Hide changes";
    if (view.hidden || view.childElementCount) return;
    clear(view, busy("Reading what was proposed…"));
    try {
      const { files } = await declinedChange(slug, d.number);
      clear(view, files.length ? files.map((f) => renderDiff(f.before ?? "", f.after ?? "", titles.get(f.path))) : h("p", { class: "muted", text: "The proposal changed no page." }));
    } catch (err) {
      clear(view, errorNote(err));
    }
  });
  const comments = d.comments.map((c) => {
    const del = c.member === mine ? h("button", { type: "button", class: "btn link danger", text: "Delete" }) : null;
    del?.addEventListener("click", async () => {
      del.disabled = true;
      try {
        await act(slug, "comment-delete", { number: d.number, id: c.id });
        await redraw("Your comment was deleted.");
      } catch (err) {
        del.disabled = false;
        del.after(errorNote(err));
      }
    });
    return h("li", { class: "comment" },
      h("p", { class: "muted small" }, `${c.name}, ${when(c.date)}`, del ? " · " : "", del),
      h("p", { class: "said", text: c.text }));
  });
  const add = h("button", { type: "button", class: "btn", text: "Add a comment" });
  add.addEventListener("click", () => {
    const id = `comment-${d.number}`;
    const field = h("textarea", { id, rows: "3", maxlength: String(COMMENT_MAX), required: true });
    const post = h("button", { type: "submit", class: "btn primary", text: "Post comment" });
    const form = h("form", { class: "decline" },
      h("label", { for: id, text: "Your comment" }),
      h("p", { class: "muted small", text: "Shown publicly with your name, on GitHub and in the book's history. Readers can read it but not reply." }),
      field, h("div", { class: "actions" }, post, h("button", { type: "button", class: "btn link", text: "Cancel", onclick: () => { clear(out); add.disabled = false; } })));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (field.value.trim().length < 2) return field.focus();
      post.disabled = field.disabled = true;
      try {
        await act(slug, "comment-add", { number: d.number, text: field.value.trim() });
        await redraw("Your comment was added.");
      } catch (err) {
        post.disabled = field.disabled = false;
        form.append(errorNote(err));
      }
    });
    add.disabled = true;
    clear(out, form);
    field.focus();
  });
  return h("li", { class: "declined" },
    h("div", { class: "row" },
      h("strong", { class: "grow", text: d.summary || DECLINED_KINDS[d.kind] }),
      h("span", { class: "badge status-declined", text: `Declined · ${DECLINED_KINDS[d.kind] ?? "Suggestion"}` })),
    h("p", { class: "muted small", text: `${page ? `${page} · ` : ""}Proposed by ${d.who?.name ?? "a reader"}, ${when(d.proposed)}. Declined${d.decliner ? ` by ${d.decliner}` : ""}, ${when(d.date)}.` }),
    h("blockquote", { class: `said${d.reason ? "" : " muted"}`, text: d.reason ?? "No reason was recorded." }),
    comments.length ? h("ul", { class: "list comments" }, comments) : null,
    h("div", { class: "row wrap" }, show, add, h("a", { class: "btn link", href: d.url, target: "_blank", rel: "noopener", text: `#${d.number} on GitHub` })),
    view, out);
}

/** The Declined section: fresh from author-read, so a comment shows at once. */
async function declinedSection(slug, path, titles) {
  const stage = h("section", { "aria-labelledby": "declined-h" });
  const draw = async (said = null) => {
    let items;
    try {
      items = (await read("declined", { book: slug })).items ?? [];
    } catch (err) {
      return clear(stage, h("h2", { id: "declined-h", text: "Declined" }), errorNote(err));
    }
    if (path) items = items.filter((d) => d.files?.includes(path));
    if (!items.length) return clear(stage);
    clear(stage,
      h("h2", { id: "declined-h", text: `Declined (${items.length})` }),
      said ? note([h("p", { text: said })]) : null,
      h("ul", { class: "list history declined-list" }, items.map((d) => declinedLine(slug, d, titles, draw))));
  };
  await draw();
  return stage;
}

/** #/<book>/history and #/<book>/history/<path>: the commits, 30 at a time. */
export async function historyScreen(slug, path = "") {
  const book = await bookBySlug(slug);
  const [first, titles, open] = await Promise.all([history(slug, { path: path || undefined }), titlesOf(book), proposed(slug, path)]);
  const declined = await declinedSection(slug, path, titles);
  const list = h("ul", { class: "list history" });
  const more = h("div", { class: "actions" });
  let page = 1;
  const show = ({ commits, next }) => {
    list.append(...commits.map((c) => h("li", {},
      h("div", { class: "row" },
        h("a", { class: "grow", href: `#/${slug}/revision/${c.sha}${path ? `/${enc(path)}` : ""}` },
          h("strong", { text: said(c.message, titles) }), ` — ${c.who}, ${when(c.when)}`),
        marker(c)))));
    if (!next) return void clear(more);
    const older = h("button", { type: "button", class: "btn", text: "Show older changes" });
    older.addEventListener("click", async () => {
      older.disabled = true;
      try {
        show(await history(slug, { path: path || undefined, page: ++page }));
      } catch (err) {
        page--;
        older.disabled = false;
        more.append(errorNote(err));
      }
    });
    clear(more, older);
  };
  show(first);
  return [
    ...bookHeader(book, "history", path ? `History of “${titles.get(path)}”` : "History"),
    h("p", { class: "muted small" },
      "Every change, newest first, in the states readers see in Page history. ",
      h("strong", { text: "Proposed" }), ": a reader's proposal or note, waiting for you. ",
      h("strong", { text: "Being edited" }), ": in the drafts; it goes to readers when you next publish. ",
      h("strong", { text: "Published" }), ": readers have it. ",
      h("strong", { text: "Declined" }), ": you or someone on the book decided against it, and said why."),
    open.length ? h("ul", { class: "list history proposed" }, open.map((it) => proposedLine(slug, it))) : null,
    first.commits.length ? list : h("p", { class: "muted", text: "No changes yet." }),
    more,
    declined,
    path ? h("p", {}, h("a", { href: `#/${slug}/edit/${enc(path)}`, text: `Back to “${titles.get(path)}”` }), " · ", h("a", { href: `#/${slug}/history`, text: "The whole book's history" })) : null,
  ];
}

/** #/<book>/revision/<sha>: one change, every page it touched. */
export async function revisionScreen(slug, sha, path = "") {
  if (path) return pageRevision(slug, sha, path);
  const book = await bookBySlug(slug);
  const [r, titles] = await Promise.all([history(slug, { sha }), titlesOf(book)]);
  const files = r.files.filter((f) => !f.path.startsWith("assets/") || /\.md$/i.test(f.path));
  const pictures = r.files.length - files.length;
  return [
    ...bookHeader(book, "history", said(r.message, titles)),
    h("p", { class: "muted small" }, `${r.who}, ${when(r.when)} · `, marker(r)),
    files.length
      ? files.map((f) => h("section", {},
        h("h2", {}, h("a", { href: `#/${slug}/revision/${sha}/${enc(f.path)}`, text: titles.get(f.path) }), h("span", { class: "muted small", text: ` ${{ added: "new", removed: "removed" }[f.status] ?? "changed"}, +${f.added} −${f.removed}` })),
        renderPatch(f.patch, titles.get(f.path))))
      : h("p", { class: "muted", text: "This change touched none of the book's pages (only the book's own machinery)." }),
    pictures ? h("p", { class: "muted", text: `And ${pictures === 1 ? "a picture" : `${pictures} pictures`}.` }) : null,
    h("p", {}, h("a", { href: `#/${slug}/history`, text: "Back to the history" })),
  ];
}

/** #/<book>/revision/<sha>/<path>: one page at one change: Changes, the page then, Restore or Bring it back. */
async function pageRevision(slug, sha, path) {
  const book = await bookBySlug(slug);
  const [r, titles] = await Promise.all([history(slug, { sha, path }), titlesOf(book)]);
  const { text, before } = r.page;
  const name = titles.get(path, text ?? before);
  const then = h("div", {}, busy("Formatting the page…"));
  const shown = typeof text === "string" ? text : before;
  if (typeof shown === "string") renderChapter(shown, path, async (p) => rawUrl(book.repo, sha, p)).then((node) => then.replaceChildren(node));
  else then.replaceChildren(h("p", { class: "muted", text: "This page isn't text, so it can't be shown." }));
  const out = h("div", { "aria-live": "polite" });

  // This change removed the page: it can be brought back, with its line in the reading order.
  const removedHere = typeof text !== "string" && typeof before === "string";
  let action;
  if (removedHere) {
    action = h("button", { type: "button", class: "btn primary", text: `Bring “${name}” back` });
    action.addEventListener("click", async () => {
      action.disabled = true;
      clear(out, busy("Bringing it back into the drafts…"));
      try {
        const tree = await read("tree", { book: slug });
        if (tree.files.some((f) => f.path === path)) throw Object.assign(new Error("there"), { userMessage: `The drafts already have a page in “${name}”'s place, so nothing was changed.` });
        const index = tree.files.some((f) => f.path === "index.md") ? await read("file", { book: slug, path: "index.md", ref: tree.head }) : null;
        const contents = path.startsWith("chapters/") && typeof index?.text === "string" ? contentsLineFor(index.text, path, name) : null;
        await send({ book: slug, base: tree.head, files: [{ path, text: before }, ...(contents ? [{ path: "index.md", text: contents }] : [])], message: `Bring back “${name}”` });
        forgetCount(slug);
        clear(out, note([h("p", {}, `“${name}” is back in the drafts${contents ? ", at the end of the reading order" : ""}. Readers see it when you publish. `, h("a", { href: `#/${slug}`, text: "Back to the chapters" }))]));
      } catch (err) {
        action.disabled = false;
        clear(out, errorNote(err));
      }
    });
  } else {
    action = h("button", { type: "button", class: "btn primary", text: "Restore this version" });
    action.disabled = typeof text !== "string";
    action.addEventListener("click", () => {
      // The editor picks this up as its starting text, and saves it to the drafts as they are now.
      try {
        sessionStorage.setItem(`tb-edit:${slug}:${path}`, JSON.stringify({ restored: { sha, when: r.when }, text: text.replace(/\r\n/g, "\n") }));
      } catch {
        return void action.after(errorNote({ userMessage: "This browser won't keep the text for the editor. Copy it from The page as it was instead." }));
      }
      location.hash = `#/${slug}/edit/${enc(path)}`;
    });
  }

  return [
    ...bookHeader(book, "history", `“${name}”, ${when(r.when)}`),
    h("p", { class: "muted small" }, `“${said(r.message, titles)}” by ${r.who} · `, marker(r)),
    h("div", { class: "row spaced" },
      action,
      h("a", { class: "btn", href: `#/${slug}/history/${enc(path)}`, text: "History of this page" }),
      h("a", { class: "btn link", href: `#/${slug}/revision/${sha}`, text: "The whole change" })),
    out,
    note([h("p", { text: removedHere
      ? "This change took the page out. Bring it back puts it into the drafts as it was just before, as a new change of your own."
      : "Restore opens this text in the editor and saves it to the drafts as a new change of your own. Nothing is undone or rewritten: the history keeps everything." })]),
    h("h2", { text: "What this change did to the page" }),
    typeof text === "string" || typeof before === "string"
      ? renderDiff(before ?? "", text ?? "", name)
      : h("p", { class: "muted", text: "This page isn't text, so there is nothing to compare." }),
    h("details", {}, h("summary", { text: removedHere ? "The page just before it was removed" : "The page as it was" }), then),
  ];
}

// The drafts area's history, in this site rather than on GitHub: every change to the
// book (or to one page), who made it and when, and whether readers have it yet. One
// change opens as the editor's Changes view (diff.js) and the page as it was, and
// "Restore this version" puts that text into the editor as a new change, sent through
// author-send on the drafts as they are now (never a revert of history).
//
// Read through author-history, as the App, so authors don't share GitHub's
// 60-an-hour unauthenticated limit.

import { h, clear, busy, note, errorNote, when } from "./dom.js";
import { history } from "./api.js";
import { bookBySlug, bookHeader, rawUrl } from "./books.js";
import { renderChapter } from "./preview.js";
import { renderDiff, renderPatch } from "./diff.js";

const pageName = (path) => path.split("/").pop().replace(/\.md$/i, "");
const enc = encodeURIComponent;
const marker = (c) => c.live
  ? h("span", { class: "badge", text: "Live" })
  : h("span", { class: "badge accepted", text: "Waiting in drafts" });

/** #/<book>/history and #/<book>/history/<path>: the commits, 30 at a time. */
export async function historyScreen(slug, path = "") {
  const book = await bookBySlug(slug);
  const first = await history(slug, { path: path || undefined });
  const list = h("ul", { class: "list history" });
  const more = h("div", { class: "actions" });
  let page = 1;
  const show = ({ commits, next }) => {
    list.append(...commits.map((c) => h("li", {},
      h("div", { class: "row" },
        h("a", { class: "grow", href: `#/${slug}/revision/${c.sha}${path ? `/${enc(path)}` : ""}` },
          h("strong", { text: c.message || "A change" }), ` — ${c.who}, ${when(c.when)}`),
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
    ...bookHeader(book, "chapters", path ? `History of ${pageName(path)}` : "History"),
    h("p", { class: "muted small" }, path ? [h("code", { text: path }), " · "] : null,
      "Every change in the drafts area, newest first. ",
      h("strong", { text: "Live" }), " means readers have it; ", h("strong", { text: "Waiting in drafts" }), " means it goes to readers when the drafts are next published."),
    first.commits.length ? list : h("p", { class: "muted", text: "No changes yet." }),
    more,
    path ? h("p", {}, h("a", { href: `#/${slug}/chapter/${enc(path)}`, text: `Back to ${pageName(path)}` }), " · ", h("a", { href: `#/${slug}/history`, text: "The whole book's history" })) : null,
  ];
}

/** #/<book>/revision/<sha>: one change, every page it touched. */
export async function revisionScreen(slug, sha, path = "") {
  if (path) return pageRevision(slug, sha, path);
  const book = await bookBySlug(slug);
  const r = await history(slug, { sha });
  return [
    ...bookHeader(book, "chapters", r.message || "A change"),
    h("p", { class: "muted small" }, `${r.who}, ${when(r.when)} · `, marker(r)),
    r.files.length
      ? r.files.map((f) => h("section", {},
        h("h2", {}, h("a", { href: `#/${slug}/revision/${sha}/${enc(f.path)}`, text: pageName(f.path) }), h("span", { class: "muted small", text: ` ${f.status}, +${f.added} −${f.removed}` })),
        renderPatch(f.patch, f.path)))
      : h("p", { class: "muted", text: "This change touched none of the book's pages (only the book's own machinery)." }),
    h("p", {}, h("a", { href: `#/${slug}/history`, text: "Back to the history" })),
  ];
}

/** #/<book>/revision/<sha>/<path>: one page at one change: Changes, the page then, Restore. */
async function pageRevision(slug, sha, path) {
  const book = await bookBySlug(slug);
  const r = await history(slug, { sha, path });
  const { text, before } = r.page;
  const name = pageName(path);
  const then = h("div", {}, busy("Formatting the page…"));
  if (typeof text === "string") renderChapter(text, path, async (p) => rawUrl(book.repo, sha, p)).then((node) => then.replaceChildren(node));
  else then.replaceChildren(h("p", { class: "muted", text: "The page didn't exist after this change (it was removed or renamed)." }));

  const restore = h("button", { type: "button", class: "btn primary", text: "Restore this version" });
  restore.disabled = typeof text !== "string";
  restore.addEventListener("click", () => {
    // The editor picks this up as its starting text, on the drafts as they are now.
    try {
      sessionStorage.setItem(`tb-edit:${slug}:${path}`, JSON.stringify({ restored: { sha, when: r.when }, text: text.replace(/\r\n/g, "\n") }));
    } catch {
      return void restore.after(errorNote({ userMessage: "This browser won't keep the text for the editor. Copy it from The page as it was instead." }));
    }
    location.hash = `#/${slug}/edit/${enc(path)}`;
  });

  return [
    ...bookHeader(book, "chapters", `${name}, ${when(r.when)}`),
    h("p", { class: "muted small" }, h("code", { text: path }), ` · “${r.message || "a change"}” by ${r.who} · `, marker(r)),
    h("div", { class: "row spaced" },
      restore,
      h("a", { class: "btn", href: `#/${slug}/history/${enc(path)}`, text: `History of ${name}` }),
      h("a", { class: "btn link", href: `#/${slug}/revision/${sha}`, text: "The whole change" })),
    note([h("p", { text: "Restore opens this text in the editor as a new change of your own. Nothing is undone or rewritten: the history keeps everything, and you can look before you send." })]),
    h("h2", { text: "What this change did to the page" }),
    typeof text === "string" || typeof before === "string"
      ? renderDiff(before ?? "", text ?? "", before === null ? `${path} (new)` : path)
      : h("p", { class: "muted", text: "This page isn't text, so there is nothing to compare." }),
    h("details", {}, h("summary", { text: "The page as it was" }), then),
  ];
}

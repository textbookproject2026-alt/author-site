// What the drafts hold that readers don't have yet, in the author's terms: one line
// per chapter (new, edited, removed), plus the chapter order, the front page and the
// pictures. The function says which files differ (author-read?what=drafts: readers'
// files only, never the book's machinery); both versions of each are public, so they
// are read here from GitHub's raw files, at the two commits.
//
// Each line can be undone on drafts (Discard): put back as readers have it, as one
// change through author-send, like every other.

import { read } from "./api.js";
import { rawUrl } from "./books.js";
import { itemLine, orderLike, outsideContents, parseContents, titleOf, withContentsOf, withItem, withLabel, withoutPath } from "./contents.js";
import { plural } from "./dom.js";

const INDEX = "index.md";

/** A file of the book at a commit, as text; null if it isn't there. */
export async function rawText(repo, ref, path) {
  const res = await fetch(rawUrl(repo, ref, path));
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error(`raw ${res.status}`), { userMessage: "GitHub didn't answer just now. Please try again in a moment." });
  return res.text();
}

const contentsOf = (text) => {
  const p = text ? parseContents(text) : null;
  return p && !p.problem ? p : null;
};

/** "Chapter 3" from chapters/chapter-03.md, for a page with no title of its own. */
const nameOf = (path) => {
  if (path === "glossary.md") return "Glossary";
  if (path === INDEX) return "Front page";
  const base = path.split("/").pop().replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : "A page";
};

/** Every page's title, by path: the Contents' labels, live's then drafts' (the newer wins). */
export function titlesFrom(...indexes) {
  const map = new Map();
  for (const text of indexes) for (const it of contentsOf(text)?.items ?? []) if (it.path && it.label) map.set(it.path, it.label);
  return { get: (path, text) => map.get(path) ?? titleOf(text) ?? nameOf(path) };
}

/** Paragraphs (blocks between blank lines) that differ between two texts. */
export function changedParagraphs(a, b) {
  const paras = (t) => (t ?? "").replace(/\r\n/g, "\n").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const A = paras(a);
  const B = paras(b);
  // Longest common subsequence, by rows: a chapter is a few hundred paragraphs at most.
  let prev = new Array(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    const row = [0];
    for (let j = 1; j <= B.length; j++) row[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    prev = row;
  }
  const same = prev[B.length];
  return Math.max(A.length - same, B.length - same);
}

/** The line the author reads for one item. */
export function itemWords(it) {
  // A chapter is a page directly in chapters/; the glossary, the front page and concept pages are pages.
  if (it.kind === "new") return `${/^chapters\/[^/]+$/.test(it.path ?? "") ? "New chapter" : "New page"} “${it.title}”`;
  if (it.kind === "removed") return `Removed “${it.title}”`;
  if (it.kind === "order") return "Chapter order changed";
  if (it.kind === "front") return "Edited the front page";
  if (it.kind === "pictures") return `${plural(it.files.length, "picture")} added or changed`;
  return `Edited “${it.title}”${it.paragraphs ? ` (${plural(it.paragraphs, "paragraph")})` : ""}`;
}

/**
 * The drafts' differences from live, as items. With `texts`, each page's two
 * versions are read too (titles from the page itself, paragraph counts, Discard);
 * without, only the front page's two versions (for the count in the tab).
 * -> { live, drafts, items: [{ kind, path?, title, who, when, paragraphs?, files? }], more, titles, liveIndex, draftsIndex, texts }
 */
export async function draftItems(book, { texts = true } = {}) {
  const d = await read("drafts", { book: book.slug });
  const [liveIndex, draftsIndex] = await Promise.all([rawText(book.repo, d.live, INDEX), rawText(book.repo, d.drafts, INDEX)]);
  const titles = titlesFrom(liveIndex, draftsIndex);
  const pages = d.files.filter((f) => f.path !== INDEX && !f.path.startsWith("assets/"));
  const pictures = d.files.filter((f) => f.path.startsWith("assets/"));
  const index = d.files.find((f) => f.path === INDEX);
  const both = new Map();
  if (texts) {
    await Promise.all(pages.map(async (f) => {
      const [live, drafts] = await Promise.all([
        f.status === "added" ? null : rawText(book.repo, d.live, f.previous ?? f.path),
        f.status === "removed" ? null : rawText(book.repo, d.drafts, f.path),
      ]);
      both.set(f.path, { live, drafts });
    }));
  }
  const items = pages.map((f) => {
    const t = both.get(f.path) ?? {};
    const kind = f.status === "added" ? "new" : f.status === "removed" ? "removed" : "edited";
    return {
      kind, path: f.path, previous: f.previous, who: f.who, when: f.when,
      title: titles.get(f.path, t.drafts ?? t.live),
      paragraphs: kind === "edited" && texts ? changedParagraphs(t.live, t.drafts) : null,
    };
  });
  if (index) {
    const lc = contentsOf(liveIndex);
    const dc = contentsOf(draftsIndex);
    if (lc && dc) {
      const inBoth = (a, b) => a.items.map((i) => i.path).filter((p) => p && b.items.some((j) => j.path === p));
      if (inBoth(lc, dc).join("\n") !== inBoth(dc, lc).join("\n")) items.push({ kind: "order", path: INDEX, title: "Chapter order", who: index.who, when: index.when });
    }
    if (outsideContents(liveIndex ?? "") !== outsideContents(draftsIndex ?? "")) items.push({ kind: "front", path: INDEX, title: "Front page", who: index.who, when: index.when });
  }
  if (pictures.length) {
    const newest = [...pictures].sort((a, b) => String(b.when).localeCompare(String(a.when)))[0];
    items.push({ kind: "pictures", title: "Pictures", files: pictures, who: newest.who, when: newest.when });
  }
  return { live: d.live, drafts: d.drafts, items, more: d.more ?? 0, titles, liveIndex, draftsIndex, texts: both };
}

// The tab's count: a light read (no page texts), kept briefly so every screen can show it.
const counts = new Map();
export function draftCount(book) {
  const kept = counts.get(book.slug);
  if (kept && Date.now() - kept.at < 15_000) return kept.promise;
  const promise = draftItems(book, { texts: false }).then((r) => r.items.length + r.more).catch(() => null);
  counts.set(book.slug, { at: Date.now(), promise });
  return promise;
}
export const forgetCount = (slug) => counts.delete(slug);

/**
 * What putting one item back as readers have it sends: { files, deletes, message },
 * or null when it can't be undone from here (pictures that were changed, not added).
 */
export function discardOf(it, state) {
  const t = state.texts.get(it.path) ?? {};
  const lc = contentsOf(state.liveIndex);
  const dc = contentsOf(state.draftsIndex);
  const files = [];
  const deletes = [];
  let index = null;
  if (it.kind === "new") {
    deletes.push(it.path);
    if (dc?.items.some((i) => i.path === it.path)) index = withoutPath(dc, it.path);
  } else if (it.kind === "edited") {
    if (it.previous) {
      deletes.push(it.path);
      files.push({ path: it.previous, text: t.live });
    } else files.push({ path: it.path, text: t.live });
    const k = dc?.items.findIndex((i) => i.path === it.path) ?? -1;
    const was = lc?.items.find((i) => i.path === (it.previous ?? it.path));
    if (k >= 0 && was?.label && dc.items[k].label !== was.label) index = withLabel(dc, k, was.label);
  } else if (it.kind === "removed") {
    files.push({ path: it.path, text: t.live });
    const at = lc?.items.findIndex((i) => i.path === it.path) ?? -1;
    if (dc && at >= 0 && !dc.items.some((i) => i.path === it.path)) {
      // Back after the chapter it followed for readers, if the drafts still have that one.
      const before = lc.items.slice(0, at).reverse().find((i) => dc.items.some((j) => j.path === i.path));
      const pos = before ? dc.items.findIndex((j) => j.path === before.path) + 1 : 0;
      index = withItem(dc, lc.items[at].lines, pos);
    }
  } else if (it.kind === "order") {
    index = orderLike(dc, lc.items.map((i) => i.path));
  } else if (it.kind === "front") {
    if (state.liveIndex === null) deletes.push(INDEX);
    else index = withContentsOf(state.liveIndex, state.draftsIndex ?? state.liveIndex);
  } else if (it.kind === "pictures") {
    if (it.files.some((f) => f.status !== "added")) return null;
    deletes.push(...it.files.map((f) => f.path));
  }
  if (files.some((f) => typeof f.text !== "string")) return null;
  if (index !== null) files.push({ path: INDEX, text: index });
  return { files, deletes, message: `Discard: ${itemWords(it)}` };
}

/** The Contents line to put back for a page brought back from History. */
export const contentsLineFor = (indexText, path, title) => {
  const p = contentsOf(indexText);
  return p && !p.items.some((i) => i.path === path) ? withItem(p, [itemLine(p, path, title)], p.items.length) : null;
};

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
import { BOOK_TYPES, ownType, typeOf, withType, withoutType } from "./booktype.js";
import { registryBook } from "./public.js";

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
  if (it.kind === "type") return `Type changed to “${BOOK_TYPES[it.type]}”`;
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
  const [liveIndex, draftsIndex, reg] = await Promise.all([rawText(book.repo, d.live, INDEX), rawText(book.repo, d.drafts, INDEX), registryBook(book.slug)]);
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
      kind, path: f.path, previous: f.previous, who: f.who, login: f.login, when: f.when,
      title: titles.get(f.path, t.drafts ?? t.live),
      paragraphs: kind === "edited" && texts ? changedParagraphs(t.live, t.drafts) : null,
    };
  });
  if (index) {
    const lc = contentsOf(liveIndex);
    const dc = contentsOf(draftsIndex);
    if (lc && dc) {
      const inBoth = (a, b) => a.items.map((i) => i.path).filter((p) => p && b.items.some((j) => j.path === p));
      if (inBoth(lc, dc).join("\n") !== inBoth(dc, lc).join("\n")) items.push({ kind: "order", path: INDEX, title: "Chapter order", who: index.who, login: index.login, when: index.when });
    }
    // The type (Settings) is its own line; the rest of the front page is "Edited the front page".
    const [was, now] = [typeOf(liveIndex, reg?.type), typeOf(draftsIndex, reg?.type)];
    if (was !== now) items.push({ kind: "type", type: now, title: "Type", who: index.who, login: index.login, when: index.when });
    if (outsideContents(withoutType(liveIndex ?? "")) !== outsideContents(withoutType(draftsIndex ?? ""))) items.push({ kind: "front", path: INDEX, title: "Front page", who: index.who, login: index.login, when: index.when });
  }
  if (pictures.length) {
    const newest = [...pictures].sort((a, b) => String(b.when).localeCompare(String(a.when)))[0];
    items.push({ kind: "pictures", title: "Pictures", files: pictures, who: newest.who, login: newest.login, when: newest.when });
  }
  return { live: d.live, drafts: d.drafts, items, more: d.more ?? 0, titles, liveIndex, draftsIndex, texts: both };
}

// --- Drafts by chapter -------------------------------------------------------------------------
//
// The Drafts tab is one row per chapter needing anything, in Contents order, and a last row,
// "Rest of the book", for everything that isn't a chapter. A row needs something when
// readers have something waiting on it (a suggestion: a proposed edit, or a written
// suggestion with a text change; a note: anything else written) or the drafts have it
// differently from the live book. Accepted written suggestions are done (History has them).

/** A chapter: a page directly in chapters/ (the glossary, the front page and concept pages are the rest of the book). */
export const isChapter = (path) => /^chapters\/[^/]+\.md$/i.test(path ?? "");
/** A reader's written item with a text change counts as a suggestion; without one, as a note. */
export const isNote = (s) => !s.original;
export const REST = "rest";

/** The words for what the drafts hold on a row, not yet live: "1 paragraph edited, not live". */
function draftsWords(items) {
  if (!items.length) return null;
  const one = items.length === 1 ? items[0] : null;
  if (one && isChapter(one.path)) {
    if (one.kind === "new") return "new, not live";
    if (one.kind === "removed") return "removed, not live";
    return `${one.paragraphs ? `${plural(one.paragraphs, "paragraph")} edited` : "edited"}, not live`;
  }
  const words = items.map((it) => ({
    new: `“${it.title}” new`, removed: `“${it.title}” removed`, edited: `“${it.title}” edited`, order: "chapter order changed",
    front: "front page edited", type: "settings changed", pictures: plural(it.files?.length ?? 0, "picture"),
  })[it.kind]);
  return `${words.join(", ")}, not live`;
}

/**
 * The rows. `state`: draftItems(); `changes`, `written`: the open proposals and written
 * suggestions (accepted ones are left out here); `lint`: the book's formatting problems at
 * the drafts' head ([{ path, line, … }]) or null.
 * -> { rows: [{ key, path?, title, suggestions, notes, reader: [item], drafts: [item], lint: [problem], status,
 *      needs, canReview, canPublish, why: { review, publish }, next }] }: every chapter in the Contents, then
 *    the Rest of the book; next: "review" | "fix" | "publish" | null (up to date)
 */
export function rowsOf(state, changes, written, lint = null) {
  const contents = [...(contentsOf(state.draftsIndex)?.items ?? []), ...(contentsOf(state.liveIndex)?.items ?? [])]
    .map((i) => i.path).filter((p) => isChapter(p));
  const order = [...new Set(contents)];
  const rows = new Map();
  const row = (key, path) => {
    if (!rows.has(key)) rows.set(key, { key, path, suggestions: 0, notes: 0, reader: [], drafts: [], lint: [] });
    return rows.get(key);
  };
  const keyOf = (path) => (isChapter(path) ? path : REST);
  for (const c of changes) {
    const r = row(keyOf(c.path), isChapter(c.path) ? c.path : null);
    r.suggestions++;
    r.reader.push({ kind: "proposal", ...c });
  }
  for (const w of written.filter((x) => !x.accepted)) {
    const r = row(keyOf(w.path), isChapter(w.path) ? w.path : null);
    if (isNote(w)) r.notes++;
    else r.suggestions++;
    r.reader.push({ kind: isNote(w) ? "note" : "suggestion", ...w });
  }
  // Pictures go with the chapter whose folder they're in (assets/<chapter>/…) when that
  // chapter is in the drafts too; the rest go with the rest of the book.
  const changed = new Set(state.items.filter((it) => isChapter(it.path)).map((it) => it.path.split("/").pop().replace(/\.md$/i, "")));
  for (const it of state.items) {
    if (it.kind === "pictures") {
      const mine = (f) => changed.has(f.path.split("/")[1]);
      for (const stem of changed) {
        const files = it.files.filter((f) => f.path.split("/")[1] === stem);
        if (files.length) row(`chapters/${stem}.md`, `chapters/${stem}.md`).pictures = files;
      }
      const rest = it.files.filter((f) => !mine(f));
      if (rest.length) row(REST, null).drafts.push({ ...it, files: rest });
      continue;
    }
    row(keyOf(it.path), isChapter(it.path) ? it.path : null).drafts.push(it);
  }
  for (const x of lint ?? []) {
    if (x.path && (isChapter(x.path) || x.path === "index.md" || x.path === "glossary.md" || x.path.startsWith("chapters/"))) {
      const r = rows.get(keyOf(x.path));
      if (r) r.lint.push(x);
    }
  }
  const pos = (p) => {
    const k = order.indexOf(p);
    return k < 0 ? order.length : k;
  };
  // Every chapter in the Contents has a row (and the Rest of the book), up to date or not.
  for (const p of order) row(p, p);
  row(REST, null);
  const list = [...rows.values()]
    .sort((a, b) => (a.key === REST) - (b.key === REST) || pos(a.path) - pos(b.path) || String(a.path).localeCompare(String(b.path), undefined, { numeric: true }));
  for (const r of list) {
    r.title = r.key === REST ? "Rest of the book" : state.titles.get(r.path, null);
    const said = [r.suggestions ? plural(r.suggestions, "suggestion") : null, r.notes ? plural(r.notes, "note") : null].filter(Boolean).join(", ");
    const pending = draftsWords(r.drafts);
    r.needs = Boolean(r.reader.length || r.drafts.length);
    // Each button, and why it can't be pressed when it can't (said on it and in the status line).
    r.canReview = r.reader.length > 0;
    r.canPublish = r.drafts.length > 0 && !r.lint.length;
    r.why = {
      review: r.canReview ? null : "Nothing waiting from readers",
      publish: r.canPublish ? null : r.drafts.length ? `${plural(r.lint.length, "problem")} to fix first` : "Nothing to publish",
    };
    r.status = r.needs ? [said || "Nothing waiting from readers", pending || "nothing to publish"].join(" · ") : "Up to date";
    r.next = r.reader.length ? "review" : !r.drafts.length ? null : r.lint.length ? "fix" : "publish";
  }
  return { rows: list };
}

/** Readers' open items, as Drafts counts them: { changes, written } (a list that can't be read throws). */
export async function readerItems(slug) {
  const [c, w] = await Promise.all([read("changes", { book: slug }), read("suggestions", { book: slug })]);
  return { changes: c.changes ?? [], written: w.suggestions ?? [] };
}

// The tab's count, the rows needing anything: a light read (no page texts), kept briefly so every screen can show it.
const counts = new Map();
export function draftCount(book) {
  const kept = counts.get(book.slug);
  if (kept && Date.now() - kept.at < 15_000) return kept.promise;
  const promise = Promise.all([draftItems(book, { texts: false }), readerItems(book.slug)])
    .then(([state, r]) => rowsOf(state, r.changes, r.written).rows.filter((x) => x.needs).length).catch(() => null);
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
    else {
      // The type is its own line: discarding the front page keeps the drafts' type.
      const front = withContentsOf(state.liveIndex, state.draftsIndex ?? state.liveIndex);
      const type = ownType(state.draftsIndex);
      index = type ? withType(front, type) : withoutType(front);
    }
  } else if (it.kind === "type") {
    const was = ownType(state.liveIndex);
    index = was ? withType(state.draftsIndex, was) : withoutType(state.draftsIndex);
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

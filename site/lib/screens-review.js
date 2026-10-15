// Review all in chapter (#/<book>/review/<path>): the chapter's drafts text as one
// continuous body, rendered as readers see it, with every pending reader edit inline in
// its sentence, as track changes: removed words struck, added words underlined, and a
// small tick box just before each edit. The function merges each proposal in (its
// lib/review.mjs: three-way, word by word); nothing is ticked to begin with.
//
//   popover      hover or tap an edit (or its box): who, the proposal's title (a link
//                to its own page, with Back to here), its summary, "part 2 of 3", View
//                on GitHub; Compare for a stale one; the alternatives
//   stale        made on an older version: inline too, dotted and marked "older
//                version"; ticked, the suggestion's words replace the drafts' (Compare
//                shows old / suggested / now). Tick all leaves these alone.
//   overlaps     edits that overlap (transitively) are one group: the first is shown,
//                the rest are "N alternatives" beside it; the popover switches which is
//                shown, and only the one shown can be ticked
//   notes        a marker at the end of their paragraph, the text in the margin (a
//                popover below 760 px); hovering either shows the other. Notes on the
//                whole chapter in a short list on top
//   the bar      Tick all, Untick all, the count and Accept N, sticky at the bottom;
//                none when there is nothing to tick
//   Accept N     one write (author-act review-accept) with the ticked ids and the drafts
//                commit the view was built from; a 409 redraws on the drafts as they
//                are now, keeping the ticks that still hold and naming the rest
//   Still to decide  what can't be ticked inline (notes, older-version edits, the
//                alternatives not shown, what can't be shown here) before Accept, and
//                everything not ticked after it: Decline (a reason, always), Keep open,
//                Open in editor
//
// The page is rendered in one call to GitHub's markdown renderer: each edit is a token
// in the text, swapped for its marks afterwards. The function compares a page line by
// line, so a paragraph wrapped over several lines arrives as several; the text keeps the
// page's own line breaks, so they join again as the book site joins them. An overlap
// group's paragraphs are rendered once per alternative between marker paragraphs and kept
// aside, to swap in. File names are never shown: a proposal's title has its page's name
// in it ("Edit ¶3 of chapter-01.md"), said here with the chapter's title.

import { h, clear, busy, note, errorNote, plural } from "./dom.js";
import { read, act } from "./api.js";
import { bookBySlug, bookHeader, rawUrl } from "./books.js";
import { rawText, titlesFrom, forgetCount } from "./drafts.js";
import { bookPath, forPreview, sanitise } from "./preview.js";
import { words, threeWay, openedKey } from "./suggestions.js";
import { declineButton } from "./decline.js";
import { diff, tokens } from "./diff.js";

/** lib/review.mjs clash: ranges sharing a paragraph, or an insertion at the other's edge. */
export const clash = (a, b) => (a.at < b.end && b.at < a.end) || ((a.at === a.end || b.at === b.end) && a.at <= b.end && b.at <= a.end);
// `lost`: a suggestion whose words are nowhere in the drafts now (Still to decide only).
const tickable = (x) => !x.already && !x.lost;

/** The view, with each deferred proposal read on its own and the overlaps worked out across all of it. */
export async function loadView(slug, path, tries = 2) {
  const v = await read("review", { book: slug, path });
  const parts = await Promise.all(v.items.filter((i) => i.deferred).map((i) => read("review", { book: slug, path, number: String(i.number) })));
  // The drafts moved between the reads: once more, from the start.
  if (parts.some((p) => p.drafts !== v.drafts) && tries > 1) return loadView(slug, path, tries - 1);
  for (const p of parts) {
    for (const it of p.items) Object.assign(v.items.find((i) => i.key === it.key) ?? {}, it, { deferred: false });
    v.hunks.push(...p.hunks);
  }
  return withOverlaps(v);
}

export function withOverlaps(v) {
  const live = v.hunks.filter(tickable);
  for (const a of live) a.overlaps = live.filter((b) => b !== a && clash(a, b)).map((b) => b.id);
  return v;
}

const lineOf = (v, at) => 1 + v.paragraphs.slice(0, Math.max(0, at)).join("").split("\n").length - 1;
const KIND = { edit: "Proposed edit", suggestion: "Suggestion", note: "Note" };
export const shown = (t) => forPreview(t ?? "").trim();

/**
 * `text` with any page's file name ("chapter-01.md", "chapters/chapter-01.md") said as the
 * page's title; `path` is the page the item is about, `titles` titlesFrom()'s.
 */
export const withTitles = (text, titles, path = "") => String(text ?? "").replace(/(?:[\w-]+\/)*[\w.-]+\.md\b/g, (m) => {
  const base = m.split("/").pop();
  const p = path === m || path.endsWith(`/${base}`) || path === base ? path : m.includes("/") ? m : `chapters/${m}`;
  return titles ? titles.get(p) : m;
});
// The page being reviewed, for the names in what it shows.
let titlesNow = null;
let pathNow = "";
const named = (t) => withTitles(t, titlesNow, pathNow);
const itemName = (it) => (it.kind === "edit" ? `“${named(it.title)}”` : KIND[it.kind]);
/** An item's own page in this site: a proposal's, or a written suggestion's or note's. */
const pageOf = (slug, it) => `#/${slug}/${it.kind === "edit" ? "proposal" : "suggestion"}/${it.number}`;

// --- Back to the chapter review, from an item's own page ----------------------------------------

const RETURN = (slug) => `tb-review-return:${slug}`;
const store = {
  get: (k) => { try { return JSON.parse(sessionStorage.getItem(k) ?? "null"); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: no way back to the same place */ } },
};

/** "Back to the chapter review" for an item's page opened from a review, else null. */
export function reviewBackLink(slug) {
  const r = store.get(RETURN(slug));
  if (!r?.path) return null;
  return h("p", { class: "rv-back" }, h("a", { href: `#/${slug}/review/${encodeURIComponent(r.path)}`, text: "← Back to the chapter review", onclick: () => store.set(RETURN(slug), { ...r, restore: true }) }));
}

/**
 * Overlapping edits, transitively, as groups in reading order: { lo, hi, hunks } with
 * `hunks` in the order the items came (the first is shown to begin with).
 */
export function groupsOf(v) {
  const order = new Map(v.items.map((it, k) => [it.key, k]));
  const live = v.hunks.filter(tickable).sort((a, b) => order.get(a.item) - order.get(b.item) || a.at - b.at);
  const groupOf = new Map();
  const groups = [];
  for (const x of live) {
    const mine = [...new Set(x.overlaps.map((o) => groupOf.get(o)).filter(Boolean))];
    const g = mine[0] ?? { hunks: [] };
    if (!mine.length) groups.push(g);
    // Two groups this one overlaps both: one group now.
    for (const other of mine.slice(1)) {
      g.hunks.push(...other.hunks);
      for (const y of other.hunks) groupOf.set(y.id, g);
      groups.splice(groups.indexOf(other), 1);
    }
    g.hunks.push(x);
    groupOf.set(x.id, g);
  }
  for (const g of groups) {
    g.hunks.sort((a, b) => order.get(a.item) - order.get(b.item) || a.at - b.at);
    g.lo = Math.min(...g.hunks.map((x) => x.at));
    g.hi = Math.max(...g.hunks.map((x) => x.end));
  }
  return groups.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
}

// --- the text, with the edits in it -------------------------------------------------------------

const TOKEN = /C4N([EN])(\d+)Z/g;
const MARK = /^C4N([GA])([\d_]+)([SE])$/;

/**
 * Where each line's paragraph starts and ends (line indexes). A line ending in a blank
 * line ends one; lines without (a paragraph wrapped in the source, a list) run on.
 */
export function blocksOf(P) {
  const start = [];
  const end = [];
  let s = 0;
  P.forEach((p, i) => {
    start[i] = s;
    if (/\n\n$/.test(p) || i === P.length - 1) {
      for (let j = s; j <= i; j++) end[j] = i;
      s = i + 1;
    }
  });
  return { start, end };
}

/**
 * One edit's words as runs: { eq } unchanged, { del, ins } changed. Changes with only one
 * unchanged word between them are one change, as track changes reads ("struck the lot,
 * then the new lot"), not a word-by-word patchwork.
 */
export function editRuns(from, to) {
  const segs = [];
  for (const op of diff(tokens(from), tokens(to))) {
    const last = segs.at(-1);
    if (op.t === "=") {
      if (last && "eq" in last) last.eq += op.v;
      else segs.push({ eq: op.v });
    } else {
      const s = last && !("eq" in last) ? last : (segs.push({ del: "", ins: "" }), segs.at(-1));
      s[op.t === "-" ? "del" : "ins"] += op.v;
    }
  }
  for (let i = 1; i < segs.length - 1; i++) {
    const s = segs[i];
    if (!("eq" in s) || "eq" in segs[i - 1] || "eq" in segs[i + 1] || s.eq.trim().split(/\s+/).length > 1) continue;
    const [a, b] = [segs[i - 1], segs[i + 1]];
    segs.splice(i - 1, 3, { del: a.del + s.eq + b.del, ins: a.ins + s.eq + b.ins });
    i -= 1;
  }
  return segs;
}

/**
 * One edit's text in Markdown: unchanged words as they are, each changed run a token
 * (`runs` gets { id, del, ins, first }), then `tail` (a note's token), then the line
 * breaks it ended with.
 */
function inline(x, runs, tail) {
  const from = x.from.trimEnd();
  const to = x.to.trimEnd();
  const trail = (x.from || x.to).slice((x.from ? from : to).length) || "\n\n";
  return editRuns(from, to).map((s) => {
    if ("eq" in s) return s.eq;
    runs.push({ id: x.id, ...s, first: !runs.some((r) => r.id === x.id) });
    return `C4NE${runs.length - 1}Z`;
  }).join("") + (tail ? ` ${tail}` : "") + trail;
}

/**
 * Lines lo..hi with `picks` (edits, not overlapping) in them, and each note's token at the
 * end of its paragraph (`noteAt`: line -> tokens). The lines keep their own breaks.
 */
function linesMd(P, lo, hi, picks, runs, noteAt) {
  const tok = (a, b) => [...noteAt].filter(([l]) => l >= a && l < b).map(([, t]) => t).join(" ");
  const line = (i) => (noteAt.has(i) ? P[i].replace(/(\n*)$/, ` ${noteAt.get(i)}$1`) : P[i]);
  const mine = picks.filter((x) => x.at >= lo && x.end <= hi && (x.at < hi || hi === P.length)).sort((a, b) => a.at - b.at || a.end - b.end);
  let out = "";
  let i = lo;
  for (const x of mine) {
    for (; i < x.at; i++) out += line(i);
    out += inline(x, runs, tok(x.at, x.end));
    i = Math.max(i, x.end);
  }
  for (; i < hi; i++) out += line(i);
  return out;
}

/**
 * The paragraphs each overlap group shows in, whole (so swapping one alternative for another
 * never cuts a paragraph): { lo, hi, groups }, merged where they meet, and widened over any
 * other edit that crosses their edge.
 */
function regionsOf(P, groups, front) {
  const { start, end } = blocksOf(P);
  const at = (i) => (i >= P.length ? P.length : start[i]);
  const to = (lo, hi) => (hi > lo ? end[hi - 1] + 1 : lo < P.length ? end[lo] + 1 : P.length);
  const regions = groups.map((g, k) => (g.hunks.length > 1 ? { lo: Math.max(front, at(g.lo)), hi: to(g.lo, g.hi), groups: [k] } : null)).filter(Boolean);
  for (let changed = true; changed;) {
    changed = false;
    regions.sort((a, b) => a.lo - b.lo);
    for (let i = 0; i + 1 < regions.length; i++) {
      if (regions[i + 1].lo < regions[i].hi) {
        // ponytail: two overlap groups in one paragraph share it; switching one resets the other to its first.
        const [a, b] = regions.splice(i, 2);
        regions.splice(i, 0, { lo: a.lo, hi: Math.max(a.hi, b.hi), groups: [...a.groups, ...b.groups] });
        changed = true;
        break;
      }
    }
    for (const r of regions) {
      for (const g of groups) {
        const crosses = g.lo < r.hi && r.lo < g.hi && (g.lo < r.lo || g.hi > r.hi);
        if (!crosses) continue;
        r.lo = Math.min(r.lo, at(g.lo));
        r.hi = Math.max(r.hi, to(g.lo, g.hi));
        changed = true;
      }
    }
  }
  return regions;
}

/** The chapter's Markdown with the edits shown in it, and each group's alternatives after it. */
function documentMarkdown(v, groups, shownIn, regions, front, runs) {
  const P = v.paragraphs;
  const { end } = blocksOf(P);
  // A note's marker at the end of the paragraph it was written on.
  const noteAt = new Map();
  v.notes.forEach((n, k) => {
    if (n.at < 0) return;
    const l = end[Math.min(n.at, P.length - 1)];
    noteAt.set(l, [noteAt.get(l), `C4NN${k}Z`].filter(Boolean).join(" "));
  });
  const picks = (alt = []) => groups.map((g, k) => alt.find(([gk]) => gk === k)?.[1] ?? g.hunks[shownIn[k]]);
  const wrap = (tag, body) => `\n\nC4N${tag}S\n\n${body.replace(/\n*$/, "")}\n\nC4N${tag}E\n\n`;
  let md = "";
  let i = front;
  regions.forEach((r, ri) => {
    md += linesMd(P, i, r.lo, picks(), runs, noteAt);
    md += wrap(`G${ri}`, linesMd(P, r.lo, r.hi, picks(), runs, noteAt));
    i = r.hi;
  });
  md += linesMd(P, i, P.length, picks(), runs, noteAt);
  regions.forEach((r, ri) => r.groups.forEach((gk) => groups[gk].hunks.forEach((x, k) => {
    // The others in a shared region at their first (see regionsOf).
    if (k !== shownIn[gk]) md += wrap(`A${ri}_${gk}_${k}`, linesMd(P, r.lo, r.hi, picks([[gk, x], ...r.groups.filter((o) => o !== gk).map((o) => [o, groups[o].hunks[0]])]), runs, noteAt));
  })));
  return md;
}

/** GitHub's renderer (as the editor's preview), or the text in paragraphs if it can't be had. */
async function render(md) {
  try {
    const res = await fetch("https://api.github.com/markdown", {
      method: "POST",
      headers: { Accept: "text/html", "Content-Type": "application/json" },
      body: JSON.stringify({ text: forPreview(md), mode: "markdown" }),
    });
    if (!res.ok) throw new Error(String(res.status));
    return { frag: sanitise(await res.text()), plain: false };
  } catch {
    const frag = document.createDocumentFragment();
    for (const p of md.split(/\n{2,}/).filter((x) => x.trim())) frag.append(h("p", { text: p }));
    return { frag, plain: true };
  }
}

/** Every text node under `root` holding a token, the token replaced by `make(kind, k)`. */
function swapTokens(root, make) {
  const found = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) if (/C4N[EN]\d+Z/.test(walk.currentNode.nodeValue)) found.push(walk.currentNode);
  for (const t of found) {
    const parts = [];
    let last = 0;
    for (const m of t.nodeValue.matchAll(TOKEN)) {
      parts.push(document.createTextNode(t.nodeValue.slice(last, m.index)), make(m[1], Number(m[2])));
      last = m.index + m[0].length;
    }
    parts.push(document.createTextNode(t.nodeValue.slice(last)));
    t.replaceWith(...parts.filter((n) => n && (n.nodeType !== 3 || n.nodeValue)));
  }
}

/**
 * Removed or added words in <del> or <ins>. Only spaces or line breaks (a paragraph split
 * in two, a line broken: ontology #82) would show as nothing, so they show as a sign.
 */
const SPACE = [[/\n[ \t]*\n/, "¶", "new paragraph"], [/\n/, "↵", "line break"], [/[\s\S]/, "␣", "space"]];
const marked = (tag, label, text) => {
  if (text.trim()) return h(tag, {}, h("span", { class: "sr-only", text: `[${label}: ` }), text, h("span", { class: "sr-only", text: "]" }));
  const [, sign, words] = SPACE.find(([re]) => re.test(text));
  return h(tag, { class: "rv-ws" }, h("span", { "aria-hidden": "true", text: sign }), h("span", { class: "sr-only", text: `[${label}: ${words}]` }));
};

// --- showing which words a note is about -----------------------------------------------------

const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, blockquote, td, dd";
const FLASH_MS = 2200;
const squash = (t) => t.replace(/\s+/g, " ").toLowerCase();

/**
 * The words `quote` in `block`, as the drafts have them (inserted words, screen-reader
 * labels and the page's own buttons aside), each text node's share of them wrapped in a
 * <mark>; the whole paragraph marked when they can't be found. Undone after FLASH_MS.
 */
export function flash(block, quote) {
  const texts = [];
  const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement.closest("ins, .sr-only, button, .rv-old-mark") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  while (walk.nextNode()) texts.push(walk.currentNode);
  // The text as one string, each character's node and offset kept (spaces squashed).
  let flat = "";
  const where = [];
  for (const t of texts) {
    for (let k = 0; k < t.nodeValue.length; k++) {
      const c = /\s/.test(t.nodeValue[k]) ? " " : t.nodeValue[k].toLowerCase();
      if (c === " " && flat.endsWith(" ")) continue;
      flat += c;
      where.push([t, k]);
    }
  }
  const q = squash(quote ?? "").trim();
  const at = q ? flat.indexOf(q) : -1;
  if (at < 0) {
    block.classList.add("rv-flash-block");
    setTimeout(() => block.classList.remove("rv-flash-block"), FLASH_MS);
    return block;
  }
  // Per text node: the first and last character of the quote in it.
  const spans = new Map();
  for (let k = at; k < at + q.length; k++) {
    const [t, o] = where[k];
    const s = spans.get(t) ?? [o, o];
    spans.set(t, [Math.min(s[0], o), Math.max(s[1], o)]);
  }
  const marks = [];
  for (const [t, [a, b]] of spans) {
    const mid = t.splitText(a);
    mid.splitText(b - a + 1);
    const m = h("mark", { class: "rv-flash" });
    mid.replaceWith(m);
    m.append(mid);
    marks.push(m);
  }
  setTimeout(() => {
    for (const m of marks) {
      const parent = m.parentNode;
      m.replaceWith(...m.childNodes);
      parent?.normalize();
    }
  }, FLASH_MS);
  return marks[0];
}

/** Brings `el` into view when it isn't. */
const intoView = (el) => {
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
};

// --- the screen --------------------------------------------------------------------------------

export async function reviewScreen(slug, path) {
  const book = await bookBySlug(slug);
  const [v, index] = await Promise.all([loadView(slug, path), rawText(book.repo, book.drafts_branch, "index.md").catch(() => null)]);
  titlesNow = titlesFrom(index);
  pathNow = path;
  const title = titlesNow.get(path);
  // Back from an item's page: the same ticks, alternatives and place.
  const back = store.get(RETURN(slug));
  const restore = back?.restore && back.path === path ? back : null;
  if (back?.restore) store.set(RETURN(slug), null);
  const stage = h("div", { class: "review" });
  await draw(stage, book, v, new Set(restore?.ticked ?? []), null, restore);
  return [...bookHeader(book, "drafts", `Review: ${title}`), stage];
}

async function draw(stage, book, v, ticked, said, restore = null) {
  const slug = book.slug;
  const byId = new Map(v.hunks.map((x) => [x.id, x]));
  const byKey = new Map(v.items.map((i) => [i.key, i]));
  for (const id of ticked) if (!byId.has(id) || !tickable(byId.get(id))) ticked.delete(id);
  const groups = groupsOf(v);
  const groupOf = new Map(groups.flatMap((g, k) => g.hunks.map((x) => [x.id, k])));
  // Which edit each group shows: the one shown before (Back), a ticked one, else the first.
  const before = new Set(restore?.shown ?? []);
  const shownIn = groups.map((g) => Math.max(0, g.hunks.findIndex((x) => before.has(x.id)), g.hunks.findIndex((x) => ticked.has(x.id))));
  const P = v.paragraphs;
  let front = 0;
  if (P[0]?.trim() === "---") front = P.findIndex((p, i) => i > 0 && p.trim() === "---") + 1;
  const regions = regionsOf(P, groups, front);
  const regionOf = new Map(regions.flatMap((r, ri) => r.groups.map((g) => [g, ri])));
  const runs = [];
  const { frag } = await render(documentMarkdown(v, groups, shownIn, regions, front, runs));
  const body = h("div", { class: "preview rv-text" });
  body.append(frag);

  // Each region's alternatives, kept aside; the one shown sits between two comments.
  const kept = new Map(); // "A<r>_<g>_<k>" -> nodes
  const anchors = new Map(); // r -> [start comment, end comment]
  for (const p of Array.from(body.querySelectorAll("p"))) {
    const m = MARK.exec(p.textContent.trim());
    if (!m || m[3] !== "S" || !p.parentNode) continue; // (the body is not in the page yet)
    const tag = `${m[1]}${m[2]}`;
    const nodes = [];
    let n = p.nextSibling;
    while (n && !(n.nodeName === "P" && n.textContent.trim() === `C4N${tag}E`)) {
      nodes.push(n);
      n = n.nextSibling;
    }
    if (m[1] === "A") {
      kept.set(tag, nodes);
      nodes.forEach((x) => x.remove());
      p.remove();
      n?.remove();
    } else {
      const a = [document.createComment(`region ${m[2]}`), document.createComment(`end ${m[2]}`)];
      p.replaceWith(a[0]);
      n?.replaceWith(a[1]);
      anchors.set(Number(m[2]), a);
    }
  }
  for (const img of Array.from(body.querySelectorAll("img"))) {
    const p = bookPath(v.path, img.getAttribute("src"));
    if (p) img.src = rawUrl(book.repo, v.drafts, p);
    else img.removeAttribute("src");
    img.loading = "lazy";
  }

  // The edits and the note markers, in the text and in the alternatives kept aside. An edit
  // inside an overlap group's paragraphs is in each alternative: its boxes are kept together.
  const checks = new Map(); // id -> boxes
  const pop = h("div", { class: "rv-pop", role: "dialog", "aria-label": "About this edit", hidden: true });
  const partOf = (x) => {
    const it = byKey.get(x.item);
    return it.hunks.length > 1 ? `part ${it.hunks.indexOf(x.id) + 1} of ${it.hunks.length}` : "";
  };
  const editNode = (k) => {
    const r = runs[k];
    const x = byId.get(r.id);
    const it = byKey.get(x.item);
    const g = groups[groupOf.get(x.id)];
    const span = h("span", { class: `rv-edit${x.stale ? " rv-old" : ""}`, "data-id": x.id });
    if (r.first) {
      const box = h("input", { type: "checkbox", class: "rv-tick", "aria-label": `Accept ${it.who}'s ${x.stale ? "older-version " : ""}edit${partOf(x) ? `, ${partOf(x)}` : ""}` });
      box.checked = ticked.has(x.id);
      box.addEventListener("change", () => {
        if (box.checked) ticked.add(x.id);
        else ticked.delete(x.id);
        refresh();
      });
      checks.set(x.id, [...(checks.get(x.id) ?? []), box]);
      span.append(box);
    }
    if (r.del) span.append(marked("del", "removed", forPreview(r.del)));
    if (r.ins) span.append(marked("ins", "added", forPreview(r.ins)));
    if (r.first && x.stale) span.append(h("span", { class: "rv-old-mark", text: "older version" }));
    if (r.first && g.hunks.length > 1) span.append(h("button", { type: "button", class: "rv-alts", text: plural(g.hunks.length - 1, "alternative") }));
    return span;
  };
  const noteNode = (k) => h("button", { type: "button", class: "rv-note-mark", "data-note": String(k), "aria-label": `Note from ${byKey.get(v.notes[k].item).who}`, text: "note" });
  swapTokens(body, (kind, k) => (kind === "E" ? editNode(k) : noteNode(k)));
  for (const nodes of kept.values()) for (const n of nodes) swapTokens(n, (kind, k) => (kind === "E" ? editNode(k) : noteNode(k)));
  const visibleBox = (id) => (checks.get(id) ?? []).find((b) => b.isConnected) ?? null;

  // Leaving for an item's page: where to come back to.
  const remember = () => store.set(RETURN(slug), {
    path: v.path, y: window.scrollY, ticked: [...ticked], shown: groups.map((g, k) => g.hunks[shownIn[k]].id),
  });

  // --- the popover ---
  let pinned = null;
  let hideTimer = 0;
  const place = (target) => {
    pop.hidden = false;
    const r = target.getBoundingClientRect();
    const w = pop.offsetWidth;
    // Above the edit when there's room: the edits still to read are below it.
    const above = r.top - pop.offsetHeight - 6;
    pop.style.top = `${(above > 8 ? above : r.bottom + 6) + window.scrollY}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - w - 8))}px`;
  };
  const close = () => {
    pop.hidden = true;
    pinned = null;
  };
  const links = (it) => h("p", { class: "rv-pop-links" },
    it.url ? h("a", { class: "small", href: it.url, target: "_blank", rel: "noopener", text: "View on GitHub" }) : null);
  const aboutEdit = (span) => {
    const x = byId.get(span.dataset.id);
    const it = byKey.get(x.item);
    const g = groups[groupOf.get(x.id)];
    const compare = h("div", { hidden: true }, (x.stale ?? []).map(threeWay));
    // A bigger target than the box in the line, for a finger.
    const toggle = h("button", { type: "button", class: "btn small rv-pop-tick", "data-id": x.id });
    toggle.addEventListener("click", () => {
      if (ticked.has(x.id)) ticked.delete(x.id);
      else ticked.add(x.id);
      refresh();
    });
    const title = it.kind === "edit" ? named(it.title) : KIND[it.kind];
    clear(pop,
      h("p", { class: "rv-pop-who" }, h("strong", { text: it.who }), partOf(x) ? h("span", { class: "muted", text: ` · ${partOf(x)}` }) : null),
      h("p", { class: "rv-pop-title" }, h("a", { href: pageOf(slug, it), text: title, onclick: remember })),
      it.summary && !it.title.includes(it.summary) ? h("p", { class: "muted small", text: named(it.summary) }) : null,
      x.stale ? [
        h("p", { class: "small", text: "Made on an older version of this paragraph: ticked, their words replace what the drafts have now." }),
        h("button", { type: "button", class: "btn link", text: "Compare", onclick: (e) => { compare.hidden = !compare.hidden; e.currentTarget.textContent = compare.hidden ? "Compare" : "Hide comparison"; } }),
        compare,
      ] : null,
      g.hunks.length > 1 ? h("div", { class: "rv-pop-alts" },
        h("p", { class: "small", text: "Only one of these can be accepted:" }),
        h("ul", {}, g.hunks.map((y, k) => h("li", {}, y === x
          ? h("span", { text: `${byKey.get(y.item).who} (shown)` })
          : h("button", { type: "button", class: "btn link", text: `Show ${byKey.get(y.item).who}'s instead`, onclick: () => switchTo(groupOf.get(x.id), k) }))))) : null,
      h("div", { class: "rv-pop-actions" }, toggle),
      links(it));
  };
  const aboutNote = (b) => {
    const n = v.notes[Number(b.dataset.note)];
    const it = byKey.get(n.item);
    clear(pop,
      h("p", { class: "rv-pop-who" }, h("strong", { text: it.who }), h("span", { class: "muted", text: " · " }), h("a", { href: pageOf(slug, it), text: "note to the authors", onclick: remember })),
      h("p", { text: n.text }),
      links(it));
  };
  const show = (target, pin) => {
    clearTimeout(hideTimer);
    if (pinned && !pin && pinned !== target) return;
    if (target.classList.contains("rv-note-mark")) {
      aboutNote(target);
      notePassage(Number(target.dataset.note));
    } else aboutEdit(target);
    // Its label from the box itself: on a tap the box toggles before its change event.
    const t = pop.querySelector(".rv-pop-tick");
    const box = t && visibleBox(t.dataset.id);
    if (t) t.textContent = (box ? box.checked : ticked.has(t.dataset.id)) ? "Untick this edit" : "Tick this edit";
    place(target);
    if (pin) pinned = target;
  };
  const owner = (e) => e.target.closest?.(".rv-edit, .rv-note-mark");
  // Hover opens it after a moment on the edit, so a mouse crossing the text doesn't.
  let showTimer = 0;
  let overBlock = null;
  body.addEventListener("mouseover", (e) => {
    const t = owner(e);
    // Over a paragraph with a note: its note shows which it is (once per visit).
    const block = e.target.closest?.(BLOCK);
    if (block !== overBlock) {
      overBlock = block;
      const marks = block ? [...block.querySelectorAll(".rv-note-mark")] : [];
      if (marks.length) setTimeout(() => overBlock === block && marks.forEach((m) => noteItself(Number(m.dataset.note))), 300);
    }
    if (!t || pinned) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => t.matches(":hover") && !pinned && show(t, false), 300);
  });
  body.addEventListener("mouseout", (e) => {
    clearTimeout(showTimer);
    if (!e.relatedTarget || !body.contains(e.relatedTarget)) overBlock = null;
    if (!owner(e) || pinned) return;
    hideTimer = setTimeout(() => !pop.matches(":hover") && close(), 250);
  });
  pop.addEventListener("mouseleave", () => !pinned && (hideTimer = setTimeout(close, 250)));
  // A mouse that clicks a box has already hovered it (the popover is showing): no pinning,
  // so ticking down the page isn't blocked. A finger's tap pins it.
  let pointer = "mouse";
  body.addEventListener("pointerdown", (e) => (pointer = e.pointerType || "mouse"));
  body.addEventListener("click", (e) => {
    const t = owner(e);
    if (!t) return;
    if (e.target.matches("input") && pointer === "mouse") return;
    // A second tap on the words closes it; the box and "N alternatives" always open it.
    if (pinned === t && !e.target.closest("input, button")) return close();
    show(t, true);
  });
  body.addEventListener("focusin", (e) => owner(e) && show(owner(e), false));
  document.addEventListener("click", (e) => pinned && !pop.contains(e.target) && !owner(e) && close(), { capture: true });
  document.addEventListener("keydown", (e) => e.key === "Escape" && !pop.hidden && close());

  // --- a note and its passage, each showing the other ---
  const markOf = (k) => body.querySelector(`.rv-note-mark[data-note="${k}"]`);
  const notePassage = (k) => {
    const m = markOf(k);
    const block = m?.closest(BLOCK);
    if (!block) return;
    intoView(flash(block, v.notes[k].quote));
  };
  const noteItself = (k) => {
    // The margin note at desktop width, the marker below it.
    const side = sideNotes.get(k);
    const el = side && side.offsetParent ? side : markOf(k);
    if (!el) return;
    el.classList.add("rv-flash-note");
    setTimeout(() => el.classList.remove("rv-flash-note"), FLASH_MS);
  };

  // --- switching which alternative a group shows ---
  const switchTo = (g, k) => {
    const ri = regionOf.get(g);
    const [a, z] = anchors.get(ri);
    const now = [];
    for (let n = a.nextSibling; n && n !== z; n = n.nextSibling) now.push(n);
    // What is shown now, kept under the key it would be asked for by.
    const r = regions[ri];
    const atFirst = r.groups.filter((o) => o !== g).every((o) => shownIn[o] === 0);
    if (atFirst) kept.set(`A${ri}_${g}_${shownIn[g]}`, now);
    now.forEach((n) => n.remove());
    const next = kept.get(`A${ri}_${g}_${k}`) ?? kept.get(`G${ri}`);
    a.after(...next);
    for (const o of r.groups) {
      // The others in a shared region are back at their first (see regionsOf).
      if (o !== g) shownIn[o] = 0;
      for (const x of groups[o].hunks) if (x !== groups[o].hunks[o === g ? k : 0]) ticked.delete(x.id);
    }
    shownIn[g] = k;
    close();
    refresh();
    drawLeft();
    visibleBox(groups[g].hunks[k].id)?.focus();
  };

  // --- the margin: each note beside its paragraph ---
  const side = h("div", { class: "rv-margin" });
  const sideNotes = new Map();
  const layout = () => {
    clear(side);
    sideNotes.clear();
    let below = 0;
    for (const m of body.querySelectorAll(".rv-note-mark")) {
      const k = Number(m.dataset.note);
      const n = v.notes[k];
      const block = m.closest(BLOCK) ?? m;
      const top = Math.max(block.offsetTop, below);
      const box = h("aside", { class: "rv-margin-note", tabindex: "0", "aria-label": `Note from ${byKey.get(n.item).who}: show the passage` }, h("strong", { text: byKey.get(n.item).who }), " ", n.text);
      box.style.top = `${top}px`; // the CSSOM, which the site's CSP allows (a style attribute isn't)
      let hover = 0;
      box.addEventListener("mouseenter", () => (hover = setTimeout(() => notePassage(k), 300)));
      box.addEventListener("mouseleave", () => clearTimeout(hover));
      box.addEventListener("click", () => notePassage(k));
      box.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), notePassage(k)));
      side.append(box);
      sideNotes.set(k, box);
      below = top + box.offsetHeight + 8;
    }
  };

  // --- what can't be ticked inline: Still to decide, before any accept ---
  const left = h("div", {});
  const drawLeft = () => clear(left, stillToDecide(book, v, ticked, byId, byKey, { shown: new Set(groups.map((g, k) => g.hunks[shownIn[k]].id)), after: reload }));
  const reload = async (words) => {
    remember();
    const r = store.get(RETURN(slug));
    store.set(RETURN(slug), null);
    pop.remove();
    await draw(stage, book, await loadView(slug, v.path), new Set(r.ticked), [words], { ...r, restore: true });
  };

  // --- the bar ---
  const pickable = () => groups.map((g, k) => g.hunks[shownIn[k]]);
  const count = h("span", { class: "rv-count" });
  const reason = h("p", { class: "publish-reason", id: "rv-reason" });
  const go = h("button", { type: "button", class: "btn primary", "aria-describedby": "rv-reason" });
  const outcome = h("div", { "aria-live": "polite" });
  const refresh = () => {
    for (const [id, boxes] of checks) for (const box of boxes) box.checked = ticked.has(id);
    for (const s of body.querySelectorAll(".rv-edit")) s.classList.toggle("ticked", ticked.has(s.dataset.id));
    const n = ticked.size;
    go.textContent = `Accept ${plural(n, "change")} into drafts`;
    go.disabled = n === 0;
    reason.textContent = n ? "" : "Tick at least one edit to accept.";
    reason.hidden = n > 0;
    count.textContent = `${n} ticked`;
    // The popover's button says what a tap on it will do now (a box tapped meanwhile included).
    const t = pop.querySelector(".rv-pop-tick");
    if (t) t.textContent = ticked.has(t.dataset.id) ? "Untick this edit" : "Tick this edit";
    layout();
  };
  const all = (on) => {
    ticked.clear();
    // The edit each group shows; older-version ones are ticked one by one.
    if (on) for (const x of pickable()) if (!x.stale) ticked.add(x.id);
    refresh();
  };
  go.addEventListener("click", async () => {
    go.disabled = true;
    clear(outcome, busy("Putting the ticked edits into the drafts…"));
    const ids = [...ticked];
    try {
      const r = await act(slug, "review-accept", { path: v.path, drafts: v.drafts, hunks: ids });
      forgetCount(slug);
      pop.remove();
      clear(stage, ...afterwards(book, v, r, ids));
      stage.scrollIntoView({ block: "start" });
    } catch (err) {
      if (err?.status === 409 && err.body?.view) {
        // Nothing was written: drawn again on the drafts as they are now.
        const names = (err.body.invalid ?? []).map((b) => {
          const x = byId.get(b.id);
          return x ? `${byKey.get(x.item).who}'s edit${partOf(x) ? ` (${partOf(x)})` : ""}: ${b.why}` : b.why;
        });
        pop.remove();
        await draw(stage, book, withOverlaps(err.body.view), new Set(err.body.kept ?? []), [err.body.userMessage, names.length ? `No longer ticked: ${names.join("; ")}.` : "Everything you ticked is still ticked."]);
        return;
      }
      go.disabled = ticked.size === 0;
      clear(outcome, errorNote(err));
    }
  });

  // Above the text: how much is waiting (the count under Still to decide is its list's),
  // and the notes on the whole chapter, three at first.
  drawLeft();
  const toDecide = Number(left.querySelector("[data-count]")?.dataset.count ?? 0);
  const edits = v.hunks.filter(tickable);
  const readers = new Set(edits.map((x) => byKey.get(x.item).who));
  const top = v.notes.filter((n) => n.at < 0);
  const noteLine = (n) => h("li", {}, h("strong", { text: `${byKey.get(n.item).who}: ` }), n.text);
  const more = top.length > 3 ? h("button", { type: "button", class: "btn link", text: `Show ${top.length - 3} more` }) : null;
  const chapterNotes = top.length ? h("section", { class: "rv-chapter-notes", "aria-label": "Notes on the whole chapter" },
    h("p", { class: "rv-chapter-notes-h", text: "On the whole chapter:" }),
    h("ul", {}, top.slice(0, 3).map(noteLine)), more) : null;
  more?.addEventListener("click", () => {
    chapterNotes.querySelector("ul").append(...top.slice(3).map(noteLine));
    more.remove();
  });
  clear(stage,
    said ? note(said.filter(Boolean).map((t) => h("p", { text: t })), "warn") : null,
    !groups.length && !toDecide ? h("p", { class: "rv-summary", text: "Nothing is waiting on this chapter." })
      : h("p", { class: "rv-summary" }, edits.length ? `${plural(edits.length, "edit")} from ${plural(readers.size, "reader")}, ${plural(v.notes.length, "note")}` : `No edits, ${plural(v.notes.length, "note")}`,
        toDecide ? h("span", { class: "muted", text: ` · ${toDecide} to decide below` }) : null),
    // Nothing to tick: one plain line, and no bar.
    !groups.length && toDecide ? h("p", { class: "rv-quiet", text: `Nothing to tick here; ${plural(toDecide, "item")} to decide below.` }) : null,
    chapterNotes,
    h("div", { class: "rv-body" }, body, side),
    groups.length ? h("div", { class: "rv-bar" }, reason,
      h("div", { class: "rv-bar-row" },
        h("button", { type: "button", class: "btn", text: "Tick all", onclick: () => all(true) }),
        h("button", { type: "button", class: "btn", text: "Untick all", onclick: () => all(false) }),
        count, go),
      outcome) : null,
    left,
    pop);
  refresh();
  if (restore?.y != null) requestAnimationFrame(() => window.scrollTo(0, restore.y));
  // Notes follow their paragraph when the width (and so the wrapping) changes.
  if (typeof ResizeObserver === "function") new ResizeObserver(() => body.isConnected && layout()).observe(body);
}

// --- afterwards ----------------------------------------------------------------------------------

function afterwards(book, v, r, ids) {
  const byId = new Map(v.hunks.map((x) => [x.id, x]));
  const byKey = new Map(v.items.map((i) => [i.key, i]));
  return [
    note([
      h("h2", { class: "small-heading", text: "Accepted" }),
      (r.steps ?? []).map((s) => h("p", { text: s })),
      h("ul", {}, (r.accepted ?? []).map((a) => {
        const it = byKey.get(a.key);
        return h("li", { text: `${it.kind === "edit" ? `Proposed edit ${itemName(it)}` : "Suggestion"} — ${it.who}${a.all ? "" : ` (${a.hunks.length} of ${it.hunks.length} changes; the rest is below)`}` });
      })),
      r.url ? h("p", {}, h("a", { href: r.url, target: "_blank", rel: "noopener", text: "See the change on GitHub" })) : null,
    ]),
    r.warning ? note([h("p", { text: r.warning })], "warn") : null,
    stillToDecide(book, v, new Set(ids), byId, byKey, null),
    h("div", { class: "actions" },
      h("a", { class: "btn", href: `#/${book.slug}/drafts`, text: "Back to Drafts" }),
      h("a", { class: "btn", href: `#/${book.slug}/edit/${encodeURIComponent(v.path)}`, text: "Open the chapter in the editor" })),
  ];
}

/**
 * The items still to decide, each with Decline (a reason, always), Keep open and Open in
 * editor. After an accept (`before` null): everything not ticked. Before one (`before`:
 * { shown, after }): what can't be ticked inline: notes, older-version edits, alternatives
 * not shown and what can't be shown here; a part of a proposal is declined with the whole
 * of it then, as nothing of it is accepted yet. `after(words)` redraws once one is answered.
 */
function stillToDecide(book, v, ticked, byId, byKey, before) {
  const slug = book.slug;
  const entries = [];
  for (const it of v.items) {
    const hs = it.hunks.map((id) => byId.get(id));
    if (before) {
      const why = (x) => (x.lost ? "its words aren't in the chapter any more" : x.stale ? "made on an older version" : !before.shown.has(x.id) ? "an alternative to the one shown" : null);
      const open = hs.filter((x) => !x.already);
      const left = open.filter(why);
      if (it.kind === "note" || it.why || !open.length) entries.push({ it, whole: true, why: whyLeft(it, byId, byKey) });
      else if (left.length && left.length === open.length) entries.push({ it, whole: true, why: why(left[0]) });
      else for (const x of left) entries.push({ it, x, why: why(x) });
      continue;
    }
    const mine = it.hunks.filter((id) => ticked.has(id));
    if (mine.length && it.hunks.every((id) => ticked.has(id) || byId.get(id).already)) continue;
    if (!mine.length) entries.push({ it, whole: true, why: whyLeft(it, byId, byKey) });
    else for (const id of it.hunks.filter((x) => !ticked.has(x) && !byId.get(x).already)) entries.push({ it, x: byId.get(id), why: byId.get(id).stale ? "made on an older version" : "not ticked" });
  }
  if (!entries.length) return h("section", { class: "rv-left", "data-count": "0" }, h("p", { class: "muted", text: "Nothing is left to decide on this chapter." }));
  const kept = new Set();
  return h("section", { class: "rv-left", "aria-labelledby": "rv-left-h", "data-count": String(entries.length) },
    h("h2", { id: "rv-left-h", text: `Still to decide (${entries.length})` }),
    before ? h("p", { class: "muted small", text: "These can't be ticked in the text above. Nothing is declined without a reason." }) : null,
    h("ul", { class: "list" }, entries.map((e) => {
      const out = h("div", { "aria-live": "polite" });
      const what = e.whole ? `${e.it.kind === "edit" ? `Proposed edit ${itemName(e.it)}` : e.it.kind === "note" ? "Note" : "Suggestion"}` : `Change ${e.it.hunks.indexOf(e.x.id) + 1} of ${e.it.hunks.length} in ${itemName(e.it)}`;
      // Before an accept a part can't be declined alone: nothing of the proposal is in yet.
      const wholeDecline = e.whole || before;
      const decline = declineButton(out, async (reason) => {
        if (!wholeDecline) {
          await act(slug, "part-decline", { number: e.it.number, reason, part: e.x.to ?? e.x.stale?.[0]?.suggested ?? "" });
          return "Declined: your reason is posted on the proposal, with the part it is about.";
        }
        await act(slug, e.it.kind === "edit" ? "change-decline" : "suggestion-decline", { number: e.it.number, reason });
        const said = "Declined: your reason is posted, with a note thanking them. It shows as Declined in the book's history.";
        if (before) setTimeout(() => before.after(said), 800);
        return said;
      }, wholeDecline && !e.whole ? "Decline the whole proposal…" : "Decline…");
      const keep = h("button", { type: "button", class: "btn", text: "Keep open" });
      keep.addEventListener("click", async () => {
        keep.disabled = true;
        try {
          // A part of a proposal accepted in part: the proposal is opened again (once) for it.
          if (!before && !e.whole && !kept.has(e.it.number)) await act(slug, "part-keep", { number: e.it.number });
          kept.add(e.it.number);
          clear(out, note([h("p", { text: before || e.whole ? "Kept open: it stays waiting for later." : "Kept open: the proposal is open again for its other parts." })]));
        } catch (err) {
          keep.disabled = false;
          clear(out, errorNote(err));
        }
      });
      const editor = h("button", { type: "button", class: "btn link", text: "Open in editor", onclick: () => openInEditor(slug, v, e) });
      return h("li", {},
        h("div", { class: "row" }, h("div", { class: "grow" }, h("strong", { text: what }), ` — ${e.it.who}`, h("span", { class: "muted small", text: ` (${e.why})` })),
          h("div", { class: "row" }, decline, keep, editor)),
        e.x && !e.x.stale ? h("blockquote", { class: "said rv-words" }, words(shown(e.x.from), shown(e.x.to))) : null,
        e.it.kind === "note" ? h("blockquote", { class: "said", text: v.notes.find((n) => n.item === e.it.key)?.text ?? "" }) : null,
        out);
    })));
}

function whyLeft(it, byId, byKey) {
  if (it.why) return it.kind === "note" ? "a note to the authors" : it.why;
  const hs = it.hunks.map((id) => byId.get(id));
  if (hs.length && hs.every((x) => x.stale)) return "made on an older version";
  const lost = hs.flatMap((x) => x.overlaps ?? []).map((o) => byKey.get(byId.get(o)?.item)?.who).filter(Boolean);
  return lost.length ? `overlapped ${[...new Set(lost)].join(" and ")}'s` : "not ticked";
}

/** The editor at the item's paragraph, with what they suggested beside it (nothing accepted). */
function openInEditor(slug, v, e) {
  const xs = e.whole ? e.it.hunks.map((id) => v.hunks.find((x) => x.id === id)) : [e.x];
  const first = xs.find((x) => x && x.at != null);
  const note = v.notes.find((n) => n.item === e.it.key);
  const paragraphs = xs.filter(Boolean).flatMap((x) => (x.stale ? x.stale : x.already ? [] : [{ base: x.from.trim(), suggested: x.to.trim(), current: x.from.trim() }]));
  try {
    sessionStorage.setItem(openedKey(slug, v.path), JSON.stringify({ review: true, number: e.it.number, title: named(e.it.title), who: e.it.who, paragraphs, note: note?.text ?? null }));
  } catch {
    /* storage blocked: the editor opens without the suggestion beside it */
  }
  const at = first?.at ?? (note && note.at >= 0 ? note.at : null);
  location.hash = `#/${slug}/edit/${encodeURIComponent(v.path)}${at == null ? "" : `/line/${lineOf(v, at)}`}`;
}

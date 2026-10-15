// Review all in chapter (#/<book>/review/<path>): the chapter's drafts text as one
// continuous body, rendered as readers see it, with every pending reader edit inline in
// its sentence, as track changes: removed words struck, added words underlined, and a
// small tick box just before each edit. The function merges each proposal in (its
// lib/review.mjs: three-way, word by word); nothing is ticked to begin with.
//
//   popover      hover or tap an edit (or its box): who, the proposal's title and
//                summary, "part 2 of 3"; Compare for a stale one; the alternatives
//   stale        made on an older version: inline too, dotted and marked "older
//                version"; ticked, the suggestion's words replace the drafts' (Compare
//                shows old / suggested / now). Tick all leaves these alone.
//   overlaps     edits that overlap (transitively) are one group: the first is shown,
//                the rest are "N alternatives" beside it; the popover switches which is
//                shown, and only the one shown can be ticked
//   notes        a marker at the end of their paragraph, the text in the margin (a
//                popover below 760 px); notes on the whole chapter in one line on top
//   the bar      Tick all, Untick all, the count and Accept N, sticky at the bottom
//   Accept N     one write (author-act review-accept) with the ticked ids and the drafts
//                commit the view was built from; a 409 redraws on the drafts as they
//                are now, keeping the ticks that still hold and naming the rest
//   After        "Still to decide": Decline (a reason, always), Keep open, Open in editor
//
// The page is rendered in one call to GitHub's markdown renderer: each edit is a token
// in the text, swapped for its marks afterwards; each group's alternatives go at the end
// between marker paragraphs and are kept aside, to swap in. On the Worker the view comes
// in parts (the page, then each proposal), joined here, and the overlaps worked out with
// the function's own rule (clash, below).

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
const shown = (t) => forPreview(t ?? "").trim();
const itemName = (it) => (it.kind === "edit" ? `“${it.title}”` : KIND[it.kind]);

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
const MARK = /^C4N([GA])(\d+)_(\d+)([SE])$/;
const ends = (t) => t.replace(/\n*$/, "\n\n");

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
 * (`runs` gets { id, del, ins, first }). Paragraph breaks around it stay.
 */
function inline(x, runs) {
  const from = x.from.trimEnd();
  const to = x.to.trimEnd();
  const trail = (x.from || x.to).slice((x.from ? from : to).length) || "\n\n";
  return editRuns(from, to).map((s) => {
    if ("eq" in s) return s.eq;
    runs.push({ id: x.id, ...s, first: !runs.some((r) => r.id === x.id) });
    return `C4NE${runs.length - 1}Z`;
  }).join("") + trail;
}

/** A group's paragraphs with `x` (one of its edits) in them; notes' tokens at its end. */
function region(P, g, x, runs, notesIn) {
  const text = P.slice(g.lo, x.at).join("") + inline(x, runs) + P.slice(x.end, g.hi).join("");
  return ends(text.replace(/\n*$/, notesIn ? ` ${notesIn}` : ""));
}

/** The chapter's Markdown with the edits shown in it, and each group's alternatives after it. */
function documentMarkdown(v, groups, shownIn, runs) {
  const P = v.paragraphs;
  // Front matter (between --- lines at the top) is never shown.
  let front = 0;
  if (P[0]?.trim() === "---") front = P.findIndex((p, i) => i > 0 && p.trim() === "---") + 1;
  const notesAt = (lo, hi) => v.notes.map((n, k) => [n, k]).filter(([n]) => n.at >= lo && n.at < hi).map(([, k]) => `C4NN${k}Z`).join(" ");
  const md = [];
  let i = front;
  let gi = 0;
  const wrap = (kind, g, k, body) => `\n\nC4N${kind}${g}_${k}S\n\n${body}\n\nC4N${kind}${g}_${k}E\n\n`;
  for (;;) {
    while (gi < groups.length && groups[gi].lo <= i) {
      const g = groups[gi];
      const body = region(P, g, g.hunks[shownIn[gi]], runs, notesAt(g.lo, Math.max(g.hi, g.lo + 1)));
      md.push(g.hunks.length > 1 ? wrap("G", gi, shownIn[gi], body) : body);
      i = Math.max(i, g.hi);
      gi++;
    }
    if (i >= P.length) break;
    md.push(ends(P[i].replace(/\n*$/, (m) => (notesAt(i, i + 1) ? ` ${notesAt(i, i + 1)}` : "")) || " "));
    i++;
  }
  groups.forEach((g, gk) => g.hunks.forEach((x, k) => {
    if (k !== shownIn[gk]) md.push(wrap("A", gk, k, region(P, g, x, runs, notesAt(g.lo, Math.max(g.hi, g.lo + 1)))));
  }));
  return md.join("");
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

const marked = (tag, label, text) => h(tag, {}, h("span", { class: "sr-only", text: `[${label}: ` }), text, h("span", { class: "sr-only", text: "]" }));

// --- the screen --------------------------------------------------------------------------------

export async function reviewScreen(slug, path) {
  const book = await bookBySlug(slug);
  const [v, index] = await Promise.all([loadView(slug, path), rawText(book.repo, book.drafts_branch, "index.md").catch(() => null)]);
  const title = titlesFrom(index).get(path);
  const stage = h("div", { class: "review" });
  await draw(stage, book, v, new Set(), null);
  return [...bookHeader(book, "drafts", `Review: ${title}`), stage];
}

async function draw(stage, book, v, ticked, said) {
  const slug = book.slug;
  const byId = new Map(v.hunks.map((x) => [x.id, x]));
  const byKey = new Map(v.items.map((i) => [i.key, i]));
  for (const id of ticked) if (!byId.has(id) || !tickable(byId.get(id))) ticked.delete(id);
  const groups = groupsOf(v);
  const groupOf = new Map(groups.flatMap((g, k) => g.hunks.map((x) => [x.id, k])));
  // Which edit each group shows: a ticked one if there is one, else the first.
  const shownIn = groups.map((g) => Math.max(0, g.hunks.findIndex((x) => ticked.has(x.id))));
  const runs = [];
  const md = documentMarkdown(v, groups, shownIn, runs);
  const { frag } = await render(md);
  const body = h("div", { class: "preview rv-text" });
  body.append(frag);

  // Each group's alternatives, kept aside; the one shown sits between two comments.
  const kept = new Map(); // "g_k" -> nodes
  const anchors = new Map(); // g -> [start comment, end comment]
  for (const p of Array.from(body.querySelectorAll("p"))) {
    const m = MARK.exec(p.textContent.trim());
    if (!m || m[4] !== "S") continue;
    const [, kind, g, k] = m;
    const nodes = [];
    let n = p.nextSibling;
    while (n && !(n.nodeName === "P" && n.textContent.trim() === `C4N${kind}${g}_${k}E`)) {
      nodes.push(n);
      n = n.nextSibling;
    }
    if (kind === "A") {
      kept.set(`${g}_${k}`, nodes);
      nodes.forEach((x) => x.remove());
      p.remove();
      n?.remove();
    } else {
      const a = [document.createComment(`group ${g}`), document.createComment(`end ${g}`)];
      p.replaceWith(a[0]);
      n?.replaceWith(a[1]);
      anchors.set(Number(g), a);
    }
  }
  for (const img of Array.from(body.querySelectorAll("img"))) {
    const p = bookPath(v.path, img.getAttribute("src"));
    if (p) img.src = rawUrl(book.repo, v.drafts, p);
    else img.removeAttribute("src");
    img.loading = "lazy";
  }

  // The edits and the note markers, in the text and in the alternatives kept aside.
  const checks = new Map();
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
      checks.set(x.id, box);
      span.append(box);
    }
    if (r.del.trim()) span.append(marked("del", "removed", forPreview(r.del)));
    if (r.ins.trim()) span.append(marked("ins", "added", forPreview(r.ins)));
    if (r.first && x.stale) span.append(h("span", { class: "rv-old-mark", text: "older version" }));
    if (r.first && g.hunks.length > 1) span.append(h("button", { type: "button", class: "rv-alts", text: plural(g.hunks.length - 1, "alternative") }));
    return span;
  };
  const noteNode = (k) => h("button", { type: "button", class: "rv-note-mark", "data-note": String(k), "aria-label": `Note from ${byKey.get(v.notes[k].item).who}`, text: "note" });
  swapTokens(body, (kind, k) => (kind === "E" ? editNode(k) : noteNode(k)));
  for (const nodes of kept.values()) for (const n of nodes) swapTokens(n, (kind, k) => (kind === "E" ? editNode(k) : noteNode(k)));

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
    clear(pop,
      h("p", { class: "rv-pop-who" }, h("strong", { text: it.who }), partOf(x) ? h("span", { class: "muted", text: ` · ${partOf(x)}` }) : null),
      it.kind === "edit" ? h("p", { class: "rv-pop-title", text: it.title }) : h("p", { class: "rv-pop-title", text: KIND[it.kind] }),
      it.summary && !it.title.includes(it.summary) ? h("p", { class: "muted small", text: it.summary }) : null,
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
      h("div", { class: "rv-pop-actions" }, toggle));
  };
  const aboutNote = (b) => {
    const n = v.notes[Number(b.dataset.note)];
    clear(pop, h("p", { class: "rv-pop-who" }, h("strong", { text: byKey.get(n.item).who }), h("span", { class: "muted", text: " · note to the authors" })), h("p", { text: n.text }));
  };
  const show = (target, pin) => {
    clearTimeout(hideTimer);
    if (pinned && !pin && pinned !== target) return;
    if (target.classList.contains("rv-note-mark")) aboutNote(target);
    else aboutEdit(target);
    // Its label from the box itself: on a tap the box toggles before its change event.
    const t = pop.querySelector(".rv-pop-tick");
    const box = t && checks.get(t.dataset.id);
    if (t) t.textContent = (box ? box.checked : ticked.has(t.dataset.id)) ? "Untick this edit" : "Tick this edit";
    place(target);
    if (pin) pinned = target;
  };
  const owner = (e) => e.target.closest?.(".rv-edit, .rv-note-mark");
  // Hover opens it after a moment on the edit, so a mouse crossing the text doesn't.
  let showTimer = 0;
  body.addEventListener("mouseover", (e) => {
    const t = owner(e);
    if (!t || pinned) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => t.matches(":hover") && !pinned && show(t, false), 300);
  });
  body.addEventListener("mouseout", (e) => {
    clearTimeout(showTimer);
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

  // --- switching which alternative a group shows ---
  const switchTo = (g, k) => {
    const [a, z] = anchors.get(g);
    const now = [];
    for (let n = a.nextSibling; n && n !== z; n = n.nextSibling) now.push(n);
    kept.set(`${g}_${shownIn[g]}`, now);
    now.forEach((n) => n.remove());
    a.after(...kept.get(`${g}_${k}`));
    for (const x of groups[g].hunks) ticked.delete(x.id);
    shownIn[g] = k;
    close();
    refresh();
    body.querySelector(`.rv-edit[data-id="${CSS.escape(groups[g].hunks[k].id)}"] .rv-tick`)?.focus();
  };

  // --- the margin: a rule beside paragraphs with edits, notes beside their paragraph ---
  const side = h("div", { class: "rv-margin", "aria-hidden": "true" });
  const layout = () => {
    for (const el of body.querySelectorAll(".rv-changed")) el.classList.remove("rv-changed");
    for (const e of body.querySelectorAll(".rv-edit")) e.closest("p, li, h1, h2, h3, h4, h5, h6, blockquote, td, dd")?.classList.add("rv-changed");
    clear(side);
    let below = 0;
    for (const m of body.querySelectorAll(".rv-note-mark")) {
      const n = v.notes[Number(m.dataset.note)];
      const block = m.closest("p, li, h1, h2, h3, h4, h5, h6, blockquote, td, dd") ?? m;
      const top = Math.max(block.offsetTop, below);
      const box = h("aside", { class: "rv-margin-note" }, h("strong", { text: byKey.get(n.item).who }), " ", n.text);
      box.style.top = `${top}px`; // the CSSOM, which the site's CSP allows (a style attribute isn't)
      side.append(box);
      below = top + box.offsetHeight + 8;
    }
  };

  // --- the bar ---
  const pickable = () => groups.map((g, k) => g.hunks[shownIn[k]]);
  const count = h("span", { class: "rv-count" });
  const reason = h("p", { class: "publish-reason", id: "rv-reason" });
  const go = h("button", { type: "button", class: "btn primary", "aria-describedby": "rv-reason" });
  const outcome = h("div", { "aria-live": "polite" });
  const refresh = () => {
    for (const [id, box] of checks) {
      box.checked = ticked.has(id);
      box.closest(".rv-edit")?.classList.toggle("ticked", ticked.has(id));
      for (const s of body.querySelectorAll(`.rv-edit[data-id="${CSS.escape(id)}"]`)) s.classList.toggle("ticked", ticked.has(id));
    }
    const n = ticked.size;
    go.textContent = `Accept ${plural(n, "change")} into drafts`;
    go.disabled = n === 0;
    reason.textContent = n ? "" : groups.length ? "Tick at least one edit to accept." : "Nothing here can be ticked: see Still to decide below.";
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

  // One line above the text: how much is waiting, and the notes on the whole chapter.
  const edits = v.hunks.filter(tickable);
  const readers = new Set(edits.map((x) => byKey.get(x.item).who));
  const elsewhere = v.items.filter((it) => it.why && it.kind !== "note").length + v.hunks.filter((x) => x.lost).length;
  const top = v.notes.filter((n) => n.at < 0);
  clear(stage,
    said ? note(said.filter(Boolean).map((t) => h("p", { text: t })), "warn") : null,
    h("p", { class: "rv-summary" }, `${plural(edits.length, "edit")} from ${plural(readers.size, "reader")}, ${plural(v.notes.length, "note")}`,
      elsewhere ? h("span", { class: "muted", text: ` · ${plural(elsewhere, "other")} under Still to decide` }) : null),
    top.length ? h("p", { class: "rv-chapter-notes" }, h("strong", { text: "On the whole chapter: " }),
      top.map((n, k) => [k ? " · " : "", `${byKey.get(n.item).who}: `, h("q", { text: n.text })])) : null,
    h("div", { class: "rv-body" }, body, side),
    h("div", { class: "rv-bar" }, reason,
      h("div", { class: "rv-bar-row" },
        h("button", { type: "button", class: "btn", text: "Tick all", onclick: () => all(true), disabled: !groups.length }),
        h("button", { type: "button", class: "btn", text: "Untick all", onclick: () => all(false), disabled: !groups.length }),
        count, go),
      outcome),
    stillToDecide(book, v, new Set(), byId, byKey, true),
    pop);
  refresh();
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
    stillToDecide(book, v, new Set(ids), byId, byKey, false),
    h("div", { class: "actions" },
      h("a", { class: "btn", href: `#/${book.slug}/drafts`, text: "Back to Drafts" }),
      h("a", { class: "btn", href: `#/${book.slug}/edit/${encodeURIComponent(v.path)}`, text: "Open the chapter in the editor" })),
  ];
}

/**
 * Everything not accepted: whole proposals and suggestions, the parts left of one accepted
 * in part, and the stale ones. `before`: the list as it stands while ticking (no buttons).
 */
function stillToDecide(book, v, ticked, byId, byKey, before) {
  const slug = book.slug;
  const entries = [];
  for (const it of v.items) {
    const mine = it.hunks.filter((id) => ticked.has(id));
    if (mine.length && it.hunks.every((id) => ticked.has(id) || byId.get(id).already)) continue;
    if (!mine.length) entries.push({ it, whole: true, why: whyLeft(it, byId, byKey) });
    else for (const id of it.hunks.filter((x) => !ticked.has(x) && !byId.get(x).already)) entries.push({ it, x: byId.get(id), why: byId.get(id).stale ? "made on an older version" : "not ticked" });
  }
  if (before) {
    return h("section", { class: "rv-left", "aria-labelledby": "rv-left-h" },
      h("h2", { id: "rv-left-h", text: "Still to decide" }),
      h("p", { class: "muted small", text: "After you accept, whatever you didn't tick is listed here to decline (with a reason), keep open, or open in the editor. Nothing is declined without a reason." }));
  }
  if (!entries.length) return h("p", { class: "muted", text: "Nothing is left to decide on this chapter." });
  const kept = new Set();
  return h("section", { class: "rv-left", "aria-labelledby": "rv-left-h" },
    h("h2", { id: "rv-left-h", text: `Still to decide (${entries.length})` }),
    h("ul", { class: "list" }, entries.map((e) => {
      const out = h("div", { "aria-live": "polite" });
      const what = e.whole ? `${e.it.kind === "edit" ? `Proposed edit ${itemName(e.it)}` : e.it.kind === "note" ? "Note" : "Suggestion"}` : `Change ${e.it.hunks.indexOf(e.x.id) + 1} of ${e.it.hunks.length} in ${itemName(e.it)}`;
      const decline = declineButton(out, async (reason) => {
        if (!e.whole) {
          await act(slug, "part-decline", { number: e.it.number, reason, part: e.x.to ?? e.x.stale?.[0]?.suggested ?? "" });
          return "Declined: your reason is posted on the proposal, with the part it is about.";
        }
        await act(slug, e.it.kind === "edit" ? "change-decline" : "suggestion-decline", { number: e.it.number, reason });
        return "Declined: your reason is posted, with a note thanking them. It shows as Declined in the book's history.";
      });
      const keep = h("button", { type: "button", class: "btn", text: "Keep open" });
      keep.addEventListener("click", async () => {
        keep.disabled = true;
        try {
          // A part of a proposal accepted in part: the proposal is opened again (once) for it.
          if (!e.whole && !kept.has(e.it.number)) await act(slug, "part-keep", { number: e.it.number });
          kept.add(e.it.number);
          clear(out, note([h("p", { text: e.whole ? "Kept open: it stays waiting for later." : "Kept open: the proposal is open again for its other parts." })]));
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
    sessionStorage.setItem(openedKey(slug, v.path), JSON.stringify({ review: true, number: e.it.number, title: e.it.title, who: e.it.who, paragraphs, note: note?.text ?? null }));
  } catch {
    /* storage blocked: the editor opens without the suggestion beside it */
  }
  const at = first?.at ?? (note && note.at >= 0 ? note.at : null);
  location.hash = `#/${slug}/edit/${encodeURIComponent(v.path)}${at == null ? "" : `/line/${lineOf(v, at)}`}`;
}

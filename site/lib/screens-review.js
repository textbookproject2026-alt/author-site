// Review all in chapter (#/<book>/review/<path>): the chapter's drafts text in full, as
// readers will see it, with every pending reader proposal and exact suggestion merged in
// by the function (its lib/review.mjs: three-way, word by word). Each changed paragraph
// (a hunk) shows the old words struck and the new underlined, with a tick box and who
// proposed it; a proposal that changes several paragraphs has one box in the list at
// the top that ticks them all. Notes sit in the margin. Nothing is ticked to begin with.
//
//   overlap   hunks from different proposals on one paragraph: ticking one disables
//             the others ("Overlaps with X's suggestion")
//   stale     its paragraph changed in the drafts since: the three-way view, no box
//   Accept N  one write (author-act review-accept) with the ticked ids and the drafts
//             commit the view was built from. If the drafts moved, the function answers
//             with the view rebuilt: drawn again, ticks still good kept, the rest named.
//   After     "Still to decide": everything not ticked, each with Decline (a reason,
//             always), Keep open and Open in editor.
//
// On the Worker the view comes in parts (the page, then each proposal): joined here,
// and the overlaps worked out with the function's own rule (clash, below).

import { h, clear, busy, note, errorNote, plural } from "./dom.js";
import { read, act } from "./api.js";
import { bookBySlug, bookHeader, rawUrl } from "./books.js";
import { rawText, titlesFrom, forgetCount } from "./drafts.js";
import { bookPath, forPreview, sanitise } from "./preview.js";
import { words, threeWay, openedKey } from "./suggestions.js";
import { declineButton } from "./decline.js";

/** lib/review.mjs clash: ranges sharing a paragraph, or an insertion at the other's edge. */
export const clash = (a, b) => (a.at < b.end && b.at < a.end) || ((a.at === a.end || b.at === b.end) && a.at <= b.end && b.at <= a.end);
const tickable = (x) => !x.stale && !x.already;

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

// --- the document, rendered as readers see it ------------------------------------------------

const SPLIT = "C4NREVIEWSPLIT";

/**
 * Markdown of each unchanged stretch, rendered in one call to GitHub's renderer (as the
 * editor's preview) and split back apart; the text itself if the renderer is unavailable.
 */
async function renderStretches(texts, book, ref, path) {
  const fallback = () => texts.map((t) => h("div", { class: "rv-plain" }, t.split(/\n{2,}/).filter((x) => x.trim()).map((x) => h("p", { text: x }))));
  if (!texts.length) return [];
  let html;
  try {
    const res = await fetch("https://api.github.com/markdown", {
      method: "POST",
      headers: { Accept: "text/html", "Content-Type": "application/json" },
      body: JSON.stringify({ text: texts.map(forPreview).join(`\n\n${SPLIT}\n\n`), mode: "markdown" }),
    });
    if (!res.ok) throw new Error(String(res.status));
    html = await res.text();
  } catch {
    return fallback();
  }
  const out = [h("div", { class: "preview rv-stretch" })];
  for (const n of Array.from(sanitise(html).childNodes)) {
    if (n.nodeName === "P" && n.textContent.trim() === SPLIT) out.push(h("div", { class: "preview rv-stretch" }));
    else out.at(-1).append(n);
  }
  if (out.length !== texts.length) return fallback();
  for (const img of out.flatMap((b) => Array.from(b.querySelectorAll("img")))) {
    const p = bookPath(path, img.getAttribute("src"));
    if (p) img.src = rawUrl(book.repo, ref, p);
    else img.removeAttribute("src");
    img.loading = "lazy";
  }
  return out;
}

/**
 * Rows of the document in reading order: { at, node } for each unchanged stretch and each
 * hunk's box, with the notes for the paragraph a row starts at beside it.
 */
async function documentRows(v, book, boxes, staleBoxes) {
  const P = v.paragraphs;
  const covered = new Set();
  for (const x of v.hunks) if (tickable(x)) for (let i = x.at; i < x.end; i++) covered.add(i);
  // Front matter (between --- lines at the top) is never shown.
  let front = 0;
  if (P[0]?.trim() === "---") front = P.findIndex((p, i) => i > 0 && p.trim() === "---") + 1;
  const breaks = new Set([...v.hunks.filter((x) => !x.already).flatMap((x) => [x.at, x.end]), ...v.notes.map((n) => n.at)]);
  const rows = [];
  const stretches = [];
  let open = null;
  for (let i = 0; i <= P.length; i++) {
    if (breaks.has(i) || i === P.length || covered.has(i)) open = null;
    for (const x of v.hunks.filter((y) => y.at === i && !y.already)) rows.push({ at: i, node: x.stale ? staleBoxes.get(x.id) : boxes.get(x.id) });
    if (i === P.length || covered.has(i) || i < front) continue;
    if (!open) {
      open = { at: i, text: "" };
      stretches.push(open);
      rows.push(open);
    }
    open.text += P[i];
  }
  const kept = stretches.filter((s) => s.text.trim());
  const rendered = await renderStretches(kept.map((s) => s.text), book, v.drafts, v.path);
  kept.forEach((s, k) => (s.node = rendered[k]));
  return rows.filter((r) => r.node);
}

// --- the screen --------------------------------------------------------------------------------

export async function reviewScreen(slug, path) {
  const book = await bookBySlug(slug);
  const [v, index] = await Promise.all([loadView(slug, path), rawText(book.repo, book.drafts_branch, "index.md").catch(() => null)]);
  const title = titlesFrom(index).get(path);
  const stage = h("div", { class: "review" });
  await draw(stage, book, v, new Set(), null);
  return [
    ...bookHeader(book, "drafts", `Review: ${title}`),
    h("p", { class: "muted small" },
      "The chapter as it is in the drafts, with every reader suggestion waiting on it put in place. ",
      "Struck words would go, underlined words would come in. Tick what you want, then accept them all at once: nothing changes until you do."),
    stage,
  ];
}

async function draw(stage, book, v, ticked, said) {
  const slug = book.slug;
  const byId = new Map(v.hunks.map((x) => [x.id, x]));
  const byKey = new Map(v.items.map((i) => [i.key, i]));
  for (const id of ticked) if (!byId.has(id) || !tickable(byId.get(id))) ticked.delete(id);
  const boxes = new Map();
  const staleBoxes = new Map();
  const checks = new Map();
  const groups = new Map();
  const pending = v.items.filter((i) => i.hunks.length);

  const partWords = (x) => {
    const it = byKey.get(x.item);
    const k = it.hunks.indexOf(x.id);
    return it.hunks.length > 1 ? `Change ${k + 1} of ${it.hunks.length} in ${itemName(it)}` : it.kind === "edit" ? `Proposed edit ${itemName(it)}` : "Suggestion";
  };

  for (const x of v.hunks.filter(tickable)) {
    const it = byKey.get(x.item);
    const box = h("input", { type: "checkbox", id: `rv-${x.id}`, "aria-describedby": `rv-${x.id}-why` });
    checks.set(x.id, box);
    box.checked = ticked.has(x.id);
    box.addEventListener("change", () => {
      if (box.checked) ticked.add(x.id);
      else ticked.delete(x.id);
      refresh();
    });
    boxes.set(x.id, h("div", { class: "rv-hunk", "data-id": x.id },
      h("label", { class: "rv-label", for: `rv-${x.id}` }, box, " ", h("span", {}, h("strong", { text: partWords(x) }), ` — ${it.who}`)),
      h("blockquote", { class: "said rv-words" }, x.to.trim() || x.from.trim() ? words(shown(x.from), shown(x.to)) : "(no text)"),
      h("p", { class: "rv-why muted small", id: `rv-${x.id}-why` })));
  }
  for (const x of v.hunks.filter((y) => y.stale)) {
    const it = byKey.get(x.item);
    staleBoxes.set(x.id, h("div", { class: "rv-hunk stale" },
      h("p", {}, h("strong", { text: partWords(x) }), ` — ${it.who}`, " ", h("span", { class: "badge look", text: "can't be ticked" })),
      h("p", { class: "muted small", text: "This suggestion was made on an older version of this paragraph: it and the drafts changed the same words since. It is listed under Still to decide." }),
      x.stale.map(threeWay)));
  }

  // The list of what is waiting, with a box for each proposal that changes several paragraphs.
  const listItem = (it) => {
    const tickables = it.hunks.filter((id) => tickable(byId.get(id)));
    const stale = it.hunks.length - tickables.length;
    const words = [it.kind === "note" ? "in the margin" : it.why ? `can't be ticked here: ${it.why}` : null,
      it.hunks.length > 1 ? plural(it.hunks.length, "change") : null,
      stale ? `${stale} made on an older version` : null].filter(Boolean).join(" · ");
    let group = null;
    if (tickables.length > 1) {
      group = h("input", { type: "checkbox", id: `rv-g-${it.key}`, "aria-label": `All of ${itemName(it)}` });
      group.addEventListener("change", () => {
        for (const id of tickables) if (group.checked ? !checks.get(id).disabled : true) (group.checked ? ticked.add(id) : ticked.delete(id));
        for (const id of tickables) checks.get(id).checked = ticked.has(id);
        refresh();
      });
      groups.set(it.key, { box: group, ids: tickables });
    }
    return h("li", { class: "rv-item" },
      group ? h("label", { for: `rv-g-${it.key}` }, group, " ", h("strong", { text: it.kind === "edit" ? itemName(it) : KIND[it.kind] })) : h("strong", { text: it.kind === "edit" ? itemName(it) : KIND[it.kind] }),
      ` — ${it.who}`, words ? h("span", { class: "muted small", text: ` (${words})` }) : null);
  };

  const count = h("span", {});
  const reason = h("p", { class: "publish-reason", id: "rv-reason" });
  const go = h("button", { type: "button", class: "btn primary big", "aria-describedby": "rv-reason" });
  const outcome = h("div", { "aria-live": "polite" });
  const refresh = () => {
    // Ticking one disables every other that overlaps it, saying whose it is.
    for (const [id, box] of checks) {
      const x = byId.get(id);
      const by = x.overlaps.find((o) => ticked.has(o));
      box.disabled = Boolean(by);
      if (by) ticked.delete(id), (box.checked = false);
      const why = boxes.get(id).querySelector(".rv-why");
      why.textContent = by ? `Overlaps with ${byKey.get(byId.get(by).item).who}'s suggestion, which is ticked.`
        : x.overlaps.length ? `Overlaps with ${[...new Set(x.overlaps.map((o) => byKey.get(byId.get(o).item).who))].join(" and ")}'s: only one can be ticked.` : "";
      boxes.get(id).classList.toggle("ticked", ticked.has(id));
    }
    for (const { box, ids } of groups.values()) {
      const n = ids.filter((id) => ticked.has(id)).length;
      box.checked = n === ids.length;
      box.indeterminate = n > 0 && n < ids.length;
    }
    const n = ticked.size;
    go.textContent = `Accept ${plural(n, "change")} into drafts`;
    go.disabled = n === 0;
    reason.textContent = n ? "" : !checks.size ? "Nothing here can be ticked: see Still to decide below." : "Tick at least one change to accept.";
    reason.hidden = n > 0;
    count.textContent = `${n} of ${checks.size} ticked`;
  };
  const all = (on) => {
    ticked.clear();
    // In reading order; one that overlaps one already ticked stays unticked.
    if (on) for (const x of [...v.hunks].filter(tickable).sort((a, b) => a.at - b.at)) if (!x.overlaps.some((o) => ticked.has(o))) ticked.add(x.id);
    for (const [id, box] of checks) box.checked = ticked.has(id);
    refresh();
  };

  go.addEventListener("click", async () => {
    go.disabled = true;
    clear(outcome, busy("Putting the ticked changes into the drafts…"));
    const ids = [...ticked];
    try {
      const r = await act(slug, "review-accept", { path: v.path, drafts: v.drafts, hunks: ids });
      forgetCount(slug);
      clear(stage, ...afterwards(book, v, r, ids));
      stage.scrollIntoView({ block: "start" });
    } catch (err) {
      if (err?.status === 409 && err.body?.view) {
        // Nothing was written: drawn again on the drafts as they are now.
        const names = (err.body.invalid ?? []).map((b) => {
          const x = byId.get(b.id);
          return x ? `${partWords(x)} from ${byKey.get(x.item).who} (${b.why})` : b.why;
        });
        await draw(stage, book, withOverlaps(err.body.view), new Set(err.body.kept ?? []), [err.body.userMessage, names.length ? `No longer ticked: ${names.join("; ")}.` : "Everything you ticked is still ticked."]);
        return;
      }
      go.disabled = ticked.size === 0;
      clear(outcome, errorNote(err));
    }
  });

  const rows = await documentRows(v, book, boxes, staleBoxes);
  const notesAt = (at) => v.notes.filter((n) => n.at === at).map((n) => {
    const it = byKey.get(n.item);
    return h("aside", { class: "rv-note" }, h("p", { class: "muted small", text: `${it.kind === "note" ? "Note" : "Suggestion, made by hand"} — ${it.who}` }), h("p", { text: n.text }));
  });
  // Each note beside the last row starting at or before its paragraph.
  const rowOf = (at) => rows.reduce((k, r, i) => (r.at <= at ? i : k), 0);
  const sides = new Map();
  for (const n of v.notes.filter((x) => x.at >= 0)) sides.set(rowOf(n.at), [...(sides.get(rowOf(n.at)) ?? []), n.at]);
  const row = (r, i) => {
    const side = [...new Set(sides.get(i) ?? [])].flatMap(notesAt);
    return h("div", { class: "rv-row" }, h("div", { class: "rv-main" }, r.node), side.length ? h("div", { class: "rv-side" }, side) : null);
  };
  const top = notesAt(-1);
  clear(stage,
    said ? note(said.filter(Boolean).map((t) => h("p", { text: t })), "warn") : null,
    pending.length || v.items.length ? h("section", { class: "rv-items", "aria-label": "What is waiting" },
      h("h2", { class: "small-heading", text: `Waiting on this chapter (${v.items.length})` }),
      h("ul", { class: "list" }, v.items.map(listItem)),
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn", text: "Tick all", onclick: () => all(true), disabled: !checks.size }),
        h("button", { type: "button", class: "btn", text: "Untick all", onclick: () => all(false), disabled: !checks.size }),
        h("span", { class: "muted small" }, count))) : null,
    h("section", { class: "rv-doc", "aria-label": "The chapter with the suggestions in place" },
      top.length ? h("div", { class: "rv-row" }, h("div", { class: "rv-main" }), h("div", { class: "rv-side" }, top)) : null,
      rows.map(row)),
    h("div", { class: "rv-bar" }, reason, h("div", { class: "row" }, go), outcome),
    stillToDecide(book, v, new Set(), byId, byKey, true));
  refresh();
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

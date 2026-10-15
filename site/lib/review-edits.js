// The author's own paragraph edits in Review all in chapter ("Edit this paragraph", "Add a
// paragraph after this one"): what an edit covers, what its editor starts from, the
// chapter they make with the ticked edits (as the function's lib/review.mjs applyEdits
// makes it, so the formatting check runs on what will be saved), finding them again when
// the drafts have moved, and keeping them in this browser until they are saved.
//
// An edit: { lo, hi, orig, text } — lines lo..hi of the view's paragraphs, which read
// `orig` when it began, become `text`; lo === hi is a new paragraph before line lo (after
// the paragraph that ends at lo - 1). Pure apart from the storage helpers.

export const keyOf = (e) => `${e.lo}_${e.hi}`;

/** Whether hunk `x` is in edit `e`'s lines (an insertion edit covers none). */
export const covers = (e, x) => e.lo < e.hi && (x.end > x.at ? x.at < e.hi && e.lo < x.end : x.at > e.lo && x.at < e.hi);

/** The lines an edit of lo..hi must cover: widened over any edit that crosses its edges. */
export function rangeFor(hunks, lo, hi) {
  for (let changed = true; changed;) {
    changed = false;
    for (const x of hunks) {
      if (x.end <= x.at) continue;
      if (x.at < hi && lo < x.end && (x.at < lo || x.end > hi)) {
        lo = Math.min(lo, x.at);
        hi = Math.max(hi, x.end);
        changed = true;
      }
    }
  }
  return { lo, hi };
}

/** Lines lo..hi as the ticked hunks inside them would make them: what the editor starts from. */
export function prefill(P, lo, hi, ticked) {
  const seg = P.slice(lo, hi);
  for (const x of [...ticked].filter((y) => y.at >= lo && y.end <= hi && y.end > y.at).sort((a, b) => b.at - a.at)) seg.splice(x.at - lo, x.end - x.at, x.to);
  return seg.join("").replace(/\s+$/, "");
}

/** What an edit puts in its lines (the function's applyEdits, the same rules). */
export function replacement(P, e) {
  const body = e.text.replace(/\s+$/, "");
  if (e.lo === e.hi) {
    const before = e.lo > 0 ? /\n*$/.exec(P[e.lo - 1])[0] : "\n\n";
    return body ? `${before.length >= 2 ? "" : "\n".repeat(2 - before.length)}${body}\n${e.lo < P.length ? "\n" : ""}` : "";
  }
  return body ? body + /\n*$/.exec(P[e.hi - 1])[0] : "";
}

/**
 * The chapter with the ticked hunks (those outside the edits) and the edits, and each
 * edit's lines in it (1-based, inclusive), for the formatting check.
 * -> { text, lines: Map(key -> [first, last]) }
 */
export function resultOf(P, ticked, edits) {
  const ops = [
    ...ticked.filter((x) => !edits.some((e) => covers(e, x))).map((x) => ({ at: x.at, end: x.end, to: x.to })),
    ...edits.map((e) => ({ at: e.lo, end: e.hi, to: replacement(P, e), key: keyOf(e) })),
  ].sort((a, b) => a.at - b.at || a.end - b.end);
  let text = "";
  let i = 0;
  const lines = new Map();
  const count = (t) => t.split("\n").length - 1;
  for (const o of ops) {
    text += P.slice(i, o.at).join("");
    const first = count(text) + 1;
    text += o.to;
    if (o.key) lines.set(o.key, [first, Math.max(first, count(text.replace(/\n+$/, "\n")))]);
    i = Math.max(i, o.end);
  }
  text += P.slice(i).join("");
  return { text, lines };
}

/**
 * Edits made on another version of the drafts, put where their paragraph is now: where it
 * reads `orig` (an insertion: after the paragraph it followed, `after`). The rest are
 * `lost`: never thrown away, shown to the author with their text.
 */
export function reanchor(P, edits) {
  const kept = [];
  const lost = [];
  const at = (orig, n) => {
    for (let k = 0; k + n <= P.length; k++) if (P.slice(k, k + n).join("") === orig) return k;
    return -1;
  };
  for (const e of edits) {
    if (e.lo === e.hi) {
      const k = e.after ? at(e.after, e.afterN ?? 1) : 0;
      if (k < 0) lost.push(e);
      else kept.push({ ...e, lo: k + (e.after ? e.afterN ?? 1 : 0), hi: k + (e.after ? e.afterN ?? 1 : 0) });
      continue;
    }
    if (P.slice(e.lo, e.hi).join("") === e.orig) kept.push(e);
    else {
      const k = at(e.orig, e.hi - e.lo);
      if (k < 0) lost.push(e);
      else kept.push({ ...e, lo: k, hi: k + (e.hi - e.lo) });
    }
  }
  return { kept, lost };
}

// --- kept in this browser until saved (wrapped: storage may be blocked) -------------------

const KEY = (slug, path) => `tb-review-edits:${slug}:${path}`;
export function loadEdits(slug, path) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(slug, path)) ?? "null");
    return v && Array.isArray(v.edits) ? v : { edits: [], lost: [], open: null };
  } catch {
    return { edits: [], lost: [], open: null };
  }
}
export function saveEdits(slug, path, state) {
  try {
    if (!state.edits.length && !state.lost?.length && !state.open) localStorage.removeItem(KEY(slug, path));
    else localStorage.setItem(KEY(slug, path), JSON.stringify(state));
  } catch {
    /* storage blocked: the edits last as long as the page */
  }
}

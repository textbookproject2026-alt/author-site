// Differences, shown the way the books' in-site editor shows them. diff, tokens,
// blocks and pairRuns are copied from quartz-edition-extras plugins/edit-on-github
// src/components/scripts/source.ts, and renderDiff from its editor.ts, turned into
// plain modules (copied, not shared: the editor ships inside every book's build, and
// this site has no build step). Keep them in step by hand.

import { h } from "./dom.js";

const MAX_CELLS = 400_000;

/** A minimal-ish diff of two token lists: common ends trimmed, LCS on the middle. */
export const diff = (a, b) => {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const head = a.slice(0, s).map((v) => ({ t: "=", v }));
  const tail = a.slice(ea).map((v) => ({ t: "=", v }));
  const ma = a.slice(s, ea);
  const mb = b.slice(s, eb);
  let mid;
  if ((ma.length + 1) * (mb.length + 1) > MAX_CELLS) {
    // Too big to align: everything in the middle is replaced.
    mid = [...ma.map((v) => ({ t: "-", v })), ...mb.map((v) => ({ t: "+", v }))];
  } else {
    const w = mb.length + 1;
    const L = new Uint32Array((ma.length + 1) * w);
    for (let i = ma.length - 1; i >= 0; i--)
      for (let j = mb.length - 1; j >= 0; j--)
        L[i * w + j] = ma[i] === mb[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    mid = [];
    let i = 0;
    let j = 0;
    while (i < ma.length && j < mb.length) {
      if (ma[i] === mb[j]) {
        mid.push({ t: "=", v: ma[i] });
        i++;
        j++;
      } else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) mid.push({ t: "-", v: ma[i++] });
      else mid.push({ t: "+", v: mb[j++] });
    }
    while (i < ma.length) mid.push({ t: "-", v: ma[i++] });
    while (j < mb.length) mid.push({ t: "+", v: mb[j++] });
  }
  return [...head, ...mid, ...tail];
};

/** Words and the whitespace between them, so a word diff re-joins exactly. */
export const tokens = (line) => line.split(/(\s+)/).filter((t) => t !== "");

/**
 * A line diff in runs: `same` holds unchanged paragraphs, shown collapsed as
 * "N unchanged paragraphs"; `ops` holds a run of changed lines, word-diffed. Blank
 * lines are dropped: they only separate paragraphs.
 */
export const blocks = (before, after) => {
  const out = [];
  for (const op of diff(before.split("\n"), after.split("\n"))) {
    const last = out[out.length - 1];
    if (!op.v.trim()) continue;
    if (op.t === "=") {
      if (last?.same) last.same.push(op.v);
      else out.push({ same: [op.v] });
    } else if (last?.ops) last.ops.push(op);
    else out.push({ ops: [op] });
  }
  return out.some((b) => b.ops) ? out : [];
};

export const unchangedLabel = (n) => `${n} unchanged paragraph${n === 1 ? "" : "s"}`;

/**
 * Runs of removed lines then added ones, paired line by line and word-diffed: each
 * line's words marked kept or changed (neighbours with the same mark joined).
 * Unpaired lines are changed throughout.
 */
export const pairRuns = (ops) => {
  const out = [];
  for (let k = 0; k < ops.length; ) {
    const dels = [];
    const adds = [];
    while (ops[k]?.t === "=") k++;
    while (ops[k]?.t === "-") dels.push(ops[k++].v);
    while (ops[k]?.t === "+") adds.push(ops[k++].v);
    const d = dels.map((v) => ({ t: "-", words: [{ v, changed: true }] }));
    const a = adds.map((v) => ({ t: "+", words: [{ v, changed: true }] }));
    for (let i = 0; i < Math.min(dels.length, adds.length); i++) {
      const w = diff(tokens(dels[i]), tokens(adds[i]));
      d[i].words = w.filter((o) => o.t !== "+").map((o) => ({ v: o.v, changed: o.t === "-" }));
      a[i].words = w.filter((o) => o.t !== "-").map((o) => ({ v: o.v, changed: o.t === "+" }));
    }
    for (const r of [...d, ...a])
      r.words = r.words.reduce((ws, w) => {
        const last = ws[ws.length - 1];
        if (last && last.changed === w.changed) last.v += w.v;
        else ws.push({ ...w });
        return ws;
      }, []);
    out.push(...d, ...a);
  }
  return out;
};

const line = (kind, content) =>
  h("div", { class: `line${kind === "-" ? " del" : kind === "+" ? " add" : ""}` },
    h("span", { "aria-hidden": "true", text: kind === "=" ? " " : kind === "-" ? "−" : "+" }),
    typeof content === "string" ? h("span", { text: content || " " }) : h("span", {}, content));

/** One changed line's words: the changed ones in <del> or <ins>. */
export const marked = (r) => r.words.map((w) => (w.changed ? h(r.t === "-" ? "del" : "ins", { text: w.v }) : document.createTextNode(w.v)));

/** Changed lines word-diffed, and each run of unchanged ones collapsed: into `out`. */
function render(bs, out) {
  for (const b of bs) {
    if (b.same) out.append(h("details", { class: "same" }, h("summary", { text: unchangedLabel(b.same.length) }), b.same.map((v) => line("=", v))));
    else out.append(h("div", { class: "hunk" }, pairRuns(b.ops).map((r) => line(r.t, marked(r)))));
  }
}

/** Two versions of one file, side by side in time. */
export function renderDiff(before, after, title) {
  const box = h("div", { class: "diff" }, title ? h("div", { class: "file", text: title }) : null);
  const bs = blocks(before, after);
  if (!bs.length) box.append(h("p", { class: "hh", text: "No differences." }));
  else render(bs, box);
  return box;
}

/** Removed and added lines alone (a patch's - and + lines), word-diffed. */
export function renderOps(ops, title) {
  const box = h("div", { class: "diff" }, title ? h("div", { class: "file", text: title }) : null);
  render([{ ops: ops.filter((o) => o.v.trim()) }], box);
  return box;
}

/** A unified patch as GitHub gives it (the compare and pull-request files APIs). */
export function renderPatch(patch, title) {
  const box = h("div", { class: "diff" }, title ? h("div", { class: "file", text: title }) : null);
  if (!patch) {
    box.append(h("p", { class: "hh", text: "Too large, or not text, to show here." }));
    return box;
  }
  // Each @@ hunk keeps its line number; its context lines collapse as unchanged paragraphs.
  let hunk = null;
  let bs = [];
  const flush = () => {
    if (hunk) render(bs, hunk);
    bs = [];
  };
  for (const raw of patch.split("\n")) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (m) {
      flush();
      hunk = h("div", { class: "patch-hunk" }, h("div", { class: "hh", text: `Line ${m[1]}` }));
      box.append(hunk);
      continue;
    }
    if (!hunk) {
      hunk = h("div", { class: "patch-hunk" });
      box.append(hunk);
    }
    const v = raw.slice(1);
    if (raw.startsWith("\\") || !v.trim()) continue; // "\ No newline at end of file", blank lines
    const t = raw[0] === "+" ? "+" : raw[0] === "-" ? "-" : "=";
    const last = bs[bs.length - 1];
    if (t === "=") {
      if (last?.same) last.same.push(v);
      else bs.push({ same: [v] });
    } else if (last?.ops) last.ops.push({ t, v });
    else bs.push({ ops: [{ t, v }] });
  }
  flush();
  return box;
}

// Differences, shown the way the books' in-site editor shows them. diff, tokens and
// hunks are copied from quartz-edition-extras plugins/edit-on-github
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

/** Line diff grouped into hunks with `context` unchanged lines around each change. */
export const hunks = (before, after, context = 2) => {
  const ops = diff(before.split("\n"), after.split("\n"));
  const out = [];
  let la = 1;
  let lb = 1;
  let current = null;
  let trailing = 0;
  ops.forEach((op, k) => {
    const changedNear = ops.slice(Math.max(0, k - context), k + context + 1).some((o) => o.t !== "=");
    if (changedNear) {
      if (!current || (op.t === "=" && trailing > 2 * context)) {
        current = { a: la, b: lb, ops: [] };
        out.push(current);
      }
      current.ops.push(op);
      trailing = op.t === "=" ? trailing + 1 : 0;
    } else {
      current = null;
      trailing = 0;
    }
    if (op.t !== "+") la++;
    if (op.t !== "-") lb++;
  });
  return out;
};

const line = (kind, content) =>
  h("div", { class: `line${kind === "-" ? " del" : kind === "+" ? " add" : ""}` },
    h("span", { text: kind === "=" ? " " : kind }),
    typeof content === "string" ? h("span", { text: content || " " }) : h("span", {}, content));

/** Removals then additions, paired line by line and word-diffed, as the editor does. */
function runs(ops, out) {
  for (let k = 0; k < ops.length; ) {
    const op = ops[k];
    if (op.t === "=") {
      out.append(line("=", op.v));
      k++;
      continue;
    }
    const dels = [];
    const adds = [];
    while (ops[k]?.t === "-") dels.push(ops[k++].v);
    while (ops[k]?.t === "+") adds.push(ops[k++].v);
    const paired = Math.min(dels.length, adds.length);
    const words = dels.map((d, i) => (i < paired ? diff(tokens(d), tokens(adds[i])) : null));
    dels.forEach((d, i) => {
      const w = words[i];
      out.append(line("-", w ? w.filter((o) => o.t !== "+").map((o) => (o.t === "-" ? h("del", { text: o.v }) : document.createTextNode(o.v))) : d));
    });
    adds.forEach((a, i) => {
      const w = words[i];
      out.append(line("+", w ? w.filter((o) => o.t !== "-").map((o) => (o.t === "+" ? h("ins", { text: o.v }) : document.createTextNode(o.v))) : a));
    });
  }
}

/** Two versions of one file, side by side in time. */
export function renderDiff(before, after, title) {
  const box = h("div", { class: "diff" }, title ? h("div", { class: "file", text: title }) : null);
  const hs = hunks(before, after);
  if (!hs.length) {
    box.append(h("p", { class: "hh", text: "No differences." }));
    return box;
  }
  for (const hk of hs) {
    const hunk = h("div", { class: "hunk" }, h("div", { class: "hh", text: `Line ${hk.b}` }));
    runs(hk.ops, hunk);
    box.append(hunk);
  }
  return box;
}

/** A unified patch as GitHub gives it (the compare and pull-request files APIs). */
export function renderPatch(patch, title) {
  const box = h("div", { class: "diff" }, title ? h("div", { class: "file", text: title }) : null);
  if (!patch) {
    box.append(h("p", { class: "hh", text: "Too large, or not text, to show here." }));
    return box;
  }
  let hunk = null;
  let ops = [];
  const flush = () => {
    if (hunk) runs(ops, hunk);
    ops = [];
  };
  for (const raw of patch.split("\n")) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(raw);
    if (m) {
      flush();
      hunk = h("div", { class: "hunk" }, h("div", { class: "hh", text: `Line ${m[1]}` }));
      box.append(hunk);
      continue;
    }
    if (!hunk) {
      hunk = h("div", { class: "hunk" });
      box.append(hunk);
    }
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    ops.push({ t: raw[0] === "+" ? "+" : raw[0] === "-" ? "-" : "=", v: raw.slice(1) });
  }
  flush();
  return box;
}

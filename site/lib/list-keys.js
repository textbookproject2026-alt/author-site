// Lists in a Markdown box, as a word processor does them: Enter on an item starts the
// next one (an empty item ends the list), Backspace just after an item's marker takes the
// marker off (the text joins the item above, or is a paragraph again), and Tab / Shift-Tab
// on an item move it in or out a level. Only the line being edited (and the numbers of
// its own numbered list) changes: every other line stays exactly as it was. Off a list
// line, every key does what it always does, so Tab still moves on from the box.

const ITEM = /^( *)([-*+]|\d{1,9}[.)])( +)(.*)$/;

const parse = (line) => {
  const m = ITEM.exec(line);
  return m ? { indent: m[1].length, marker: m[2], gap: m[3], text: m[4], head: m[1].length + m[2].length + m[3].length } : null;
};
const numbered = (marker) => /^\d/.test(marker);
const lineAt = (lines, pos) => {
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    if (pos <= start + lines[i].length) return { i, start };
    start += lines[i].length + 1;
  }
  return { i: lines.length - 1, start: start - lines.at(-1).length - 1 };
};
const offsetOf = (lines, i) => lines.slice(0, i).reduce((a, l) => a + l.length + 1, 0);

/**
 * The items of the numbered list line `i` is in (same indent, nothing shallower between),
 * renumbered from its first; with `start`, line `i` begins a list of its own at `start`.
 */
function renumber(lines, i, start = null) {
  const me = parse(lines[i]);
  if (!me || !numbered(me.marker)) return;
  const sameList = (j) => {
    const p = parse(lines[j]);
    return p && p.indent === me.indent && numbered(p.marker) && p.marker.at(-1) === me.marker.at(-1);
  };
  // Lines that end the list: a shallower item, or a paragraph at a shallower indent after
  // a blank line (straight after a line it is that line's continuation).
  const ends = (j) => {
    const l = lines[j];
    if (!l.trim()) return false;
    const p = parse(l);
    return p ? p.indent < me.indent : l.length - l.trimStart().length < me.indent + 1 && !lines[j - 1]?.trim();
  };
  let first = i;
  if (start === null) for (let j = i - 1; j >= 0 && !ends(j); j--) if (sameList(j)) first = j;
  let n = start ?? Number.parseInt(parse(lines[first]).marker, 10);
  for (let j = first; j < lines.length && (j === first || !ends(j)); j++) {
    if (!sameList(j)) continue;
    const p = parse(lines[j]);
    const marker = `${n++}${p.marker.at(-1)}`;
    if (marker !== p.marker) lines[j] = `${" ".repeat(p.indent)}${marker}${p.gap}${p.text}`;
  }
}

/** The item above line `i` with an indent at most `max` (its sibling or its parent), or null. */
function above(lines, i, max) {
  for (let j = i - 1; j >= 0; j--) {
    const l = lines[j];
    if (!l.trim()) continue;
    const p = parse(l);
    if (p && p.indent <= max) return p;
    if (!p && l.length - l.trimStart().length === 0) return null; // a paragraph: the list ended
  }
  return null;
}

/**
 * What `key` does at the selection [from, to] of `value`. -> { value, caret }, or null:
 * the box's own behaviour (not on a list line, a selection, or a modifier).
 */
export function listKey(value, from, to, key, shift = false) {
  if (from !== to && key !== "Tab") return null;
  const lines = value.split("\n");
  const { i, start } = lineAt(lines, from);
  const item = parse(lines[i]);
  if (!item) return null;
  const col = from - start;
  const done = (caretLine, caretCol) => ({ value: lines.join("\n"), caret: offsetOf(lines, caretLine) + caretCol });

  if (key === "Enter" && !shift) {
    if (col < item.head) return null;
    if (!item.text.trim()) {
      // An empty item: the list ends here.
      lines[i] = "";
      return done(i, 0);
    }
    // Loose (a blank line between items) when its own list is: an item of the same kind
    // across a blank line, not another list that follows this one.
    const kin = (l) => {
      const p = parse(l ?? "");
      return p && p.indent === item.indent && (numbered(item.marker) ? numbered(p.marker) && p.marker.at(-1) === item.marker.at(-1) : p.marker === item.marker);
    };
    const loose = (lines[i + 1] === "" && kin(lines[i + 2])) || (lines[i - 1] === "" && kin(lines[i - 2]));
    const marker = numbered(item.marker) ? `${Number.parseInt(item.marker, 10) + 1}${item.marker.at(-1)}` : item.marker;
    const rest = lines[i].slice(col);
    lines[i] = col === item.head ? lines[i].slice(0, col) : lines[i].slice(0, col).trimEnd();
    const next = `${" ".repeat(item.indent)}${marker}${item.gap}${rest.trimStart()}`;
    lines.splice(i + 1, 0, ...(loose ? ["", next] : [next]));
    const at = i + (loose ? 2 : 1);
    renumber(lines, at);
    return done(at, parse(lines[at]).head);
  }

  if (key === "Backspace" && !shift) {
    if (col !== item.head) return null;
    // The marker goes: the text is a line of the item above, or a paragraph again.
    lines[i] = `${" ".repeat(item.indent)}${item.text}`;
    const below = lines.findIndex((l, j) => j > i && parse(l)?.indent === item.indent);
    if (below >= 0) renumber(lines, below);
    return done(i, item.indent);
  }

  if (key === "Tab") {
    if (!shift) {
      // In a level: under the item above, as its child. The first item of a list has none.
      const sibling = above(lines, i, item.indent);
      if (!sibling || sibling.indent !== item.indent) return null;
      lines[i] = `${" ".repeat(sibling.head)}${item.marker}${item.gap}${item.text}`;
      // The first child of the item above starts a list of its own, at 1.
      const sib = lines.slice(0, i).findLastIndex((l) => parse(l)?.indent === item.indent);
      const children = lines.slice(sib + 1, i).some((l) => parse(l)?.indent === sibling.head);
      renumber(lines, i, children ? null : 1);
      if (i + 1 < lines.length && parse(lines[i + 1])?.indent === item.indent) renumber(lines, i + 1);
      // The old list, from the item before it.
      const prev = lines.slice(0, i).findLastIndex((l) => parse(l)?.indent === item.indent);
      if (prev >= 0) renumber(lines, prev);
      return done(i, col + sibling.head - item.indent);
    }
    // Out a level: to its parent's indent. A top-level item has nowhere to go.
    if (item.indent === 0) return null;
    const parent = above(lines, i, item.indent - 1);
    const to = parent ? parent.indent : 0;
    lines[i] = `${" ".repeat(to)}${item.marker}${item.gap}${item.text}`;
    renumber(lines, i);
    // The items that followed it at its old level are now its children: a list from 1.
    const sib = lines.slice(i + 1).findIndex((l) => parse(l)?.indent === item.indent);
    if (sib >= 0) renumber(lines, i + 1 + sib, 1);
    return done(i, Math.max(to, col - (item.indent - to)));
  }
  return null;
}

/** Wires listKey to a textarea; an edit goes through the box's own input event (saving, the live check). */
export function listKeys(textarea) {
  textarea.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.isComposing || !["Enter", "Backspace", "Tab"].includes(e.key)) return;
    const r = listKey(textarea.value, textarea.selectionStart, textarea.selectionEnd, e.key, e.shiftKey);
    if (!r) return;
    e.preventDefault();
    textarea.setRangeText(r.value, 0, textarea.value.length, "end");
    textarea.setSelectionRange(r.caret, r.caret);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

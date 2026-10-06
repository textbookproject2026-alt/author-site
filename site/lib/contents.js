// The book's reading order: the list under "## Contents" in index.md, which is the one
// place the builder takes it from (quartz-book builder/lib.mjs contentsOrder: each list
// item's first link, [[target|label]], [[target]] or [label](target)). Reordering and
// retitling rewrite that list and nothing else on the front page. File names never
// change (decision of 1 Oct): a retitle changes what the chapter is called, not where
// it lives.

const CONTENTS = /^##\s+Contents\s*$/i;
const HEADING = /^#{1,6}\s/;
const ITEM = /^(?:[-*+]|\d+[.)])\s/;
const LINK = /\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]|\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/;

/** A link target as a repo path: "chapters/chapter-03" -> "chapters/chapter-03.md". */
function targetPath(target) {
  let t = target;
  try {
    t = decodeURI(t);
  } catch {
    /* a stray %: as written */
  }
  t = t.split("#")[0].trim().replace(/^\.?\//, "");
  return /\.md$/i.test(t) ? t : `${t}.md`;
}

/**
 * index.md's Contents list, or null when there is none, or { problem } when it is laid
 * out in a way this can't safely rearrange (text between the items).
 * -> { eol, before: [lines], items: [{ lines, path, label }], gap, after: [lines] }
 */
export function parseContents(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => CONTENTS.test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && HEADING.test(l));
  if (end < 0) end = lines.length;
  const section = lines.slice(start + 1, end);
  const first = section.findIndex((l) => ITEM.test(l));
  if (first < 0) return { eol, lines, start, end, items: [], gaps: [], head: section, tail: [] };
  // The items, each with the lines indented under it; the list ends at the last of them.
  const items = [];
  const gaps = [];
  let i = first;
  let pendingBlank = 0;
  for (; i < section.length; i++) {
    const l = section[i];
    if (ITEM.test(l)) {
      if (items.length) gaps.push(pendingBlank);
      pendingBlank = 0;
      items.push({ lines: [l] });
    } else if (!l.trim()) {
      pendingBlank++;
    } else if (/^\s/.test(l)) {
      items.at(-1).lines.push(...Array(pendingBlank).fill(""), l);
      pendingBlank = 0;
    } else {
      break; // text after the list
    }
  }
  const tail = [...Array(pendingBlank).fill(""), ...section.slice(i)];
  if (tail.some((l) => ITEM.test(l))) return { problem: "The front page's Contents has writing between its items, so it can't be rearranged here. Use Edit on the front page instead." };
  for (const it of items) {
    const m = LINK.exec(it.lines[0]);
    it.path = m ? targetPath(m[1] ?? m[5]) : null;
    it.label = m ? (m[1] ? (m[3] ?? m[1].split("/").pop()) : m[4]) : it.lines[0].replace(ITEM, "").trim();
  }
  return { eol, lines, start, end, items, gaps, head: section.slice(0, first), tail };
}

/** index.md with the Contents items in `order` (indexes into parsed.items). */
export function withOrder(parsed, order) {
  const items = order.map((k) => parsed.items[k]);
  // The spacing between items stays as it was: one blank line between them if there was any.
  const blank = parsed.gaps.some((g) => g > 0);
  const list = items.flatMap((it, k) => [...(k && blank ? [""] : []), ...it.lines]);
  const out = [...parsed.lines.slice(0, parsed.start + 1), ...parsed.head, ...list, ...parsed.tail, ...parsed.lines.slice(parsed.end)];
  return out.join(parsed.eol);
}

// "|" ends a wikilink's target and "]]" the link (contents.py line_for): neither in a label.
const safeLabel = (title) => title.replace(/\s+/g, " ").trim().replace(/\|/g, "-").replace(/\]\]/g, "] ]").replace(/\[\[/g, "[ [");

/** index.md with item `k` of the Contents called `title`. */
export function withLabel(parsed, k, title) {
  const it = parsed.items[k];
  const label = safeLabel(title);
  const first = it.lines[0].replace(LINK, (all, target, frag = "", _old, _text, href, rest) =>
    (target ? `[[${target}${frag}|${label}]]` : `[${label.replace(/[[\]]/g, "")}](${href}${rest})`));
  const items = parsed.items.map((x, i) => (i === k ? { ...x, lines: [first, ...x.lines.slice(1)] } : x));
  return withOrder({ ...parsed, items }, items.map((_, i) => i));
}

/** The chapter with its title (first "# " heading, and a front matter title: if it has one) changed. */
export function retitledChapter(text, title) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const clean = title.replace(/\s+/g, " ").trim();
  let bodyFrom = 0;
  if (lines[0] === "---") {
    const close = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
    if (close > 0) {
      for (let i = 1; i < close; i++) {
        if (/^title\s*:/.test(lines[i])) lines[i] = `title: ${JSON.stringify(clean)}`;
      }
      bodyFrom = close + 1;
    }
  }
  let fence = null;
  for (let i = bodyFrom; i < lines.length; i++) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (f) fence = fence ? (f[1][0] === fence[0] ? null : fence) : f[1];
    else if (!fence && /^#\s/.test(lines[i])) {
      lines[i] = `# ${clean}`;
      return lines.join(eol);
    }
  }
  // No title heading yet: one goes at the top, after any front matter.
  lines.splice(bodyFrom, 0, `# ${clean}`, "");
  return lines.join(eol);
}

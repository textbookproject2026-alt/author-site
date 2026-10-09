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
  // A blank line after the heading, before the list and after it, as markdownlint
  // asks (MD022, MD032), whatever the page had: the Contents is the platform's
  // block, and a first item added to an empty one used to run into the next heading.
  const head = [...parsed.head];
  if (list.length) {
    if (!head.length || head[0].trim()) head.unshift("");
    if (head.at(-1).trim()) head.push("");
  }
  const rest = [...parsed.tail, ...parsed.lines.slice(parsed.end)];
  const after = list.length && rest.length && rest[0].trim() ? [""] : [];
  const out = [...parsed.lines.slice(0, parsed.start + 1), ...head, ...list, ...after, ...rest];
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

/** index.md with the Contents items listed by `order` only (indexes into parsed.items): the rest go. */
export const withoutPath = (parsed, path) => withOrder(parsed, parsed.items.map((_, k) => k).filter((k) => parsed.items[k].path !== path));

/** index.md with an item of `lines` put in the Contents at position `at`. */
export function withItem(parsed, lines, at) {
  const items = [...parsed.items];
  items.splice(Math.max(0, Math.min(at, items.length)), 0, { lines });
  return withOrder({ ...parsed, items }, items.map((_, i) => i));
}

/** A Contents line for `path` called `title`, written the way the list's first item is. */
export function itemLine(parsed, path, title) {
  const target = path.replace(/\.md$/i, "");
  const first = parsed.items[0]?.lines[0];
  if (!first || !LINK.test(first)) return `- [[${target}|${safeLabel(title)}]]`;
  return first.replace(LINK, (all, wiki, _f, _o, _t, href, rest) =>
    (wiki ? `[[${target}|${safeLabel(title)}]]` : `[${safeLabel(title).replace(/[[\]]/g, "")}](${encodeURI(target)}${/\.md$/i.test(href) ? ".md" : ""}${rest ?? ""})`));
}

/** The drafts' Contents (`parsed`) put back in the order of `livePaths`, for the items both have; the others keep their places. */
export function orderLike(parsed, livePaths) {
  const rank = new Map(livePaths.map((p, i) => [p, i]));
  const slots = parsed.items.map((_, k) => k).filter((k) => rank.has(parsed.items[k].path));
  const sorted = [...slots].sort((a, b) => rank.get(parsed.items[a].path) - rank.get(parsed.items[b].path));
  const order = parsed.items.map((_, k) => k);
  slots.forEach((slot, i) => {
    order[slot] = sorted[i];
  });
  return withOrder(parsed, order);
}

/** The front page's text outside its Contents list (what "the front page changed" means). */
export function outsideContents(text) {
  const p = parseContents(text);
  if (!p || p.problem) return text.replace(/\r\n/g, "\n");
  return [...p.lines.slice(0, p.start + 1), ...p.lines.slice(p.end)].join("\n");
}

/** `liveText` (index.md as readers have it) with the Contents list of `draftsText`. */
export function withContentsOf(liveText, draftsText) {
  const live = parseContents(liveText);
  const drafts = parseContents(draftsText);
  if (!live || live.problem || !drafts || drafts.problem) return liveText;
  return [...live.lines.slice(0, live.start + 1), ...drafts.lines.slice(drafts.start + 1, drafts.end), ...live.lines.slice(live.end)].join(live.eol);
}

/** A page's title: its front matter's title:, else its first # heading; null if neither. */
export function titleOf(text) {
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/);
  let i = 0;
  if (lines[0] === "---") {
    const close = lines.findIndex((l, k) => k > 0 && /^---\s*$/.test(l));
    for (let k = 1; k < close; k++) {
      const m = /^title\s*:\s*(.+)$/.exec(lines[k]);
      if (m) return m[1].trim().replace(/^(["'])(.*)\1$/, "$2");
    }
    i = close + 1;
  }
  for (; i < lines.length; i++) {
    const m = /^#\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (m) return m[1];
  }
  return null;
}

/**
 * The glossary with `term` added in the format the glossary run writes
 * (authoring-assistant glossary.py, _entry_block): "## Term", a blank line, the
 * definition as a sentence, a blank line, in A–Z order among the "## " entries.
 * `text` null starts a glossary ("# Glossary"). Throws { userMessage } if the term is
 * already there (any case) or either part is empty.
 */
export function withGlossaryTerm(text, term, definition) {
  const t = term.replace(/\s+/g, " ").trim().replace(/^#+\s*/, "");
  let d = definition.replace(/\s+/g, " ").trim();
  if (!t || !d) throw Object.assign(new Error("empty"), { userMessage: "Give both the term and what it means." });
  d = d[0].toUpperCase() + d.slice(1);
  if (!/[.!?:]$/.test(d)) d += ".";
  const eol = text?.includes("\r\n") ? "\r\n" : "\n";
  const lines = (text ?? "# Glossary\n").replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const heads = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(l)) fence = !fence;
    const m = !fence && /^\s{0,3}#{2,4}\s+(.+?)\s*$/.exec(l);
    if (m) heads.push({ i, term: m[1].replace(/[*_`]/g, "") });
  });
  if (heads.some((x) => x.term.toLowerCase() === t.toLowerCase())) {
    throw Object.assign(new Error("exists"), { userMessage: `“${t}” is already in the glossary.` });
  }
  const block = [`## ${t}`, "", d];
  const next = heads.find((x) => x.term.localeCompare(t, "en", { sensitivity: "base" }) > 0);
  if (next) lines.splice(next.i, 0, ...block, "");
  else lines.push("", ...block);
  return lines.join(eol) + eol;
}

/** chapters/chapter-NN.md with the next number after the highest the book has (two digits at least). */
export function nextChapterPath(paths) {
  const used = paths.map((p) => /^chapters\/chapter-(\d+)\.md$/i.exec(p)?.[1]).filter(Boolean).map(Number);
  const n = (used.length ? Math.max(...used) : 0) + 1;
  return `chapters/chapter-${String(n).padStart(2, "0")}.md`;
}

/** A page's file name from its title: what a file name can't hold taken out; "" if nothing is left. */
export const pageFileName = (title) =>
  title.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "");

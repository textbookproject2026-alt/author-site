// What the book is (batch 1's resource types a whole book can be): index.md's
// `resource_type:`, else the registry's `type`, else a book. quartz-book's bookType
// reads it the same way for every label (header badge, portal card, citations).
// Settings sets it; Drafts shows a change to it as its own line. Pure functions.

export const BOOK_TYPES = { book: "Book", paper: "Paper", report: "Report", article: "Article" };

/** index.md's frontmatter lines and where they end, or null when it has none. */
function frontOf(lines) {
  if (lines[0] !== "---") return null;
  const close = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
  return close > 0 ? close : null;
}

const KEY = /^resource_type\s*:\s*(.*?)\s*$/;

/** index.md's own `resource_type:` value ("" for none), unquoted and lowercased. */
export function ownType(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const close = frontOf(lines);
  const line = close ? lines.slice(1, close).find((l) => KEY.test(l)) : null;
  return line ? KEY.exec(line)[1].replace(/\s+#.*$/, "").replace(/^(["'])(.*)\1$/, "$2").trim().toLowerCase() : "";
}

/** The book's type: index.md's when it's a book-level one, else the registry's, else "book". */
export const typeOf = (text, registryType) => [ownType(text), registryType].find((t) => Object.hasOwn(BOOK_TYPES, t)) ?? "book";

/** `text` with `resource_type: <type>`: that line replaced, every other kept; no frontmatter gets one. */
export function withType(text, type) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const line = `resource_type: ${type}`;
  const close = frontOf(lines);
  if (!close) return ["---", line, "---", ""].join(eol) + eol + text;
  const at = lines.slice(1, close).findIndex((l) => KEY.test(l));
  if (at >= 0) lines[at + 1] = line;
  else lines.splice(close, 0, line);
  return lines.join(eol);
}

/** `text` without its resource_type line: what the rest of the front page is, for Drafts. */
export function withoutType(text) {
  if (typeof text !== "string") return text;
  const lines = text.split(/\r?\n/);
  const close = frontOf(lines);
  if (!close) return text;
  const kept = lines.filter((l, i) => !(i > 0 && i < close && KEY.test(l)));
  // Frontmatter that held only the type (withType's own): as if it had none.
  if (kept[1] === "---") {
    kept.splice(0, 2);
    while (kept[0] === "") kept.shift();
  }
  return kept.join(text.includes("\r\n") ? "\r\n" : "\n");
}

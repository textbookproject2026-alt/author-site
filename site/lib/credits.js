// Credits (batch 2a): a book's and each chapter's authors and editors, as their
// frontmatter has them (`authors:`, `editors:`; index.md for the book, a chapter's
// own for that chapter). quartz-book's builder reads the same keys for the
// bylines, the citations and the contributors page. Pure functions; the screen is
// screens-credits.js.

const LOGIN = /^@?([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})$/;

/**
 * Whether an ORCID iD is real: 0000-0000-0000-000X, its last character the ISO 7064
 * 11,2 check digit of the other fifteen (https://support.orcid.org/hc/en-us/articles/360006897674).
 * An https://orcid.org/ address counts too. -> the bare iD, or null.
 */
export function orcidOf(value) {
  const m = /^(?:https?:\/\/orcid\.org\/)?(\d{4})-?(\d{4})-?(\d{4})-?(\d{3}[\dXx])$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const digits = m.slice(1).join("").toUpperCase();
  let total = 0;
  for (const d of digits.slice(0, 15)) total = (total + Number(d)) * 2;
  const check = (12 - (total % 11)) % 11;
  const want = check === 10 ? "X" : String(check);
  return digits[15] === want ? `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}-${digits.slice(12)}` : null;
}

/** A GitHub username, without the @; null if it can't be one. */
export const loginOf = (value) => LOGIN.exec(String(value ?? "").trim())?.[1] ?? null;

/** People from parsed frontmatter's value: names, "A, B", or { name, orcid, github }. */
export function peopleOf(raw) {
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : raw == null ? [] : [raw];
  return items.flatMap((it) => {
    if (it && typeof it === "object") {
      const name = String(it.name ?? "").trim();
      return name ? [{ name, orcid: orcidOf(it.orcid) ?? "", github: loginOf(it.github) ?? "" }] : [];
    }
    const name = String(it ?? "").trim();
    return name ? [{ name, orcid: "", github: "" }] : [];
  });
}

/** What's wrong with a list of people, in words: [] when nothing. */
export function problemsOf(people) {
  const out = [];
  people.forEach((p, i) => {
    const n = `${i + 1}`;
    if (!p.name.trim()) out.push(`Person ${n} has no name.`);
    if (p.orcid.trim() && !orcidOf(p.orcid)) out.push(`${p.name || `Person ${n}`}: “${p.orcid}” isn't an ORCID iD (it looks like 0000-0002-1825-0097, and its last digit is a check digit).`);
    if (p.github.trim() && !loginOf(p.github)) out.push(`${p.name || `Person ${n}`}: “${p.github}” isn't a GitHub username.`);
  });
  return out;
}

// YAML for one value: always a double-quoted string, which is valid YAML for any text.
const q = (s) => JSON.stringify(String(s));

/** The `authors:` or `editors:` block for `people`; "" for none (the key goes). */
export function peopleBlock(key, people) {
  if (!people.length) return "";
  const lines = [`${key}:`];
  for (const p of people) {
    const orcid = orcidOf(p.orcid);
    const github = loginOf(p.github);
    if (!orcid && !github) {
      lines.push(`  - ${q(p.name.trim())}`);
      continue;
    }
    lines.push(`  - name: ${q(p.name.trim())}`);
    if (orcid) lines.push(`    orcid: ${q(orcid)}`);
    if (github) lines.push(`    github: ${q(github)}`);
  }
  return lines.join("\n");
}

/**
 * `text` (a page) with its frontmatter's authors and editors set: those keys (and
 * author:, editor:) are replaced, every other line is kept as it was, and a page
 * with no frontmatter gets one. Empty lists take the keys out.
 */
export function withPeople(text, { authors, editors }) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  let body = lines;
  let fm = [];
  if (lines[0] === "---") {
    const close = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
    if (close > 0) {
      fm = lines.slice(1, close);
      body = lines.slice(close + 1);
    }
  }
  // Drop the keys (a top-level key line and its indented or list lines below it).
  const keep = [];
  let dropping = false;
  for (const l of fm) {
    const top = /^([A-Za-z_][\w-]*)\s*:/.exec(l);
    if (top) dropping = ["authors", "author", "editors", "editor"].includes(top[1]);
    else if (dropping && !/^(\s|-|$)/.test(l)) dropping = false;
    if (!dropping) keep.push(l);
  }
  while (keep.length && !keep.at(-1).trim()) keep.pop();
  const added = [peopleBlock("authors", authors), peopleBlock("editors", editors)].filter(Boolean);
  const front = [...keep, ...added.flatMap((b) => b.split("\n"))];
  if (!front.length) return (fm.length ? body.join(eol).replace(/^(\r?\n)+/, "") : text);
  const rest = body.join(eol);
  return ["---", ...front, "---", ...(fm.length ? [] : [""])].join(eol) + eol + (fm.length ? rest : text);
}

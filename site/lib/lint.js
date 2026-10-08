// The book's own lint, in the browser, as the author types: markdownlint 0.38.0 (the version
// the books' lint workflow runs: markdownlint-cli2-action@v20 → cli2 0.18.1) with the
// book's .markdownlint-cli2.yaml at the drafts commit the page was read at. What it
// can put right itself (blank lines, spacing) it does; anything left is said in plain
// words, with its line, and Send waits until there is nothing left. The function runs
// the same check before Publish (suggest-edit-function lib/book-lint.mjs).

import { rawUrl } from "./books.js";

const MARKDOWNLINT = "https://cdn.jsdelivr.net/npm/markdownlint@0.38.0/lib/markdownlint.mjs/+esm";
const JS_YAML = "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm";
export const CONFIG_FILE = ".markdownlint-cli2.yaml";

let libs;
const load = () => (libs ??= Promise.all([import(MARKDOWNLINT), import(JS_YAML)]).catch((err) => {
  libs = null; // a later Send tries again
  throw Object.assign(err, { userMessage: "The formatting check couldn't be loaded. Check you're online, then press Send again." });
}));

/** "**" and "*" globs, as cli2's ignores use them. */
const globRe = (glob) => new RegExp(`^${glob
  .replace(/[.+^${}()|[\]\\]/g, "\\$&")
  .replace(/\*\*\//g, "\u0000")
  .replace(/\*\*/g, ".*")
  .replace(/\*/g, "[^/]*")
  .replace(/\u0000/g, "(?:.*/)?")}$`);

const configs = new Map(); // repo@commit -> Promise<{ config, ignores }>

/** The book's lint settings at `commit`; markdownlint's defaults if it has none. */
export function bookLintConfig(book, commit) {
  const key = `${book.repo}@${commit}`;
  if (!configs.has(key)) {
    configs.set(key, (async () => {
      const [, yaml] = await load();
      const res = await fetch(rawUrl(book.repo, commit, CONFIG_FILE), { cache: "force-cache" });
      if (!res.ok && res.status !== 404) throw Object.assign(new Error("config"), { userMessage: "The book's formatting rules couldn't be read just now. Please press Send again." });
      const doc = res.ok ? yaml.load(await res.text()) ?? {} : {};
      return { config: doc.config ?? { default: true }, ignores: ["node_modules/**", ...(doc.ignores ?? [])].map(globRe) };
    })().catch((err) => {
      configs.delete(key);
      throw err;
    }));
  }
  return configs.get(key);
}

// What each rule means for an author, and what to do. Anything not here is said in
// markdownlint's own words.
const WORDS = {
  MD001: "A heading skips a level. Make it one level below the heading before it (one more #).",
  MD003: "Headings are written in two different styles. Write each as # at the start of its line.",
  MD004: "The bullet lists use different markers. Use - for every bullet.",
  MD005: "Items of the same list are indented differently. Line them up.",
  MD007: "A bullet inside a list is indented by the wrong amount.",
  MD009: "There are spaces at the end of the line.",
  MD010: "There is a tab on the line. Use spaces.",
  MD011: "A link is the wrong way round: (text)[address]. Write it as [text](address).",
  MD012: "There are several blank lines in a row. One is enough.",
  MD013: "The line is longer than the book allows.",
  MD018: "A heading has no space after its #. Write “## Heading”.",
  MD019: "A heading has more than one space after its #.",
  MD022: "A heading needs a blank line before and after it.",
  MD023: "A heading doesn't start at the beginning of its line.",
  MD024: "Two headings in the same part of the page say exactly the same. Reword one of them.",
  MD025: "There is more than one top-level heading (#). A page has one title: make the others ## headings.",
  MD026: "A heading ends with punctuation. Take it off.",
  MD027: "A quotation has more than one space after its >.",
  MD028: "A blank line splits a quotation in two. Put > on the blank line, or remove it.",
  MD029: "A numbered list's numbers aren't in order.",
  MD030: "A list item has the wrong number of spaces after its - or number. Use one.",
  MD031: "A block of code needs a blank line before and after it.",
  MD032: "A list needs a blank line before and after it.",
  MD033: "There is HTML on the line, which the book doesn't allow.",
  MD034: "A web address isn't written as a link. Put it between < and >, or write [text](address).",
  MD035: "Horizontal rules are written in two different ways.",
  MD036: "A line in bold or italic is standing in for a heading. Make it a real heading (## at the start), or join it to the paragraph.",
  MD037: "There are spaces just inside * or _, so it won't show as bold or italic.",
  MD038: "There are spaces just inside a `code` span.",
  MD039: "There are spaces just inside a link's [text].",
  MD040: "A block of code doesn't say what language it is.",
  MD041: "The page should start with its title as a # heading.",
  MD042: "A link goes nowhere: its address is empty.",
  MD044: "A name isn't capitalised the way the book spells it.",
  MD045: "A picture has no description. Put a few words saying what it shows between its square brackets: ![like this](…).",
  MD046: "Blocks of code are written in two different ways.",
  MD047: "The page should end with a line break.",
  MD048: "Blocks of code are fenced in two different ways.",
  MD049: "Italics are written in two different ways. Use *one style*.",
  MD050: "Bold is written in two different ways. Use **one style**.",
  MD051: "A link points to a heading on the page that doesn't exist.",
  MD052: "A link refers to a label that isn't defined anywhere on the page.",
  MD053: "A footnote or link definition isn't used anywhere in the text: [^1]: … needs a [^1] where it belongs, or should go.",
  MD054: "A link is written in a style the book doesn't use.",
  MD055: "A table's rows are written with | in different places.",
  MD056: "A table row has a different number of cells from the others.",
  MD058: "A table needs a blank line before and after it.",
  MD059: "A link's text doesn't say where it goes (like “click here”). Say what it links to.",
};

const describe = (e) => ({
  line: e.lineNumber,
  rule: e.ruleNames[0],
  words: WORDS[e.ruleNames[0]] ?? `${e.ruleDescription}.`,
  context: e.errorContext ?? "",
});

/**
 * Lints one page with the book's rules, putting right what markdownlint can.
 * -> { text, fixed: [rule], problems: [{ line, rule, words, context }], skipped }
 */
export async function lintPage(book, commit, path, original) {
  const options = await bookLintConfig(book, commit);
  if (!/\.md$/i.test(path) || options.ignores.some((re) => re.test(path))) return { text: original, fixed: [], problems: [], skipped: true };
  const [mdl] = await load();
  const run = async (text) => (await mdl.lintPromise({ strings: { [path]: text }, config: options.config, handleRuleFailures: true }))[path];
  let text = original;
  const fixed = new Set();
  // A fix can make room for another (a blank line, then the heading beside it): a few rounds.
  for (let round = 0; round < 3; round++) {
    const errors = (await run(text)).filter((e) => e.fixInfo);
    if (!errors.length) break;
    const next = mdl.applyFixes(text, errors);
    if (next === text) break;
    errors.forEach((e) => fixed.add(e.ruleNames[0]));
    text = next;
  }
  return { text, fixed: [...fixed], problems: (await run(text)).map(describe), skipped: false };
}

/** "3 things": what was put right automatically, in one sentence. */
export function fixedWords(fixed) {
  if (!fixed.length) return "";
  return `Put right automatically: ${fixed.map((r) => (WORDS[r] ?? r).replace(/\.$/, "").toLowerCase()).join("; ")}.`;
}

/** A rule's plain words (for problems the function found before Publish). */
export const ruleWords = (rule, description = "") => WORDS[rule] ?? (description ? `${description}.` : rule);

const lineAt = (text, pos) => text.slice(0, pos).split("\n").length;

/**
 * The editor's live check: lints the page with the book's rules and puts right what
 * markdownlint can, except on the line the caret is on (that one is still being
 * typed). -> { text, caret, problems, fixed: [rule] }: the caret moves with its text.
 */
export async function lintLive(book, commit, path, original, caret) {
  const options = await bookLintConfig(book, commit);
  if (!/\.md$/i.test(path) || options.ignores.some((re) => re.test(path))) return { text: original, caret, problems: [], fixed: [] };
  const [mdl] = await load();
  const run = async (text) => (await mdl.lintPromise({ strings: { [path]: text }, config: options.config, handleRuleFailures: true }))[path];
  const MARK = "⁣";
  let text = original;
  let pos = caret;
  const fixed = new Set();
  const notHere = (e) => (e.fixInfo.lineNumber ?? e.lineNumber) !== lineAt(text, pos) && e.lineNumber !== lineAt(text, pos);
  for (let round = 0; round < 3; round++) {
    const errors = (await run(text)).filter((e) => e.fixInfo && notHere(e));
    if (!errors.length) break;
    const next = mdl.applyFixes(text.slice(0, pos) + MARK + text.slice(pos), errors);
    const at = next.indexOf(MARK);
    if (at < 0) break; // the caret's own line went: leave the text as it was
    const unmarked = next.slice(0, at) + next.slice(at + 1);
    if (unmarked === text) break;
    errors.forEach((e) => fixed.add(e.ruleNames[0]));
    text = unmarked;
    pos = at;
  }
  const problems = (await run(text)).filter((e) => !(e.fixInfo && !notHere(e))).map(describe);
  return { text, caret: pos, problems, fixed: [...fixed] };
}

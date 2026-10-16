// site/lib/contents.js on its own (no browser): the front page's Contents, reordered
// and retitled exactly as the builder will read it back (quartz-book contentsOrder).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseContents, withOrder, withLabel, withItem, itemLine, retitledChapter } from "../site/lib/contents.js";

const INDEX = [
  "# A book", "", "Intro.", "", "## Contents", "",
  "- **[[chapters/chapter-01|Chapter 1: Soils]]**",
  "  How soils form.",
  "- **[[chapters/chapter-02|Chapter 2]]**",
  "- [Chapter 3](chapters/chapter-03.md)",
  "", "## About", "", "x", "",
].join("\n");

test("parses each item, with the lines indented under it, and where it points", () => {
  const p = parseContents(INDEX);
  assert.deepEqual(p.items.map((i) => [i.path, i.label, i.lines.length]), [
    ["chapters/chapter-01.md", "Chapter 1: Soils", 2],
    ["chapters/chapter-02.md", "Chapter 2", 1],
    ["chapters/chapter-03.md", "Chapter 3", 1],
  ]);
});

test("reorders only the list: its description goes with an item, and the rest of the page is untouched", () => {
  const p = parseContents(INDEX);
  const out = withOrder(p, [2, 0, 1]);
  assert.equal(out, INDEX.replace(
    "- **[[chapters/chapter-01|Chapter 1: Soils]]**\n  How soils form.\n- **[[chapters/chapter-02|Chapter 2]]**\n- [Chapter 3](chapters/chapter-03.md)",
    "- [Chapter 3](chapters/chapter-03.md)\n- **[[chapters/chapter-01|Chapter 1: Soils]]**\n  How soils form.\n- **[[chapters/chapter-02|Chapter 2]]**"));
  assert.equal(withOrder(p, [0, 1, 2]), INDEX, "the same order gives the same page");
});

test("blank lines between items and CRLF are kept", () => {
  const crlf = "## Contents\r\n\r\n- [[a|A]]\r\n\r\n- [[b|B]]\r\n";
  const p = parseContents(crlf);
  assert.equal(withOrder(p, [1, 0]), "## Contents\r\n\r\n- [[b|B]]\r\n\r\n- [[a|A]]\r\n");
});

test("retitle: the label changes in either kind of link, and a label can't break the link", () => {
  const p = parseContents(INDEX);
  assert.match(withLabel(p, 1, "Chapter 2: Rocks | and stones"), /- \*\*\[\[chapters\/chapter-02\|Chapter 2: Rocks - and stones\]\]\*\*/);
  assert.match(withLabel(p, 2, "Water"), /- \[Water\]\(chapters\/chapter-03\.md\)/);
  assert.match(withLabel(parseContents("## Contents\n\n- [[chapters/x]]\n"), 0, "X"), /\[\[chapters\/x\|X\]\]/);
});

test("no Contents: null; writing between the items: refused in words", () => {
  assert.equal(parseContents("# Book\n\nNo list.\n"), null);
  assert.match(parseContents("## Contents\n\n- [[a|A]]\n\nSome words.\n\n- [[b|B]]\n").problem, /can't be rearranged here/);
});

test("the chapter's title: its # heading (not one in code), and a front matter title", () => {
  assert.equal(retitledChapter("# Old\n\nText.\n", "New  title"), "# New title\n\nText.\n");
  assert.equal(retitledChapter("---\ntitle: Old\ntopic: x\n---\n\n```\n# not this\n```\n\n# Old\n", "New"), '---\ntitle: "New"\ntopic: x\n---\n\n```\n# not this\n```\n\n# New\n');
  assert.equal(retitledChapter("Text only.\n", "New"), "# New\n\nText only.\n");
});

import { withGlossaryTerm, nextChapterPath, pageFileName } from "../site/lib/contents.js";

test("withGlossaryTerm: in A–Z order, in the glossary run's format; a new glossary; no term twice", () => {
  const g = "# Glossary\n\nIntro.\n\n## Agency\n\nThe capacity to act.\n\n## Structure\n\nWhat endures.\n";
  assert.equal(withGlossaryTerm(g, "emergence", "properties of wholes"),
    "# Glossary\n\nIntro.\n\n## Agency\n\nThe capacity to act.\n\n## emergence\n\nProperties of wholes.\n\n## Structure\n\nWhat endures.\n");
  assert.equal(withGlossaryTerm(g, "Zeitgeist", "Spirit of the age!"), g + "\n## Zeitgeist\n\nSpirit of the age!\n");
  assert.equal(withGlossaryTerm(null, "Agency", "The capacity to act"), "# Glossary\n\n## Agency\n\nThe capacity to act.\n");
  assert.throws(() => withGlossaryTerm(g, "AGENCY", "x"), (e) => /already in the glossary/.test(e.userMessage));
  assert.throws(() => withGlossaryTerm(g, " ", "x"), (e) => /Give both/.test(e.userMessage));
});

test("nextChapterPath and pageFileName", () => {
  assert.equal(nextChapterPath(["chapters/chapter-01.md", "chapters/chapter-11.md", "chapters/introduction.md", "chapters/Definitions/x.md"]), "chapters/chapter-12.md");
  assert.equal(nextChapterPath([]), "chapters/chapter-01.md");
  assert.equal(pageFileName("Structure / agency: a note?"), "Structure agency a note");
  assert.equal(pageFileName("..."), "");
});

test("the Contents always has blank lines around its heading and list (markdownlint MD022, MD032)", () => {
  // The first item added to an empty Contents doesn't run into the next heading.
  const empty = parseContents("# B\n\n## Contents\n\n## Next\n\nText\n");
  assert.equal(
    withItem(empty, [itemLine(empty, "chapters/x.md", "X")], 0),
    "# B\n\n## Contents\n\n- [[chapters/x|X]]\n\n## Next\n\nText\n",
  );
  // A list packed against its heading and the next one (platform-test-book's drafts, 9 Oct) gets them.
  const packed = parseContents("## Contents\n1. [[a|A]]\n2. [[b|B]]\n## Next\n");
  assert.equal(withOrder(packed, [1, 0]), "## Contents\n\n1. [[b|B]]\n2. [[a|A]]\n\n## Next\n", "and counted again");
  // Text before the list keeps a blank line on both sides.
  const intro = parseContents("## Contents\nRead in order:\n- [[a|A]]\n");
  assert.equal(withOrder(intro, [0]), "## Contents\n\nRead in order:\n\n- [[a|A]]\n");
});

test("a numbered Contents is counted again after a move, an addition or a removal (no gap or repeat for markdownlint)", () => {
  const NUMBERED = "# Book\n\n## Contents\n\n1. [[chapters/chapter-01|One]]\n2. [[chapters/chapter-02|Two]]\n3. [[chapters/chapter-03|Three]]\n\nAfter.\n";
  const p = parseContents(NUMBERED);
  assert.equal(withOrder(p, [2, 0, 1]), "# Book\n\n## Contents\n\n1. [[chapters/chapter-03|Three]]\n2. [[chapters/chapter-01|One]]\n3. [[chapters/chapter-02|Two]]\n\nAfter.\n");
  // A new chapter's line is written like the first item's ("1. "), then counted.
  assert.equal(withItem(p, [itemLine(p, "chapters/chapter-04.md", "Four")], 1), "# Book\n\n## Contents\n\n1. [[chapters/chapter-01|One]]\n2. [[chapters/chapter-04|Four]]\n3. [[chapters/chapter-02|Two]]\n4. [[chapters/chapter-03|Three]]\n\nAfter.\n");
  assert.equal(withOrder(p, [0, 2]), "# Book\n\n## Contents\n\n1. [[chapters/chapter-01|One]]\n2. [[chapters/chapter-03|Three]]\n\nAfter.\n");
  // From its own first number, and "1)" kept as written; bullets untouched.
  assert.equal(withOrder(parseContents(NUMBERED.replace(/^(\d)\. /gm, (m, d) => `${Number(d) + 4}) `)), [1, 0, 2]), NUMBERED.replace("1. [[chapters/chapter-01|One]]\n2. [[chapters/chapter-02|Two]]", "5) [[chapters/chapter-02|Two]]\n6) [[chapters/chapter-01|One]]").replace("3. ", "7) "));
  assert.equal(withOrder(parseContents(INDEX), [0, 1, 2]), INDEX);
});

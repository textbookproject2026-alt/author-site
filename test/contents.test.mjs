// site/lib/contents.js on its own (no browser): the front page's Contents, reordered
// and retitled exactly as the builder will read it back (quartz-book contentsOrder).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseContents, withOrder, withLabel, retitledChapter } from "../site/lib/contents.js";

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

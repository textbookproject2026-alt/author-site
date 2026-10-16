// Drafts by chapter (site/lib/drafts.js rowsOf): which rows, in what order, what each says
// and what its one button does; the counts the tab, the summary and the rows share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REST, rowsOf, titlesFrom } from "../site/lib/drafts.js";

const INDEX = "# Book\n\n## Contents\n\n- [[chapters/chapter-01|One]]\n- [[chapters/chapter-02|Two]]\n- [[chapters/chapter-03|Three]]\n- [[chapters/chapter-04|Four]]\n";
const state = (items) => ({ items, liveIndex: INDEX, draftsIndex: INDEX, titles: titlesFrom(INDEX), texts: new Map() });

test("every chapter in Contents order, then the rest of the book; each with Review and Publish, enabled by its own data, and why not", () => {
  const { rows } = rowsOf(
    state([
      { kind: "edited", path: "chapters/chapter-03.md", title: "Three", paragraphs: 1 },
      { kind: "new", path: "chapters/Definitions/Horizon.md", title: "Horizon" },
      { kind: "front", path: "index.md", title: "Front page" },
    ]),
    [{ number: 7, path: "chapters/chapter-02.md", title: "Edit ¶2", who: "Mara" }],
    [
      { number: 8, path: "chapters/chapter-02.md", original: "", suggestion: "A note", who: "Jo" },
      { number: 9, path: "chapters/chapter-02.md", original: "old", suggestion: "new", who: "Jo" },
      { number: 10, path: "chapters/chapter-02.md", original: "", suggestion: "Done", who: "Jo", accepted: true },
      { number: 11, path: "", original: "", suggestion: "Lovely book", who: "Al" },
    ],
  );
  assert.deepEqual(rows.map((r) => [r.title, r.status, r.canReview, r.canPublish, r.why.review, r.why.publish]), [
    ["One", "Up to date", false, false, "Nothing waiting from readers", "Nothing to publish"],
    ["Two", "2 suggestions, 1 note · nothing to publish", true, false, null, "Nothing to publish"],
    ["Three", "Nothing waiting from readers · 1 paragraph edited, not live", false, true, "Nothing waiting from readers", null],
    ["Four", "Up to date", false, false, "Nothing waiting from readers", "Nothing to publish"],
    ["Rest of the book", "1 note · “Horizon” new, front page edited, not live", true, true, null, null],
  ]);
  assert.deepEqual(rows.map((r) => r.needs), [false, true, true, false, true]);
  assert.ok(!rows.flatMap((r) => r.reader).some((x) => x.number === 10), "an accepted one never appears");
  // Nothing at all: still every chapter, and the rest of the book, each up to date.
  assert.deepEqual(rowsOf(state([]), [], []).rows.map((r) => [r.title, r.status]), [["One", "Up to date"], ["Two", "Up to date"], ["Three", "Up to date"], ["Four", "Up to date"], ["Rest of the book", "Up to date"]]);
});

test("formatting problems keep Publish greyed with how many, on its row; Review is still there when readers are waiting", () => {
  const { rows } = rowsOf(
    state([{ kind: "edited", path: "chapters/chapter-01.md", title: "One" }, { kind: "edited", path: "chapters/chapter-02.md", title: "Two" }]),
    [{ number: 7, path: "chapters/chapter-02.md", title: "x", who: "M" }],
    [],
    [{ path: "chapters/chapter-01.md", line: 3 }, { path: "chapters/chapter-01.md", line: 9 }, { path: "chapters/chapter-02.md", line: 1 }, { path: ".github/x.md", line: 1 }],
  );
  assert.deepEqual(rows.filter((r) => r.needs).map((r) => [r.key, r.next, r.lint.length, r.canReview, r.canPublish, r.why.publish]), [
    ["chapters/chapter-01.md", "fix", 2, false, false, "2 problems to fix first"],
    ["chapters/chapter-02.md", "review", 1, true, false, "1 problem to fix first"],
  ]);
});

test("pictures go with the chapter whose folder they're in when it is in the drafts, else with the rest of the book", () => {
  const { rows } = rowsOf(
    state([
      { kind: "edited", path: "chapters/chapter-01.md", title: "One" },
      { kind: "pictures", files: [{ path: "assets/chapter-01/a.png", status: "added" }, { path: "assets/chapter-04/b.png", status: "added" }] },
    ]),
    [],
    [],
  );
  assert.deepEqual(rows.filter((r) => r.needs).map((r) => [r.key, r.status]), [["chapters/chapter-01.md", "Nothing waiting from readers · edited, not live"], [REST, "Nothing waiting from readers · 1 picture, not live"]]);
  assert.deepEqual(rows.find((r) => r.key === "chapters/chapter-01.md").pictures.map((f) => f.path), ["assets/chapter-01/a.png"]);
});

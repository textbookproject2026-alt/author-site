// Drafts by chapter (site/lib/drafts.js rowsOf): which rows, in what order, what each says
// and what its one button does; the counts the tab, the summary and the rows share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REST, rowsOf, titlesFrom } from "../site/lib/drafts.js";

const INDEX = "# Book\n\n## Contents\n\n- [[chapters/chapter-01|One]]\n- [[chapters/chapter-02|Two]]\n- [[chapters/chapter-03|Three]]\n- [[chapters/chapter-04|Four]]\n";
const state = (items) => ({ items, liveIndex: INDEX, draftsIndex: INDEX, titles: titlesFrom(INDEX), texts: new Map() });

test("one row per chapter needing anything, in Contents order, then the rest of the book; the others are up to date", () => {
  const { rows, upToDate } = rowsOf(
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
  assert.deepEqual(rows.map((r) => [r.key, r.title, r.status, r.next]), [
    ["chapters/chapter-02.md", "Two", "2 suggestions, 1 note", "review"],
    ["chapters/chapter-03.md", "Three", "1 paragraph edited, not live", "publish"],
    [REST, "Rest of the book", "1 note · “Horizon” new, front page edited, not live", "review"],
  ]);
  assert.equal(upToDate, 2, "chapters 1 and 4");
  assert.ok(!rows.flatMap((r) => r.reader).some((x) => x.number === 10), "an accepted one never appears");
});

test("formatting problems take Publish's place on their row; a review still comes first", () => {
  const { rows } = rowsOf(
    state([{ kind: "edited", path: "chapters/chapter-01.md", title: "One" }, { kind: "edited", path: "chapters/chapter-02.md", title: "Two" }]),
    [{ number: 7, path: "chapters/chapter-02.md", title: "x", who: "M" }],
    [],
    [{ path: "chapters/chapter-01.md", line: 3 }, { path: "chapters/chapter-01.md", line: 9 }, { path: "chapters/chapter-02.md", line: 1 }, { path: ".github/x.md", line: 1 }],
  );
  assert.deepEqual(rows.map((r) => [r.key, r.next, r.lint.length]), [["chapters/chapter-01.md", "fix", 2], ["chapters/chapter-02.md", "review", 1]]);
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
  assert.deepEqual(rows.map((r) => [r.key, r.status]), [["chapters/chapter-01.md", "edited, not live"], [REST, "1 picture, not live"]]);
  assert.deepEqual(rows[0].pictures.map((f) => f.path), ["assets/chapter-01/a.png"]);
});

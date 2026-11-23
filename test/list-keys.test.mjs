// site/lib/list-keys.js on its own (no browser): Enter, Backspace, Tab and Shift-Tab on
// nested bullet and numbered lists, and every line the key didn't touch unchanged.

import { test } from "node:test";
import assert from "node:assert/strict";
import { listKey } from "../site/lib/list-keys.js";

/** `|` marks the caret; -> the text after `key`, with `|` at the new caret (null: the box's own behaviour). */
const press = (marked, key, shift = false) => {
  const at = marked.indexOf("|");
  const r = listKey(marked.replace("|", ""), at, at, key, shift);
  return r && `${r.value.slice(0, r.caret)}|${r.value.slice(r.caret)}`;
};

const BULLETS = "Intro.\n\n- one\n- two\n  - two a\n  - two b\n- three\n\nAfter.\n";
const NUMBERS = "1. one\n2. two\n   1. two a\n   2. two b\n3. three\n";

test("Enter on an item starts the next, with the same marker and indent; numbers carry on", () => {
  assert.equal(press(BULLETS.replace("- two\n", "- two|\n"), "Enter"), "Intro.\n\n- one\n- two\n- |\n  - two a\n  - two b\n- three\n\nAfter.\n");
  assert.equal(press(BULLETS.replace("two a", "two a|"), "Enter"), "Intro.\n\n- one\n- two\n  - two a\n  - |\n  - two b\n- three\n\nAfter.\n");
  assert.equal(press(NUMBERS.replace("2. two\n", "2. two|\n"), "Enter"), "1. one\n2. two\n3. |\n   1. two a\n   2. two b\n4. three\n");
  assert.equal(press(NUMBERS.replace("two a", "two a|"), "Enter"), "1. one\n2. two\n   1. two a\n   2. |\n   3. two b\n3. three\n");
  // In the middle of an item, the rest of its words go to the new one.
  assert.equal(press("- one |two\n", "Enter"), "- one\n- |two\n");
});

test("Enter keeps a loose list loose and a Word list's spacing", () => {
  assert.equal(press("- one|\n\n- two\n", "Enter"), "- one\n\n- |\n\n- two\n");
  assert.equal(press("- one|\n\n1. a list after it\n", "Enter"), "- one\n- |\n\n1. a list after it\n", "another list after a blank line isn't this one");
  assert.equal(press("-   one|\n-   two\n", "Enter"), "-   one\n-   |\n-   two\n");
  assert.equal(press("1.  one|\n2.  two\n", "Enter"), "1.  one\n2.  |\n3.  two\n");
});

test("Tab on the first child of a numbered item starts its list at 1", () => {
  assert.equal(press("1. one\n2. |two\n3. three\n", "Tab"), "1. one\n   1. |two\n2. three\n");
});

test("Enter on an empty item ends the list", () => {
  assert.equal(press("- one\n- |\n", "Enter"), "- one\n|\n");
});

test("Backspace just after a marker takes it off; anywhere else it is the box's own", () => {
  assert.equal(press("- one\n- |two\n", "Backspace"), "- one\n|two\n");
  assert.equal(press(NUMBERS.replace("2. two\n", "2. |two\n"), "Backspace"), "1. one\n|two\n   1. two a\n   2. two b\n2. three\n");
  assert.equal(press("- one\n- t|wo\n", "Backspace"), null);
  assert.equal(press("A para|graph.\n", "Backspace"), null);
});

test("Tab moves an item in under the one above, Shift-Tab out; the first item and top level stay", () => {
  assert.equal(press(BULLETS.replace("- three", "- th|ree"), "Tab"), "Intro.\n\n- one\n- two\n  - two a\n  - two b\n  - th|ree\n\nAfter.\n");
  assert.equal(press(BULLETS.replace("  - two b", "  - two |b"), "Tab", true), "Intro.\n\n- one\n- two\n  - two a\n- two |b\n- three\n\nAfter.\n");
  assert.equal(press(NUMBERS.replace("3. three", "3. |three"), "Tab"), "1. one\n2. two\n   1. two a\n   2. two b\n   3. |three\n");
  assert.equal(press(NUMBERS.replace("   1. two a", "   1. |two a"), "Tab", true), "1. one\n2. two\n3. |two a\n   1. two b\n4. three\n");
  assert.equal(press("- |one\n- two\n", "Tab"), null, "the first item has nothing to go under");
  assert.equal(press("- |one\n", "Tab", true), null, "top level: Shift-Tab moves on from the box");
  assert.equal(press("A |paragraph.\n", "Tab"), null, "off a list, Tab moves on from the box");
});

test("a key changes only its own item and its list's numbers: every other line stays as it was", () => {
  const page = `---\ntitle: "T"\n---\n\n# T\n\n${BULLETS}\n${NUMBERS}\n* star\n* list\n`;
  const at = page.indexOf("two b") + 5;
  const r = listKey(page, at, at, "Enter");
  const before = page.split("\n");
  const after = r.value.split("\n");
  // One line added after "two b"; nothing else changed.
  const i = before.findIndex((l) => l.endsWith("two b"));
  assert.deepEqual([...after.slice(0, i + 1), ...after.slice(i + 2)], before);
  assert.equal(after[i + 1], "  - ");
});

test("a paragraph becomes an item by typing its marker, and a paragraph again with Backspace", () => {
  assert.equal(press("Para.\n\n- |Words here.\n", "Backspace"), "Para.\n\n|Words here.\n");
});

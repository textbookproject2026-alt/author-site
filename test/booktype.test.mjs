import test from "node:test";
import assert from "node:assert/strict";
import { ownType, typeOf, withType, withoutType } from "../site/lib/booktype.js";

const INDEX = "# A Book\n\nIntro.\n";

test("the book's type: index.md's book-level resource_type, else the registry's, else a book", () => {
  assert.equal(typeOf("---\nresource_type: paper\n---\n" + INDEX, "report"), "paper");
  assert.equal(typeOf('---\nresource_type: "Report" # set in Settings\n---\n' + INDEX), "report");
  assert.equal(typeOf("---\nresource_type: chapter\n---\n" + INDEX, "article"), "article");
  assert.equal(typeOf(INDEX, "poem"), "book");
  assert.equal(ownType(INDEX), "");
});

test("withType sets one line and keeps the rest; withoutType takes it out again", () => {
  const added = withType(INDEX, "paper");
  assert.equal(added, "---\nresource_type: paper\n---\n\n" + INDEX);
  assert.equal(withoutType(added), INDEX);
  const fm = "---\ntitle: A Book\nauthors:\n  - \"Ann\"\n---\n\n" + INDEX;
  assert.equal(withType(fm, "report"), "---\ntitle: A Book\nauthors:\n  - \"Ann\"\nresource_type: report\n---\n\n" + INDEX);
  assert.equal(withType(withType(fm, "report"), "book"), "---\ntitle: A Book\nauthors:\n  - \"Ann\"\nresource_type: book\n---\n\n" + INDEX);
  assert.equal(withoutType(withType(fm, "report")), fm);
  assert.equal(withType("---\r\nresource_type: book\r\n---\r\n# A\r\n", "article"), "---\r\nresource_type: article\r\n---\r\n# A\r\n");
});

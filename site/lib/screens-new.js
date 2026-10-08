// New pages, written here rather than brought in from a document (Chapters):
//   #/<book>/new/chapter   the title and where it goes in the reading order; it becomes
//                          chapters/chapter-NN.md (the next free number) with a # heading
//   #/<book>/new/concept   the title and its concept folder (one the book has, or a new
//                          one); it becomes chapters/<folder>/<title>.md
// Each is one change on the drafts, the page and its line in the front page's Contents
// together, and then the page opens in the editor.

import { h, clear, busy, note, errorNote } from "./dom.js";
import { read, send } from "./api.js";
import { bookBySlug, bookHeader } from "./books.js";
import { forgetCount } from "./drafts.js";
import { itemLine, nextChapterPath, pageFileName, parseContents, withItem } from "./contents.js";

const edit = (slug, path) => `#/${slug}/edit/${encodeURIComponent(path)}`;

/** The book's drafts, its front page and that page's Contents (one made if it has none). */
async function bookNow(slug) {
  const tree = await read("tree", { book: slug });
  const has = tree.files.some((f) => f.path === "index.md");
  const index = has ? await read("file", { book: slug, path: "index.md", ref: tree.head }) : null;
  let parsed = typeof index?.text === "string" ? parseContents(index.text) : null;
  if (parsed === null && typeof index?.text === "string") parsed = parseContents(`${index.text.trimEnd()}\n\n## Contents\n`);
  return { tree, parsed: parsed && !parsed.problem ? parsed : null, problem: parsed?.problem ?? null };
}

/** Sends the page and the Contents with it as one change, then opens the page. */
async function create(slug, now, path, title, at, stage, message) {
  const files = [{ path, text: `# ${title}\n` }];
  if (now.parsed) files.push({ path: "index.md", text: withItem(now.parsed, [itemLine(now.parsed, path, title)], at) });
  clear(stage, busy("Making the page…"));
  await send({ book: slug, base: now.tree.head, files, deletes: [], message });
  forgetCount(slug);
  location.hash = edit(slug, path);
}

function titleInput() {
  return h("input", { type: "text", id: "new-title", required: true, maxlength: 200, autocomplete: "off" });
}

export async function newChapterScreen(slug) {
  const book = await bookBySlug(slug);
  const now = await bookNow(slug);
  const stage = h("div", { "aria-live": "polite" });
  const title = titleInput();
  const items = now.parsed?.items ?? [];
  const where = h("select", { id: "new-where" },
    h("option", { value: String(items.length), text: "At the end", selected: true }),
    h("option", { value: "0", text: "At the start" }),
    items.map((it, k) => h("option", { value: String(k + 1), text: `After “${it.label || it.path}”` })));
  const out = h("div");
  const form = h("form", { novalidate: true },
    h("label", { class: "field", for: "new-title" }, "What the chapter is called", title),
    items.length ? h("label", { class: "field", for: "new-where" }, "Where it goes in the reading order", where) : null,
    now.problem ? note([h("p", { text: `${now.problem} The chapter is made all the same; put it in the Contents by hand.` })], "warn") : null,
    h("p", { class: "muted small", text: "It starts empty, with its title as the heading, and opens in the editor. Like every change, it is in your drafts until you publish." }),
    out,
    h("div", { class: "actions" }, h("button", { type: "submit", class: "btn primary", text: "Make the chapter" }), h("a", { class: "btn", href: `#/${slug}`, text: "Back to the chapters" })));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const t = title.value.replace(/\s+/g, " ").trim();
    if (!t) return clear(out, note([h("p", { text: "Give the chapter a title." })], "warn"));
    const path = nextChapterPath(now.tree.files.map((f) => f.path));
    try {
      await create(slug, now, path, t, Number(where.value), stage, `New chapter “${t}”`);
    } catch (err) {
      clear(stage, form);
      clear(out, errorNote(err));
    }
  });
  clear(stage, form);
  return [...bookHeader(book, "chapters", "New chapter"), stage];
}

export async function newConceptScreen(slug) {
  const book = await bookBySlug(slug);
  const now = await bookNow(slug);
  const stage = h("div", { "aria-live": "polite" });
  const folders = [...new Set(now.tree.files.filter((f) => /^chapters\/.+\/[^/]+\.md$/i.test(f.path)).map((f) => f.path.slice(0, f.path.lastIndexOf("/"))))].sort();
  const title = titleInput();
  const folder = h("select", { id: "new-folder" },
    folders.map((f) => h("option", { value: f, text: f.slice("chapters/".length) })),
    h("option", { value: "", text: "A new folder…", selected: !folders.length }));
  const newFolder = h("input", { type: "text", id: "new-folder-name", maxlength: 80, autocomplete: "off", value: folders.length ? "" : "Definitions" });
  const newField = h("label", { class: "field", for: "new-folder-name", hidden: Boolean(folders.length) }, "The new folder's name", newFolder);
  folder.addEventListener("change", () => { newField.hidden = folder.value !== ""; });
  const out = h("div");
  const form = h("form", { novalidate: true },
    h("label", { class: "field", for: "new-title" }, "What the concept page is called", title),
    h("label", { class: "field", for: "new-folder" }, "Its concept folder", folder),
    newField,
    h("p", { class: "muted small", text: "Concept pages are short pages for the ideas the chapters build on; Links & glossary links the chapters to them. It starts empty, with its title as the heading, goes at the end of the Contents, and opens in the editor." }),
    out,
    h("div", { class: "actions" }, h("button", { type: "submit", class: "btn primary", text: "Make the concept page" }), h("a", { class: "btn", href: `#/${slug}`, text: "Back to the chapters" })));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const t = title.value.replace(/\s+/g, " ").trim();
    const name = pageFileName(t);
    if (!name) return clear(out, note([h("p", { text: "Give the page a title." })], "warn"));
    const dir = folder.value || (pageFileName(newFolder.value) ? `chapters/${pageFileName(newFolder.value)}` : "");
    if (!dir) return clear(out, note([h("p", { text: "Give the new folder a name." })], "warn"));
    const path = `${dir}/${name}.md`;
    if (now.tree.files.some((f) => f.path.toLowerCase() === path.toLowerCase())) {
      return clear(out, note([h("p", {}, "There is already a page called that in this folder. ", h("a", { href: edit(slug, path), text: "Open it" }), ".")], "warn"));
    }
    try {
      await create(slug, now, path, t, now.parsed?.items.length ?? 0, stage, `New concept page “${t}”`);
    } catch (err) {
      clear(stage, form);
      clear(out, errorNote(err));
    }
  });
  clear(stage, form);
  return [...bookHeader(book, "chapters", "New concept page"), stage];
}

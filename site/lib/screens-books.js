// Your books, a book's chapters, and one chapter as readers will see it.

import { h, clear, busy, note, errorNote, when } from "./dom.js";
import { read, send } from "./api.js";
import { parseContents, retitledChapter, withLabel, withOrder } from "./contents.js";
import { conflictView } from "./screens-shared.js";
import { bookBySlug, bookHeader, rawUrl, myBooks, pageSlug } from "./books.js";
import { renderChapter } from "./preview.js";
import { discussionUrl, draftsPreview, registryBook } from "./public.js";

export async function booksScreen() {
  const { login, books } = await myBooks();
  if (!books.length) {
    return [
      h("h1", { text: "Your books" }),
      note([
        h("p", {}, "You're signed in as ", h("strong", { text: `@${login}` }), ", but that account isn't one of any book's authors."),
        h("p", { text: "If a book was set up for you under a different GitHub account, sign out and sign in with that one. Otherwise, ask the platform's technical contact to add this account to your book." }),
      ]),
    ];
  }
  return [
    h("h1", { text: "Your books" }),
    h("ul", { class: "list" }, books.map((b) =>
      h("li", {},
        h("div", { class: "row" },
          h("div", { class: "grow" },
            h("h2", { class: "flush" }, h("a", { href: `#/${b.slug}`, text: b.title })),
            b.status === "preview" ? h("span", { class: "badge", text: "Preview: not listed for readers" }) : null,
            b.domain ? h("p", { class: "muted small below" }, h("a", { href: `https://${b.domain}/`, target: "_blank", rel: "noopener", text: b.domain })) : null),
          h("a", { class: "btn", href: `#/${b.slug}/waiting`, text: "Waiting for you" }))))),
  ];
}

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export async function chaptersScreen(slug) {
  const book = await bookBySlug(slug);
  const [tree, reg] = await Promise.all([read("tree", { book: slug }), registryBook(slug)]);
  const pages = tree.files.filter((f) => /\.md$/i.test(f.path));
  const chapters = pages.filter((f) => /^chapters\/[^/]+$/.test(f.path)).sort((a, b) => natural.compare(a.path, b.path));
  const folders = new Map();
  for (const f of pages.filter((p) => /^chapters\/.+\/.+$/.test(p.path))) {
    const folder = f.path.slice("chapters/".length, f.path.lastIndexOf("/"));
    folders.set(folder, [...(folders.get(folder) ?? []), f]);
  }
  const top = pages.filter((f) => f.path === "index.md" || f.path === "glossary.md");
  const link = (f, label) => h("li", {}, h("a", { href: `#/${slug}/chapter/${encodeURIComponent(f.path)}`, text: label ?? f.path.split("/").pop().replace(/\.md$/i, "") }));
  const preview = draftsPreview(reg);

  return [
    ...bookHeader(book, "chapters"),
    h("div", { class: "row" },
      h("a", { class: "btn", href: book.zip, download: "", text: "Download a copy" }),
      preview ? h("a", { class: "btn", href: preview, target: "_blank", rel: "noopener", text: "See the drafts preview" }) : null,
      h("a", { class: "btn link", href: `#/${slug}/history`, text: "History" }),
      discussionUrl(reg) ? h("a", { class: "btn link", href: discussionUrl(reg), target: "_blank", rel: "noopener", text: "Reader discussion" }) : null),
    h("p", { class: "muted small", text: "Download a copy is every file of the book as the drafts area holds it, in one .zip, from GitHub." }),
    ...(await readingOrder(book, tree, chapters, link)),
    [...folders].map(([folder, list]) => [
      h("h3", { text: folder }),
      h("ul", { class: "list" }, list.sort((a, b) => natural.compare(a.path, b.path)).map((f) => link(f))),
    ]),
    top.length ? [h("h2", { text: "The rest of the book" }), h("ul", { class: "list" }, top.map((f) => link(f, f.path === "index.md" ? "Front page (index.md)" : "Glossary (glossary.md)")))] : null,
    note([
      h("p", {}, "A chapter that still lives in Word can be ", h("a", { href: `#/${slug}/import`, text: "brought in again" }), " to replace it."),
    ]),
  ];
}

/**
 * The chapters in the order readers see them: the front page's Contents (contents.js),
 * reordered by dragging or with each chapter's up and down buttons, and each one
 * retitled in place. Either is one change on the drafts area, like every other.
 * Chapters the Contents doesn't list follow, by file name.
 */
async function readingOrder(book, tree, chapters, link) {
  const plain = () => [
    h("h2", { text: "Chapters" }),
    chapters.length ? h("ul", { class: "list" }, chapters.map((f) => link(f))) : h("p", { class: "muted", text: "No chapters yet. Bring one in from a Word document." }),
  ];
  if (!tree.files.some((f) => f.path === "index.md")) return plain();
  const index = await read("file", { book: book.slug, path: "index.md", ref: tree.head });
  const parsed = typeof index.text === "string" ? parseContents(index.text) : null;
  if (!parsed || parsed.problem || !parsed.items.length) {
    return [...plain(), parsed?.problem ? note([h("p", { text: parsed.problem })]) : null];
  }
  const known = new Set(tree.files.map((f) => f.path));
  const listed = new Set(parsed.items.map((i) => i.path));
  let order = parsed.items.map((_, k) => k);
  const list = h("ol", { class: "list reorder", "aria-label": "Chapters in reading order" });
  const status = h("div", { "aria-live": "polite" });
  const save = h("button", { type: "button", class: "btn primary", text: "Save this order", hidden: true });
  const undo = h("button", { type: "button", class: "btn", text: "Put it back", hidden: true });
  const changed = () => order.some((k, i) => k !== i);

  const commit = async (files, message, done) => {
    clear(status, busy("Sending it to the drafts area…"));
    try {
      await send({ book: book.slug, base: tree.head, files, message });
      clear(status, note([h("p", { text: done })]));
      setTimeout(() => window.dispatchEvent(new HashChangeEvent("hashchange")), 1200);
    } catch (err) {
      if (err.status === 409 && err.body?.error === "conflict") {
        clear(status, conflictView(err.body.conflict), h("div", { class: "actions" },
          h("button", { type: "button", class: "btn primary", text: "Open the chapters again", onclick: () => window.dispatchEvent(new HashChangeEvent("hashchange")) })));
      } else clear(status, errorNote(err));
    }
  };

  const move = (from, to, focus) => {
    if (to < 0 || to >= order.length || from === to) return;
    const [k] = order.splice(from, 1);
    order.splice(to, 0, k);
    draw();
    if (focus) list.children[to]?.querySelector(`[data-move="${focus}"]`)?.focus();
    clear(status, h("p", { class: "muted small", text: changed() ? "Not saved yet." : "" }));
  };

  let dragging = null;
  const draw = () => {
    save.hidden = undo.hidden = !changed();
    clear(list, order.map((k, pos) => {
      const it = parsed.items[k];
      const name = it.label || it.path;
      const li = h("li", { class: "row reorder-item", draggable: "true", "data-pos": pos },
        h("span", { class: "drag-handle", "aria-hidden": "true", text: "⠿" }),
        h("div", { class: "grow" },
          it.path && known.has(it.path) ? h("a", { href: `#/${book.slug}/chapter/${encodeURIComponent(it.path)}`, text: name }) : h("span", { text: name }),
          it.path ? h("p", { class: "muted small below" }, h("code", { text: it.path })) : null),
        h("button", { type: "button", class: "btn link", "data-move": "up", "aria-label": `Move ${name} up`, text: "↑", disabled: pos === 0, onclick: () => move(pos, pos - 1, "up") }),
        h("button", { type: "button", class: "btn link", "data-move": "down", "aria-label": `Move ${name} down`, text: "↓", disabled: pos === order.length - 1, onclick: () => move(pos, pos + 1, "down") }),
        it.path && known.has(it.path) ? h("button", { type: "button", class: "btn link", text: "Rename", "aria-label": `Rename ${name}`, onclick: () => rename(li, k) }) : null);
      li.addEventListener("dragstart", (e) => {
        dragging = pos;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(pos));
        li.classList.add("dragging");
      });
      li.addEventListener("dragend", () => li.classList.remove("dragging"));
      li.addEventListener("dragover", (e) => e.preventDefault());
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = dragging ?? Number(e.dataTransfer.getData("text/plain"));
        dragging = null;
        move(from, pos);
      });
      return li;
    }));
  };

  const rename = (li, k) => {
    li.draggable = false; // so the title can be selected with the mouse
    const it = parsed.items[k];
    const input = h("input", { type: "text", id: "retitle", value: it.label ?? "", autocomplete: "off" });
    const ok = h("button", { type: "submit", class: "btn primary", text: "Save the title" });
    const form = h("form", { class: "retitle" },
      h("label", { class: "field", for: "retitle" }, "What it should be called", input),
      h("p", { class: "muted small", text: "This changes the chapter's title at the top of its page and in the Contents, in one change. Its file keeps its name, so links to it keep working." }),
      h("div", { class: "row" }, ok, h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => draw() })));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = input.value.replace(/\s+/g, " ").trim();
      if (!title) return void input.focus();
      if (changed()) return clear(status, note([h("p", { text: "Save or put back the new order first, then rename." })], "warn"));
      ok.disabled = true;
      try {
        const chapter = await read("file", { book: book.slug, path: it.path, ref: tree.head });
        await commit([
          { path: it.path, text: retitledChapter(chapter.text, title) },
          { path: "index.md", text: withLabel(parsed, k, title) },
        ], `Retitle ${it.path}: “${it.label}” → “${title}”`, `Renamed to “${title}” in the drafts area. Readers see it once the drafts are published.`);
      } catch (err) {
        ok.disabled = false;
        clear(status, errorNote(err));
      }
    });
    clear(li, form);
    input.focus();
    input.select();
  };

  save.addEventListener("click", () => commit([{ path: "index.md", text: withOrder(parsed, order) }], "Reorder the Contents",
    "The new order is in the drafts area. Readers see it once the drafts are published."));
  undo.addEventListener("click", () => {
    order = parsed.items.map((_, i) => i);
    draw();
    clear(status);
  });
  draw();
  const rest = chapters.filter((f) => !listed.has(f.path));
  return [
    h("h2", { text: "Chapters, in reading order" }),
    h("p", { class: "muted small", text: "Drag a chapter, or use its ↑ and ↓ buttons, to change the order readers see; then save it. The order is the front page's Contents." }),
    list,
    h("div", { class: "actions" }, save, undo),
    status,
    rest.length ? [h("h3", { text: "Not in the Contents" }), h("ul", { class: "list" }, rest.map((f) => link(f)))] : null,
  ];
}

export async function chapterScreen(slug, path) {
  const book = await bookBySlug(slug);
  const [tree, reg] = await Promise.all([read("tree", { book: slug }), registryBook(slug)]);
  const file = await read("file", { book: slug, path, ref: tree.head });
  const name = path.split("/").pop().replace(/\.md$/i, "");
  const known = new Set(tree.files.map((f) => f.path));
  const shown = h("div", {}, busy("Formatting the chapter…"));
  if (typeof file.text === "string") {
    renderChapter(file.text, path, async (p) => (known.has(p) ? rawUrl(book.repo, tree.head, p) : null)).then((node) => shown.replaceChildren(node));
  } else shown.replaceChildren(h("p", { class: "muted", text: "This file isn't text, so it can't be shown here." }));
  const preview = draftsPreview(reg);
  const slugPath = pageSlug(path === "index.md" ? "" : path);

  return [
    ...bookHeader(book, "chapters", name),
    h("p", { class: "muted small" }, h("code", { text: path }),
      file.last ? [" · last changed by ", h("strong", { text: file.last.who }), ` ${when(file.last.when)}`, file.last.message ? ` (“${file.last.message}”)` : ""] : null),
    h("div", { class: "row spaced" },
      typeof file.text === "string" ? h("a", { class: "btn primary", href: `#/${slug}/edit/${encodeURIComponent(path)}`, text: "Edit" }) : null,
      h("a", { class: "btn", href: `#/${slug}/history/${encodeURIComponent(path)}`, text: "History" }),
      /\.md$/i.test(path) && path.startsWith("chapters/") ? h("a", { class: "btn", href: `#/${slug}/tidy/${encodeURIComponent(path)}`, text: "Citations, concept links and glossary" }) : null,
      preview ? h("a", { class: "btn", href: `${preview}${slugPath}`, target: "_blank", rel: "noopener", text: "In the drafts preview" }) : null,
      book.domain ? h("a", { class: "btn", href: `https://${book.domain}/${slugPath}`, target: "_blank", rel: "noopener", text: "On the live site" }) : null),
    shown,
  ];
}

// Your books, and a book's Chapters: the chapters in reading order, each with where
// it stands (Published, Draft changes, New, To be removed). Reordering, retitling and
// removing happen here and are saved to the drafts as they are made, one change each;
// nothing reaches readers until Publish, under Drafts.

import { h, clear, busy, note } from "./dom.js";
import { read, send } from "./api.js";
import { itemLine, parseContents, retitledChapter, titleOf, withItem, withLabel, withOrder, withoutPath } from "./contents.js";
import { bookBySlug, bookHeader, myBooks } from "./books.js";
import { draftItems, forgetCount, titlesFrom } from "./drafts.js";
import { savedAt } from "./screens-shared.js";
import { discussionUrl, registryBook } from "./public.js";

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
            b.domain ? h("p", { class: "muted small below" }, h("a", { href: `https://${b.domain}/`, target: "_blank", rel: "noopener", text: "The book as readers see it" })) : null),
          h("a", { class: "btn", href: `#/${b.slug}/drafts`, text: "Drafts" }))))),
  ];
}

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const STATUS = { published: "Published", edited: "Draft changes", new: "New", removed: "To be removed" };
const edit = (slug, path) => `#/${slug}/edit/${encodeURIComponent(path)}`;

/**
 * The pages the book's sidebar (Quartz's explorer) shows: every .md in chapters/
 * (concept folders too), glossary.md and community/, but index.md files. The
 * builder adds any the Contents misses at its end (quartz-book completeContents,
 * the same rule), so every one of them is in the reading order here.
 */
export const isPage = (path) =>
  /\.md$/i.test(path) && !/(^|\/)index\.md$/i.test(path) && (path === "glossary.md" || /^(chapters|community)\//.test(path));

export async function chaptersScreen(slug) {
  const book = await bookBySlug(slug);
  const [tree, state, reg] = await Promise.all([read("tree", { book: slug }), draftItems(book, { texts: false }).catch(() => null), registryBook(slug)]);
  const known = new Set(tree.files.map((f) => f.path));
  const index = known.has("index.md") ? await read("file", { book: slug, path: "index.md", ref: tree.head }) : null;
  const titles = titlesFrom(state?.liveIndex, index?.text);
  const status = new Map((state?.items ?? []).filter((i) => i.path && ["new", "edited", "removed"].includes(i.kind)).map((i) => [i.path, i.kind]));
  const statusOf = (path) => status.get(path) ?? "published";
  const badge = (path) => h("span", { class: `badge status-${statusOf(path)}`, text: STATUS[statusOf(path)] });
  const removed = (state?.items ?? []).filter((i) => i.kind === "removed" && i.path.startsWith("chapters/"));

  const pages = tree.files.filter((f) => isPage(f.path)).sort((a, b) => natural.compare(a.path, b.path));
  // No Contents heading yet: one at the end of the front page, which the first save writes.
  let parsed = typeof index?.text === "string" ? parseContents(index.text) : null;
  if (parsed === null && typeof index?.text === "string" && pages.length) parsed = parseContents(`${index.text.trimEnd()}\n\n## Contents\n`);
  let usable = parsed && !parsed.problem ? parsed : null;
  // Pages the Contents doesn't list go at its end, flagged, as readers' sidebar has them.
  const listed = new Set(usable?.items.map((i) => i.path) ?? []);
  const missing = usable ? pages.filter((f) => !listed.has(f.path)) : [];
  if (missing.length) {
    const texts = await Promise.all(missing.map((f) => read("file", { book: slug, path: f.path, ref: tree.head }).then((r) => r.text, () => null)));
    missing.forEach((f, i) => {
      usable = parseContents(withItem(usable, [itemLine(usable, f.path, titleOf(texts[i]) ?? titles.get(f.path))], usable.items.length));
    });
  }
  if (usable && !usable.items.length) usable = null;
  const unlisted = usable ? [] : pages;
  // Concept folders (pages in a folder inside chapters), for the book-wide concept links.
  const folders = new Set(pages.filter((f) => f.path.startsWith("chapters/") && f.path.slice("chapters/".length).includes("/")).map((f) => f.path.slice(0, f.path.lastIndexOf("/"))));
  const pageRow = (path) => h("li", { class: "row" },
    h("a", { class: "grow", href: edit(slug, path), text: titles.get(path) }), badge(path));

  const saved = savedAt();
  return [
    ...bookHeader(book, "chapters"),
    h("div", { class: "row spaced" },
      h("a", { class: "btn primary", href: `#/${slug}/import`, text: "Bring in a document" }),
      h("a", { class: "btn", href: book.zip, download: "", text: "Download a copy" }),
      discussionUrl(reg) ? h("a", { class: "btn link", href: discussionUrl(reg), target: "_blank", rel: "noopener", text: "Reader discussion" }) : null),
    saved.node,
    usable ? readingOrder(book, tree, usable, titles, badge, saved, new Set(missing.map((f) => f.path))) : [
      h("h2", { text: "Chapters" }),
      parsed?.problem ? note([h("p", { text: parsed.problem })]) : null,
      pages.length ? null : h("p", { class: "muted", text: "No chapters yet. Bring one in from a document." }),
    ],
    removed.length ? [
      h("h3", { text: "To be removed when you publish" }),
      h("ul", { class: "list" }, removed.map((i) => h("li", { class: "row" }, h("span", { class: "grow muted", text: i.title }), badge(i.path)))),
      h("p", { class: "muted small" }, "Changed your mind? Discard it under ", h("a", { href: `#/${slug}/drafts`, text: "Drafts" }), ", or bring it back from History."),
    ] : null,
    unlisted.length ? [h("h3", { text: "Pages" }), h("ul", { class: "list" }, unlisted.map((f) => pageRow(f.path)))] : null,
    h("h2", { text: "Across the whole book" }),
    h("p", { class: "muted small", text: "The Links & glossary questions for every chapter in turn, one kind at a time. Each chapter you save becomes a change on Drafts. For one chapter, use Links & glossary in its editor." }),
    h("div", { class: "row spaced" },
      h("a", { class: "btn", href: `#/${slug}/tidy-all/glossary`, text: "Glossary terms in every chapter" }),
      folders.size
        ? h("a", { class: "btn", href: `#/${slug}/tidy-all/concepts`, text: "Concept links in every chapter" })
        : h("span", { class: "muted small", text: "Concept links: the book has no concept pages yet (bring a document into a concept folder)." })),
    h("h3", { text: "The rest of the book" }),
    h("ul", { class: "list" },
      known.has("index.md") ? pageRow("index.md") : null,
      known.has("glossary.md") && !usable ? pageRow("glossary.md") : null),
  ];
}

/**
 * The Contents (index.md's list, which the site builds its order from) as rows:
 * drag a row, or use its ↑ and ↓; Rename; Remove. Each is saved to the drafts as one
 * change, in turn (a move a second after the last one).
 */
function readingOrder(book, tree, parsed, titles, badge, saved, missing) {
  const slug = book.slug;
  let base = tree.head;
  let current = parsed;
  let order = parsed.items.map((_, k) => k);
  let queue = Promise.resolve();
  const list = h("ol", { class: "list reorder", "aria-label": "Chapters in reading order" });

  /** One change on the drafts, after any before it; the screen shows Saving… and then when. */
  const save = (files, deletes, message) => {
    queue = queue.then(async () => {
      saved.saving();
      try {
        const sent = await send({ book: slug, base, files, deletes, message });
        base = sent.sha;
        forgetCount(slug);
        saved.done();
        return true;
      } catch (err) {
        saved.failed(err, () => save(files, deletes, message));
        return false;
      }
    });
    return queue;
  };

  let moveTimer = null;
  const saveOrder = () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const text = withOrder(current, order);
      current = parseContents(text);
      order = current.items.map((_, k) => k);
      save([{ path: "index.md", text }], [], "Change the chapter order");
    }, 1000);
  };

  const move = (from, to, focus) => {
    if (to < 0 || to >= order.length || from === to) return;
    const [k] = order.splice(from, 1);
    order.splice(to, 0, k);
    draw();
    if (focus) list.children[to]?.querySelector(`[data-move="${focus}"]`)?.focus();
    saveOrder();
  };

  let dragging = null;
  const draw = () => {
    clear(list, order.map((k, pos) => {
      const it = current.items[k];
      const name = it.label || titles.get(it.path);
      const li = h("li", { class: "row reorder-item", draggable: "true" },
        h("span", { class: "drag-handle", "aria-hidden": "true", text: "⠿" }),
        h("a", { class: "grow", href: edit(slug, it.path), text: name }),
        badge(it.path),
        missing.has(it.path) ? h("span", { class: "badge status-missing", text: "Not in the Contents" }) : null,
        h("button", { type: "button", class: "btn link", "data-move": "up", "aria-label": `Move ${name} up`, text: "↑", disabled: pos === 0, onclick: () => move(pos, pos - 1, "up") }),
        h("button", { type: "button", class: "btn link", "data-move": "down", "aria-label": `Move ${name} down`, text: "↓", disabled: pos === order.length - 1, onclick: () => move(pos, pos + 1, "down") }),
        h("button", { type: "button", class: "btn link", text: "Rename", "aria-label": `Rename ${name}`, onclick: () => rename(li, k) }),
        // The glossary is where the glossary questions write: renamed, never removed here.
        it.path === "glossary.md" ? null : h("button", { type: "button", class: "btn link danger", text: "Remove", "aria-label": `Remove ${name}`, onclick: () => remove(li, k) }));
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

  /** Pending moves go first, so what follows is made on the order the author sees. */
  const flush = async () => {
    if (!moveTimer) return;
    clearTimeout(moveTimer);
    moveTimer = null;
    if (order.some((k, i) => k !== i)) {
      const text = withOrder(current, order);
      current = parseContents(text);
      order = current.items.map((_, k) => k);
      await save([{ path: "index.md", text }], [], "Change the chapter order");
    }
  };
  const reload = () => window.dispatchEvent(new HashChangeEvent("hashchange"));

  const rename = (li, k) => {
    li.draggable = false; // so the title can be selected with the mouse
    const it = current.items[k];
    const input = h("input", { type: "text", id: "retitle", value: it.label ?? "", autocomplete: "off" });
    const form = h("form", { class: "retitle" },
      h("label", { class: "field", for: "retitle" }, "What it should be called", input),
      h("p", { class: "muted small", text: "This changes the chapter's title at the top of its page and in the reading order. Links to it keep working." }),
      h("div", { class: "row" }, h("button", { type: "submit", class: "btn primary", text: "Save the title" }), h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => draw() })));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const title = input.value.replace(/\s+/g, " ").trim();
      if (!title) return void input.focus();
      form.querySelector("button[type=submit]").disabled = true;
      await flush();
      try {
        const chapter = await read("file", { book: slug, path: it.path, ref: base });
        const pos = current.items.findIndex((x) => x.path === it.path);
        if (await save([{ path: it.path, text: retitledChapter(chapter.text, title) }, { path: "index.md", text: withLabel(current, pos, title) }], [], `Retitle “${it.label}” as “${title}”`)) reload();
      } catch (err) {
        saved.failed(err);
      }
    });
    clear(li, form);
    input.focus();
    input.select();
  };

  const remove = (li, k) => {
    li.draggable = false;
    const it = current.items[k];
    const name = it.label || titles.get(it.path);
    const yes = h("button", { type: "button", class: "btn danger-solid", text: `Remove “${name}”` });
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      await flush();
      if (await save([{ path: "index.md", text: withoutPath(current, it.path) }], [it.path], `Remove “${name}”`)) reload();
    });
    clear(li, h("div", { class: "grow confirm-remove", role: "alertdialog", "aria-label": `Remove ${name}?` },
      h("p", {}, h("strong", { text: `Remove “${name}” from the book?` })),
      h("p", { class: "muted small", text: "It comes out of the drafts now. Readers keep it until you publish, and you can bring it back from History (or Discard it under Drafts) at any time." }),
      h("div", { class: "row" }, yes, h("button", { type: "button", class: "btn", text: "Keep it", onclick: () => draw() }))));
    yes.focus();
  };

  // Saving the order as it stands writes the flagged pages into the Contents where they are.
  const addMissing = missing.size
    ? note([
      h("p", { text: `${missing.size === 1 ? "One page isn't" : `${missing.size} pages aren't`} in the front page's Contents (flagged below). Readers find ${missing.size === 1 ? "it" : "them"} at the end of the book's sidebar and Contents. Move ${missing.size === 1 ? "it" : "one"} where it belongs, or add ${missing.size === 1 ? "it" : "them"} at the end as ${missing.size === 1 ? "it is" : "they are"}.` }),
      h("button", { type: "button", class: "btn", text: "Add to the Contents", onclick: async (e) => {
        e.target.disabled = true;
        clearTimeout(moveTimer);
        moveTimer = null;
        const text = withOrder(current, order);
        if (await save([{ path: "index.md", text }], [], "Add the missing pages to the Contents")) reload();
      } }),
    ])
    : null;
  draw();
  return [
    h("h2", { text: "Chapters, in reading order" }),
    h("p", { class: "muted small", text: "Drag a chapter, or use ↑ and ↓, to change the order. Every change is saved to the drafts as you make it; readers see it when you publish." }),
    addMissing,
    list,
  ];
}

/** Old links (#/<book>/chapter/<path>) open the chapter in the editor. */
export const chapterScreen = (slug, path) => {
  location.replace(edit(slug, path));
  return busy("Opening the chapter…");
};

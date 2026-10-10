// Bringing a document in: a Word document (.docx, .doc), an OpenDocument text (.odt)
// or a Rich Text file (.rtf). book-requests' private import-chapter workflow turns
// anything but .docx into .docx (LibreOffice) and converts it with the desktop app's
// own converter (convert.py, contents.py). The author sees the chapter as it will be,
// then adds it to the drafts as a new chapter (the next chapter-NN, in the reading
// order) or in place of the chapter it was before; uploads of the same document in
// the book go in the same change. Readers see it when the author publishes.
//
//   choose  -> upload (parts) -> converting (poll) -> look at it -> add -> done
//                                     ^                              |
//                                     +---- convert again <----------+ (drafts moved)

import { h, clear, busy, note, errorNote, when, plural } from "./dom.js";
import { importStart, importAgain, importStatus, read, send } from "./api.js";
import { bookBySlug, bookHeader, rawUrl } from "./books.js";
import { renderChapter } from "./preview.js";
import { ACCEPT, fileProblem, uploadParts } from "./upload.js";
import { lintPage } from "./lint.js";
import { forgetCount } from "./drafts.js";

const POLL_MS = 3000;
const GIVE_UP_MS = 6 * 60 * 1000;

/** The document's own name as a page name, for a folder that keeps names (convert.suggest_name). */
const suggestName = (file) => (file.replace(/\.(docx|doc|odt|rtf)$/i, "").trim().replace(/^\.+|\.+$/g, "").replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "Untitled page");

let folders = [];

export async function importScreen(slug) {
  const book = await bookBySlug(slug);
  const tree = await read("tree", { book: slug });
  // Folders inside chapters (concept pages, say): a document can go there under a name of the author's choosing.
  folders = [...new Set(tree.files.filter((f) => /^chapters\/.+\/[^/]+\.md$/i.test(f.path)).map((f) => f.path.slice(0, f.path.lastIndexOf("/"))))].sort();
  const stage = h("div", { "aria-live": "polite" });
  choose(book, stage);
  return [...bookHeader(book, "chapters", "Bring in a document"), stage];
}

function choose(book, stage, problem) {
  const input = h("input", { type: "file", accept: ACCEPT, id: "docx" });
  const said = h("div");
  const where = h("select", { id: "where" },
    h("option", { value: "chapters", text: "A chapter of the book" }),
    folders.map((f) => h("option", { value: f, text: `A page in ${f.slice("chapters/".length)}` })));
  const name = h("input", { type: "text", id: "chapter-name", autocomplete: "off" });
  const nameField = h("label", { class: "field", hidden: true }, "What the page should be called", name);
  const syncName = () => {
    nameField.hidden = where.value === "chapters";
    if (!nameField.hidden && !name.value && input.files[0]) name.value = suggestName(input.files[0].name);
  };
  where.addEventListener("change", syncName);
  input.addEventListener("change", () => {
    const p = fileProblem(input.files[0]);
    clear(said, p ? note([h("p", { text: p })], "warn") : null);
    name.value = "";
    syncName();
  });
  const form = h("form", { novalidate: true },
    h("p", { text: "Choose the document. You'll see the whole chapter as readers will, and anything worth checking, before it goes into your drafts. Your document itself is never changed." }),
    h("label", { class: "file-drop" }, h("span", { class: "sr-only", text: "Document" }), input),
    h("p", { class: "muted small", text: "Word (.docx or .doc), OpenDocument (.odt) or Rich Text (.rtf), up to 20 MB. A document you brought in before replaces the chapter it became." }),
    folders.length ? h("label", { class: "field" }, "Where it goes", where) : null,
    nameField,
    said,
    problem ? errorNote(problem) : null,
    h("div", { class: "actions" }, h("button", { type: "submit", class: "btn primary", text: "Convert it" }), h("a", { class: "btn", href: `#/${book.slug}`, text: "Back to the chapters" })));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const file = input.files[0];
    const p = fileProblem(file);
    if (p) return clear(said, note([h("p", { text: p })], "warn"));
    if (!nameField.hidden && !name.value.trim()) return clear(said, note([h("p", { text: "Please give the page a name." })], "warn"));
    await upload(book, stage, file, where.value, nameField.hidden ? null : name.value.trim());
  });
  clear(stage, form);
}

async function upload(book, stage, file, folder = "chapters", chapterName = null) {
  const bar = h("span");
  bar.style.width = "0%";
  clear(stage, h("p", { class: "busy", text: "Uploading your document…" }), h("div", { class: "progress", role: "progressbar", "aria-label": "Upload" }, bar));
  let started;
  try {
    const receipts = await uploadParts(book.slug, file, (f) => {
      bar.style.width = `${Math.round(f * 100)}%`;
    });
    clear(stage, busy("Starting the conversion…"));
    started = await importStart({ book: book.slug, name: file.name, parts: receipts, folder, chapterName });
  } catch (err) {
    return choose(book, stage, err);
  }
  await wait(book, stage, started.id);
}

/** Polls until this attempt of the import is converted (or failed). */
async function wait(book, stage, id) {
  const began = Date.now();
  clear(stage, busy("Converting your document… This usually takes about a minute (two for a .doc, .odt or .rtf)."));
  for (;;) {
    let s;
    try {
      s = await importStatus(book.slug, id);
    } catch (err) {
      return choose(book, stage, err);
    }
    if (s.state === "done") return review(book, stage, id, s);
    if (s.state === "failed") return choose(book, stage, { userMessage: s.error });
    if (Date.now() - began > GIVE_UP_MS) {
      return choose(book, stage, { userMessage: "The conversion is taking much longer than it should. Nothing has changed in your book. Please try again; if it happens again, tell the platform's technical contact." });
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const picked = new Map(); // staged picture path -> blob URL, for this page's life

async function review(book, stage, id, s) {
  const { result, chapter } = s;
  const c = result.chapter;
  const staged = new Set(result.writes.filter((w) => w.kind === "picture").map((w) => w.path));
  const pictureUrl = async (p) => {
    if (staged.has(p)) {
      const key = `${id}:${s.attempt}:${p}`;
      if (!picked.has(key)) {
        const { base64 } = await importStatus(book.slug, id, p).catch(() => ({ base64: null }));
        if (!base64) return null;
        const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
        picked.set(key, URL.createObjectURL(new Blob([bytes], { type: /\.svg$/i.test(p) ? "image/svg+xml" : "" })));
      }
      return picked.get(key);
    }
    return p.startsWith(`${c.media_dir}/`) ? rawUrl(book.repo, result.base, p) : null;
  };
  const title = c.title || "the chapter";
  const out = h("div", { class: "outcome", "aria-live": "polite" });
  const nothing = !result.writes.length && !result.deletes.length;
  const add = h("button", { type: "button", class: "btn primary", text: c.new ? `Add “${title}” to the drafts` : `Replace “${title}” in the drafts` });
  add.addEventListener("click", async () => {
    add.disabled = true;
    clear(out, busy("Adding it to the drafts…"));
    try {
      // What the book's formatting rules can put right is put right on the way in; the
      // rest shows in the editor and on Drafts.
      const fixed = await lintPage(book, result.base, c.path, chapter.text).catch(() => null);
      const files = fixed && fixed.text !== chapter.text ? [{ path: c.path, text: fixed.text }] : undefined;
      await send({ book: book.slug, base: result.base, import: id, files, replace: !c.new || undefined, message: c.new ? `Bring in “${title}”` : `Bring in “${title}” again` });
      forgetCount(book.slug);
      clear(stage,
        h("h2", { class: "flush-top", text: c.new ? `“${title}” is in the drafts` : `“${title}” was replaced in the drafts` }),
        h("p", { text: !c.path.slice("chapters/".length).includes("/") ? (c.new ? "It is at the end of the reading order; move it on Chapters if it belongs elsewhere." : "Its place in the reading order is unchanged.") : "It is listed on Chapters under its folder." }),
        fixed?.problems.length ? note([h("p", { text: `${plural(fixed.problems.length, "formatting thing")} to put right before you publish: the editor lists ${fixed.problems.length === 1 ? "it" : "them"}, with the line.` })], "warn") : null,
        h("p", { class: "muted", text: "Readers see it when you publish, from Drafts." }),
        h("div", { class: "actions" },
          h("a", { class: "btn primary", href: `#/${book.slug}/tidy/${encodeURIComponent(c.path)}`, text: "Links & glossary for it now" }),
          h("a", { class: "btn", href: `#/${book.slug}/edit/${encodeURIComponent(c.path)}`, text: "Open it in the editor" }),
          h("a", { class: "btn", href: `#/${book.slug}`, text: "Back to the chapters" })));
    } catch (err) {
      if (err.status === 409 && (err.body?.error === "conflict" || err.body?.error === "import base")) {
        const again = h("button", { type: "button", class: "btn primary", text: "Convert it again" });
        again.addEventListener("click", async () => {
          again.disabled = true;
          try {
            await importAgain(book.slug, id);
            await wait(book, stage, id);
          } catch (e) {
            clear(out, errorNote(e));
          }
        });
        clear(out, note([h("p", { text: "Nothing was added: the drafts changed while this was converting. Your document is kept. Convert it again and it is checked against the drafts as they are now." })], "warn"), h("div", { class: "actions" }, again));
      } else {
        clear(out, errorNote(err));
        add.disabled = false;
      }
    }
  });

  const shown = h("div", {}, busy("Formatting the chapter…"));
  renderChapter(chapter.text, c.path, pictureUrl).then((node) => shown.replaceChildren(node));
  const report = result.report ?? [];
  const counts = result.counts ?? {};
  const tables = (counts.pipe_tables ?? 0) + (counts.html_tables ?? 0);
  const summary = [
    counts.words ? plural(counts.words, "word") : null,
    counts.headings ? plural(counts.headings, "heading") : null,
    tables ? plural(tables, "table") : null,
    counts.footnotes ? plural(counts.footnotes, "footnote") : null,
    counts.pictures ? plural(counts.pictures, "picture") : null,
  ].filter(Boolean);
  const LEVEL = { ok: "ok", look: "look", warn: "warn" };
  const gone = (result.removed_pictures ?? []).length;

  clear(stage,
    h("h2", { class: "flush-top", text: c.new ? `A new chapter: “${title}”` : `It replaces “${title}”` }),
    summary.length ? h("p", { text: `A chapter of ${summary.join(", ")}.` }) : null,
    !c.new && c.replaces ? note([
      h("p", {}, "The drafts already have this chapter",
        c.replaces.who ? [", last changed by ", h("strong", { text: c.replaces.who }), c.replaces.when ? ` ${when(c.replaces.when)}` : ""] : null,
        ". ", c.replaces.lines_differ ? `${plural(c.replaces.lines_differ.removed, "line")} would go and ${plural(c.replaces.lines_differ.added, "line")} would come in.` : ""),
      gone ? h("p", { text: `${plural(gone, "picture")} no longer in the document ${gone === 1 ? "goes" : "go"} too.` }) : null,
    ], "warn") : null,
    (result.removed_word_files ?? []).length ? h("p", { class: "muted", text: "Copies of this document that were uploaded into the book come out in the same change: readers never see documents, only chapters." }) : null,
    h("h3", { text: "What to check" }),
    report.length
      ? h("ul", { class: "report" }, report.map((n) => h("li", { class: `level-${LEVEL[n.level] ?? "look"}` },
        h("span", { class: `badge level-${LEVEL[n.level] ?? "look"}`, text: LEVEL[n.level] ?? "look" }), " ",
        h("strong", { text: n.headline }), n.body ? h("div", { text: n.body }) : null,
        n.check ? h("div", { class: "muted small" }, h("strong", { text: "What to check: " }), n.check) : null)))
      : h("p", { class: "muted", text: "Nothing in this document needs checking." }),
    h("h3", { text: "The chapter, as it will be" }),
    shown,
    nothing ? note([h("p", { text: "The drafts already have exactly this, so there is nothing to add." })])
      : h("div", { class: "actions" }, add, h("button", { type: "button", class: "btn", text: "Start again", onclick: () => choose(book, stage) })),
    out);
}

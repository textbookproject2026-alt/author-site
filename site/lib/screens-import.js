// Bringing a Word document in. The conversion is the desktop app's own (convert.py,
// contents.py), run by book-requests' private import-chapter workflow; nothing reaches
// the book until the author has read the whole converted chapter and pressed Send.
//
//   choose  -> upload (parts) -> converting (poll) -> read it -> send -> done
//                                     ^                         |
//                                     +---- convert again <-----+ (drafts moved)

import { h, clear, busy, note, errorNote, when, plural } from "./dom.js";
import { read, send, importStart, importAgain, importStatus } from "./api.js";
import { bookBySlug, bookHeader, rawUrl } from "./books.js";
import { renderChapter } from "./preview.js";
import { fileProblem, uploadParts } from "./upload.js";
import { conflictView, sentView } from "./screens-shared.js";

const POLL_MS = 3000;
const GIVE_UP_MS = 6 * 60 * 1000;

const HOW = {
  new: "It's a Word file this book hasn't seen, so it becomes the next free chapter number.",
  recorded: "This Word file became this chapter last time, so bringing it in again replaces that chapter.",
  existing: "A chapter already has this Word file's name (the book went live before the chapter-NN rule), so it is replaced and keeps its name.",
};

/** Word's name for the file, as a chapter name outside chapters/ (convert.suggest_name). */
const suggestName = (docx) => (docx.replace(/\.docx$/i, "").trim().replace(/^\.+|\.+$/g, "").replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "Untitled chapter");

export async function importScreen(slug) {
  const book = await bookBySlug(slug);
  const tree = await read("tree", { book: slug });
  const folders = [...new Set(tree.files
    .filter((f) => /^chapters\/.+\/[^/]+\.md$/i.test(f.path))
    .map((f) => f.path.slice(0, f.path.lastIndexOf("/"))))].sort();
  const stage = h("div", { "aria-live": "polite" });
  const root = [...bookHeader(book, "import", "Bring in a Word document"), stage];
  choose(book, folders, stage);
  return root;
}

function choose(book, folders, stage, problem) {
  const input = h("input", { type: "file", accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document", id: "docx" });
  const where = h("select", { id: "where" },
    h("option", { value: "chapters", text: "chapters: a chapter (named chapter-01, chapter-02…)" }),
    folders.map((f) => h("option", { value: f, text: `${f}: keeps a name you choose` })));
  const name = h("input", { type: "text", id: "chapter-name", autocomplete: "off" });
  const nameField = h("label", { class: "field", hidden: true }, "What it should be called", name);
  const said = h("div");
  const go = h("button", { type: "submit", class: "btn primary", text: "Convert it" });
  const syncName = () => {
    nameField.hidden = where.value === "chapters";
    if (!nameField.hidden && !name.value && input.files[0]) name.value = suggestName(input.files[0].name);
  };
  where.addEventListener("change", syncName);
  input.addEventListener("change", () => {
    clear(said);
    name.value = "";
    syncName();
    const p = fileProblem(input.files[0]);
    if (p) clear(said, note([h("p", { text: p })], "warn"));
  });
  const form = h("form", { novalidate: true },
    h("p", { text: "Choose the Word document. You'll see the whole converted chapter, and a list of anything worth checking, before anything reaches your book. Your Word document is never changed." }),
    h("label", { class: "file-drop" }, h("span", { class: "sr-only", text: "Word document" }), input),
    h("p", { class: "muted small", text: "A .docx, up to 20 MB." }),
    folders.length ? h("label", { class: "field" }, "Where it goes", where) : null,
    nameField,
    said,
    problem ? errorNote(problem) : null,
    h("div", { class: "actions" }, go));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const file = input.files[0];
    const p = fileProblem(file);
    if (p) return clear(said, note([h("p", { text: p })], "warn"));
    if (!nameField.hidden && !name.value.trim()) return clear(said, note([h("p", { text: "Please give the chapter a name." })], "warn"));
    await upload(book, folders, stage, file, where.value, nameField.hidden ? null : name.value.trim());
  });
  clear(stage, form);
}

async function upload(book, folders, stage, file, folder, chapterName) {
  const bar = h("span");
  bar.style.width = "0%";
  clear(stage, h("p", { class: "busy", text: `Uploading ${file.name}…` }), h("div", { class: "progress", role: "progressbar", "aria-label": "Upload" }, bar));
  let started;
  try {
    const receipts = await uploadParts(file, (f) => {
      bar.style.width = `${Math.round(f * 100)}%`;
    });
    clear(stage, busy("Starting the conversion…"));
    started = await importStart({ book: book.slug, name: file.name, parts: receipts, folder, chapterName });
  } catch (err) {
    return choose(book, folders, stage, err);
  }
  await wait(book, folders, stage, started.id, file.name);
}

/** Polls until this attempt of the import is converted (or failed). */
async function wait(book, folders, stage, id, docxName) {
  const began = Date.now();
  clear(stage, busy(`Converting ${docxName}… This usually takes about a minute.`));
  for (;;) {
    let s;
    try {
      s = await importStatus(book.slug, id);
    } catch (err) {
      return choose(book, folders, stage, err);
    }
    if (s.state === "done") return review(book, folders, stage, id, docxName, s);
    if (s.state === "failed") return choose(book, folders, stage, { userMessage: s.error });
    if (Date.now() - began > GIVE_UP_MS) {
      return choose(book, folders, stage, { userMessage: "The conversion is taking much longer than it should. Nothing has changed in your book. Please try again; if it happens again, tell the platform's technical contact." });
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

const picked = new Map(); // staged picture path -> blob URL, for this page's life

async function review(book, folders, stage, id, docxName, s) {
  const { result, chapter } = s;
  const c = result.chapter;
  const staged = new Set(result.writes.filter((w) => w.kind === "picture").map((w) => w.path));
  const raw = (p) => rawUrl(book.repo, result.base, p);
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
    return p.startsWith(`${c.media_dir}/`) ? raw(p) : null;
  };

  const read_ = h("input", { type: "checkbox", id: "read-it" });
  const replaceTick = h("input", { type: "checkbox", id: "replace-it" });
  const sendBtn = h("button", { type: "button", class: "btn primary", text: "Send to drafts", disabled: true });
  const sync = () => {
    sendBtn.disabled = !read_.checked || (!c.new && !replaceTick.checked) || !result.writes.length && !result.deletes.length;
  };
  read_.addEventListener("change", sync);
  replaceTick.addEventListener("change", sync);
  const out = h("div", { class: "outcome", "aria-live": "polite" });
  const confirmBox = h("div", {},
    h("p", { class: "muted small", text: "The drafts area isn't what readers see. It goes to them when you publish, under Waiting for you." }),
    h("div", { class: "actions" }, sendBtn, h("button", { type: "button", class: "btn", text: "Start again", onclick: () => choose(book, folders, stage) })));

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
  const pictures = result.writes.filter((w) => w.kind === "picture");

  sendBtn.addEventListener("click", async () => {
    sendBtn.disabled = true;
    clear(out, busy("Sending it to the drafts area…"));
    try {
      const sent = await send({ book: book.slug, base: result.base, import: id, replace: !c.new || undefined, message: `Bring in ${c.path.split("/").pop()} from Word (“${docxName}”)` });
      clear(stage, ...sentView(book, sent, c.new ? "The chapter is in the drafts area" : "The chapter was replaced in the drafts area",
        [c.new && result.contents_line ? "Its line is on the front page, under “Contents”." : null],
        h("a", { class: "btn primary", href: `#/${book.slug}/tidy/${encodeURIComponent(c.path)}`, text: "Go through this chapter now" })));
    } catch (err) {
      if (err.status === 409 && (err.body?.error === "conflict" || err.body?.error === "import base")) {
        const again = h("button", { type: "button", class: "btn primary", text: "Convert it again" });
        again.addEventListener("click", async () => {
          again.disabled = true;
          try {
            await importAgain(book.slug, id);
            await wait(book, folders, stage, id, docxName);
          } catch (e) {
            clear(out, errorNote(e));
          }
        });
        confirmBox.hidden = true;
        clear(out, conflictView(err.body.conflict), note([h("p", { text: "Your Word document is kept. Convert it again and it is checked against the drafts area as it is now; then read it and send it." })]), h("div", { class: "actions" }, again));
        out.scrollIntoView({ block: "start" });
      } else {
        clear(out, errorNote(err));
        sync();
      }
    }
  });

  clear(stage,
    h("h2", { class: "flush-top", text: c.new ? `It becomes ${c.path}` : `It replaces ${c.path}` }),
    c.how && HOW[c.how] ? h("p", { class: "muted", text: HOW[c.how] }) : null,
    !c.new && c.replaces ? note([
      h("p", {}, "The drafts area already has this chapter",
        c.replaces.who ? [", last changed by ", h("strong", { text: c.replaces.who }), c.replaces.when ? ` ${when(c.replaces.when)}` : "", c.replaces.message ? ` (“${c.replaces.message}”)` : ""] : null,
        ". ", c.replaces.lines_differ ? `${plural(c.replaces.lines_differ.removed, "line")} would go and ${plural(c.replaces.lines_differ.added, "line")} would come in.` : ""),
      result.removed_pictures?.length ? h("p", {}, "These pictures are no longer in the Word document, so they are taken out: ", result.removed_pictures.join(", "), ".") : null,
    ], "warn") : null,
    result.contents_line ? h("p", {}, "A line is added to the front page, under “Contents”: ", h("code", { text: result.contents_line })) : null,
    (result.notes ?? []).map((n) => h("p", { class: "muted", text: n })),
    pictures.length ? h("p", { class: "muted small", text: `${plural(pictures.length, "picture")} ${pictures.length === 1 ? "goes" : "go"} into ${c.media_dir}/.` }) : null,
    summary.length ? h("p", {}, h("code", { text: docxName }), ` became a chapter of ${summary.join(", ")}.`) : null,
    h("h3", { text: "What to check" }),
    report.length
      ? h("ul", { class: "report" }, report.map((n) => h("li", { class: `level-${LEVEL[n.level] ?? "look"}` },
        h("span", { class: `badge level-${LEVEL[n.level] ?? "look"}`, text: LEVEL[n.level] ?? "look" }), " ",
        h("strong", { text: n.headline }), n.body ? h("div", { text: n.body }) : null,
        n.check ? h("div", { class: "muted small" }, h("strong", { text: "What to check: " }), n.check) : null)))
      : h("p", { class: "muted", text: "Nothing in this document needs checking." }),
    h("h3", { text: "The chapter, as it will be" }),
    shown,
    !result.writes.length && !result.deletes.length ? note([h("p", { text: "The drafts area already has exactly this, so there is nothing to send." })]) : [
      h("label", { class: "confirm" }, read_, h("span", { text: "I've read the converted chapter and want it in the drafts area." })),
      c.new ? null : h("label", { class: "confirm" }, replaceTick, h("span", { text: `Replace the ${c.path} that is there now.` })),
    ],
    confirmBox,
    out);
  sync();
}

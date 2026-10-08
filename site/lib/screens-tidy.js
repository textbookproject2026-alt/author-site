// Links & glossary: the link and glossary questions, as the desktop app asked them: citations linked to
// the chapter's own reference list, mentions of concept pages linked to them, and terms
// worth a glossary entry, one question at a time; then exactly what will change; then
// one change on the drafts, made by the author, which Drafts lists like any other.
// The questions themselves are the app's own Python (python.js); this file only asks
// and shows.
//
// Book-wide (#/<book>/tidy-all/<glossary|concepts>[/<n>], from Chapters): the same
// questions for one kind of thing, chapter by chapter in reading order, each chapter
// saved as its own change before the next is read (so each sees the glossary as the
// one before left it).

import { forgetCount, rawText, titlesFrom } from "./drafts.js";
import { h, clear, busy, note, errorNote, plural } from "./dom.js";
import { read, send } from "./api.js";
import { bookBySlug, bookHeader, rawUrl } from "./books.js";
import { parseContents } from "./contents.js";
import { analyse, changes } from "./python.js";
import { deepseekKey } from "./deepseek.js";
import { conflictView, sentView } from "./screens-shared.js";

const CONCEPT_FOLDERS = /(^|\/)(definitions|concepts|terms|glossary terms|key concepts)(\/|$)/i;

/** git's blob id for bytes: a file from GitHub is only used if it is the one the drafts name. */
async function blobSha(bytes) {
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  const d = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The drafts as the session needs them: the snapshot, and the bytes of every page it
 * may read (the chapter, glossaries, and the pages in a concept folder), from GitHub's
 * public copy at the drafts commit, each checked against the drafts' own blob id.
 */
async function snapshot(book) {
  const tree = await read("tree", { book: book.slug });
  const files = Object.fromEntries(tree.files.map((f) => [f.path, f.sha]));
  const wanted = tree.files.filter((f) => /\.md$/i.test(f.path) && (f.path.startsWith("chapters/") || /(^|\/)glossary\.md$/.test(f.path)));
  const blobs = {};
  await Promise.all(wanted.map(async (f) => {
    const url = rawUrl(book.repo, tree.head, f.path);
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) throw Object.assign(new Error("raw"), { userMessage: "A page of the book couldn't be read from GitHub just now. Please try again." });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if ((await blobSha(bytes)) !== f.sha) throw Object.assign(new Error("sha"), { userMessage: "The book changed while it was being read. Please try again." });
    blobs[f.sha] = bytes;
  }));
  return { snap: { head: tree.head, tree: null, files }, blobs, hasConcepts: tree.files.some((f) => CONCEPT_FOLDERS.test(f.path)) };
}

// ponytail: llm.py and formatting.py speak of the Mac's key; the few sentences that do
// are reworded here rather than forked. Add a case if the converter adds one.
const inBrowser = (note) => note.replace(/ on this Mac/g, " in this browser").replace(/ by running Setup again/g, " in Settings");

/** The book-wide run in progress, or null for one chapter: { kind, n, total, next, name }. */
let tour = null;
let name = "";
const tourNext = () => h("a", { class: "btn primary", href: tour.next, text: tour.n + 1 < tour.total ? "Next chapter" : "Finish" });

export async function tidyScreen(slug, path) {
  tour = null;
  const book = await bookBySlug(slug);
  const stage = h("div", { "aria-live": "polite" });
  name = titlesFrom(await rawText(book.repo, book.drafts_branch, "index.md").catch(() => null)).get(path, await rawText(book.repo, book.drafts_branch, path).catch(() => null));
  options(book, path, stage);
  return [...bookHeader(book, "chapters", `Links & glossary: “${name}”`), stage];
}

/** The chapters a book-wide run goes through: reading order, then the rest; never the concept pages themselves. */
async function chaptersInOrder(book) {
  const tree = await read("tree", { book: book.slug });
  const known = new Set(tree.files.map((f) => f.path));
  const index = known.has("index.md") ? await read("file", { book: book.slug, path: "index.md", ref: tree.head }) : null;
  const parsed = typeof index?.text === "string" ? parseContents(index.text) : null;
  const ok = (p) => p && known.has(p) && /^chapters\/.+\.md$/i.test(p) && !CONCEPT_FOLDERS.test(p);
  const listed = (parsed && !parsed.problem ? parsed.items.map((i) => i.path) : []).filter(ok);
  const rest = tree.files.map((f) => f.path).filter((p) => ok(p) && !listed.includes(p) && !p.slice("chapters/".length).includes("/")).sort();
  return { paths: [...new Set([...listed, ...rest])], titles: titlesFrom(index?.text), hasConcepts: tree.files.some((f) => CONCEPT_FOLDERS.test(f.path)) };
}

const KINDS = {
  glossary: { title: "Glossary terms in every chapter", analyses: ["glossary"] },
  concepts: { title: "Concept links in every chapter", analyses: ["terms"] },
};

export async function tidyAllScreen(slug, kind, n = 0) {
  const book = await bookBySlug(slug);
  const k = KINDS[kind];
  const { paths, titles, hasConcepts } = await chaptersInOrder(book);
  const header = bookHeader(book, "chapters", k.title);
  const stop = h("a", { class: "btn link", href: `#/${slug}`, text: "Stop and go back to the chapters" });
  if (kind === "concepts" && !hasConcepts) {
    return [...header, note([h("p", { text: "This book has no concept pages yet, so there is nothing to link to. Bring a document into the concept folder (Bring in a document › Where it goes), then come back." })]), stop];
  }
  if (n >= paths.length) {
    tour = null;
    return [...header, note([h("p", { text: `Done: every chapter has been through. Each one you saved is on Drafts, ready to publish.` })]),
      h("div", { class: "actions" }, h("a", { class: "btn primary", href: `#/${slug}/drafts`, text: "Drafts" }), h("a", { class: "btn", href: `#/${slug}`, text: "Back to the chapters" }))];
  }
  const path = paths[n];
  name = titles.get(path, await rawText(book.repo, book.drafts_branch, path).catch(() => null));
  tour = { kind, n, total: paths.length, next: `#/${slug}/tidy-all/${kind}/${n + 1}` };
  const stage = h("div", { "aria-live": "polite" });
  run(book, path, stage, { analyses: k.analyses, first_mention_only: true, anchor_style: "obsidian", use_deepseek: kind === "glossary" && Boolean(deepseekKey()) });
  return [...header,
    h("p", { class: "muted" }, `Chapter ${n + 1} of ${paths.length}: `, h("strong", { text: `“${name}”` })),
    h("div", { class: "row spaced" }, h("a", { class: "btn", href: tour.next, text: "Skip this chapter" }), stop),
    stage];
}

function options(book, path, stage, problem) {
  const box = (id, checked, strong, rest) => h("label", { class: "confirm" }, h("input", { type: "checkbox", id, checked }), h("span", {}, h("strong", { text: strong }), ` — ${rest}`));
  const refs = box("opt-references", true, "Citations", "find mentions such as “(Bhaskar, 1975)” and link them to the matching entry in the chapter's reference list.");
  const terms = box("opt-terms", true, "Concept pages", "find where the chapter mentions one of your concept pages and link to it.");
  const gloss = box("opt-glossary", true, "Glossary terms", "find terms worth adding to your glossary.");
  // The DeepSeek checks, as the app offered them: only with the author's own key.
  const key = Boolean(deepseekKey());
  const keyState = (on, off) => h("em", { class: "muted" }, " ", key ? on : [off, " ", h("a", { href: "#/settings", text: "Add one in Settings" }), ". Everything else works without it."]);
  const format = box("opt-format", false, "AI formatting check", "ask DeepSeek to check this chapter against the book's formatting rules, and offer each fix for you to say yes or no to. Formatting only: a proposed change that would alter your wording is thrown away, and you are told.");
  format.querySelector("input").disabled = !key;
  format.querySelector("span").append(keyState("Uses the DeepSeek key kept in this browser.", "This needs a DeepSeek key, and none is kept in this browser, so it is turned off."));
  const deepseek = box("opt-deepseek", false, "DeepSeek", "also ask it for glossary suggestions.");
  deepseek.querySelector("input").disabled = !key;
  deepseek.querySelector("span").append(keyState("A key is kept in this browser.", "No key is kept in this browser, so this is turned off."));
  const first = box("opt-first", true, "Only the first mention", "of each concept in the chapter is offered. If you say “yes to every mention” for a term, every mention is linked anyway.");
  const anchor = (value, text, checked) => h("label", { class: "confirm" }, h("input", { type: "radio", name: "anchor", value, checked }), h("span", { text }));
  const go = h("button", { type: "submit", class: "btn primary", text: "Look through this chapter" });
  const form = h("form", {},
    h("p", { text: "One question at a time: each shows the sentence and the change. Nothing reaches the book until you've seen every change together and pressed Save to drafts." }),
    h("h2", { text: "What should it look for?" }), refs, terms, gloss, format,
    h("details", {}, h("summary", { text: "A few more choices" }), first, deepseek,
      h("p", { class: "muted", text: "How should citation links work?" }),
      anchor("obsidian", "Mark each entry in the reference list and link straight to it (recommended). A short tag such as ^bhaskar-1975 goes at the end of the entry; the book's website follows these links.", true),
      anchor("html", "Put a plain web anchor in front of each entry instead, for exporting the chapter with pandoc.", false)),
    problem ? errorNote(problem) : null,
    h("div", { class: "actions" }, go, h("a", { class: "btn link", href: `#/${book.slug}/edit/${encodeURIComponent(path)}`, text: "Back to the chapter" })));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const analyses = [["opt-references", "references"], ["opt-terms", "terms"], ["opt-glossary", "glossary"], ["opt-format", "format"]]
      .filter(([id]) => form.querySelector(`#${id}`).checked).map(([, a]) => a);
    if (!analyses.length) return;
    const opts = { analyses, first_mention_only: form.querySelector("#opt-first").checked, anchor_style: form.querySelector('input[name="anchor"]:checked').value,
      use_deepseek: form.querySelector("#opt-deepseek").checked };
    await run(book, path, stage, opts);
  });
  clear(stage, form);
}

async function run(book, path, stage, opts, keep) {
  const status = busy("Reading the chapter from the drafts area…");
  clear(stage, status);
  const say = (t) => clear(status, t);
  let snap, result;
  try {
    const got = await snapshot(book);
    snap = got.snap;
    if (!snap.files[path]) throw Object.assign(new Error("gone"), { userMessage: "That chapter isn't in the drafts area any more." });
    result = await analyse(snap, got.blobs, path, opts, say);
  } catch (err) {
    if (tour) return clear(stage, errorNote(err), h("div", { class: "actions" }, tourNext()));
    return options(book, path, stage, err);
  }
  const state = keep ?? { index: 0, decisions: {}, groupRule: {}, expand: [] };
  // Book-wide: a chapter with nothing to ask about is passed by.
  if (tour && !result.findings.length) return void location.replace(tour.next);
  // Nothing to ask, or the author's choices carried over after the drafts moved on
  // (the chapter and glossary unchanged): straight to what will change.
  if (!result.findings.length || keep) return preview(book, path, stage, opts, result, state, snap);
  question(book, path, stage, opts, result, state, snap);
}

function question(book, path, stage, opts, result, state, snap) {
  const { findings } = result;
  const f = findings[state.index];
  const total = findings.length;
  const bar = h("span");
  bar.style.width = `${Math.round((state.index / total) * 100)}%`;
  let explain = f.explain;
  if (f.occurrence_total > 1) explain += f.kind === "format" ? ` This is fix ${f.occurrence} of ${f.occurrence_total} under this rule.` : ` This is mention ${f.occurrence} of ${f.occurrence_total} in the chapter.`;
  const label = f.kind === "reference" || f.kind === "format" ? f.group_label : `“${f.group_label}”`;
  const noun = f.kind === "format" ? "formatting fix under rule" : "mention of";
  const many = f.occurrence_total > 1 || f.kind === "term";

  const answer = (value, all) => {
    if (all) {
      state.groupRule[f.group] = value ? "yes" : "no";
      for (const g of findings) if (g.group === f.group) state.decisions[g.id] = value;
      if (f.kind === "term") state.expand = value ? [...new Set([...state.expand, f.group_label])] : state.expand.filter((t) => t !== f.group_label);
    } else state.decisions[f.id] = value;
    let i = state.index + 1;
    while (i < total && state.groupRule[findings[i].group]) i++;
    if (i >= total) return preview(book, path, stage, opts, result, state, snap);
    state.index = i;
    question(book, path, stage, opts, result, state, snap);
  };
  const back = () => {
    let i = state.index - 1;
    while (i > 0 && state.groupRule[findings[i].group]) i--;
    if (i < 0) return;
    state.index = i;
    question(book, path, stage, opts, result, state, snap);
  };
  const btn = (text, cls, fn) => h("button", { type: "button", class: `btn ${cls}`.trim(), text, onclick: fn });

  clear(stage,
    h("div", { class: "row" }, h("span", { class: "muted", text: `${state.index + 1} of ${total}` }), h("div", { class: "progress grow", "aria-hidden": "true" }, bar)),
    h("h2", { text: f.title }),
    h("p", { text: explain }),
    h("div", { class: "card" },
      f.line_no ? h("p", { class: "muted small", text: `In your chapter, line ${f.line_no}` }) : null,
      h("p", { class: "sentence" }, f.before, h("mark", { text: f.match }), f.after)),
    f.kind === "glossary" ? null : h("div", { class: "card" },
      h("p", { class: "muted small", text: "After the change" }),
      h("p", { class: "sentence" }, f.before, h("mark", { class: "new", text: f.becomes }), f.after)),
    f.detail ? h("div", { class: "card" }, h("p", { class: "muted small", text: f.detail_label ?? "" }), h("p", { text: f.detail })) : null,
    h("div", { class: "actions" }, btn("Yes, make this change", "primary", () => answer(true, false)), btn("No, leave it alone", "", () => answer(false, false))),
    many ? h("div", { class: "actions" }, btn(`Yes to every ${noun} ${label}`, "", () => answer(true, true)), btn(`No to every ${noun} ${label}`, "", () => answer(false, true))) : null,
    h("div", { class: "actions" },
      state.index > 0 ? btn("Go back one", "link", back) : null,
      btn("Stop here and see what I have chosen", "link", () => preview(book, path, stage, opts, result, state, snap))));
  stage.querySelector("h2")?.focus?.();
}

async function preview(book, path, stage, opts, result, state, snap) {
  clear(stage, busy("Putting your chapter together…"));
  const accepted = Object.keys(state.decisions).filter((id) => state.decisions[id]);
  let out;
  try {
    out = await changes(accepted, state.expand);
  } catch (err) {
    return options(book, path, stage, err);
  }
  const p = out.preview;
  const c = p.counts;
  const bits = [
    c.references ? `${plural(c.references, "citation")} linked` : null,
    c.terms ? `${plural(c.terms, "mention")} linked to concept pages` : null,
    c.expanded ? `every mention of ${plural(c.expanded, "term")} linked` : null,
    c.glossary ? `${c.glossary} glossary ${c.glossary === 1 ? "entry" : "entries"} added` : null,
    c.format ? `${c.format} formatting ${c.format === 1 ? "fix" : "fixes"}` : null,
  ].filter(Boolean);
  const nothing = !p.diff.length && !p.glossary_added.length;
  const notes = [...result.warnings, ...result.notes, ...(p.format_skipped ?? []).map((n) =>
    `The formatting fix for line ${n} was left out, because you chose another change on the same line. Run the formatting check again after sending.`)].map(inBrowser);
  const tick = h("input", { type: "checkbox", id: "tidy-confirm" });
  const go = h("button", { type: "button", class: "btn primary", text: "Save to drafts", disabled: true });
  tick.addEventListener("change", () => { go.disabled = !tick.checked; });
  const outcome = h("div", { class: "outcome", "aria-live": "polite" });

  go.addEventListener("click", async () => {
    go.disabled = true;
    clear(outcome, busy("Saving it to the drafts…"));
    const what = [c.references ? "citations" : null, c.terms || c.expanded ? "concept links" : null, c.glossary ? "glossary" : null, c.format ? "formatting" : null].filter(Boolean);
    try {
      const sent = await send({
        book: book.slug, base: snap.head,
        files: Object.entries(out.files).map(([file, text]) => ({ path: file, text })),
        message: `Links & glossary for “${name}”: ${what.join(", ") || "links"}`,
      });
      forgetCount(book.slug);
      if (tour) return clear(stage, note([h("p", { text: `Saved to the drafts: “${name}”.` })]), h("div", { class: "actions" }, tourNext()));
      clear(stage, ...sentView(book, sent, "Saved to the drafts", [], h("a", { class: "btn primary", href: `#/${book.slug}/edit/${encodeURIComponent(path)}`, text: "Back to the chapter" })));
    } catch (err) {
      if (err.status !== 409 || err.body?.error !== "conflict") {
        clear(outcome, errorNote(err));
        go.disabled = !tick.checked;
        return;
      }
      // As the app: if this chapter and its glossary are as they were, the same
      // choices still hold and are offered again; if not, the chapter is read afresh.
      const moved = new Set((err.body.conflict?.files ?? []).map((f) => f.path));
      const same = !moved.has(path) && !moved.has(result.glossary_path);
      const again = h("button", { type: "button", class: "btn primary", text: same ? "Look at the changes again" : "Read the chapter again" });
      again.addEventListener("click", () => run(book, path, stage, opts, same ? { ...state } : undefined));
      clear(outcome, conflictView(err.body.conflict),
        note([h("p", { text: same
          ? "This chapter and the glossary are as they were, so your choices still stand. Look at the changes once more, then send them again."
          : "This chapter or the glossary changed in the drafts area while you were working, so it has to be read again and gone through again." })]),
        h("div", { class: "actions" }, again));
      outcome.scrollIntoView({ block: "start" });
    }
  });

  const glossaryAfter = p.glossary_after?.split("\n") ?? [];
  clear(stage,
    h("h2", { class: "flush-top", text: result.findings.length ? "Here is exactly what will change" : "Nothing needs changing" }),
    nothing
      ? note([h("p", { text: result.findings.length ? "You did not choose any changes, so there is nothing to send." : "The whole chapter was read and nothing needs changing. Everything that could be linked is already linked." })])
      : h("p", { text: `You chose: ${bits.join(", ")}. ${plural(p.diff.length, "line")} of the chapter will change. Every other line stays exactly as it is.` }),
    notes.length ? [h("h3", { text: "Also worth knowing" }), h("ul", {}, notes.map((n) => h("li", { text: n })))] : null,
    nothing ? null : [
      h("h3", { text: "Your chapter" }),
      p.diff.length ? p.diff.map((d) => h("div", { class: "card" },
        h("p", { class: "muted small", text: `Line ${d.line_no}` }),
        h("p", { class: "prose-change before" }, h("span", { class: "sr-only", text: "Before: " }), d.before),
        h("p", { class: "prose-change after" }, h("span", { class: "sr-only", text: "After: " }), d.after)))
        : h("p", { class: "muted", text: "No lines of the chapter itself will change." }),
      p.glossary_added.length ? [
        h("h3", { text: "Your glossary" }),
        h("p", { class: "muted small", text: p.glossary_exists ? "Into the book's glossary." : "Into a new glossary for the book." }),
        p.glossary_added.map((term) => {
          const i = glossaryAfter.findIndex((l) => l.trim() === `## ${term}`);
          const def = i >= 0 ? (glossaryAfter.slice(i + 1, i + 4).find((l) => l.trim()) ?? "") : "";
          return h("div", { class: "card" }, h("strong", { text: term }), h("div", { text: def.trim() }));
        }),
      ] : null,
      note([h("p", { text: "When you press Save to drafts, these changes go to the drafts as one change of their own, made by you. Only the lines shown above change. If anything else changed the drafts area while you were looking, nothing is saved and you are shown it." })]),
      h("label", { class: "confirm" }, tick, h("span", { text: "I have read the changes above and I want to send them to the drafts area." })),
    ],
    h("div", { class: "actions" },
      nothing ? null : go,
      result.findings.length ? h("button", { type: "button", class: "btn", text: "Go back to the questions", onclick: () => {
        state.index = Math.min(state.index, result.findings.length - 1);
        question(book, path, stage, opts, result, state, snap);
      } }) : null,
      tour ? tourNext() : h("a", { class: "btn link", href: `#/${book.slug}/edit/${encodeURIComponent(path)}`, text: "Back to the chapter" })),
    outcome);
}

// The link and glossary questions, as the desktop app asked them: citations linked to
// the chapter's own reference list, mentions of concept pages linked to them, and terms
// worth a glossary entry, one question at a time; then exactly what will change; then
// one change on the drafts area, made by the author. The questions themselves are the
// app's own Python (python.js); this file only asks and shows.

import { h, clear, busy, note, errorNote, plural } from "./dom.js";
import { read, send } from "./api.js";
import { bookBySlug, bookHeader, rawUrl } from "./books.js";
import { analyse, changes } from "./python.js";
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

export async function tidyScreen(slug, path) {
  const book = await bookBySlug(slug);
  const stage = h("div", { "aria-live": "polite" });
  options(book, path, stage);
  return [...bookHeader(book, "chapters", `Citations, concept links and glossary: ${path.split("/").pop().replace(/\.md$/i, "")}`), stage];
}

function options(book, path, stage, problem) {
  const box = (id, checked, strong, rest) => h("label", { class: "confirm" }, h("input", { type: "checkbox", id, checked }), h("span", {}, h("strong", { text: strong }), ` — ${rest}`));
  const refs = box("opt-references", true, "Citations", "find mentions such as “(Bhaskar, 1975)” and link them to the matching entry in the chapter's reference list.");
  const terms = box("opt-terms", true, "Concept pages", "find where the chapter mentions one of your concept pages and link to it.");
  const gloss = box("opt-glossary", true, "Glossary terms", "find terms worth adding to your glossary.");
  const first = box("opt-first", true, "Only the first mention", "of each concept in the chapter is offered. If you say “yes to every mention” for a term, every mention is linked anyway.");
  const anchor = (value, text, checked) => h("label", { class: "confirm" }, h("input", { type: "radio", name: "anchor", value, checked }), h("span", { text }));
  const go = h("button", { type: "submit", class: "btn primary", text: "Look through this chapter" });
  const form = h("form", {},
    h("p", { text: "One question at a time: each shows the sentence and the change. Nothing reaches the book until you've seen every change together and pressed Send." }),
    h("h2", { text: "What should it look for?" }), refs, terms, gloss,
    h("details", {}, h("summary", { text: "A few more choices" }), first,
      h("p", { class: "muted", text: "How should citation links work?" }),
      anchor("obsidian", "Mark each entry in the reference list and link straight to it (recommended). A short tag such as ^bhaskar-1975 goes at the end of the entry; the book's website follows these links.", true),
      anchor("html", "Put a plain web anchor in front of each entry instead, for exporting the chapter with pandoc.", false)),
    problem ? errorNote(problem) : null,
    h("div", { class: "actions" }, go, h("a", { class: "btn link", href: `#/${book.slug}/chapter/${encodeURIComponent(path)}`, text: "Back to the chapter" })));
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const analyses = [["opt-references", "references"], ["opt-terms", "terms"], ["opt-glossary", "glossary"]]
      .filter(([id]) => form.querySelector(`#${id}`).checked).map(([, a]) => a);
    if (!analyses.length) return;
    const opts = { analyses, first_mention_only: form.querySelector("#opt-first").checked, anchor_style: form.querySelector('input[name="anchor"]:checked').value };
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
    return options(book, path, stage, err);
  }
  const state = keep ?? { index: 0, decisions: {}, groupRule: {}, expand: [] };
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
  if (f.occurrence_total > 1) explain += ` This is mention ${f.occurrence} of ${f.occurrence_total} in the chapter.`;
  const label = f.kind === "reference" ? f.group_label : `“${f.group_label}”`;
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
    many ? h("div", { class: "actions" }, btn(`Yes to every mention of ${label}`, "", () => answer(true, true)), btn(`No to every mention of ${label}`, "", () => answer(false, true))) : null,
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
  ].filter(Boolean);
  const nothing = !p.diff.length && !p.glossary_added.length;
  const notes = [...result.warnings, ...result.notes];
  const tick = h("input", { type: "checkbox", id: "tidy-confirm" });
  const go = h("button", { type: "button", class: "btn primary", text: "Send to drafts", disabled: true });
  tick.addEventListener("change", () => { go.disabled = !tick.checked; });
  const outcome = h("div", { class: "outcome", "aria-live": "polite" });

  go.addEventListener("click", async () => {
    go.disabled = true;
    clear(outcome, busy("Sending it to the drafts area…"));
    const what = [c.references ? "citations" : null, c.terms || c.expanded ? "concept links" : null, c.glossary ? "glossary" : null].filter(Boolean);
    try {
      const sent = await send({
        book: book.slug, base: snap.head,
        files: Object.entries(out.files).map(([file, text]) => ({ path: file, text })),
        message: `Tidy ${path.split("/").pop()}: ${what.join(", ") || "links"}`,
      });
      clear(stage, ...sentView(book, sent, "Sent to the drafts area"));
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
        h("p", { class: "muted small", text: `${p.glossary_path}${p.glossary_exists ? "" : " (this file will be created)"}` }),
        p.glossary_added.map((term) => {
          const i = glossaryAfter.findIndex((l) => l.trim() === `## ${term}`);
          const def = i >= 0 ? (glossaryAfter.slice(i + 1, i + 4).find((l) => l.trim()) ?? "") : "";
          return h("div", { class: "card" }, h("strong", { text: term }), h("div", { text: def.trim() }));
        }),
      ] : null,
      note([h("p", { text: "When you press Send, these changes go to the drafts area as one change of their own, made by you. Only the lines shown above change. If anything else changed the drafts area while you were looking, nothing is sent and you are shown it." })]),
      h("label", { class: "confirm" }, tick, h("span", { text: "I have read the changes above and I want to send them to the drafts area." })),
    ],
    h("div", { class: "actions" },
      nothing ? null : go,
      result.findings.length ? h("button", { type: "button", class: "btn", text: "Go back to the questions", onclick: () => {
        state.index = Math.min(state.index, result.findings.length - 1);
        question(book, path, stage, opts, result, state, snap);
      } }) : null,
      h("a", { class: "btn link", href: `#/${book.slug}/chapter/${encodeURIComponent(path)}`, text: "Back to the chapter" })),
    outcome);
}

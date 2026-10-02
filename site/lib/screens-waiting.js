// Waiting for you: what readers and contributors have sent in, and the way to the
// live book. The desktop app's console, with its wording and its rules: a reply says
// the chapter changed only when a commit holds the change; accepting puts work in the
// drafts area and no further; publishing is its own deliberate press.

import { h, clear, busy, note, errorNote, when, plural } from "./dom.js";
import { read, act, send } from "./api.js";
import { bookBySlug, bookHeader, pageSlug } from "./books.js";
import { sentView } from "./screens-shared.js";
import { PREVIEW_WORDS, discussionUrl, historyUrl, jobs, previewState, registryBook } from "./public.js";

/** A button that runs `fn`, showing progress and then what happened in `out`. */
function doButton(text, cls, out, fn) {
  const b = h("button", { type: "button", class: `btn ${cls}`.trim(), text });
  b.addEventListener("click", async () => {
    b.disabled = true;
    clear(out, busy("Working…"));
    try {
      await fn(b);
    } catch (err) {
      clear(out, errorNote(err));
      b.disabled = false;
    }
  });
  return b;
}

const done = (res, back) => [
  h("ul", { class: "steps" }, (res.steps ?? []).map((s) => h("li", { text: s }))),
  res.warning ? note([h("p", { text: res.warning })], "warn") : null,
  back ? h("p", {}, h("a", { href: back, text: "Back to Waiting for you" })) : null,
];

/** The drafts commit and its time, from GitHub's public API (for the preview check). */
async function draftsHead(book) {
  try {
    const r = await fetch(`https://api.github.com/repos/${book.repo}/commits/${encodeURIComponent(book.drafts_branch)}`);
    if (!r.ok) return null;
    const c = await r.json();
    return { sha: c.sha, when: c.commit?.committer?.date ?? c.commit?.author?.date };
  } catch {
    return null;
  }
}

function publishCard(book, p, out) {
  if (!p) return h("div", { class: "card" }, h("p", { text: "The live book already has everything in the drafts area." }));
  if (!p.open) {
    return h("div", { class: "card" },
      h("p", { text: p.state_words }),
      h("div", { class: "actions" }, doButton("Put it in line", "", out, async () => {
        const res = await act(book.slug, "publish-prepare");
        clear(out, ...done(res));
        location.hash = `#/${book.slug}/publish`;
      })));
  }
  return h("div", { class: "card" },
    h("p", {}, `${plural(p.change_count, "change")} to ${plural(p.page_count, "page")}`, p.who.length ? `, by ${p.who.join(", ")}` : "", ", waiting to go to readers."),
    h("p", { class: "muted", text: p.state_words }),
    h("div", { class: "actions" }, h("a", { class: "btn primary", href: `#/${book.slug}/publish`, text: "Look at it, and publish" })));
}

export async function waitingScreen(slug) {
  const book = await bookBySlug(slug);
  const out = h("div", { "aria-live": "polite" });
  const [sug, chg, pub, reg] = await Promise.all([
    read("suggestions", { book: slug }).catch((e) => ({ error: e })),
    read("changes", { book: slug }).catch((e) => ({ error: e })),
    read("publish", { book: slug }).catch((e) => ({ error: e })),
    registryBook(slug),
  ]);

  // The public parts load on their own and never hold the page up.
  const previewLine = h("p", { class: "muted" });
  const jobsBox = h("div", {}, busy("Checking the automatic jobs…"));
  if (reg) {
    draftsHead(book).then((head) => previewState(reg, head?.sha, head?.when)).then((p) => {
      if (!p) return previewLine.remove();
      const words = PREVIEW_WORDS[p.state === "stale" && !p.hasBuild ? "stale_none" : p.state];
      const link = p.state === "current" ? "See the drafts" : p.state === "unknown" || (p.state === "stale" && p.hasBuild) ? "See the drafts as the preview last showed them" : null;
      clear(previewLine, words, link ? [" ", h("a", { href: p.url, target: "_blank", rel: "noopener", text: link })] : null);
    });
    jobs(reg).then((list) => {
      if (!list) return clear(jobsBox, h("p", { class: "muted", text: "GitHub couldn't be asked about them just now." }));
      if (!list.length) return clear(jobsBox, h("p", { class: "muted", text: "This book has none." }));
      clear(jobsBox, h("ul", { class: "list" }, list.map((j) => h("li", { class: "row" },
        h("span", { class: "grow", text: j.name }),
        j.state === "ok" ? h("span", { class: "muted", text: `Finished properly ${when(j.when)}` })
          : j.state === "failed" ? h("span", { class: "error" }, "Did not finish ", when(j.when), " · ", h("a", { href: j.url, target: "_blank", rel: "noopener", text: "details" }))
            : h("span", { class: "muted", text: "Hasn't run yet" })))),
      h("p", { class: "muted small", text: "Nothing to do here. If one says it did not finish, tell the technical contact." }));
    });
  } else {
    previewLine.remove();
    clear(jobsBox, h("p", { class: "muted", text: "The list of textbooks couldn't be read just now." }));
  }

  const section = (title, body) => [h("h2", { text: title }), body];
  return [
    ...bookHeader(book, "waiting", "Waiting for you"),
    out,
    section("Suggestions from readers", sug.error ? errorNote(sug.error) : sug.suggestions.length
      ? h("ul", { class: "list" }, sug.suggestions.map((s) => h("li", {},
        h("div", { class: "row" },
          h("a", { class: "grow", href: `#/${slug}/suggestion/${s.number}` }, h("strong", { text: s.page }), ` — from ${s.who}, ${when(s.when)}`),
          s.accepted ? h("span", { class: "badge accepted", text: "Accepted" }) : null),
        h("div", { class: "muted small", text: s.suggestion.length > 160 ? `${s.suggestion.slice(0, 160)}…` : s.suggestion }))))
      : h("p", { class: "muted", text: "None waiting." })),
    section("Draft changes", chg.error ? errorNote(chg.error) : chg.changes.length
      ? [h("p", { class: "muted small", text: "Written in the book's site with Edit this page. Nothing here has reached readers." }),
        h("ul", { class: "list" }, chg.changes.map((c) => h("li", {}, h("a", { href: `#/${slug}/change/${c.number}`, text: c.title }), ` — ${c.who}, ${when(c.when)}`)))]
      : h("p", { class: "muted", text: "None waiting." })),
    section("Going live", pub.error ? errorNote(pub.error) : publishCard(book, pub.publish, out)),
    previewLine,
    section("The automatic jobs", jobsBox),
    h("h2", { text: "Discussion and history" }),
    h("p", {},
      discussionUrl(reg) ? [h("a", { href: discussionUrl(reg), target: "_blank", rel: "noopener", text: "Reader discussion" }), " — every comment left in the margins of the book. "] : null,
      h("a", { href: historyUrl({ content: { repo: book.repo, live_branch: book.live_branch } }), target: "_blank", rel: "noopener", text: "History" }), " — what changed, when, and by whom."),
  ];
}

export async function suggestionScreen(slug, number) {
  const book = await bookBySlug(slug);
  const { suggestions } = await read("suggestions", { book: slug });
  const s = suggestions.find((x) => x.number === number);
  const back = `#/${slug}/waiting`;
  if (!s) return [...bookHeader(book, "waiting", "A suggestion from a reader"), note([h("p", { text: "This suggestion has already been dealt with." })]), h("p", {}, h("a", { href: back, text: "Back to Waiting for you" }))];
  const out = h("div", { "aria-live": "polite" });
  const onSite = book.domain && s.path ? `https://${book.domain}/${pageSlug(s.path)}` : null;

  // A reader who wrote an exact replacement ("X" should be "Y") may have it made for
  // them, as in the app: console.py decides, on the chapter as drafts holds it, and
  // only if the old wording is there exactly once. Worth asking only when there are quotes.
  const exact = !s.accepted && /\.md$/i.test(s.path) && /["“'][^"”']{2,}["”']/.test(s.suggestion)
    ? exactReplacement(book, s, out, () => actions.remove()) : null;

  let actions;
  if (!s.accepted) {
    actions = h("div", { class: "actions" },
      doButton("Accept: I'll make the change", "primary", out, async () => {
        clear(out, ...done(await act(slug, "suggestion-accept", { number }), back));
        actions.remove();
      }),
      doButton("Decline, politely", "", out, async () => {
        clear(out, ...done(await act(slug, "suggestion-decline", { number }), back));
        actions.remove();
      }),
      h("a", { class: "btn link", href: s.url, target: "_blank", rel: "noopener", text: "Open on GitHub" }));
  } else {
    actions = h("div", { class: "actions" },
      doButton("I've made the change", "primary", out, async () => {
        const { page, changes } = await read("suggestion-changes", { book: slug, number: String(number) });
        const newest = changes[0];
        if (!newest) {
          clear(out, note([h("p", { text: `Nothing has changed ${page} in the drafts area since you accepted this, so there is no change to show the reader yet. Make the change, then press this again.` })], "warn"));
          return;
        }
        const confirm = doButton("Yes: thank the reader with a link to it", "primary", out, async () => {
          clear(out, ...done(await act(slug, "suggestion-made", { number, sha: newest.sha }), back));
          actions.remove();
        });
        clear(out, h("div", { class: "card" },
          h("p", {}, "The latest change to ", h("strong", { text: page }), " in the drafts area: ",
            h("a", { href: newest.url, target: "_blank", rel: "noopener", text: newest.message || "a change" }), ` — ${newest.who}, ${when(newest.when)}.`),
          h("p", { text: "Is that the change the reader asked for? The reader is sent a link to it, and the suggestion is closed." }),
          h("div", { class: "actions" }, confirm)));
      }),
      h("a", { class: "btn link", href: s.url, target: "_blank", rel: "noopener", text: "Open on GitHub" }));
  }

  return [
    ...bookHeader(book, "waiting", "A suggestion from a reader"),
    h("p", { class: "muted" }, "From ", h("strong", { text: s.who }), `, ${when(s.when)}, about `,
      onSite ? h("a", { href: onSite, target: "_blank", rel: "noopener", text: s.page }) : s.page, ".",
      s.accepted ? [" ", h("span", { class: "badge accepted", text: "Accepted" })] : null),
    h("h2", { text: "What they suggest" }),
    h("blockquote", { class: "said", text: s.suggestion || "(nothing written)" }),
    s.reasoning ? [h("h3", { text: "Why" }), h("blockquote", { class: "said", text: s.reasoning })] : null,
    s.accepted
      ? note([h("p", { text: "You've taken this on, and the reader has been thanked. Once the change is in the drafts area (from Edit this page, say, once you've accepted it here), press “I've made the change”." })])
      : note([h("p", { text: "Accepting means you're taking it on: the reader is thanked and told you'll make the change, and the suggestion stays here, marked Accepted, until you have. Declining sends a courteous reply saying the text is staying as it is." })]),
    exact,
    actions,
    out,
  ];
}

/** "Can it be made for you?": the exact replacement, worked out and shown before it is made. */
function exactReplacement(book, s, out, onMade) {
  const box = h("div", { class: "card" }, h("p", {}, h("strong", { text: "This reader wrote an exact replacement." }), " The author site can look for it in the chapter and, if the wording is there exactly once, make the change for you: only that one line changes."));
  const look = doButton("Look for it", "", out, async () => {
    clear(out, busy("Getting the checker ready. The first time takes a little while…"));
    const tree = await read("tree", { book: book.slug });
    if (!tree.files.some((f) => f.path === s.path)) {
      clear(out);
      box.append(note([h("p", { text: `The page “${s.page}” is not in the drafts area, so it can't be looked at.` })], "warn"));
      look.remove();
      return;
    }
    const file = await read("file", { book: book.slug, path: s.path, ref: tree.head });
    const { planSuggestion } = await import("./python.js");
    const plan = await planSuggestion(file.text, s.path, s.suggestion, (t) => clear(out, busy(t)));
    clear(out);
    look.remove();
    if (!plan.can_apply || !plan.new_text) {
      box.append(note([h("p", { text: plan.why || plan.reason })], "warn"), h("p", { class: "muted", text: "It's yours to make by hand, then: accept it below." }));
      return;
    }
    const make = doButton("Make this change and thank the reader", "primary", out, async () => {
      const sent = await send({ book: book.slug, base: tree.head, suggestion: s.number, files: [{ path: s.path, text: plan.new_text }] });
      box.replaceWith(h("div", {}, ...sentView(book, sent, "Changed, and the reader thanked")));
      clear(out);
      onMade();
    });
    box.append(
      h("p", { class: "muted small", text: `Line ${plan.line_no} of ${s.path}` }),
      h("p", { class: "prose-change before" }, h("span", { class: "sr-only", text: "Before: " }), plan.before),
      h("p", { class: "prose-change after" }, h("span", { class: "sr-only", text: "After: " }), plan.after),
      h("p", { class: "muted small", text: "It goes to the drafts area as one change made by you; the reader is sent a link to it and the suggestion is closed. If the drafts area changed meanwhile, nothing is sent." }),
      h("div", { class: "actions" }, make));
  });
  box.append(h("div", { class: "actions" }, look));
  return box;
}

export async function changeScreen(slug, number) {
  const book = await bookBySlug(slug);
  const back = `#/${slug}/waiting`;
  const [{ changes }, detail] = await Promise.all([read("changes", { book: slug }), read("change", { book: slug, number: String(number) })]);
  const c = changes.find((x) => x.number === number);
  if (!c) return [...bookHeader(book, "waiting", "A draft change"), note([h("p", { text: "This change has already been accepted or closed." })]), h("p", {}, h("a", { href: back, text: "Back to Waiting for you" }))];
  const out = h("div", { "aria-live": "polite" });
  const actions = h("div", { class: "actions" },
    doButton("Accept this change", "primary", out, async () => {
      clear(out, ...done(await act(slug, "change-accept", { number, title: c.title }), back));
      actions.remove();
    }),
    doButton("Decline it", "", out, async () => {
      clear(out, ...done(await act(slug, "change-decline", { number }), back));
      actions.remove();
    }),
    h("a", { class: "btn link", href: c.url, target: "_blank", rel: "noopener", text: "Open on GitHub" }));

  return [
    ...bookHeader(book, "waiting", c.title),
    h("p", { class: "muted" }, "Proposed by ", h("strong", { text: c.who }), `, ${when(c.when)}. Nothing here has reached readers.`),
    detail.readable
      ? detail.pages.map((p) => [
        h("h2", { text: p.page }),
        p.lines.map((l) => h("p", { class: `prose-change ${l.kind}` }, h("span", { class: "sr-only", text: l.kind === "before" ? "Before: " : "After: " }), l.text || " ")),
      ])
      : [note([h("p", { text: detail.why })]), h("ul", {}, detail.pages.map((p) => h("li", { text: `${p.page}: ${p.added} added, ${p.removed} removed` })))],
    note([h("p", { text: "Accepting folds it into the drafts area and puts the drafts in line for the live book. It reaches no reader until you publish." })]),
    actions,
    out,
  ];
}

export async function publishScreen(slug) {
  const book = await bookBySlug(slug);
  const { publish: p } = await read("publish", { book: slug });
  const back = `#/${slug}/waiting`;
  const header = bookHeader(book, "waiting", "Send the drafts to the live book");
  if (!p || !p.open) {
    return [...header, publishCard(book, p, h("div")), h("p", {}, h("a", { href: back, text: "Back to Waiting for you" }))];
  }
  const out = h("div", { "aria-live": "polite" });
  const tick = h("input", { type: "checkbox", id: "publish-confirm" });
  const go = h("button", { type: "button", class: "btn primary", text: "Publish to the live book", disabled: true });
  tick.addEventListener("change", () => {
    go.disabled = !(tick.checked && p.can_publish);
  });
  go.addEventListener("click", async () => {
    go.disabled = true;
    clear(out, busy("Publishing…"));
    try {
      const res = await act(slug, "publish", { number: p.number, confirm: true });
      clear(out, ...done(res, back));
      form.remove();
    } catch (err) {
      clear(out, errorNote(err));
      go.disabled = !(tick.checked && p.can_publish);
    }
  });
  const form = h("div", {},
    p.can_publish ? h("label", { class: "confirm" }, tick, h("span", { text: "I've looked at what will go to readers, including other people's work in the drafts area." })) : null,
    h("div", { class: "actions" }, go, h("a", { class: "btn link", href: p.url, target: "_blank", rel: "noopener", text: "Open on GitHub" })));
  return [
    ...header,
    h("p", {}, `${plural(p.change_count, "change")} to ${plural(p.page_count, "page")} will go to readers`, p.who.length ? `, by ${p.who.join(", ")}` : "", "."),
    p.pages.length ? h("ul", {}, p.pages.slice(0, 40).map((pg) => h("li", { text: pg }))) : null,
    note([h("p", { text: p.state_words })], p.can_publish ? "" : "warn"),
    note([h("p", { text: "The drafts area is shared: everything in it goes, whoever wrote it. The site rebuilds itself afterwards, which takes a few minutes." })]),
    form,
    out,
  ];
}

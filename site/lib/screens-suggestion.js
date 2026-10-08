// A reader's written suggestion (an issue from the book's site): accept it and make
// the change by hand, decline it, or, where the reader wrote an exact replacement,
// have it made. The desktop app's console, with its wording and its rules: a reply
// says the chapter changed only when a commit holds the change.

import { h, clear, busy, note, errorNote, when } from "./dom.js";
import { read, act, send } from "./api.js";
import { bookBySlug, bookHeader, pageSlug } from "./books.js";
import { sentView } from "./screens-shared.js";

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
  back ? h("p", {}, h("a", { href: back, text: "Back to Drafts" })) : null,
];

export async function suggestionScreen(slug, number) {
  const book = await bookBySlug(slug);
  const { suggestions } = await read("suggestions", { book: slug });
  const s = suggestions.find((x) => x.number === number);
  const back = `#/${slug}/drafts`;
  if (!s) return [...bookHeader(book, "drafts", "A suggestion from a reader"), note([h("p", { text: "This suggestion has already been dealt with." })]), h("p", {}, h("a", { href: back, text: "Back to Drafts" }))];
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
      s.path ? h("a", { class: "btn", href: `#/${slug}/edit/${encodeURIComponent(s.path)}`, text: "Edit the page" }) : null,
      h("a", { class: "btn link", href: s.url, target: "_blank", rel: "noopener", text: "Open on GitHub" }));
  } else {
    actions = h("div", { class: "actions" },
      doButton("I've made the change", "primary", out, async () => {
        const { changes } = await read("suggestion-changes", { book: slug, number: String(number) });
        const newest = changes[0];
        if (!newest) {
          clear(out, note([h("p", { text: `Nothing has changed the page in the drafts since you accepted this, so there is no change to show the reader yet. Make the change, then press this again.` })], "warn"));
          return;
        }
        const confirm = doButton("Yes: thank the reader with a link to it", "primary", out, async () => {
          clear(out, ...done(await act(slug, "suggestion-made", { number, sha: newest.sha }), back));
          actions.remove();
        });
        clear(out, h("div", { class: "card" },
          h("p", {}, "The latest change to the page in the drafts: ",
            h("a", { href: newest.url, target: "_blank", rel: "noopener", text: newest.message || "a change" }), ` — ${newest.who}, ${when(newest.when)}.`),
          h("p", { text: "Is that the change the reader asked for? The reader is sent a link to it, and the suggestion is closed." }),
          h("div", { class: "actions" }, confirm)));
      }),
      s.path ? h("a", { class: "btn", href: `#/${slug}/edit/${encodeURIComponent(s.path)}`, text: "Edit the page" }) : null,
      h("a", { class: "btn link", href: s.url, target: "_blank", rel: "noopener", text: "Open on GitHub" }));
  }

  return [
    ...bookHeader(book, "drafts", "A suggestion from a reader"),
    h("p", { class: "muted" }, "From ", h("strong", { text: s.who }), `, ${when(s.when)}, about `,
      onSite ? h("a", { href: onSite, target: "_blank", rel: "noopener", text: "this page" }) : "a page", ".",
      s.accepted ? [" ", h("span", { class: "badge accepted", text: "Accepted" })] : null),
    h("h2", { text: "What they suggest" }),
    h("blockquote", { class: "said", text: s.suggestion || "(nothing written)" }),
    s.reasoning ? [h("h3", { text: "Why" }), h("blockquote", { class: "said", text: s.reasoning })] : null,
    s.accepted
      ? note([h("p", { text: "You've taken this on, and the reader has been thanked. Once the change is in the drafts area (made with Edit on the page, say), press “I've made the change”." })])
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
      box.append(note([h("p", { text: "The page is not in the drafts, so it can't be looked at." })], "warn"));
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
      h("p", { class: "muted small", text: `Line ${plan.line_no}` }),
      h("p", { class: "prose-change before" }, h("span", { class: "sr-only", text: "Before: " }), plan.before),
      h("p", { class: "prose-change after" }, h("span", { class: "sr-only", text: "After: " }), plan.after),
      h("p", { class: "muted small", text: "It goes to the drafts area as one change made by you; the reader is sent a link to it and the suggestion is closed. If the drafts area changed meanwhile, nothing is sent." }),
      h("div", { class: "actions" }, make));
  });
  box.append(h("div", { class: "actions" }, look));
  return box;
}


// "Publish this chapter" (Drafts, and the review once its changes are in the drafts): one
// chapter to the live book, the rest of the drafts staying where it is. The function does it
// (author-act publish-chapter): a pull request into the live branch with only that chapter,
// its pictures and its Contents line, which merges itself once the book's checks pass.
//
//   first    the chapter through the book's formatting rules here: a problem stops this
//            chapter only, listed with Fix (the book's own check would stop it anyway)
//   linked   pages it links to that the live book hasn't got: "Publish these too" or
//            "Publish without them" (then the broken links are said plainly)
//   then     its checks, asked every few seconds for a few minutes: live, or what stopped it

import { h, clear, busy, note, errorNote, plural } from "./dom.js";
import { act, read } from "./api.js";
import { rawText, forgetCount } from "./drafts.js";
import { lintText } from "./lint.js";
import { pageSlug } from "./books.js";

export const timing = { pollMs: 4000, deadlineMs: 6 * 60_000 };

const fixList = (book, path, problems) => h("ul", {}, problems.map((x) => h("li", {},
  `Line ${x.line}: ${x.words} `, h("a", { href: `#/${book.slug}/edit/${encodeURIComponent(path)}/line/${x.line}`, text: "Fix" }))));

/** The button, and where it says what happened. */
export function publishChapterButton(book, path, title) {
  const out = h("div", { "aria-live": "polite" });
  const b = h("button", { type: "button", class: "btn", text: "Publish this chapter" });
  b.addEventListener("click", () => publish(book, path, title, b, out));
  return h("div", { class: "publish-chapter" }, b, out);
}

async function publish(book, path, title, b, out) {
  b.disabled = true;
  clear(out, busy("Checking the chapter's formatting…"));
  try {
    const problems = await lintText(book, book.drafts_branch, path, await rawText(book.repo, book.drafts_branch, path));
    if (problems.length) {
      clear(out, note([
        h("p", { text: `“${title}” can't go to readers yet: ${plural(problems.length, "formatting problem")} to fix first. Other chapters aren't held up by it.` }),
        fixList(book, path, problems),
      ], "warn"));
      b.disabled = false;
      return;
    }
  } catch {
    /* couldn't check here: the book's own check still runs before it goes live */
  }
  await send();

  async function send(linked) {
    clear(out, busy("Publishing… this can take up to a minute."));
    try {
      const r = await act(book.slug, "publish-chapter", { path, ...(linked ? { linked } : {}) });
      watch(r, linked === "without" ? r.linkedLeft ?? [] : []);
    } catch (err) {
      if (err?.status === 409 && err.body?.linked) {
        const list = err.body.linked;
        clear(out, note([
          h("p", { text: `“${title}” links to ${list.length === 1 ? "a page" : `${list.length} pages`} the live book hasn't got yet:` }),
          h("ul", {}, list.map((l) => h("li", { text: `${l.title} (${l.why})` }))),
          h("div", { class: "row" },
            h("button", { type: "button", class: "btn primary", text: "Publish these too", onclick: () => send("with") }),
            h("button", { type: "button", class: "btn", text: "Publish without them", onclick: () => send("without") })),
          h("p", { class: "muted small", text: "Without them, those links lead nowhere on the live book until you publish those pages too." }),
        ]));
        return;
      }
      b.disabled = false;
      clear(out, errorNote(err));
    }
  }

  function watch(r, left) {
    const broken = left.length ? note([h("p", { text: `Published without ${left.map((l) => `“${l.title}”`).join(", ")}: ${left.length === 1 ? "its link is" : "their links are"} broken on the live book until you publish ${left.length === 1 ? "it" : "them"}.` })], "warn") : null;
    clear(out, busy(`“${r.title}” goes live once the book's checks pass (about a minute)…`), broken);
    const t0 = Date.now();
    const ask = async () => {
      if (!out.isConnected) return;
      if (Date.now() - t0 > timing.deadlineMs) {
        clear(out, note([h("p", {}, "This is taking longer than it should. ", h("a", { href: r.url, target: "_blank", rel: "noopener", text: "Look on GitHub" }), ".")], "warn"), broken);
        b.disabled = false;
        return;
      }
      const s = await read("publish-chapter", { book: book.slug, number: String(r.number) }).catch(() => null);
      if (s?.state === "merged") {
        forgetCount(book.slug);
        clear(out, note([
          h("p", { text: `Published “${r.title}”. The site rebuilds: readers see it in about 3 minutes.` }),
          book.domain ? h("p", {}, h("a", { href: `https://${book.domain}/${pageSlug(path)}`, target: "_blank", rel: "noopener", text: "Open it on the book's site" })) : null,
        ]), broken);
        return;
      }
      if (s?.state === "failed" || s?.state === "closed") {
        const lint = s.checks.some((c) => c.done && !c.ok && /markdownlint/i.test(c.name))
          ? (await read("lint", { book: book.slug, sha: s.sha }).catch(() => null))?.lint?.problems?.filter((x) => x.path === path) ?? []
          : [];
        clear(out, note([
          h("p", { text: s.state === "closed" ? `“${r.title}” was closed without going live.` : `“${r.title}” didn't go live: ${s.checks.filter((c) => c.done && !c.ok).map((c) => c.name).join(", ")} found a problem. Nothing else changed.` }),
          lint.length ? fixList(book, path, lint.map((x) => ({ line: x.line, words: x.description ?? x.rule }))) : null,
          h("p", {}, h("a", { href: r.url, target: "_blank", rel: "noopener", text: "Look on GitHub" })),
        ], "warn"), broken);
        b.disabled = false;
        return;
      }
      setTimeout(ask, timing.pollMs);
    };
    setTimeout(ask, timing.pollMs);
  }
}

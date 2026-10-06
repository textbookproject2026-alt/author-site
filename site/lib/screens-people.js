// A book's People: who can work on it here, and inviting or removing an author. Each
// change is a pull request on the platform's registry that goes through by itself
// once its checks pass (suggest-edit-function's author-people-change); access starts
// or ends only when the author site's server has the change, so until then it is
// shown as on its way.

import { h, clear, busy, note, errorNote, when } from "./dom.js";
import { people, changePeople } from "./api.js";
import { bookBySlug, bookHeader } from "./books.js";
import { identity } from "./auth.js";

const RECHECK_MS = 30_000;
const lower = (s) => s.toLowerCase();
const profile = (login) => h("a", { href: `https://github.com/${encodeURIComponent(login)}`, target: "_blank", rel: "noopener", text: `@${login}` });

export async function peopleScreen(slug) {
  const book = await bookBySlug(slug);
  const stage = h("div", { "aria-live": "polite" });
  await draw(book, stage);
  return [...bookHeader(book, "people", "People"), stage];
}

async function draw(book, stage, said = null) {
  let p;
  try {
    p = await people(book.slug);
  } catch (err) {
    if (err.status === 404) return clear(stage, note([h("p", { text: "Changing who works on a book isn't switched on yet. Ask the platform's technical contact." })]));
    throw err;
  }
  const me = lower(identity()?.login ?? "");
  const open = p.pending.find((c) => c.state === "open");
  // A change that didn't go through is said so, with why: never "on its way" for good.
  const failed = p.pending.filter((c) => c.state === "failed");
  const onWay = p.pending.filter((c) => c.state !== "failed");
  const pendingFor = new Map(onWay.map((c) => [lower(c.login), c]));

  const out = h("div", { class: "outcome", "aria-live": "polite" });
  const act = async (action, login, button) => {
    button.disabled = true;
    clear(out, busy(action === "add" ? `Inviting @${login}…` : `Removing @${login}…`));
    try {
      const c = await changePeople(book.slug, action, login);
      await draw(book, stage, [
        note([h("p", { text: action === "add"
          ? `@${c.login} is invited. GitHub tells them, with a link to sign in here. They can work on the book once the change has gone through, usually a few minutes.`
          : `@${c.login} is being removed. They keep access until the change has gone through, usually a few minutes.` })]),
        c.warning ? note([h("p", { text: c.warning })], "warn") : null,
      ]);
    } catch (err) {
      button.disabled = false;
      clear(out, errorNote(err));
    }
  };

  const removable = (login) => lower(login) !== lower(p.owner) && p.authors.length > 1 && !open && !pendingFor.has(lower(login));
  const row = (login) => {
    const confirm = h("div", { class: "row", hidden: true },
      h("span", { text: lower(login) === me ? "Remove yourself? You lose access once the change has gone through." : `Remove @${login}? They lose access once the change has gone through.` }));
    const yes = h("button", { type: "button", class: "btn primary", text: "Yes, remove" });
    yes.addEventListener("click", () => act("remove", login, yes));
    confirm.append(yes, h("button", { type: "button", class: "btn link", text: "Cancel", onclick: () => { confirm.hidden = true; } }));
    const pending = pendingFor.get(lower(login));
    return h("li", {},
      h("div", { class: "row" },
        h("div", { class: "grow" }, profile(login),
          lower(login) === me ? [" ", h("span", { class: "badge", text: "you" })] : null,
          lower(login) === lower(p.owner) ? [" ", h("span", { class: "badge", text: "looks after the platform" })] : null,
          pending?.action === "remove" ? [" ", h("span", { class: "badge level-look", text: "being removed" })] : null),
        removable(login) ? h("button", { type: "button", class: "btn", text: "Remove", onclick: () => { confirm.hidden = false; } }) : null),
      confirm);
  };

  const input = h("input", { type: "text", id: "invite-login", autocomplete: "off", spellcheck: "false", placeholder: "for example, octocat" });
  const invite = h("button", { type: "submit", class: "btn primary", text: "Invite", disabled: Boolean(open) });
  const form = h("form", {},
    h("label", { class: "field", for: "invite-login" }, "Their GitHub username", input),
    h("div", { class: "row" }, invite),
    h("p", { class: "muted small", text: "They need a GitHub account. GitHub lets them know, with a link to sign in here. They can do everything you can: bring in chapters, edit, answer readers, publish, and invite or remove people." }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const login = input.value.trim().replace(/^@/, "");
    if (!login) return clear(out, errorNote({ userMessage: "Type their GitHub username first." }));
    if (p.authors.some((a) => lower(a) === lower(login))) return clear(out, errorNote({ userMessage: `@${login} can already work on this book.` }));
    act("add", login, invite);
  });

  const words = (c) => c.state === "open"
    ? "waiting for the registry's checks, then it goes through by itself"
    : "gone through; reaching the author site, usually within a few minutes";
  clear(stage,
    said,
    h("h2", { class: "flush-top", text: "Who can work on this book here" }),
    h("ul", { class: "list" }, p.authors.map(row)),
    failed.length ? [
      h("h3", { text: "Didn't go through" }),
      h("ul", { class: "list" }, failed.map((c) => h("li", { class: "failed-change" },
        note([
          h("p", { class: "flush" }, c.action === "add" ? "Inviting " : "Removing ", profile(c.login), c.by ? [" (by @", c.by, ")"] : null,
            " didn't go through, so nothing changed. ", h("a", { href: c.url, target: "_blank", rel: "noopener", text: "See it on GitHub" })),
          h("p", { class: "flush" }, "Why: "),
          h("ul", {}, (c.reasons ?? []).map((r) => h("li", { text: r }))),
          h("p", { class: "muted small", text: "You can try again below; that closes this one. If the reason isn't something you can put right, tell the platform's technical contact." }),
        ], "warn")))),
    ] : null,
    onWay.length ? [
      h("h3", { text: "On its way" }),
      h("ul", { class: "list" }, onWay.map((c) => h("li", {},
        h("p", { class: "flush" }, c.action === "add" ? "Inviting " : "Removing ", profile(c.login), c.by ? [" (by @", c.by, ")"] : null, ": ", words(c), ". ",
          h("a", { href: c.url, target: "_blank", rel: "noopener", text: "See it on GitHub" })),
        c.when ? h("p", { class: "muted small below", text: `Started ${when(c.when)}.` }) : null))),
    ] : null,
    h("h2", { text: "Invite someone" }),
    open ? note([h("p", { text: "One change at a time: you can invite or remove someone once the change above has gone through." })]) : form,
    out);

  // Checked again while something is on its way, for as long as this screen is open.
  if (onWay.length) {
    const here = location.hash;
    setTimeout(() => {
      if (location.hash === here && stage.isConnected) draw(book, stage).catch(() => {});
    }, RECHECK_MS);
  }
}

// A book's People (batch 2b): who works on it, inviting by name and email, removing,
// and what has changed ("Brandon added Caroline · 9 Oct"). Everyone on a book is
// equal. Changes take effect at once (the author site's own server, /api/members);
// the registry, the public record, follows by itself in the background.

import { h, clear, note, errorNote } from "./dom.js";
import { bookBySlug, bookHeader } from "./books.js";
import { identity, loadMe, own } from "./auth.js";

/** "9 Oct", as the audit lines read. */
const day = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export async function peopleScreen(slug) {
  const book = await bookBySlug(slug);
  const stage = h("div", { "aria-live": "polite" });
  await draw(book, stage);
  return [...bookHeader(book, "people", "People"), stage];
}

async function draw(book, stage, said = null) {
  let p;
  try {
    p = await own(`/api/members?book=${encodeURIComponent(book.slug)}`);
  } catch (err) {
    return clear(stage, errorNote(err));
  }
  const redraw = (msg) => draw(book, stage, msg);
  const act = async (button, body, done) => {
    button.disabled = true;
    try {
      const r = await own("/api/members", { method: "POST", body: { book: book.slug, ...body } });
      await redraw(done(r));
    } catch (err) {
      button.disabled = false;
      button.after(errorNote(err));
    }
  };

  const rows = p.members.map((m) => {
    const li = h("li", { class: "person" });
    const name = h("div", { class: "grow" }, h("strong", { text: m.name }), m.you ? h("span", { class: "muted", text: " (you)" }) : null);
    const remove = m.you ? null : h("button", { type: "button", class: "btn link danger", text: "Remove" });
    remove?.addEventListener("click", () => {
      const yes = h("button", { type: "button", class: "btn danger-solid", text: `Remove ${m.name}` });
      yes.addEventListener("click", () => act(yes, { action: "remove", member: m.id }, () => note([h("p", { text: `${m.name} is no longer on this book. If they were signed in, they've been signed out.` })])));
      remove.replaceWith(h("span", { class: "row" }, yes, h("button", { type: "button", class: "btn link", text: "Keep", onclick: () => redraw(said) })));
    });
    li.append(h("div", { class: "row" }, name, remove));
    if (!m.hasEmail) {
      li.append(h("p", { class: "badge level-look", text: "needs an email address" }));
      if (!m.you) {
        const email = h("input", { type: "email", "aria-label": `${m.name}'s email address`, autocomplete: "off", spellcheck: "false" });
        const send = h("button", { type: "button", class: "btn", text: "Send them a link" });
        send.addEventListener("click", () => act(send, { action: "set-email", member: m.id, email: email.value }, () => note([h("p", { text: `A link went to that address. Once ${m.name} opens it, they sign in with it.` })])));
        li.append(h("div", { class: "row wrap" }, email, send));
      }
    }
    return li;
  });

  // Inviting: name and email; the email goes, or the link is copied.
  const name = h("input", { type: "text", id: "invite-name", autocomplete: "off", maxlength: "80", required: true });
  const email = h("input", { type: "email", id: "invite-email", autocomplete: "off", spellcheck: "false", required: true });
  const out = h("div", { "aria-live": "polite" });
  const invite = async (send, button) => {
    if (!name.value.trim() || !email.value.trim()) return clear(out, note([h("p", { text: "Give their name and their email address." })], "warn"));
    button.disabled = true;
    try {
      const r = await own("/api/members", { method: "POST", body: { book: book.slug, action: "invite", name: name.value, email: email.value, send } });
      if (r.mailed) return redraw(note([h("p", { text: `Invitation sent to ${email.value}. It works once, within seven days.` })]));
      const box = h("input", { type: "text", readonly: true, value: r.link, "aria-label": "The invitation link" });
      const copy = h("button", { type: "button", class: "btn", text: "Copy the link" });
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(r.link);
          copy.textContent = "Copied";
        } catch {
          box.select();
        }
      });
      clear(out, note([h("p", { text: r.userMessage ?? "Send them this link yourself. It works once, within seven days, for that address." }), h("div", { class: "row wrap" }, box, copy)]));
      button.disabled = false;
    } catch (err) {
      button.disabled = false;
      clear(out, errorNote(err));
    }
  };
  const sendBtn = h("button", { type: "submit", class: "btn primary", text: "Send the invitation" });
  const linkBtn = h("button", { type: "button", class: "btn", text: "Copy a link instead" });
  linkBtn.addEventListener("click", () => invite(false, linkBtn));
  const form = h("form", { class: "invite" },
    h("label", { for: "invite-name", text: "Their name, as the book will credit them" }), name,
    h("label", { for: "invite-email", text: "Their email address" }), email,
    h("div", { class: "actions wrap" }, sendBtn, linkBtn), out);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    invite(true, sendBtn);
  });

  // Your own reader-suggestion emails.
  const me = identity();
  const notifyOn = me?.notify !== false;
  const toggle = h("button", { type: "button", class: "btn", text: notifyOn ? "Stop emailing me" : "Email me again" });
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try {
      await own("/api/me", { method: "POST", body: { notify: !notifyOn } });
      await loadMe();
    } catch (err) {
      toggle.disabled = false;
      toggle.after(errorNote(err));
    }
  });

  clear(stage,
    said,
    h("h2", { text: "Who works on this book" }),
    h("p", { class: "muted small", text: "Everyone here can edit, publish, invite and remove. Nobody needs any other account: they sign in with their email." }),
    h("ul", { class: "list people" }, rows),
    p.invitations.length ? [h("h3", { text: "Invited, not joined yet" }), h("ul", { class: "list" }, p.invitations.map((i) => h("li", { class: "row" }, h("span", { class: "grow", text: `${i.name} (${i.email})` }), h("span", { class: "muted small", text: `until ${day(i.expires)}` }))))] : null,
    h("h2", { text: "Invite someone" }),
    form,
    h("h2", { text: "Emails about reader suggestions" }),
    h("p", { class: "muted small", text: notifyOn ? "You get one email for each new proposal, note or suggestion on your books." : "You don't get emails about new reader suggestions." }),
    h("div", { class: "actions" }, toggle),
    p.log.length ? [h("h2", { text: "What changed" }), h("ul", { class: "list log" }, p.log.map((l) => h("li", {}, `${l.text} · `, h("span", { class: "muted", text: day(l.at) }))))] : null,
    p.sync ? h("p", { class: "muted small", text: p.sync.inSync ? "The registry lists the same people (platform maintainer only)." : `The registry hasn't caught up yet: ${p.sync.registry ?? "?"} listed there, ${p.sync.here} here (platform maintainer only). It syncs by itself.` }) : null);
}

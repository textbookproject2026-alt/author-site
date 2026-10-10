// Where you're signed in (batch 2c), and the new-browser alert's "This wasn't me".
//   #/signed-in        every browser the account is signed in on: browser and system,
//                      last active, this one marked; each with Sign out
//   #/revoke/<token>   the alert's link: a page, then one button that signs the account
//                      out everywhere (a mail scanner opening the link changes nothing)

import { h, clear, busy, note, errorNote } from "./dom.js";
import { own, signedOut } from "./auth.js";

/** "10 Oct, 14:05" (today: "today, 14:05"). */
const at = (ms) => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? `today, ${time}` : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`;
};

export async function signedInScreen() {
  const stage = h("div", { "aria-live": "polite" });
  const draw = async (said = null) => {
    let list;
    try {
      ({ sessions: list } = await own("/api/sessions"));
    } catch (err) {
      return clear(stage, errorNote(err));
    }
    clear(stage, said, h("ul", { class: "list sessions" }, list.map((s) => {
      const out = h("button", { type: "button", class: "btn", text: "Sign out", "aria-label": `Sign out ${s.device}${s.current ? " (this browser)" : ""}` });
      out.addEventListener("click", async () => {
        out.disabled = true;
        try {
          const r = await own("/api/sessions", { method: "POST", body: { id: s.id } });
          if (r.current) return signedOut();
          await draw(note([h("p", { text: `${s.device} is signed out.` })]));
        } catch (err) {
          out.disabled = false;
          out.after(errorNote(err));
        }
      });
      return h("li", { class: "row" },
        h("div", { class: "grow" },
          h("strong", { text: s.device }), s.current ? h("span", { class: "badge status-new", text: "This browser" }) : null,
          h("p", { class: "muted small", text: `Last active ${at(s.lastActive)} · signed in ${at(s.created)}` })),
        out);
    })));
  };
  await draw();
  return [
    h("h1", { text: "Where you're signed in" }),
    h("p", { class: "muted", text: "Every browser where your account is signed in. If you don't recognise one, sign it out, then make sure your email inbox is safe: it's the only way in." }),
    stage,
  ];
}

export async function revokeScreen(token) {
  let info;
  try {
    info = await own("/api/auth/revoke", { method: "POST", body: { token, action: "info" } });
  } catch (err) {
    return [h("h1", { text: "This link has expired" }), errorNote(err), h("p", {}, h("a", { href: "#/", text: "Go to the author site" }))];
  }
  const status = h("div", { "aria-live": "polite" });
  const go = h("button", { type: "button", class: "btn danger-solid", text: "Sign out everywhere" });
  go.addEventListener("click", async () => {
    go.disabled = true;
    clear(status, busy("Signing your account out…"));
    try {
      await own("/api/auth/revoke", { method: "POST", body: { token, action: "confirm" } });
      go.remove();
      clear(status, note([h("p", { text: "Done: your account is signed out on every browser, including this one. To sign in again, ask for a link with your email address." })]), h("p", {}, h("a", { href: "#/", text: "Sign in" })));
    } catch (err) {
      go.disabled = false;
      clear(status, errorNote(err));
    }
  });
  return [
    h("h1", { text: "Wasn't you?" }),
    h("p", { text: `Your account was signed in on ${info.device}, ${at(info.when)}. If that wasn't you, sign your account out everywhere. Nothing happens until you press the button.` }),
    h("div", { class: "actions" }, go),
    status,
  ];
}

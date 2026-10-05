// Settings: the author's own DeepSeek key, kept in this browser (deepseek.js), as the
// desktop app's Settings kept it in the Mac's Keychain.

import { h, clear } from "./dom.js";
import { deepseekKey, keepDeepseekKey, keyHint, testDeepseekKey } from "./deepseek.js";

export function settingsScreen() {
  const input = h("input", { type: "password", id: "key-input", autocomplete: "off", spellcheck: "false", placeholder: "Your DeepSeek key" });
  const present = h("div");
  const said = h("p", { class: "muted", role: "status" });
  const say = (text, kind = "") => {
    said.textContent = text;
    said.className = kind === "bad" ? "error" : "muted";
  };
  const show = () => {
    const key = deepseekKey();
    clear(present, key ? h("div", { class: "note" }, h("p", {}, "A key is kept in this browser, ending ", h("strong", { text: `…${keyHint(key)}` }), ".")) : null);
    remove.hidden = !key;
  };
  const save = h("button", { type: "button", class: "btn primary", text: "Save key" });
  const check = h("button", { type: "button", class: "btn", text: "Check it works" });
  const remove = h("button", { type: "button", class: "btn link", text: "Remove the key from this browser" });

  save.addEventListener("click", async () => {
    const key = input.value.trim();
    if (!key) return say("Please paste a key first.", "bad");
    if (!keepDeepseekKey(key)) return say("This browser won't keep it (its site storage is switched off), so it was not saved.", "bad");
    input.value = "";
    show();
    say("Saved. Checking it works…");
    const [ok, message] = await testDeepseekKey(key);
    say(message, ok ? "" : "bad");
  });
  check.addEventListener("click", async () => {
    say("Checking…");
    const [ok, message] = await testDeepseekKey(input.value.trim() || deepseekKey());
    say(message, ok ? "" : "bad");
  });
  remove.addEventListener("click", () => {
    keepDeepseekKey(null);
    show();
    say("The key has been removed from this browser.");
  });
  show();

  return [
    h("h1", { text: "Settings" }),
    h("h2", { text: "DeepSeek (optional)" }),
    h("p", { text: "The citation, concept-link and glossary questions work perfectly well without this. With your own DeepSeek key, they can also ask DeepSeek for extra glossary suggestions, and check a chapter's formatting against the book's formatting rules." }),
    present,
    h("label", { class: "field", for: "key-input" }, "Paste a key to save it", input),
    h("div", { class: "row" }, save, check, remove),
    said,
    h("p", { class: "muted small", text: "The key is kept only in this browser, on this computer, until you remove it: it is never sent to the author site's server, and it isn't on your other computers. It goes only to DeepSeek, from this page, with the chapter you are working on, when you ask for a DeepSeek check. On a shared computer, remove it when you're done." }),
  ];
}

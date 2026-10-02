// The link and glossary questions, and a suggestion's exact replacement: the
// converter's own Python (site/py/, from scripts/fetch-converter.mjs) run in headless
// Chromium by the real Pyodide from jsDelivr, on a real little book
// (test/fixtures/book), under the site's CSP.
//
// The same answers are then given to the same Python on this machine
// (CONVERTER_DIR, as the desktop app ran it), and what the page sends must be
// byte for byte what the desktop app would have written.
//
//   CONVERTER_DIR=../authoring-assistant node scripts/fetch-converter.mjs
//   CONVERTER_DIR=../authoring-assistant npm test

import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { startServer, SITE } from "./server.mjs";
import { createStub, HEAD, DEEPSEEK_TERMS, DEEPSEEK_FORMAT } from "./stub.mjs";

const BOOK_DIR = new URL("./fixtures/book/", import.meta.url).pathname;
const CONVERTER = resolve(process.env.CONVERTER_DIR ?? new URL("../../authoring-assistant", import.meta.url).pathname);
const skip = !existsSync(`${SITE}py/manifest.json`) ? "site/py is missing: run scripts/fetch-converter.mjs first"
  : !existsSync(`${CONVERTER}/app/session.py`) ? `no converter at ${CONVERTER} to compare with (set CONVERTER_DIR)` : false;
if (skip && process.env.REQUIRE_CONVERTER) throw new Error(`REQUIRE_CONVERTER is set, but: ${skip}`);

/**
 * The desktop app's answer: DraftsSession on the same book, with the same choices.
 * `accepted` "all" takes every finding. With DeepSeek asked, llm.py gets the stub's
 * answers through its own urlopen, as the app would have from DeepSeek.
 */
function desktop(accepted, expand, options) {
  const code = `
import hashlib, json, os, sys, types, urllib.request
sys.path.insert(0, ${JSON.stringify(CONVERTER)})
from app import session as S, llm
class _R:
    def __init__(self, b): self.b = b.encode()
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self, n=-1): return self.b
TERMS, FORMAT = json.loads(${JSON.stringify(JSON.stringify(DEEPSEEK_TERMS))}), json.loads(${JSON.stringify(JSON.stringify(DEEPSEEK_FORMAT))})
def _urlopen(req, timeout=None):
    body = json.loads(req.data)
    ans = TERMS if "glossary" in body["messages"][0]["content"] else FORMAT
    return _R(json.dumps({"choices": [{"message": {"content": json.dumps(ans)}}]}))
urllib.request.urlopen = _urlopen
llm.load_key = lambda: "sk-test-key-1234"
root = ${JSON.stringify(BOOK_DIR)}
files, store = {}, {}
for d, _, fs in os.walk(root):
    for f in fs:
        p = os.path.join(d, f); b = open(p, "rb").read()
        sha = hashlib.sha1(b"blob %d\\0" % len(b) + b).hexdigest()
        files[os.path.relpath(p, root)] = sha; store[sha] = b
s = S.DraftsSession(types.SimpleNamespace(), {"head": "x", "tree": None, "files": files}, lambda k: store[k])
s.load_chapter("chapters/chapter-01.md")
found, _ = s.run_analyses(json.loads(${JSON.stringify(JSON.stringify(options))}))
accepted = ${JSON.stringify(accepted)}
_, out = s.changes([f["id"] for f in found] if accepted == "all" else accepted, ${JSON.stringify(expand)})
print(json.dumps({p: b.decode() for p, b in out.items()}))
`;
  const r = spawnSync("python3", ["-c", code], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

let server, browser, context, page, stub, problems;
before(async () => {
  if (skip) return;
  server = await startServer();
  browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM_CHANNEL ? { channel: process.env.PW_CHROMIUM_CHANNEL } : {}) });
});
after(async () => {
  await browser?.close();
  server?.close();
});
beforeEach(async () => {
  if (skip) return;
  context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  stub = createStub({ siteOrigin: server.origin });
  stub.useBook(BOOK_DIR);
  await stub.install(context);
  problems = [];
  context.on("page", (p) => {
    p.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    p.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`);
    });
  });
  page = await context.newPage();
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(`${server.origin}/`);
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Sign in with GitHub" }).click()]);
  await popup.waitForEvent("close").catch(() => {});
  await page.getByRole("heading", { name: "Your books" }).waitFor();
});
afterEach(async () => {
  if (skip) return;
  await context.close();
  assert.deepEqual(problems, [], problems.join("\n"));
});

const PYODIDE_TIMEOUT = 120_000;
const CHAPTER = "chapters/chapter-01.md";
const lastSend = () => stub.s.requests.filter((r) => r.endpoint === "author-send").at(-1)?.body;

test("the questions, one at a time, then exactly what changes, sent as one change: byte for byte the desktop app's", { skip, timeout: 240_000 }, async () => {
  await page.goto(`${server.origin}/#/a-book/chapter/${encodeURIComponent(CHAPTER)}`);
  await page.getByRole("link", { name: "Citations, concept links and glossary" }).click();
  await page.getByRole("button", { name: "Look through this chapter" }).click();

  const heading = page.locator("h2").first();
  const answer = async (expectTitle, button) => {
    await page.getByText(expectTitle, { exact: false }).first().waitFor({ timeout: PYODIDE_TIMEOUT });
    await page.getByRole("button", { name: button, exact: true }).click();
  };
  // r0, r1, t2, t3, g4 (the desktop app finds the same five, in this order).
  await page.getByText("1 of 5").waitFor({ timeout: PYODIDE_TIMEOUT });
  assert.match(await heading.textContent(), /Bhaskar/);
  assert.equal(await page.locator(".card mark").first().textContent(), "Bhaskar, 1975");
  await answer("1 of 5", "Yes, make this change");
  await answer("2 of 5", "No, leave it alone");
  await answer("3 of 5", "Yes, make this change");
  await page.getByText("4 of 5").waitFor();
  await page.getByRole("button", { name: "No to every mention of “Epistemology”" }).click();
  await answer("5 of 5", "Yes, make this change");

  await page.getByRole("heading", { name: "Here is exactly what will change" }).waitFor();
  await page.getByText("You chose: 1 citation linked, 1 mention linked to concept pages, 1 glossary entry added.", { exact: false }).waitFor();
  await page.getByText("Ontology", { exact: true }).waitFor();
  const go = page.getByRole("button", { name: "Send to drafts" });
  assert.equal(await go.isDisabled(), true);
  await page.getByLabel("I have read the changes above").check();
  await go.click();
  await page.getByRole("heading", { name: "Sent to the drafts area" }).waitFor();

  const sent = lastSend();
  assert.equal(sent.base, HEAD);
  assert.equal(sent.message, "Tidy chapter-01.md: citations, concept links, glossary");
  const byPath = Object.fromEntries(sent.files.map((f) => [f.path, f.text]));
  const options = { analyses: ["references", "terms", "glossary"], first_mention_only: true, anchor_style: "obsidian" };
  assert.deepEqual(byPath, desktop(["r0", "t2", "g4"], [], options));
  assert.match(byPath[CHAPTER], /\[Bhaskar, 1975\]\(#\^ref-bhaskar-1975\)/);
  assert.doesNotMatch(byPath[CHAPTER], /ref-archer-1995/, "a declined citation's entry gets no anchor");
  assert.match(byPath["glossary.md"], /## Ontology/);
});

test("yes to every mention of a concept, and the drafts moving on: the same choices offered again", { skip, timeout: 240_000 }, async () => {
  await page.goto(`${server.origin}/#/a-book/tidy/${encodeURIComponent(CHAPTER)}`);
  await page.locator("#opt-references").uncheck();
  await page.locator("#opt-glossary").uncheck();
  await page.getByRole("button", { name: "Look through this chapter" }).click();
  await page.getByText("1 of 2").waitFor({ timeout: PYODIDE_TIMEOUT });
  await page.getByRole("button", { name: "Yes to every mention of “Critical realism”" }).click();
  await page.getByText("2 of 2").waitFor();
  await page.getByRole("button", { name: "No, leave it alone" }).click();
  await page.getByLabel("I have read the changes above").check();
  stub.s.sendAnswers = [[409, { error: "conflict", conflict: { head: "b".repeat(40), commits: [{ who: "x", message: "An unrelated edit", url: "" }], files: [{ path: "index.md", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" }] } }], [201, { sha: "c".repeat(40), url: "https://github.com/c", steps: ["The change is in the drafts area, as one change made by you."] }]];
  await page.getByRole("button", { name: "Send to drafts" }).click();
  await page.getByText("your choices still stand").waitFor();
  await page.getByRole("button", { name: "Look at the changes again" }).click();
  await page.getByRole("heading", { name: "Here is exactly what will change" }).waitFor({ timeout: PYODIDE_TIMEOUT });
  await page.getByLabel("I have read the changes above").check();
  await page.getByRole("button", { name: "Send to drafts" }).click();
  await page.getByRole("heading", { name: "Sent to the drafts area" }).waitFor();
  const byPath = Object.fromEntries(lastSend().files.map((f) => [f.path, f.text]));
  assert.deepEqual(byPath, desktop(["t0"], ["Critical realism"], { analyses: ["terms"], first_mention_only: true, anchor_style: "obsidian" }));
});

test("a reader's exact replacement, found exactly once, made and thanked in one send", { skip, timeout: 240_000 }, async () => {
  stub.s.suggestions[0] = { ...stub.s.suggestions[0], path: CHAPTER, suggestion: '"The the domains" should be "The three domains"' };
  await page.goto(`${server.origin}/#/a-book/suggestion/7`);
  await page.getByRole("button", { name: "Look for it" }).click();
  await page.getByRole("button", { name: "Make this change and thank the reader" }).waitFor({ timeout: PYODIDE_TIMEOUT });
  await page.locator(".prose-change.after", { hasText: "The three domains of reality are layered." }).waitFor();
  await page.getByRole("button", { name: "Make this change and thank the reader" }).click();
  await page.getByRole("heading", { name: "Changed, and the reader thanked" }).waitFor();
  const sent = lastSend();
  assert.equal(sent.suggestion, 7);
  const before = stub.s.bookFiles.get(CHAPTER).toString("utf8");
  assert.equal(sent.files[0].text, before.replace("The the domains", "The three domains"));
});

test("a suggestion that isn't an exact replacement found once says why, and is left to the author", { skip, timeout: 240_000 }, async () => {
  stub.s.suggestions[0] = { ...stub.s.suggestions[0], path: CHAPTER, suggestion: '"Ontology" should be "Social ontology"' };
  await page.goto(`${server.origin}/#/a-book/suggestion/7`);
  await page.getByRole("button", { name: "Look for it" }).click();
  await page.getByText("appears twice in that chapter").waitFor({ timeout: PYODIDE_TIMEOUT });
  assert.equal(stub.s.requests.filter((r) => r.endpoint === "author-send").length, 0);
});

const KEY = "sk-test-key-1234";
const keepKey = () => page.evaluate((k) => localStorage.setItem("tb-deepseek-key", k), KEY);

test("DeepSeek, with the author's own key from this browser: glossary suggestions and the formatting check, byte for byte the app's", { skip, timeout: 240_000 }, async () => {
  await keepKey();
  await page.goto(`${server.origin}/#/a-book/tidy/${encodeURIComponent(CHAPTER)}`);
  await page.getByText("Uses the DeepSeek key kept in this browser.").waitFor();
  await page.locator("#opt-references").uncheck();
  await page.locator("#opt-terms").uncheck();
  await page.locator("#opt-format").check();
  await page.getByText("A few more choices").click();
  await page.locator("#opt-deepseek").check();
  await page.getByRole("button", { name: "Look through this chapter" }).click();

  await page.getByText("1 of 3").waitFor({ timeout: PYODIDE_TIMEOUT });
  assert.match(await page.locator("h2").first().textContent(), /Morphogenetic approach/);
  await page.getByText("Suggested wording, from DeepSeek").waitFor();
  await page.getByRole("button", { name: "Yes, make this change", exact: true }).click();
  await page.getByText("2 of 3").waitFor();
  await page.getByRole("button", { name: "Yes, make this change", exact: true }).click();
  await page.getByText("3 of 3").waitFor();
  assert.match(await page.locator("h2").first().textContent(), /Formatting: .*line 5/);
  assert.equal(await page.locator(".card mark.new").textContent(), DEEPSEEK_FORMAT.changes[0].after);
  await page.getByRole("button", { name: "Yes, make this change", exact: true }).click();

  await page.getByRole("heading", { name: "Here is exactly what will change" }).waitFor();
  await page.getByText("You chose: 2 glossary entries added, 1 formatting fix.", { exact: false }).waitFor();
  await page.getByText("A proposed formatting change to line 3 was thrown away", { exact: false }).waitFor();
  await page.getByText("DeepSeek suggested 1 extra term on top of the plain checks.").waitFor();
  await page.getByLabel("I have read the changes above").check();
  await page.getByRole("button", { name: "Send to drafts" }).click();
  await page.getByRole("heading", { name: "Sent to the drafts area" }).waitFor();

  const options = { analyses: ["glossary", "format"], first_mention_only: true, anchor_style: "obsidian", use_deepseek: true };
  const byPath = Object.fromEntries(lastSend().files.map((f) => [f.path, f.text]));
  assert.deepEqual(byPath, desktop("all", [], options));
  assert.match(lastSend().message, /glossary, formatting/);
  // The key went to DeepSeek only, once per check, and never to the function.
  const asked = stub.s.requests.filter((r) => r.endpoint === "deepseek");
  assert.equal(asked.length, 2);
  assert.ok(asked.every((r) => r.auth === `Bearer ${KEY}`));
  assert.ok(stub.s.requests.filter((r) => r.endpoint !== "deepseek").every((r) => !JSON.stringify(r).includes(KEY)));
});

test("DeepSeek refusing the key: the plain checks carry on, and the author is told where to fix it", { skip, timeout: 240_000 }, async () => {
  await keepKey();
  stub.s.deepseekStatus = 401;
  await page.goto(`${server.origin}/#/a-book/tidy/${encodeURIComponent(CHAPTER)}`);
  await page.locator("#opt-references").uncheck();
  await page.locator("#opt-terms").uncheck();
  await page.locator("#opt-glossary").uncheck();
  await page.locator("#opt-format").check();
  await page.getByRole("button", { name: "Look through this chapter" }).click();
  await page.getByText("DeepSeek didn't accept the saved key, so the formatting check didn't run. You can set a new key in Settings.").waitFor({ timeout: PYODIDE_TIMEOUT });
});

test("without a key the DeepSeek checks are off and say where to add one", { skip, timeout: 60_000 }, async () => {
  await page.goto(`${server.origin}/#/a-book/tidy/${encodeURIComponent(CHAPTER)}`);
  assert.equal(await page.locator("#opt-format").isDisabled(), true);
  assert.equal(await page.locator("#opt-deepseek").isDisabled(), true);
  assert.equal(await page.getByRole("link", { name: "Add one in Settings" }).first().getAttribute("href"), "#/settings");
});

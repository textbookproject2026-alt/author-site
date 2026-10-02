// The author site in headless Chromium, against stubbed endpoints (test/stub.mjs):
// the page as served by Cloudflare (site/, with site/_headers' Content-Security-Policy
// applied by a local server), clicked through the way an author would.
//
//   npm test                                  Chromium from `npx playwright-core install chromium`
//   PW_CHROMIUM_CHANNEL=chrome npm test       the installed Chrome instead
//
// Any console error, uncaught exception or CSP violation fails the test it happens in.

import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { startServer } from "./server.mjs";
import { createStub, importDone, sentAnswer, HEAD, MOVED } from "./stub.mjs";

let server, origin, browser;
before(async () => {
  server = await startServer();
  origin = server.origin;
  browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM_CHANNEL ? { channel: process.env.PW_CHROMIUM_CHANNEL } : {}) });
});
after(async () => {
  await browser?.close();
  server?.close();
});

let context, page, stub, problems;
beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  stub = createStub({ siteOrigin: origin });
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
});
afterEach(async () => {
  await context.close();
  assert.deepEqual(problems, [], problems.join("\n"));
});

async function signIn() {
  await page.goto(`${origin}/`);
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Sign in with GitHub" }).click()]);
  await popup.waitForEvent("close").catch(() => {});
  await page.getByRole("heading", { name: "Your books" }).waitFor();
}
const lastCall = (endpoint, pred = () => true) => stub.s.requests.filter((r) => r.endpoint === endpoint && pred(r)).at(-1);

// --- signing in, books, theme ------------------------------------------------------------------

test("signed out: the sign-in screen; the popup signs in; the books are the author's, with the identity on every call", async () => {
  await page.goto(`${origin}/`);
  await page.getByRole("heading", { name: "Work on your textbook" }).waitFor();
  const popupUrl = page.waitForEvent("popup").then((p) => p.url());
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
  assert.equal(await popupUrl, `https://suggest-edit-function.vercel.app/api/github-auth?origin=${encodeURIComponent(origin)}`);
  await page.getByRole("heading", { name: "Your books" }).waitFor();
  await page.getByRole("link", { name: "A Book of Things" }).waitFor();
  assert.match(await page.locator("#who").textContent(), /@author-one/);
  assert.ok(stub.s.requests.every((r) => r.auth === "Bearer tok-1"));
  // Nothing about the sign-in is kept beyond this tab.
  assert.equal(await page.evaluate(() => localStorage.length), 0);
});

test("sign out, and a 401 from the endpoints, both return to the sign-in screen", async () => {
  await signIn();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Work on your textbook" }).waitFor();
  await signIn();
  stub.s.status401 = true;
  await page.getByRole("link", { name: "A Book of Things" }).click();
  await page.getByRole("heading", { name: "Work on your textbook" }).waitFor();
});

test("an account that is no book's author is told so, and how to fix it", async () => {
  stub.s.books = [];
  await signIn();
  await page.getByText("isn't one of any book's authors").waitFor();
});

test("theme: follows a dark system, the toggle switches to light and remembers it before first paint", async () => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${origin}/`);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(), "rgb(33, 31, 41)");
  const toggle = page.locator("#theme-toggle");
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  await toggle.click();
  assert.equal(await bg(), "rgb(243, 240, 234)");
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  assert.equal(await page.evaluate(() => localStorage.getItem("theme")), "light");
  // Reloaded on a dark system: light from the first paint (theme-init.js runs before the body).
  await page.goto(`${origin}/`, { waitUntil: "commit" });
  await page.waitForSelector("body");
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "light");
});

test("fonts: interface in Source Sans 3, a chapter's text in Source Serif 4", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/chapter/${encodeURIComponent("chapters/chapter-01.md")}`);
  await page.locator(".preview p").first().waitFor();
  const font = (sel) => page.locator(sel).first().evaluate((n) => getComputedStyle(n).fontFamily);
  assert.match(await font("h1"), /^"Source Sans 3"/);
  assert.match(await font(".preview p"), /^"Source Serif 4"/);
});

// --- chapters ----------------------------------------------------------------------------------

test("chapters: listed in order with the concept folder, Download a copy is the drafts zip, and a chapter renders safely", async () => {
  await signIn();
  await page.getByRole("link", { name: "A Book of Things" }).click();
  await page.getByRole("heading", { name: "Chapters" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Download a copy" }).getAttribute("href"), "https://github.com/someone/a-book/archive/refs/heads/drafts.zip");
  assert.equal(await page.getByRole("link", { name: "See the drafts preview" }).getAttribute("href"), "https://drafts.a-book.pages.dev/");
  await page.getByRole("heading", { name: "Definitions" }).waitFor();
  await page.getByRole("link", { name: "chapter-01" }).click();
  await page.locator(".preview img").waitFor();
  // The picture is the drafts' own, at the commit read; GitHub's script and javascript: link are gone.
  assert.equal(await page.locator(".preview img").getAttribute("src"), `https://raw.githubusercontent.com/someone/a-book/${HEAD}/assets/chapter-01/image1.png`);
  assert.equal(await page.locator(".preview script").count(), 0);
  assert.equal(await page.locator('.preview a[href^="javascript"]').count(), 0);
  assert.equal(await page.getByRole("link", { name: "On the live site", exact: true }).getAttribute("href"), "https://a-book.example.org/chapters/chapter-01");
  assert.equal(await page.getByRole("link", { name: "In the drafts preview" }).getAttribute("href"), "https://drafts.a-book.pages.dev/chapters/chapter-01");
});

test("signed in as the real book answered: every page under chapters/ offers the questions, the others don't", async () => {
  // author-read's real answers for the book where the button was missing (a browser
  // still running PR #1's cached modules; see README, Deploy).
  const real = JSON.parse(readFileSync(new URL("./fixtures/signed-in.json", import.meta.url)));
  stub.s.books = real.books.books;
  stub.s.signedIn.login = real.books.login;
  stub.s.tree = real.tree;
  stub.s.registry = { schema_version: 1, books: [real.registry] };
  await signIn();
  const slug = real.books.books[0].slug;
  await page.getByRole("link", { name: "From Ontology to Method" }).click();
  await page.getByRole("heading", { name: "Definitions" }).waitFor();
  for (const [name, path] of [["chapter-01", "chapters/chapter-01.md"], ["Example concept", "chapters/Definitions/Example concept.md"]]) {
    await page.goto(`${origin}/#/${slug}`);
    await page.getByRole("link", { name, exact: true }).click();
    const tidy = page.getByRole("link", { name: "Citations, concept links and glossary" });
    await tidy.waitFor();
    assert.equal(await tidy.getAttribute("href"), `#/${slug}/tidy/${encodeURIComponent(path)}`);
    await page.getByRole("link", { name: "In the drafts preview" }).waitFor();
  }
  await page.goto(`${origin}/#/${slug}/chapter/index.md`);
  await page.getByRole("link", { name: "On the live site", exact: true }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Citations, concept links and glossary" }).count(), 0);
  assert.equal(await page.getByText("Edit this page").count(), 0, "the author site edits chapters itself");
});

// --- the editor ----------------------------------------------------------------------------------

const CH1_PATH = "chapters/chapter-01.md";
const conflictAnswer = (paths) => [409, { error: "conflict", conflict: { head: MOVED,
  commits: [{ who: "reader", when: new Date().toISOString(), message: "A browser edit", url: "https://github.com/x" }],
  files: paths.map((path) => ({ path, status: "modified", patch: "@@ -1,1 +1,1 @@\n-a\n+b\n" })) } }];

async function openEditor() {
  await page.goto(`${origin}/#/a-book/chapter/${encodeURIComponent(CH1_PATH)}`);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByRole("tab", { name: "Edit" }).waitFor();
  return page.locator("#editor-text");
}

test("editor: Edit, Preview, Changes; Send writes the whole page on the commit it was read at, as the author", async () => {
  await signIn();
  const box = await openEditor();
  const send = page.getByRole("button", { name: "Send to drafts" });
  assert.equal(await send.isDisabled(), true, "nothing to send until something changes");
  await box.fill("# Chapter 1\n\nSome better text about ![a figure](../assets/chapter-01/image1.png) things.\n");
  await page.getByRole("tab", { name: "Edit" }).press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Preview" }).getAttribute("aria-selected"), "true");
  await page.locator("#ed-panel-1 .preview img").waitFor();
  assert.equal(await page.locator("#ed-panel-1 .preview img").getAttribute("src"), `https://raw.githubusercontent.com/someone/a-book/${HEAD}/assets/chapter-01/image1.png`);
  await page.getByRole("tab", { name: "Changes" }).click();
  assert.equal(await page.locator("#ed-panel-2 ins").first().textContent(), "better");
  await page.locator("#edit-message").fill("Say it better");
  await send.click();
  await page.getByRole("heading", { name: "Sent to the drafts area" }).waitFor();
  assert.deepEqual(lastCall("author-send").body, { book: "a-book", base: HEAD, message: "Say it better",
    files: [{ path: CH1_PATH, text: "# Chapter 1\n\nSome better text about ![a figure](../assets/chapter-01/image1.png) things.\n" }] });
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("tb-edit:")).length), 0, "nothing kept once sent");
});

test("editor: the drafts moved but not this page — offered again on the new commit; this page moved — nothing resent, the text kept", async () => {
  await signIn();
  let box = await openEditor();
  await box.fill("Mine.\n");
  stub.s.sendAnswers = [conflictAnswer(["chapters/chapter-02.md"]), [201, sentAnswer()]];
  await page.getByRole("button", { name: "Send to drafts" }).click();
  await page.getByText("Nothing was sent.").waitFor();
  await page.getByText("chapter-01.md isn't among the changes").waitFor();
  await page.getByRole("button", { name: "Send it on the drafts as they are now" }).click();
  await page.getByRole("heading", { name: "Sent to the drafts area" }).waitFor();
  const sends = stub.s.requests.filter((r) => r.endpoint === "author-send");
  assert.deepEqual(sends.map((r) => r.body.base), [HEAD, MOVED]);
  assert.equal(sends[1].body.files[0].text, "Mine.\n");

  box = await openEditor();
  await box.fill("Mine again.\n");
  stub.s.sendAnswers = [conflictAnswer([CH1_PATH])];
  await page.getByRole("button", { name: "Send to drafts" }).click();
  await page.getByText("chapter-01.md itself was changed meanwhile").waitFor();
  assert.equal(await page.getByRole("button", { name: "Send it on the drafts as they are now" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Send to drafts" }).isDisabled(), true);
  assert.equal(await box.inputValue(), "Mine again.\n");
});

test("editor: unsent text survives leaving the screen; Cancel asks first; a CRLF page goes back with CRLF", async () => {
  await signIn();
  let box = await openEditor();
  await box.fill("Half done.\n");
  await page.getByRole("link", { name: "Waiting for you" }).click();
  await page.getByText("Weekly snapshot").waitFor();
  box = await openEditor();
  await page.getByText("Your unsent changes from earlier are back.").waitFor();
  assert.equal(await box.inputValue(), "Half done.\n");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("link", { name: "Edit", exact: true }).waitFor();
  box = await openEditor();
  assert.equal(await box.inputValue(), "# Chapter 1\n\nSome text about ![a figure](../assets/chapter-01/image1.png) things.\n");

  stub.s.bookFiles.set(CH1_PATH, Buffer.from("# Windows\r\n\r\nLine one.\r\n"));
  box = await openEditor();
  await box.fill("# Windows\n\nLine two.\n");
  await page.getByRole("button", { name: "Send to drafts" }).click();
  await page.getByRole("heading", { name: "Sent to the drafts area" }).waitFor();
  assert.equal(lastCall("author-send").body.files[0].text, "# Windows\r\n\r\nLine two.\r\n");
});

// --- Word import -------------------------------------------------------------------------------

const DOCX = Buffer.concat([Buffer.from("PK\x03\x04", "binary"), Buffer.alloc(3 * 1024 * 1024, 1)]);

async function chooseDocx(name = "Chapter 2 – Soils.docx", buffer = DOCX) {
  await page.goto(`${origin}/#/a-book/import`);
  await page.locator("#docx").setInputFiles({ name, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer });
}

test("import: parts of at most 2.5 MB, receipts in order, converted, read, ticked, sent as the import", async () => {
  await signIn();
  stub.s.importState = [{ state: "working", attempt: 1 }, importDone()];
  await chooseDocx();
  await page.getByRole("button", { name: "Convert it" }).click();
  await page.getByRole("heading", { name: "It becomes chapters/chapter-02.md" }).waitFor({ timeout: 15000 });

  const parts = stub.s.requests.filter((r) => r.body?.part);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => Buffer.from(p.body.part, "base64").length <= 2.5 * 1024 * 1024));
  assert.ok(Buffer.concat(parts.map((p) => Buffer.from(p.body.part, "base64"))).equals(DOCX), "the parts reassemble to the file");
  assert.deepEqual(lastCall("author-import", (r) => r.body?.action === "start").body,
    { action: "start", book: "a-book", name: "Chapter 2 – Soils.docx", parts: ["receipt-1", "receipt-2"], folder: "chapters", chapterName: null });

  await page.getByText("- **[[chapters/chapter-02|Chapter 2: Soils]]**").waitFor();
  await page.getByText("One picture is a chart").waitFor();
  await page.getByText("Headings came across").waitFor();
  assert.equal(await page.locator("li.level-warn .badge").textContent(), "warn");
  await page.getByText("became a chapter of 6 words, 1 picture.").waitFor();
  await page.locator(".preview img").waitFor();
  assert.match(await page.locator(".preview img").getAttribute("src"), /^blob:/, "the staged picture, not the drafts'");

  const sendBtn = page.getByRole("button", { name: "Send to drafts" });
  assert.equal(await sendBtn.isDisabled(), true);
  await page.getByLabel("I've read the converted chapter").check();
  await sendBtn.click();
  await page.getByRole("heading", { name: "The chapter is in the drafts area" }).waitFor();
  const sent = lastCall("author-send").body;
  assert.deepEqual([sent.book, sent.base, sent.import, sent.replace], ["a-book", HEAD, "0123456789abcdef0123", undefined]);
  assert.equal(sent.files, undefined, "the import's files are never sent through the browser");
  assert.equal(await page.getByRole("link", { name: "See the change on GitHub" }).getAttribute("href"), sentAnswer().url);
  assert.equal(await page.getByRole("link", { name: "Go through this chapter now" }).getAttribute("href"), `#/a-book/tidy/${encodeURIComponent("chapters/chapter-02.md")}`);
});

test("import: replacing a chapter needs the second tick, and says who changed it and which pictures go", async () => {
  await signIn();
  stub.s.importState = [importDone({ isNew: false })];
  await chooseDocx();
  await page.getByRole("button", { name: "Convert it" }).click();
  await page.getByRole("heading", { name: "It replaces chapters/chapter-02.md" }).waitFor({ timeout: 15000 });
  await page.getByText("last changed by").waitFor();
  await page.getByText("old.png").waitFor();
  await page.getByText("2 lines would go and 1 line would come in.").waitFor();
  const sendBtn = page.getByRole("button", { name: "Send to drafts" });
  await page.getByLabel("I've read the converted chapter").check();
  assert.equal(await sendBtn.isDisabled(), true, "not without the replace tick");
  await page.getByLabel("Replace the chapters/chapter-02.md").check();
  await sendBtn.click();
  await page.getByRole("heading", { name: "The chapter was replaced in the drafts area" }).waitFor();
  assert.equal(lastCall("author-send").body.replace, true);
});

test("import: drafts moved — nothing sent, what moved is shown, and Convert it again starts a new attempt", async () => {
  await signIn();
  stub.s.importState = [importDone()];
  stub.s.sendAnswers = [[409, { error: "conflict", userMessage: "Something else changed the drafts area.", conflict: {
    head: MOVED,
    commits: [{ sha: MOVED, who: "reader", when: new Date().toISOString(), message: "A browser edit", url: `https://github.com/someone/a-book/commit/${MOVED}` }],
    files: [{ path: "index.md", status: "modified", added: 1, removed: 1, patch: "@@ -1,2 +1,2 @@\n # Book\n-Old line\n+New line" }],
  } }], [201, sentAnswer()]];
  await chooseDocx();
  await page.getByRole("button", { name: "Convert it" }).click();
  await page.getByLabel("I've read the converted chapter").check({ timeout: 15000 });
  await page.getByRole("button", { name: "Send to drafts" }).click();
  await page.getByText("Nothing was sent.").waitFor();
  await page.getByRole("link", { name: "A browser edit" }).waitFor();
  assert.equal(await page.locator(".diff .del").first().textContent(), "-Old line");
  assert.equal(await page.locator(".diff .add").first().textContent(), "+New line");
  stub.s.importState = [{ state: "working", attempt: 2 }, { ...importDone(), attempt: 2 }];
  await page.getByRole("button", { name: "Convert it again" }).click();
  await page.getByRole("heading", { name: "It becomes chapters/chapter-02.md" }).waitFor({ timeout: 15000 });
  assert.equal(lastCall("author-import", (r) => r.body?.action === "again").body.id, "0123456789abcdef0123");
});

test("import: not a .docx, and a concept page with its own name in a folder inside chapters", async () => {
  await signIn();
  await chooseDocx("notes.pdf", Buffer.from("%PDF"));
  await page.getByText("That is not a Word document").waitFor();
  stub.s.importState = [{ state: "failed", attempt: 1, error: "That file could not be read as a Word document." }];
  await chooseDocx("Realism notes.docx", Buffer.from("PK\x03\x04tiny"));
  await page.locator("#where").selectOption("chapters/Definitions");
  assert.equal(await page.locator("#chapter-name").inputValue(), "Realism notes");
  await page.locator("#chapter-name").fill("Critical realism");
  await page.getByRole("button", { name: "Convert it" }).click();
  await page.getByText("That file could not be read as a Word document.").waitFor({ timeout: 15000 });
  const start = lastCall("author-import", (r) => r.body?.action === "start").body;
  assert.deepEqual([start.folder, start.chapterName], ["chapters/Definitions", "Critical realism"]);
});

// --- waiting for you ------------------------------------------------------------------------------

test("waiting: suggestions, draft changes, going live, the preview and the jobs, each from its own source", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/waiting`);
  await page.getByRole("heading", { name: "Suggestions from readers" }).waitFor();
  await page.getByText("from Ada").waitFor();
  await page.getByText("Accepted", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Fix a typo" }).waitFor();
  await page.getByText("2 changes to 1 page").waitFor();
  await page.getByText("The preview shows the drafts area as it stands.").waitFor();
  await page.getByText("Weekly snapshot").waitFor();
  await page.locator(".error", { hasText: "Did not finish" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Reader discussion" }).getAttribute("href"), "https://hypothes.is/search?q=url:https://a-book.example.org/*");
  assert.equal(await page.getByRole("link", { name: "History" }).getAttribute("href"), "https://github.com/someone/a-book/commits/main");
});

test("a suggestion: accept by hand, decline; an accepted one: I've made the change names the commit, then thanks", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/suggestion/7`);
  await page.getByText('"recieve" should be "receive"').waitFor();
  await page.getByRole("button", { name: "Accept: I'll make the change" }).click();
  await page.getByText("Did suggestion-accept.").waitFor();
  assert.deepEqual(lastCall("author-act").body, { book: "a-book", action: "suggestion-accept", number: 7 });

  await page.goto(`${origin}/#/a-book/suggestion/8`);
  await page.getByRole("button", { name: "I've made the change" }).click();
  await page.getByRole("link", { name: "Reword" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Edit chapter-01" }).getAttribute("href"), `#/a-book/edit/${encodeURIComponent("chapters/chapter-01.md")}`);
  await page.getByRole("button", { name: "Yes: thank the reader with a link to it" }).click();
  await page.getByText("Did suggestion-made.").waitFor();
  assert.deepEqual(lastCall("author-act").body, { book: "a-book", action: "suggestion-made", number: 8, sha: "c".repeat(40) });
});

test("a draft change: before and after, accepted", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/change/12`);
  await page.getByText("The the domains.").waitFor();
  await page.getByText("The three domains.").waitFor();
  await page.getByRole("button", { name: "Accept this change" }).click();
  await page.getByText("Did change-accept.").waitFor();
  assert.deepEqual(lastCall("author-act").body, { book: "a-book", action: "change-accept", number: 12, title: "Fix a typo" });
});

test("publishing: only with the tick, and only the request shown", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/publish`);
  const go = page.getByRole("button", { name: "Publish to the live book" });
  await go.waitFor();
  assert.equal(await go.isDisabled(), true);
  await page.getByLabel("I've looked at what will go to readers").check();
  await go.click();
  await page.getByText("The drafts were sent to the live book.").waitFor();
  assert.deepEqual(lastCall("author-act").body, { book: "a-book", action: "publish", number: 30, confirm: true });
});

test("publishing: not clean means no tick box and no button that works", async () => {
  stub.s.publish = { ...stub.s.publish, state: "conflict", can_publish: false, state_words: "This cannot be published as it stands." };
  await signIn();
  await page.goto(`${origin}/#/a-book/publish`);
  await page.getByText("This cannot be published as it stands.").waitFor();
  assert.equal(await page.getByLabel("I've looked at what will go to readers").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Publish to the live book" }).isDisabled(), true);
});

// --- phones -------------------------------------------------------------------------------------------

test("at 375px nothing scrolls sideways", async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn();
  for (const hash of ["#/", "#/a-book", "#/a-book/waiting", "#/a-book/change/12"]) {
    await page.goto(`${origin}/${hash}`);
    await page.locator("h1").waitFor();
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${hash} overflows by ${overflow}px`);
  }
});

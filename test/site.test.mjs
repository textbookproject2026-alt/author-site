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
import { createStub, importDone, API, HEAD, MOVED, SENT, LIVE, CH1_DRAFTS, ROCKS, INDEX_LIVE } from "./stub.mjs";

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

test("the header's Guide link opens the author guide in a new tab, signed in or out", async () => {
  await page.goto(`${origin}/`);
  const guide = page.locator(".masthead").getByRole("link", { name: "Guide", exact: true });
  assert.equal(await guide.getAttribute("href"), "https://guide.confused4now.org");
  assert.equal(await guide.getAttribute("target"), "_blank");
  await signIn();
  assert.ok(await guide.isVisible());
});

test("theme: follows a dark system, the toggle switches to light and remembers it before first paint", async () => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${origin}/`);
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(), "rgb(23, 24, 28)");
  const toggle = page.locator("#theme-toggle");
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  await toggle.click();
  assert.equal(await bg(), "rgb(255, 255, 255)");
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  assert.equal(await page.evaluate(() => localStorage.getItem("theme")), "light");
  // Reloaded on a dark system: light from the first paint (theme-init.js runs before the body).
  await page.goto(`${origin}/`, { waitUntil: "commit" });
  await page.waitForSelector("body");
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "light");
});

test("settings: the DeepSeek key is kept in this browser only, checked with DeepSeek itself, and removed", async () => {
  await signIn();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "DeepSeek (optional)" }).waitFor();
  await page.getByRole("button", { name: "Save key" }).click();
  await page.getByText("Please paste a key first.").waitFor();
  await page.locator("#key-input").fill("  sk-abcdefgh9876  ");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.getByText("The key works. DeepSeek answered normally.").waitFor();
  await page.getByText("…9876").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("tb-deepseek-key")), "sk-abcdefgh9876");
  assert.equal(await page.locator("#key-input").inputValue(), "", "the key isn't left on screen");
  const asked = stub.s.requests.filter((r) => r.endpoint === "deepseek");
  assert.deepEqual(asked.map((r) => r.auth), ["Bearer sk-abcdefgh9876"]);
  assert.ok(stub.s.requests.filter((r) => r.endpoint !== "deepseek").every((r) => !JSON.stringify(r).includes("sk-abcdefgh9876")), "never sent to the function");

  stub.s.deepseekStatus = 402;
  await page.getByRole("button", { name: "Check it works" }).click();
  await page.getByText("The key is valid, but the DeepSeek account has no credit left.").waitFor();
  await page.getByRole("button", { name: "Remove the key from this browser" }).click();
  await page.getByText("The key has been removed from this browser.").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("tb-deepseek-key")), null);
});


test("fonts: interface in Source Sans 3, a chapter's text in Source Serif 4", async () => {
  await signIn();
  await openEditor();
  await page.getByRole("tab", { name: "Preview" }).click();
  await page.locator(".preview p").first().waitFor();
  const font = (sel) => page.locator(sel).first().evaluate((n) => getComputedStyle(n).fontFamily);
  assert.match(await font("h1"), /^"Source Sans 3"/);
  assert.match(await font(".preview p"), /^"Source Serif 4"/);
});

const CH1_PATH = "chapters/chapter-01.md";
/** The author-facing text of the page: never a file name. */
const noFileNames = async () => {
  // The page's own words, not the chapter text it shows (a difference, a preview, the editor's box).
  const text = await page.locator("main").evaluate((m) => {
    const c = m.cloneNode(true);
    c.querySelectorAll(".diff, .preview, textarea").forEach((n) => n.remove());
    return c.innerText;
  });
  assert.doesNotMatch(text, /\.md\b|chapters\/|assets\/|\.docx|index\.md|glossary\.md/, text);
};

async function openEditor(path = CH1_PATH) {
  await page.goto(`${origin}/#/a-book/edit/${encodeURIComponent(path)}`);
  await page.getByRole("tab", { name: "Edit" }).waitFor();
  return page.locator("#editor-text");
}
const sends = () => stub.s.requests.filter((r) => r.endpoint === "author-send").map((r) => r.body);

// --- Chapters -------------------------------------------------------------------------------------

test("chapters: reading order with each chapter's status, the removed one listed apart, no file names", async () => {
  await signIn();
  await page.getByRole("link", { name: "A Book of Things" }).click();
  await page.getByRole("heading", { name: "Chapters, in reading order" }).waitFor();
  const rows = page.locator("ol.reorder > li");
  await rows.nth(2).waitFor();
  assert.deepEqual((await rows.allInnerTexts()).map((t) => t.split("\n").slice(0, 3).join(" | ")), ["⠿ | Soils | Published", "⠿ | Chapter 1 | Draft changes", "⠿ | Water | New", "⠿ | Realism | Published", "⠿ | Glossary | Published"]);
  // The concept page and the glossary aren't in index.md's Contents: at its end, flagged, as the builder adds them.
  assert.equal(await rows.nth(3).getByText("Not in the Contents").count(), 1);
  assert.equal(await rows.nth(4).getByText("Not in the Contents").count(), 1);
  assert.equal(await rows.nth(2).getByText("Not in the Contents").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Remove Glossary" }).count(), 0, "the glossary is never removed here");
  await page.getByRole("heading", { name: "To be removed when you publish" }).waitFor();
  await page.getByText("Rocks").waitFor();
  assert.equal(await page.getByRole("link", { name: "Bring in a document" }).getAttribute("href"), "#/a-book/import");
  assert.equal(await page.getByRole("link", { name: "Download a copy" }).getAttribute("href"), "https://github.com/someone/a-book/archive/refs/heads/drafts.zip");
  assert.equal(await page.getByRole("link", { name: "Chapter 1" }).getAttribute("href"), `#/a-book/edit/${encodeURIComponent(CH1_PATH)}`);
  // The tabs: no Waiting for you, and Drafts with its count.
  await page.getByRole("link", { name: "Drafts (5)" }).waitFor();
  assert.equal(await page.getByText("Waiting for you").count(), 0);
  await noFileNames();
});

test("chapters: ↑ and ↓ or dragging change the order, saved to the drafts by themselves as one change", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book`);
  await page.getByRole("button", { name: "Move Water up" }).click();
  await page.getByRole("button", { name: "Move Water up" }).click();
  await page.getByText(/^Draft saved \d\d:\d\d$/).waitFor();
  assert.equal(sends().length, 1, "two moves, one change");
  const sent = sends()[0];
  assert.equal(sent.base, HEAD);
  assert.equal(sent.message, "Change the chapter order");
  assert.match(sent.files[0].text, /## Contents\n\n- \[\[chapters\/chapter-04\|Water\]\]\n- \[\[chapters\/chapter-02\|Soils\]\]\n- \[\[chapters\/chapter-01\|Chapter 1\]\]\n/);
  await page.locator("ol.reorder > li").nth(2).dragTo(page.locator("ol.reorder > li").nth(0));
  await page.waitForFunction(() => document.querySelector(".saved")?.textContent.startsWith("Draft saved") && true);
  await page.waitForTimeout(1300);
  assert.equal(sends().at(-1).base, SENT, "the next change is made on the one before");
});

test("chapters: Add to the Contents writes the flagged pages at its end, as one change", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book`);
  await Promise.all([page.waitForResponse((r) => r.url().includes("author-send")), page.getByRole("button", { name: "Add to the Contents" }).click()]);
  const sent = sends()[0];
  assert.equal(sent.message, "Add the missing pages to the Contents");
  assert.match(sent.files[0].text, /- \[\[chapters\/chapter-04\|Water\]\]\n- \[\[chapters\/Definitions\/Realism\|Realism\]\]\n- \[\[glossary\|Glossary\]\]\n$/);
});

test("chapters: Rename changes the heading and the reading order's label; Remove asks with the name, then takes it out", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book`);
  await page.getByRole("button", { name: "Rename Chapter 1" }).click();
  await page.locator("#retitle").fill("Chapter 1: Beginnings");
  await Promise.all([page.waitForResponse((r) => r.url().includes("author-send")), page.getByRole("button", { name: "Save the title" }).click()]);
  const renamed = sends()[0];
  assert.deepEqual(renamed.files.map((f) => f.path), [CH1_PATH, "index.md"]);
  assert.match(renamed.files[0].text, /^# Chapter 1: Beginnings\n/);
  assert.match(renamed.files[1].text, /\[\[chapters\/chapter-01\|Chapter 1: Beginnings\]\]/);

  await page.getByRole("button", { name: "Remove Water" }).click();
  await page.getByText("Remove “Water” from the book?").waitFor();
  assert.equal(sends().length, 1, "nothing until confirmed");
  await Promise.all([page.waitForResponse((r) => r.url().includes("author-send")), page.getByRole("button", { name: "Remove “Water”" }).click()]);
  const removed = sends().at(-1);
  assert.deepEqual(removed.deletes, ["chapters/chapter-04.md"]);
  assert.doesNotMatch(removed.files[0].text, /chapter-04/);
  assert.equal(removed.message, "Remove “Water”");
});

// --- the editor -------------------------------------------------------------------------------------

test("editor: no Send; typing is saved to the drafts by itself, Saving… then Draft saved HH:MM, each save on the one before", async () => {
  await signIn();
  const box = await openEditor();
  assert.equal(await page.getByRole("button", { name: /^Send/ }).count(), 0);
  assert.equal(await box.inputValue(), CH1_DRAFTS);
  await box.press("End");
  await box.type(" More.");
  await page.getByText(/^Draft saved \d\d:\d\d$/).waitFor();
  const first = sends()[0];
  assert.equal(first.base, HEAD);
  assert.equal(first.message, "Edit “Chapter 1”");
  assert.ok(first.files[0].text.includes("More."));
  await noFileNames();
  // Changes compares with what readers have.
  await page.getByRole("tab", { name: "Changes" }).click();
  await page.locator("#ed-panel-2 ins").first().waitFor();
});

test("editor: the book's lint as you type — fixes what it can away from the caret, lists the rest with Go to line", async () => {
  await signIn();
  const box = await openEditor();
  await box.fill("# Chapter 1\n\n\n\nSome text.   \n\n![](x.png)\n\nEnd");
  await page.getByText(/Formatting: 1 thing to put right/).waitFor();
  // The blank lines and trailing spaces went; the caret's line (the last) was left alone.
  assert.equal(await box.inputValue(), "# Chapter 1\n\nSome text.\n\n![](x.png)\n\nEnd");
  await page.getByRole("button", { name: "Go to line 5" }).click();
  assert.equal(await box.evaluate((t) => t.value.slice(t.selectionStart, t.selectionEnd)), "![](x.png)");
});

test("editor: a save that fails says so with Try again; the drafts moved elsewhere — saved on the new commit by itself", async () => {
  await signIn();
  stub.s.sendAnswers = [[502, { error: "x", userMessage: "GitHub didn't answer." }], [201, { sha: SENT, url: "", steps: [] }]];
  const box = await openEditor();
  await box.press("End");
  await box.type(" More.");
  await page.getByText("Not saved.").waitFor();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByText(/^Draft saved/).waitFor();
  assert.equal(sends().length, 2);

  stub.s.sendAnswers = [[409, { error: "conflict", conflict: { head: MOVED, commits: [], files: [{ path: "chapters/chapter-02.md", status: "modified", patch: "" }] } }], [201, { sha: SENT, url: "", steps: [] }]];
  await page.goto(`${origin}/#/a-book/edit/${encodeURIComponent("glossary.md")}`);
  const g = page.locator("#editor-text");
  await g.press("End");
  await g.type("\nA term.");
  await page.getByText(/^Draft saved/).waitFor();
  assert.equal(sends().at(-1).base, MOVED);
});

test("editor: Links & glossary saves what is typed first, then opens the chapter's questions; the page's links and last change are on top", async () => {
  await signIn();
  const box = await openEditor();
  await page.getByText(/^Last changed by author-one/).waitFor();
  assert.equal(await page.getByRole("link", { name: "On the live site" }).getAttribute("href"), "https://a-book.example.org/chapters/chapter-01");
  assert.equal(await page.getByRole("link", { name: "In the drafts preview" }).getAttribute("href"), "https://drafts.a-book.pages.dev/chapters/chapter-01");
  await box.press("End");
  await box.type(" More.");
  await page.getByRole("button", { name: "Links & glossary" }).click();
  await page.getByRole("heading", { name: "Links & glossary: “Chapter 1”" }).waitFor();
  assert.ok(sends()[0].files[0].text.includes("More."), "saved before leaving");
  for (const id of ["#opt-references", "#opt-terms", "#opt-glossary", "#opt-format"]) await page.locator(id).waitFor({ state: "attached" });
  assert.equal(await page.locator("#opt-format").isDisabled(), true, "the AI pass needs the DeepSeek key");
  await noFileNames();
  // Not offered for the front page or the glossary.
  await openEditor("index.md");
  assert.equal(await page.getByRole("button", { name: "Links & glossary" }).count(), 0);
});

test("chapters: book-wide glossary and concept links, concept pages in the reading order, and Reader discussion", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book`);
  await page.getByRole("heading", { name: "Across the whole book" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Glossary terms in every chapter" }).getAttribute("href"), "#/a-book/tidy-all/glossary");
  assert.equal(await page.getByRole("link", { name: "Concept links in every chapter" }).getAttribute("href"), "#/a-book/tidy-all/concepts");
  assert.equal(await page.locator("ol.reorder").getByRole("link", { name: "Realism" }).getAttribute("href"), `#/a-book/edit/${encodeURIComponent("chapters/Definitions/Realism.md")}`);
  assert.equal(await page.getByRole("link", { name: "Reader discussion" }).getAttribute("href"), "https://hypothes.is/search?q=url:https://a-book.example.org/*");
});

test("import: a concept page goes into its folder under a name of the author's choosing", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/import`);
  await page.locator("#where").selectOption("chapters/Definitions");
  stub.s.importState = [importDone()];
  await chooseFile("Structure.odt", Buffer.from("PK\x03\x04odt", "binary"));
  assert.equal(await page.locator("#chapter-name").inputValue(), "Structure");
  await page.getByRole("button", { name: "Convert it" }).click();
  await page.getByRole("button", { name: /to the drafts$/ }).waitFor();
  const start = lastCall("author-import", (r) => r.body?.action === "start").body;
  assert.deepEqual([start.folder, start.chapterName], ["chapters/Definitions", "Structure"]);
});

// --- bringing in a document -------------------------------------------------------------------------

async function chooseFile(name, bytes) {
  await page.locator("#docx").setInputFiles({ name, mimeType: "application/octet-stream", buffer: bytes });
}

test("import: an .odt is uploaded, converted and added to the drafts as a new chapter, with no file names on the way", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/import`);
  assert.equal(await page.locator("#docx").getAttribute("accept"), ".docx,.doc,.odt,.rtf");
  stub.s.importState = [{ state: "working", attempt: 1 }, importDone()];
  await chooseFile("Chapter 2 – Soils.odt", Buffer.from("PK\x03\x04odt", "binary"));
  await page.getByRole("button", { name: "Convert it" }).click();
  await page.getByRole("heading", { name: "A new chapter: “Chapter 2: Soils”" }).waitFor();
  await noFileNames();
  await page.getByRole("button", { name: "Add “Chapter 2: Soils” to the drafts" }).click();
  await page.getByRole("heading", { name: "“Chapter 2: Soils” is in the drafts" }).waitFor();
  const start = lastCall("author-import", (r) => r.body?.action === "start").body;
  assert.equal(start.name, "Chapter 2 – Soils.odt");
  const sent = sends()[0];
  assert.equal(sent.import, "0123456789abcdef0123");
  assert.equal(sent.replace, undefined);
  assert.equal(await page.getByRole("link", { name: "Open it in the editor" }).getAttribute("href"), "#/a-book/edit/chapters%2Fchapter-02.md");
  assert.equal(await page.getByRole("link", { name: "Links & glossary for it now" }).getAttribute("href"), "#/a-book/tidy/chapters%2Fchapter-02.md");
});

test("import: replacing says so on the button; a .pages file is refused in plain words", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/import`);
  await chooseFile("Chapter.pages", Buffer.from("x"));
  await page.getByText("That kind of file can't be brought in.", { exact: false }).waitFor();
  stub.s.importState = [importDone({ isNew: false })];
  await chooseFile("Chapter 2.rtf", Buffer.from("{\\rtf1 x}"));
  await page.getByRole("button", { name: "Convert it" }).click();
  await page.getByRole("button", { name: "Replace “Chapter 2: Soils” in the drafts" }).click();
  await page.getByRole("heading", { name: "“Chapter 2: Soils” was replaced in the drafts" }).waitFor();
  assert.equal(sends()[0].replace, true);
});

// --- Drafts -------------------------------------------------------------------------------------------

test("drafts: one plain line per chapter, with who and when; View changes; nothing behind the scenes; no file names", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/drafts`);
  await page.getByRole("heading", { name: "What's in the drafts (5)" }).waitFor();
  const lines = (await page.locator("ul.drafts > li").allInnerTexts()).map((t) => t.split("\n")[0]);
  assert.deepEqual(lines, ["Edited “Chapter 1” (1 paragraph)", "Removed “Rocks”", "New chapter “Water”", "Chapter order changed", "1 picture added or changed"]);
  assert.match(await page.locator("ul.drafts > li").first().innerText(), /author-one, 10 minutes ago/);
  await page.locator("ul.drafts > li").first().getByRole("button", { name: "View changes" }).click();
  await page.locator("ul.drafts > li .diff ins").first().waitFor();
  assert.equal(await page.getByRole("link", { name: "Preview the book with drafts" }).getAttribute("href"), "https://drafts.a-book.pages.dev/");
  await page.getByRole("link", { name: "Drafts (5)" }).waitFor();
  await noFileNames();
});

test("drafts: Discard puts one line back as readers have it, on the drafts: a removed chapter returns to its place", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/drafts`);
  const removed = page.locator("ul.drafts > li").nth(1);
  await removed.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "Discard it" }).click();
  await page.waitForFunction(() => document.querySelectorAll("ul.drafts > li").length === 5 && !document.querySelector('[role="alertdialog"]'));
  const sent = sends()[0];
  assert.equal(sent.base, HEAD);
  assert.equal(sent.message, "Discard: Removed “Rocks”");
  assert.deepEqual(sent.files[0], { path: "chapters/chapter-03.md", text: ROCKS });
  // After Soils, as for readers.
  assert.match(sent.files[1].text, /- \[\[chapters\/chapter-02\|Soils\]\]\n- \[\[chapters\/chapter-03\|Rocks\]\]\n- \[\[chapters\/chapter-01\|Chapter 1\]\]/);

  await page.locator("ul.drafts > li").nth(2).getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "Discard it" }).click();
  await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
  const gone = sends().at(-1);
  assert.deepEqual(gone.deletes, ["chapters/chapter-04.md"]);
  assert.doesNotMatch(gone.files[0].text, /chapter-04/);

  await page.locator("ul.drafts > li").nth(3).getByRole("button", { name: "Discard" }).click();
  await page.getByRole("button", { name: "Discard it" }).click();
  await page.waitForFunction(() => !document.querySelector('[role="alertdialog"]'));
  assert.match(sends().at(-1).files[0].text, /- \[\[chapters\/chapter-01\|Chapter 1\]\]\n- \[\[chapters\/chapter-02\|Soils\]\]\n- \[\[chapters\/chapter-04\|Water\]\]/);
  void INDEX_LIVE;
});

test("drafts: reader suggestions at the top — Accept folds one into the drafts, Decline closes it", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/drafts`);
  await page.getByRole("heading", { name: "Reader suggestions" }).waitFor();
  const row = page.locator("li", { hasText: "Fix a typo" });
  await row.getByRole("button", { name: "View changes" }).click();
  await page.getByText("The three domains.").waitFor();
  await row.getByRole("button", { name: "Accept" }).click();
  await page.getByText("Accepted: it is in the drafts.").waitFor();
  assert.deepEqual(lastCall("author-act").body, { book: "a-book", action: "change-accept", number: 12, title: "Fix a typo" });
  await page.goto(`${origin}/#/a-book/drafts`);
  await page.locator("li", { hasText: "Fix a typo" }).getByRole("button", { name: "Decline" }).click();
  await page.getByText("Declined, with a note thanking them.").waitFor();
  assert.equal(lastCall("author-act").body.action, "change-decline");
  await page.getByRole("link", { name: /recieve/ }).waitFor();
});

test("drafts: formatting problems block Publish — each with its chapter and Fix; dead links don't; the reason is right above the button", async () => {
  await signIn();
  stub.s.publish = { ...stub.s.publish, state: "lint", can_publish: false, state_words: "This cannot go to readers yet.",
    lint: [{ path: CH1_PATH, line: 3, rule: "MD045", description: "Images should have alternate text" }, { path: "docs/README.md", line: 1, rule: "MD041", description: "First line" }], lint_count: 2,
    links: { checked: true, dead: [{ url: "https://gone.example/x", file: CH1_PATH, status: "404" }] } };
  await page.goto(`${origin}/#/a-book/drafts`);
  await page.getByRole("heading", { name: "Formatting: 2 problems to fix" }).waitFor();
  const fix = page.getByRole("link", { name: "Fix" });
  assert.equal(await fix.getAttribute("href"), `#/a-book/edit/${encodeURIComponent(CH1_PATH)}/line/3`);
  assert.match(await page.locator(".check.bad li").innerText(), /^Chapter 1, line 3: A picture has no description/);
  await page.getByText("1 problem in the book's behind-the-scenes files", { exact: false }).waitFor();
  await page.getByText("1 link to other websites doesn't work").waitFor();
  const go = page.getByRole("button", { name: "Publish 5 changes" });
  assert.equal(await go.isDisabled(), true);
  assert.equal(await page.locator(".publish-reason").textContent(), "Fix the 2 formatting problems above first.");
  assert.equal(await page.locator(".publish > *").first().evaluate((n) => n.className), "publish-reason", "the reason is directly above the button");
  await noFileNames();
  await fix.click();
  await page.waitForFunction(() => document.querySelector("#editor-text")?.selectionEnd > 0);
});

test("drafts: a check that couldn't run says so with Check again, never an empty warning", async () => {
  await signIn();
  stub.s.publish = { ...stub.s.publish, state: "unchecked", can_publish: false, state_words: "The pages' formatting couldn't be checked just now." };
  await page.goto(`${origin}/#/a-book/drafts`);
  await page.getByText("The formatting check couldn't be run just now, so publishing waits for it.").waitFor();
  assert.equal(await page.locator(".publish-reason").textContent(), "The formatting check couldn't be run just now.");
  stub.s.publish = { ...stub.s.publish, state: "clean", can_publish: true, lint: [], lint_count: 0 };
  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByText("✓ Formatting: nothing to fix.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Publish 5 changes" }).isDisabled(), false);

  stub.s.publishError = true;
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  await page.getByText("The checks couldn't be fetched just now, so publishing waits for them.").waitFor();
  await page.getByRole("button", { name: "Check again" }).waitFor();
});

test("drafts: Publish N changes — one press, Publishing… then Published with links to the changed chapters", async () => {
  await signIn();
  stub.s.publish = { ...stub.s.publish, open: false, number: null, state: "not_open", can_publish: false, lint: [], lint_count: 0 };
  await page.goto(`${origin}/#/a-book/drafts`);
  const go = page.getByRole("button", { name: "Publish 5 changes" });
  assert.equal(await go.isDisabled(), false);
  assert.equal(await page.getByRole("checkbox").count(), 0, "no tick box");
  stub.s.publish = { ...stub.s.publish, open: true, number: 30, state: "clean", can_publish: true };
  await go.click();
  await page.getByRole("heading", { name: "Published" }).waitFor();
  const acts = stub.s.requests.filter((r) => r.endpoint === "author-act").map((r) => r.body);
  assert.deepEqual(acts, [{ book: "a-book", action: "publish-prepare" }, { book: "a-book", action: "publish", number: 30, confirm: true }]);
  assert.deepEqual(await page.locator(".published li a").evaluateAll((as) => as.map((a) => [a.textContent, a.href])),
    [["Chapter 1", "https://a-book.example.org/chapters/chapter-01"], ["Water", "https://a-book.example.org/chapters/chapter-04"]]);
});

test("drafts: a publish that fails says so in plain words, with Try again", async () => {
  await signIn();
  stub.s.publish = { ...stub.s.publish, lint: [], lint_count: 0 };
  await page.goto(`${origin}/#/a-book/drafts`);
  await page.route(`${API}author-act`, (route) => route.fulfill({ status: 409, contentType: "application/json", headers: { "access-control-allow-origin": origin }, body: JSON.stringify({ error: "x", userMessage: "What is waiting to go live has changed." }) }), { times: 1 });
  await page.getByRole("button", { name: "Publish 5 changes" }).click();
  await page.getByText("What is waiting to go live has changed.").waitFor();
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByRole("heading", { name: "Published" }).waitFor();
});

test("old links land: Waiting for you and the publish screen open Drafts; a chapter opens in the editor", async () => {
  await signIn();
  for (const hash of ["waiting", "publish", "change/12"]) {
    await page.goto(`${origin}/#/a-book/${hash}`);
    await page.getByRole("heading", { name: "Drafts", exact: true }).waitFor();
  }
  await page.goto(`${origin}/#/a-book/chapter/${encodeURIComponent(CH1_PATH)}`);
  await page.getByRole("tab", { name: "Edit" }).waitFor();
});

// --- people ---------------------------------------------------------------------------------

test("people: the book's authors; invite by username; pending until live, and one change at a time", async () => {
  await signIn();
  await page.getByRole("link", { name: "A Book of Things" }).click();
  await page.getByRole("link", { name: "People" }).click();
  await page.getByRole("heading", { name: "Who can work on this book here" }).waitFor();
  const rows = page.locator("ul.list > li");
  assert.deepEqual(await rows.allInnerTexts().then((t) => t.map((x) => x.split("\n")[0])), ["@author-one you", "@co-author", "@textbookproject2026-alt looks after the platform"]);
  // Never the platform owner; anyone else, yourself included.
  assert.equal(await rows.nth(2).getByRole("button", { name: "Remove", exact: true }).count(), 0);
  assert.equal(await rows.nth(0).getByRole("button", { name: "Remove", exact: true }).count(), 1);

  await page.locator("#invite-login").fill("@co-author");
  await page.getByRole("button", { name: "Invite" }).click();
  await page.getByText("@co-author can already work on this book.").waitFor();
  assert.equal(stub.s.requests.filter((r) => r.endpoint === "author-people-change").length, 0);

  stub.s.peopleAnswers = [[404, { error: "no such account", userMessage: "There's no GitHub account called “nobdy”. Check the spelling." }]];
  await page.locator("#invite-login").fill("nobdy");
  await page.getByRole("button", { name: "Invite" }).click();
  await page.getByText("There's no GitHub account called “nobdy”.", { exact: false }).waitFor();

  await page.locator("#invite-login").fill("NewPerson");
  await page.getByRole("button", { name: "Invite" }).click();
  await page.getByText("@NewPerson is invited.", { exact: false }).waitFor();
  assert.deepEqual(lastCall("author-people-change").body, { book: "a-book", action: "add", login: "NewPerson" });
  await page.getByText("waiting for the registry's checks", { exact: false }).waitFor();
  assert.equal(await page.getByRole("link", { name: "See it on GitHub" }).getAttribute("href"), "https://github.com/textbookproject2026-alt/textbook-registry/pull/61");
  await page.getByText("One change at a time", { exact: false }).waitFor();
  assert.equal(await page.locator("#invite-login").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Remove", exact: true }).count(), 0, "nothing else while one is open");
});

test("people: remove asks first; the last author can't be removed; not switched on says so", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/people`);
  await page.locator("ul.list > li").nth(1).getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByText("Remove @co-author? They lose access once the change has gone through.").waitFor();
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await page.getByText("@co-author is being removed.", { exact: false }).waitFor();
  assert.deepEqual(lastCall("author-people-change").body, { book: "a-book", action: "remove", login: "co-author" });

  stub.s.people = { authors: ["author-one"], owner: "textbookproject2026-alt", registry: "r".repeat(40), pending: [] };
  await page.goto(`${origin}/#/a-book/waiting`);
  await page.goto(`${origin}/#/a-book/people`);
  await page.getByRole("heading", { name: "Invite someone" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Remove", exact: true }).count(), 0);

  await context.route(`${API}author-people?**`, (route) => route.fulfill({ status: 404, contentType: "application/json", headers: { "access-control-allow-origin": origin }, body: "{}" }));
  await page.goto(`${origin}/#/a-book/waiting`);
  await page.goto(`${origin}/#/a-book/people`);
  await page.getByText("isn't switched on yet", { exact: false }).waitFor();
});

// --- the book's lint before Send and Publish; reading order; People that failed ----------------
test("people: a change that didn't go through says so, with the reasons, and doesn't hold up the next", async () => {
  await signIn();
  stub.s.people = { ...stub.s.people, pending: [{ number: 63, url: "https://github.com/textbookproject2026-alt/textbook-registry/pull/63", action: "add", login: "gobi10k", by: "author-one", state: "failed",
    when: new Date(Date.now() - 4 * 86400e3).toISOString(), reasons: ["a-book authors: there is no GitHub account called gobi10k"] }] };
  await page.goto(`${origin}/#/a-book/people`);
  await page.getByRole("heading", { name: "Didn't go through" }).waitFor();
  await page.getByText("a-book authors: there is no GitHub account called gobi10k").waitFor();
  assert.equal(await page.getByRole("heading", { name: "On its way" }).count(), 0);
  assert.equal(await page.locator("#invite-login").count(), 1, "a new invite can be made");
});

const INDEX_WITH_CONTENTS = "# A Book of Things\n\n## Contents\n\n- **[[chapters/chapter-01|Chapter 1]]**\n- **[[chapters/chapter-02|Chapter 2: Soils]]**\n- **[[chapters/chapter-03|Chapter 3]]**\n\n## About\n\nx\n";


// --- history -----------------------------------------------------------------------------------

test("history: the book's changes in this site, paged, marked live or waiting; not GitHub", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book`);
  const link = page.getByRole("link", { name: "History", exact: true });
  assert.equal(await link.getAttribute("href"), "#/a-book/history");
  await link.click();
  await page.getByRole("heading", { name: "History", exact: true }).waitFor();
  const items = page.locator("ul.history > li");
  assert.equal(await items.count(), 30);
  assert.match(await items.nth(0).textContent(), /Say it better — author-one.*Waiting in drafts/);
  assert.match(await items.nth(2).textContent(), /Change 2 — co-author.*Live/);
  await page.getByRole("button", { name: "Show older changes" }).click();
  await items.nth(30).waitFor();
  assert.deepEqual(lastCall("author-history").query, { book: "a-book", page: "2" });
});

test("history: a page's, from the editor; Restore opens the old text in the editor, which saves it on the drafts as they are now", async () => {
  await signIn();
  await openEditor();
  await page.getByRole("link", { name: "History of this page" }).click();
  await page.getByRole("heading", { name: "History of “Chapter 1”" }).waitFor();
  assert.deepEqual(lastCall("author-history").query, { book: "a-book", path: CH1_PATH });
  await page.locator("ul.history > li a").nth(1).click();
  await page.getByRole("heading", { name: "What this change did to the page" }).waitFor();
  assert.equal(await page.locator(".diff del").first().textContent(), "first");
  await noFileNames();
  await page.getByRole("button", { name: "Restore this version" }).click();
  await page.getByText("from its history").waitFor();
  await page.getByText(/^Draft saved/).waitFor();
  const sent = sends()[0];
  assert.equal(sent.base, HEAD, "on the drafts as they are now, not the old revision");
  assert.match(sent.files[0].text, /Some older text/);
});

test("history: a change that removed a page offers Bring it back, with its line in the reading order", async () => {
  await signIn();
  const sha = stub.s.history[0].sha;
  await page.route(`${API}author-history?*`, (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": origin },
    body: JSON.stringify({ ...stub.s.history[0], message: "Remove “Rocks”", files: [], page: { path: "chapters/chapter-03.md", text: null, before: ROCKS } }) }));
  await page.goto(`${origin}/#/a-book/revision/${sha}/${encodeURIComponent("chapters/chapter-03.md")}`);
  await page.getByRole("button", { name: "Bring “Rocks” back" }).click();
  await page.getByText("“Rocks” is back in the drafts, at the end of the reading order.", { exact: false }).waitFor();
  const sent = sends()[0];
  assert.deepEqual(sent.files[0], { path: "chapters/chapter-03.md", text: ROCKS });
  assert.match(sent.files[1].text, /- \[\[chapters\/chapter-04\|Water\]\]\n- \[\[chapters\/chapter-03\|Rocks\]\]\n$/);
});

test("at 375px nothing scrolls sideways", async () => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn();
  for (const hash of ["#/", "#/a-book", "#/a-book/drafts", `#/a-book/edit/${encodeURIComponent(CH1_PATH)}`, "#/a-book/import", "#/a-book/history"]) {
    await page.goto(`${origin}/${hash}`);
    await page.locator("h1").first().waitFor();
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${hash} overflows by ${overflow}px`);
  }
});

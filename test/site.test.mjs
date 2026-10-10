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
import { createStub, importDone, API, HEAD, MOVED, SENT, LIVE, CH1_DRAFTS, ROCKS, INDEX_LIVE, REGISTRY } from "./stub.mjs";

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
    // The first-visit privacy note sits over the window's corner: seen once, as a
    // returning author has, except in its own test.
    try {
      if (!sessionStorage.getItem("show-privacy")) localStorage.setItem("tb-privacy-ok", "1");
    } catch {
      /* no storage */
    }
  });
});
afterEach(async () => {
  await context.close();
  assert.deepEqual(problems, [], problems.join("\n"));
});

/** Signed in: the way an emailed link does it (#/link/<token>, then its button). */
async function signIn() {
  await page.goto(`${origin}/#/link/${"L".repeat(43)}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Your books" }).waitFor();
}
const lastCall = (endpoint, pred = () => true) => stub.s.requests.filter((r) => r.endpoint === endpoint && pred(r)).at(-1);

// --- signing in, books, theme ------------------------------------------------------------------

test("signed out: email me a link (the same answer for any address); the link signs in; every call goes through this site with the session", async () => {
  await page.goto(`${origin}/`);
  await page.getByRole("heading", { name: "Work on your textbook" }).waitFor();
  await page.getByLabel("Your email address").fill("someone@example.org");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByText("If that address has access, we've sent a link.").waitFor();
  assert.deepEqual(stub.s.own.find((c) => c.path === "/api/auth/request").body, { email: "someone@example.org" });
  // The link: one press, then in.
  await page.goto(`${origin}/#/link/${"L".repeat(43)}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Your books" }).waitFor();
  await page.getByRole("link", { name: "A Book of Things" }).waitFor();
  // Every author call went to this site's /fn/, marked as the site's own; no token anywhere.
  assert.ok(stub.s.requests.length > 0);
  assert.ok(stub.s.requests.every((r) => r.auth === undefined));
  assert.ok(stub.s.own.filter((c) => c.method === "POST").every((c) => c.header === "1"));
  // Used once: the same link again says so.
  await page.goto(`${origin}/#/link/${"L".repeat(43)}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("That link has been used or has expired.").waitFor();
  // Nothing about the sign-in is kept in the page's storage (the session is an HttpOnly cookie).
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter((k) => k !== "tb-privacy-ok" && k !== "theme")), []);
});

test("sign out, and a 401 from the endpoints, both return to the sign-in screen", async () => {
  await signIn();
  await page.getByRole("button", { name: /^Account: Author One$/ }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.getByRole("heading", { name: "Work on your textbook" }).waitFor();
  assert.equal(stub.s.session, false);
  stub.s.links["L".repeat(43)] = "signin";
  await signIn();
  stub.s.status401 = true;
  await page.getByRole("link", { name: "A Book of Things" }).click();
  await page.getByRole("heading", { name: "Work on your textbook" }).waitFor();
});

test("an invitation: confirm the name the book credits you by, Continue, and you're in the book", async () => {
  await page.goto(`${origin}/#/invite/${"I".repeat(43)}`);
  await page.getByRole("heading", { name: "Join A Book of Things" }).waitFor();
  await page.getByText("Author One invited you to work on it.").waitFor();
  const name = page.getByLabel("Your name as it appears in the book's credits");
  assert.equal(await name.inputValue(), "New Person");
  await name.fill("New Person-Smith");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/#\/a-book$/);
  assert.deepEqual(stub.s.own.find((c) => c.path === "/api/invite" && c.body.action === "accept").body, { kind: "invite", token: "I".repeat(43), action: "accept", name: "New Person-Smith" });
  // Used: the link says so.
  await page.goto(`${origin}/#/invite/${"I".repeat(43)}`);
  await page.getByRole("heading", { name: "This invitation has expired" }).waitFor();
});

test("a copied invitation: nothing happens here but the invitation going to the address", async () => {
  stub.s.session = false;
  await page.goto(`${origin}/#/invite/${"J".repeat(43)}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("One more step: we've emailed this invitation to new@example.org. Open it there to join A Book of Things.").waitFor();
  assert.equal(stub.s.session, false);
});

test("a claim link: confirm the address you'll sign in with", async () => {
  await page.goto(`${origin}/#/claim/${"C".repeat(43)}`);
  await page.getByText("Brandon, you'll sign in to the author site with brandon@example.org from now on.").waitFor();
  await page.getByRole("button", { name: "Use this address" }).click();
  await page.getByRole("heading", { name: "Your books" }).waitFor();
});

test("an account that is no book's author is told so, and how to fix it", async () => {
  stub.s.books = [];
  await signIn();
  await page.getByText("isn't one of any book's authors").waitFor();
});

test("the guide opens in a new tab: from the header signed out, from the account menu signed in", async () => {
  await page.goto(`${origin}/`);
  const guide = page.locator(".masthead").getByRole("link", { name: "Guide", exact: true });
  assert.equal(await guide.getAttribute("href"), "https://guide.confused4now.org");
  assert.equal(await guide.getAttribute("target"), "_blank");
  await signIn();
  assert.equal(await guide.isVisible(), false, "signed in, it is in the account menu");
  await page.getByRole("button", { name: /^Account: / }).click();
  const item = page.getByRole("menuitem", { name: "Guide for authors" });
  assert.equal(await item.getAttribute("href"), "https://guide.confused4now.org");
  assert.equal(await item.getAttribute("target"), "_blank");
});

test("the account menu on a phone: avatar only, the full login inside, no label broken inside a word; Escape closes it", async () => {
  await page.setViewportSize({ width: 360, height: 740 });
  stub.s.me = { ...stub.s.me, name: "Alexander Gordon-Whitfield", email: "a.very.long.address.for.testing@example.org" };
  await signIn();
  const button = page.getByRole("button", { name: "Account: Alexander Gordon-Whitfield" });
  assert.equal(await button.locator(".login").isVisible(), false, "only the initial under 720px");
  await button.click();
  assert.equal(await button.getAttribute("aria-expanded"), "true");
  await page.locator(".account-name").getByText("a.very.long.address.for.testing@example.org").waitFor();
  for (const name of ["Guide for authors", "Settings", "Sign out", "Sign out everywhere"]) {
    const lines = await page.getByRole("menuitem", { name, exact: true }).evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
    });
    assert.equal(lines, 1, `${name} on one line`);
  }
  await page.keyboard.press("Escape");
  assert.equal(await button.getAttribute("aria-expanded"), "false");
  // The book's tabs: one row, the current one in view.
  await page.goto(`${origin}/#/a-book/history`);
  await page.getByRole("heading", { name: "History", exact: true }).waitFor();
  // The strip scrolls the current tab into view a frame or two after it is drawn.
  await page.waitForFunction(() => {
    const nav = document.querySelector("nav.tabs");
    const cur = nav?.querySelector('[aria-current="page"]')?.getBoundingClientRect();
    const box = nav?.getBoundingClientRect();
    return cur && cur.right <= box.right + 1 && cur.left >= box.left - 1;
  }, null, { timeout: 3000 }).catch(() => {});
  const tabs = await page.locator("nav.tabs").evaluate((nav) => {
    const tops = new Set([...nav.querySelectorAll("a")].map((a) => Math.round(a.getBoundingClientRect().top)));
    const cur = nav.querySelector('[aria-current="page"]').getBoundingClientRect();
    const box = nav.getBoundingClientRect();
    const state = { scrollLeft: nav.scrollLeft, maxScroll: nav.scrollWidth - nav.clientWidth, current: `${Math.round(cur.left)}–${Math.round(cur.right)}`, strip: `${Math.round(box.left)}–${Math.round(box.right)}`, labels: [...nav.querySelectorAll("a")].map((a) => a.textContent).join("|"), fonts: document.fonts.status };
    return { rows: tops.size, visible: cur.left >= box.left - 1 && cur.right <= box.right + 1, state };
  });
  // When it fails, say what the strip looked like (it has failed only now and then, in CI).
  assert.deepEqual({ rows: tabs.rows, visible: tabs.visible }, { rows: 1, visible: true }, JSON.stringify(tabs.state));
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
  await page.getByRole("button", { name: /^Account: / }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
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
  assert.deepEqual((await rows.allInnerTexts()).map((t) => t.split("\n").filter((l) => !/suggestions?$/.test(l)).slice(0, 3).join(" | ")), ["⠿ | Soils | Published", "⠿ | Chapter 1 | Draft changes", "⠿ | Water | New", "⠿ | Realism | Published", "⠿ | Glossary | Published"]);
  // Each chapter's open reader suggestions, written and proposed, linking to its editor.
  assert.equal(await rows.nth(0).locator(".badge.suggestions").innerText(), "1 suggestion");
  assert.equal(await rows.nth(1).locator(".badge.suggestions").innerText(), "2 suggestions");
  assert.equal(await rows.nth(1).locator(".badge.suggestions").getAttribute("href"), `#/a-book/edit/${encodeURIComponent(CH1_PATH)}`);
  assert.equal(await rows.nth(2).locator(".badge.suggestions").count(), 0);
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

test("editor: the page's open reader suggestions, with Accept and Decline", async () => {
  await signIn();
  await openEditor();
  const box = page.getByRole("region", { name: "Reader suggestions on this page" });
  await box.getByRole("heading", { name: "Reader suggestions on this page (2)" }).waitFor();
  await box.getByText('"recieve" should be "receive"').waitFor();
  // The accepted one waits for the change; the other can be answered here.
  assert.equal(await box.getByText("Accepted").count(), 1);
  // Declining needs a reason (batch 2c): the button stays off until it has 10 characters.
  await box.getByRole("button", { name: "Decline…" }).click();
  const why = box.getByLabel("Why is this being declined?");
  await why.fill("too short");
  assert.equal(await box.getByRole("button", { name: "Decline", exact: true }).isDisabled(), true);
  await box.getByText("At least 10 characters (9 so far).").waitFor();
  await why.fill("The chapter already says this in ¶4.");
  await Promise.all([page.waitForResponse((r) => r.url().includes("author-act")), box.getByRole("button", { name: "Decline", exact: true }).click()]);
  await box.getByText(/^Declined: your reason is posted, with a courteous reply\./).waitFor();
  const done = lastCall("author-act").body;
  assert.equal(done.action, "suggestion-decline");
  assert.equal(done.number, 7);
  assert.equal(done.reason, "The chapter already says this in ¶4.");
});

test("editor: a proposed edit to the page, accepted from the editor", async () => {
  await signIn();
  await openEditor("chapters/chapter-02.md");
  const box = page.getByRole("region", { name: "Reader suggestions on this page" });
  await box.getByText("Fix a typo").waitFor();
  await Promise.all([page.waitForResponse((r) => r.url().includes("author-act")), box.getByRole("button", { name: "Accept" }).click()]);
  await box.getByText("Accepted: it is in the drafts.").waitFor();
  assert.deepEqual([lastCall("author-act").body.action, lastCall("author-act").body.number], ["change-accept", 12]);
});

test("editor: no suggestions, no list", async () => {
  await signIn();
  await openEditor("chapters/chapter-04.md");
  await page.getByRole("tab", { name: "Edit" }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole("region", { name: "Reader suggestions on this page" }).count(), 0);
});

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
  const typo = page.locator("li", { hasText: "Fix a typo" });
  await typo.getByRole("button", { name: "Decline…" }).click();
  await typo.getByLabel("Why is this being declined?").fill("We keep the original wording here.");
  await typo.getByRole("button", { name: "Decline", exact: true }).click();
  await page.getByText(/^Declined: your reason is posted, with a note thanking them\./).waitFor();
  assert.deepEqual(lastCall("author-act").body, { book: "a-book", action: "change-decline", number: 12, reason: "We keep the original wording here." });
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
  assert.equal(await page.locator(".publish-preview").textContent(), "Publishing will move 5 changes from Being edited to Published.");
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
  await page.route(`${origin}/fn/author-act`, (route) => route.fulfill({ status: 409, contentType: "application/json", headers: { "access-control-allow-origin": origin }, body: JSON.stringify({ error: "x", userMessage: "What is waiting to go live has changed." }) }), { times: 1 });
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

test("people: who works on the book; invite by name and email, sent or as a link; the change shows at once with an audit line", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/people`);
  await page.getByRole("heading", { name: "Who works on this book" }).waitFor();
  const people = page.locator("ul.people > li");
  assert.deepEqual(await people.locator("strong").allTextContents(), ["Author One", "Co Author", "Brandon"]);
  await page.getByText("Author One invited Co Author · ").waitFor();
  await page.getByLabel("Their name, as the book will credit them").fill("Dee Writer");
  await page.getByLabel("Their email address").fill("dee@example.org");
  await page.getByRole("button", { name: "Send the invitation" }).click();
  await page.getByText("Invitation sent to dee@example.org.").waitFor();
  await page.getByText("Dee Writer (dee@example.org)").waitFor();
  await page.getByText(/^Author One invited Dee Writer · /).waitFor();
  assert.deepEqual(stub.s.own.filter((c) => c.path === "/api/members" && c.method === "POST").at(-1).body, { book: "a-book", action: "invite", name: "Dee Writer", email: "dee@example.org", send: true });
  // Or a link to send yourself.
  await page.getByLabel("Their name, as the book will credit them").fill("Eve Editor");
  await page.getByLabel("Their email address").fill("eve@example.org");
  await page.getByRole("button", { name: "Copy a link instead" }).click();
  assert.equal(await page.getByLabel("The invitation link").inputValue(), `${origin}/#/invite/${"I".repeat(43)}`);
});

test("people: remove asks first and takes effect at once; a member without an email gets a link sent for them", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/people`);
  await page.getByText("needs an email address").waitFor();
  // Only the platform maintainer gives an address for someone else.
  await page.getByText("Brandon adds it the next time they sign in with GitHub.", { exact: false }).waitFor();
  assert.equal(await page.getByLabel("Brandon's email address").count(), 0);
  stub.s.me = { ...stub.s.me, maintainer: true };
  await page.reload();
  await page.getByLabel("Brandon's email address").fill("brandon@example.org");
  await page.getByRole("button", { name: "Send them a link" }).click();
  await page.getByText("Once Brandon opens it, they sign in with it.").waitFor();
  const row = page.locator("ul.people > li", { hasText: "Co Author" });
  await row.getByRole("button", { name: "Remove" }).click();
  assert.equal(stub.s.own.filter((c) => c.body?.action === "remove").length, 0, "asks first");
  await page.getByRole("button", { name: "Remove Co Author" }).click();
  await page.getByText("Co Author is no longer on this book.").waitFor();
  assert.deepEqual(await page.locator("ul.people > li strong").allTextContents(), ["Author One", "Brandon"]);
  await page.getByText(/^Author One removed Co Author · /).waitFor();
  assert.equal(await page.locator("ul.people > li", { hasText: "Author One" }).getByRole("button", { name: "Remove" }).count(), 0, "not yourself");
});

test("people: your own reader-suggestion emails, off and on again", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/people`);
  await page.getByRole("button", { name: "Stop emailing me" }).click();
  await page.getByRole("button", { name: "Email me again" }).waitFor();
  assert.equal(stub.s.me.notify, false);
  await page.getByRole("button", { name: "Email me again" }).click();
  await page.getByRole("button", { name: "Stop emailing me" }).waitFor();
});

// --- history -----------------------------------------------------------------------------------

test("history: the book's changes in this site, paged, in the states readers see; not GitHub", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book`);
  const link = page.getByRole("link", { name: "History", exact: true });
  assert.equal(await link.getAttribute("href"), "#/a-book/history");
  await link.click();
  await page.getByRole("heading", { name: "History", exact: true }).waitFor();
  const open = page.locator("ul.history.proposed > li");
  assert.equal(await open.count(), 1);
  assert.match(await open.nth(0).textContent(), /Say where this is from — Jo Reader.*Proposed · Note/);
  assert.equal(await open.locator("a").getAttribute("href"), "#/a-book/suggestion/12");
  assert.deepEqual(lastCall("history").query, { book: "a-book" });
  const items = page.locator("ul.history:not(.proposed):not(.declined-list) > li");
  assert.equal(await items.count(), 30);
  assert.match(await items.nth(0).textContent(), /Say it better — author-one.*Being edited/);
  assert.match(await items.nth(2).textContent(), /Change 2 — co-author.*Published/);
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
  await page.locator("ul.history:not(.proposed) > li a").nth(1).click();
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
  await page.route(`${origin}/fn/author-history?*`, (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": origin },
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

test("privacy: the first-visit note, OK closes it for good; the footer links Privacy", async () => {
  await page.goto(`${origin}/`);
  await page.evaluate(() => {
    sessionStorage.setItem("show-privacy", "1");
    localStorage.removeItem("tb-privacy-ok");
  });
  await page.reload();
  const note = page.getByRole("region", { name: "Privacy" });
  await note.getByText("No tracking cookies. Margin comments are provided by Hypothes.is, which may set its own cookies.").waitFor();
  assert.equal(await note.getByRole("link", { name: "Privacy" }).getAttribute("href"), "https://confused4now.org/privacy");
  await note.getByRole("button", { name: "OK" }).click();
  assert.equal(await note.count(), 0);
  await page.reload();
  await page.locator("footer.site-foot").waitFor();
  assert.equal(await page.getByRole("region", { name: "Privacy" }).count(), 0);
  assert.equal(await page.locator("footer.site-foot").getByRole("link", { name: "Privacy" }).getAttribute("href"), "https://confused4now.org/privacy");
});

// --- writing new pages (9 Oct) ---------------------------------------------------------

test("new chapter: the title and where it goes; chapters/chapter-NN.md with a heading, in the Contents, one change, then the editor", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book`);
  await page.getByRole("link", { name: "New chapter" }).click();
  await page.locator("#new-title").fill("Rivers and lakes");
  await page.locator("#new-where").selectOption({ label: "After “Soils”" });
  await Promise.all([page.waitForResponse((r) => r.url().includes("author-send")), page.getByRole("button", { name: "Make the chapter" }).click()]);
  const sent = sends()[0];
  assert.equal(sent.message, "New chapter “Rivers and lakes”");
  assert.equal(sent.base, HEAD);
  assert.deepEqual(sent.files.map((f) => f.path), ["chapters/chapter-05.md", "index.md"]);
  assert.equal(sent.files[0].text, "# Rivers and lakes\n");
  assert.match(sent.files[1].text, /- \[\[chapters\/chapter-02\|Soils\]\]\n- \[\[chapters\/chapter-05\|Rivers and lakes\]\]\n- \[\[chapters\/chapter-01\|Chapter 1\]\]/);
  await page.waitForURL(`${origin}/#/a-book/edit/${encodeURIComponent("chapters/chapter-05.md")}`);
  await page.getByRole("tab", { name: "Edit" }).waitFor();
});

test("new concept page: into a folder the book has, or a new one; at the end of the Contents; then the editor", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/new/concept`);
  await page.locator("#new-title").fill("Realism");
  await page.getByRole("button", { name: "Make the concept page" }).click();
  await page.getByText("There is already a page called that in this folder.").waitFor();
  assert.equal(sends().length, 0);
  await page.locator("#new-title").fill("Emergence");
  await page.locator("#new-folder").selectOption({ label: "A new folder…" });
  await page.locator("#new-folder-name").fill("Key ideas");
  await Promise.all([page.waitForResponse((r) => r.url().includes("author-send")), page.getByRole("button", { name: "Make the concept page" }).click()]);
  const sent = sends()[0];
  assert.deepEqual(sent.files.map((f) => f.path), ["chapters/Key ideas/Emergence.md", "index.md"]);
  assert.equal(sent.files[0].text, "# Emergence\n");
  assert.match(sent.files[1].text, /- \[\[chapters\/Key ideas\/Emergence\|Emergence\]\]\n$/);
  assert.equal(sent.message, "New concept page “Emergence”");
  await page.waitForURL(`${origin}/#/a-book/edit/${encodeURIComponent("chapters/Key ideas/Emergence.md")}`);
});

test("add glossary term: from a chapter, the Glossary page as its own change in A–Z order; on the Glossary, into the text", async () => {
  await signIn();
  await openEditor();
  await page.getByRole("button", { name: "Add glossary term" }).click();
  await page.locator("#gloss-term").fill("Agency");
  await page.locator("#gloss-def").fill("the capacity to act");
  await Promise.all([page.waitForResponse((r) => r.url().includes("author-send")), page.getByRole("button", { name: "Add to the glossary" }).click()]);
  await page.getByText("“Agency” is in the glossary.").waitFor();
  const sent = sends().at(-1);
  assert.deepEqual(sent.files.map((f) => f.path), ["glossary.md"]);
  assert.equal(sent.files[0].text, "# Glossary\n\n## Agency\n\nThe capacity to act.\n");
  assert.equal(sent.message, "Add “Agency” to the glossary");

  const box = await openEditor("glossary.md");
  await page.getByRole("button", { name: "Add glossary term" }).click();
  await page.locator("#gloss-term").fill("Structure");
  await page.locator("#gloss-def").fill("What endures.");
  await page.getByRole("button", { name: "Add to the glossary" }).click();
  assert.match(await box.inputValue(), /## Structure\n\nWhat endures\.\n$/);
  await page.getByText(/^Draft saved \d\d:\d\d$/).waitFor();
});

test("credits: add an editor with an ORCID iD (checked), reorder the authors, saved to the drafts as one change", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/credits`);
  await page.getByRole("heading", { name: "Authors" }).waitFor();
  await page.getByRole("button", { name: "Add author" }).click();
  await page.getByLabel("Author 1: name").fill("Ann Author");
  await page.getByRole("button", { name: "Add author" }).click();
  await page.getByLabel("Author 2: name").fill("Bo Second");
  await page.locator(".credit-row").nth(1).getByRole("button", { name: "Up" }).click();
  await page.getByRole("button", { name: "Add editor" }).click();
  await page.getByLabel("Editor 1: name").fill("Ed Itor");
  await page.getByLabel("Editor 1: ORCID iD").fill("0000-0002-1825-0098");
  await page.getByRole("button", { name: "Save to the drafts" }).click();
  await page.getByText(/isn't an ORCID iD/).waitFor();
  assert.equal(sends().length, 0, "a wrong check digit sends nothing");
  await page.getByLabel("Editor 1: ORCID iD").fill("0000-0002-1825-0097");
  await page.getByLabel("Editor 1: GitHub username").fill("@ed-itor");
  await page.getByRole("button", { name: "Save to the drafts" }).click();
  await page.getByText("Saved to the drafts. Readers see it when you publish.").waitFor();
  assert.equal(sends().length, 1);
  const sent = sends()[0];
  assert.equal(sent.base, HEAD);
  assert.equal(sent.message, "Credits: the book's authors and editors");
  assert.equal(sent.files[0].path, "index.md");
  assert.match(sent.files[0].text, /^---\nauthors:\n  - "Bo Second"\n  - "Ann Author"\neditors:\n  - name: "Ed Itor"\n    orcid: "0000-0002-1825-0097"\n    github: "ed-itor"\n---\n\n# A Book of Things\n/);
});

test("credits: with ORCID switched off for the platform, no ORCID field; an iD already there is kept on save", async () => {
  await signIn();
  stub.s.registry = { ...structuredClone(REGISTRY), platform: { ...REGISTRY.platform, features: { orcid: false } } };
  const index = stub.s.bookFiles.get("index.md").toString("utf8");
  stub.s.bookFiles.set("index.md", Buffer.from(index.replace(/^/, '---\neditors:\n  - name: "Ed Itor"\n    orcid: "0000-0002-1825-0097"\n---\n')));
  await page.goto(`${origin}/#/a-book/credits`);
  await page.getByLabel("Editor 1: name").waitFor();
  assert.equal(await page.getByLabel(/ORCID/).count(), 0);
  assert.equal(await page.getByText(/ORCID/).count(), 0);
  await page.getByLabel("Editor 1: name").fill("Ed Itor-Smith");
  await page.getByRole("button", { name: "Save to the drafts" }).click();
  await page.getByText("Saved to the drafts. Readers see it when you publish.").waitFor();
  assert.match(sends().at(-1).files[0].text, /editors:\n  - name: "Ed Itor-Smith"\n    orcid: "0000-0002-1825-0097"\n/);
});

test("credits: a chapter's own authors and editors, said to replace the book's", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/credits`);
  await page.getByLabel("Credits for").selectOption({ label: "Chapter 1" });
  await page.getByText(/replace the book's for that chapter/).waitFor();
  await page.getByRole("button", { name: "Add author" }).click();
  await page.getByLabel("Author 1: name").fill("Cee Writer");
  await page.getByRole("button", { name: "Save to the drafts" }).click();
  await page.getByText("Saved to the drafts. Readers see it when you publish.").waitFor();
  const sent = sends()[0];
  assert.equal(sent.files[0].path, "chapters/chapter-01.md");
  assert.match(sent.files[0].text, /^---\nauthors:\n  - "Cee Writer"\n---\n\n# Chapter 1\n/);
});

// --- batch 2c ----------------------------------------------------------------------------------

test("history: Declined, with who proposed and declined it, the reason (or none recorded), Show changes and comments; add one, delete your own", async () => {
  await signIn();
  await page.goto(`${origin}/#/a-book/history`);
  await page.getByRole("heading", { name: "Declined (2)" }).waitFor();
  const first = page.locator("li.declined", { hasText: "A clearer opening" });
  await first.getByText("Declined · Proposed edit").waitFor();
  await first.getByText("Chapter One · Proposed by Jo Reader on 8 Oct 2026. Declined by Co Author on 9 Oct 2026.").or(first.getByText(/Proposed by Jo Reader on 8 Oct 2026\. Declined by Co Author on 9 Oct 2026\./)).first().waitFor();
  await first.getByText("We keep the original wording.").waitFor();
  await page.locator("li.declined", { hasText: "Make it weirder" }).getByText("No reason was recorded.").waitFor();
  // Show changes: the proposal's change, from the function's public history.
  await first.getByRole("button", { name: "Show changes" }).click();
  await first.getByText("The proposed opening.").waitFor();
  // Someone else's comment: no Delete. Add one: it shows, with Delete; delete it: gone.
  await first.getByText("Thanks, though.").waitFor();
  assert.equal(await first.getByRole("button", { name: "Delete" }).count(), 0);
  await first.getByRole("button", { name: "Add a comment" }).click();
  await first.getByLabel("Your comment").fill("We may revisit this next year.");
  await first.getByRole("button", { name: "Post comment" }).click();
  await page.getByText("Your comment was added.").waitFor();
  const again = page.locator("li.declined", { hasText: "A clearer opening" });
  await again.getByText("We may revisit this next year.").waitFor();
  assert.deepEqual(lastCall("author-act").body, { book: "a-book", action: "comment-add", number: 14, text: "We may revisit this next year." });
  await again.getByRole("button", { name: "Delete" }).click();
  await page.getByText("Your comment was deleted.").waitFor();
  assert.equal(await page.getByText("We may revisit this next year.").count(), 0);
  assert.deepEqual(lastCall("author-act").body, { book: "a-book", action: "comment-delete", number: 14, id: 901 });
});

test("where you're signed in: from the account menu, each browser with its last activity, this one marked; Sign out ends another", async () => {
  await signIn();
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("menuitem", { name: "Where you're signed in" }).click();
  await page.getByRole("heading", { name: "Where you're signed in" }).waitFor();
  const rows = page.locator("ul.sessions > li");
  assert.equal(await rows.count(), 2);
  await rows.nth(0).getByText("This browser").waitFor();
  await rows.nth(1).getByText(/^Last active /).waitFor();
  await page.getByRole("button", { name: "Sign out Safari on iPhone" }).click();
  await page.getByText("Safari on iPhone is signed out.").waitFor();
  assert.equal(await page.locator("ul.sessions > li").count(), 1);
  assert.deepEqual(stub.s.own.filter((c) => c.path === "/api/sessions" && c.method === "POST").at(-1).body, { id: "2222222222222222" });
});

test("a new-browser alert's link: opening it changes nothing; its button signs out everywhere, once", async () => {
  await signIn();
  for (let i = 0; i < 2; i++) {
    if (i) await page.reload();
    else await page.goto(`${origin}/#/revoke/${"R".repeat(43)}`);
    await page.getByRole("heading", { name: "Wasn't you?" }).waitFor();
    await page.getByText(/signed in on Safari on iPhone/).waitFor();
  }
  assert.equal(stub.s.own.filter((c) => c.path === "/api/auth/revoke" && c.body.action === "confirm").length, 0, "nothing on opening");
  assert.equal(stub.s.session, true);
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await page.getByText(/^Done: your account is signed out on every browser/).waitFor();
  assert.equal(stub.s.session, false);
  await page.reload();
  await page.getByRole("heading", { name: "This link has expired" }).waitFor();
});

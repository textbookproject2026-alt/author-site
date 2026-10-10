// The phone audit (batch 2b) on every screen of the author site, against the stubbed
// endpoints (test/stub.mjs, the real responses' shapes), signed in as a long login:
// the seven checks in phone-audit-checks.mjs at 360x740, 390x844 and 412x915, light
// and dark, plus the book's tabs on one row with the current one in view. A failure
// names the screen, size, theme, check and element.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startServer } from "./server.mjs";
import { createStub } from "./stub.mjs";
import { auditPage } from "./phone-audit-checks.mjs";

const CH1 = encodeURIComponent("chapters/chapter-01.md");
const SCREENS = [
  ["sign-in", "#/", { signedOut: true }],
  ["sign-in link", `#/link/${"L".repeat(43)}`, { signedOut: true }],
  ["invitation", `#/invite/${"I".repeat(43)}`, { signedOut: true }],
  ["your books", "#/"],
  ["chapters", "#/a-book"],
  ["editor", `#/a-book/edit/${CH1}`],
  ["drafts", "#/a-book/drafts"],
  ["people", "#/a-book/people"],
  ["credits", "#/a-book/credits"],
  ["history", "#/a-book/history"],
  ["history, a declined change open", "#/a-book/history", { setup: async (page) => {
    const d = page.locator("li.declined").first();
    await d.getByRole("button", { name: "Show changes" }).click();
    await d.getByRole("button", { name: "Add a comment" }).click();
    await page.getByText("The proposed opening.").waitFor();
  } }],
  ["drafts, declining", "#/a-book/drafts", { setup: async (page) => {
    await page.locator("li", { hasText: "Fix a typo" }).getByRole("button", { name: "Decline…" }).click();
    await page.getByLabel("Why is this being declined?").fill("x");
  } }],
  ["where you're signed in", "#/signed-in"],
  ["this wasn't me", `#/revoke/${"R".repeat(43)}`, { signedOut: true }],
  ["settings", "#/settings"],
  ["account menu", "#/a-book", { menu: true }],
];
const SIZES = [[360, 740], [390, 844], [412, 915]];

let server, browser;
before(async () => {
  server = await startServer();
  browser = await chromium.launch(process.env.PW_CHROMIUM_CHANNEL ? { channel: process.env.PW_CHROMIUM_CHANNEL } : {});
});
after(async () => {
  await browser?.close();
  server?.close();
});

test("phone audit: every screen at 360, 390 and 412px, light and dark", async () => {
  const problems = [];
  for (const [name, hash, opts = {}] of SCREENS)
    for (const [w, h] of SIZES)
      for (const theme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, colorScheme: theme });
        const stub = createStub({ siteOrigin: server.origin });
        stub.s.signedIn = { token: "tok-1", login: "textbookproject2026-alt", id: 5, name: "Alec Gordon" };
        await stub.install(ctx);
        await ctx.addInitScript(() => { try { localStorage.setItem("tb-privacy-ok", "1"); } catch {} });
        stub.s.session = !opts.signedOut;
        stub.s.me = { ...stub.s.me, name: "Alec Gordon", email: "alecg95@example.org" };
        const page = await ctx.newPage();
        await page.goto(`${server.origin}/${hash}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(500);
        if (opts.menu) await page.locator(".account-btn").click();
        if (opts.setup) await opts.setup(page);
        await page.waitForFunction(() => {
          const nav = document.querySelector("nav.tabs");
          if (!nav) return true;
          const cur = nav.querySelector('[aria-current="page"]')?.getBoundingClientRect();
          const box = nav.getBoundingClientRect();
          return !cur || (cur.right <= box.right + 1 && cur.left >= box.left - 1);
        }, null, { timeout: 3000 }).catch(() => {});
        const failures = await page.evaluate(auditPage, { scope: opts.menu ? ".masthead" : null });
        const tabs = await page.evaluate(() => {
          const nav = document.querySelector("nav.tabs");
          if (!nav) return null;
          const tops = new Set([...nav.querySelectorAll("a")].map((a) => Math.round(a.getBoundingClientRect().top)));
          const cur = nav.querySelector('[aria-current="page"]')?.getBoundingClientRect();
          const box = nav.getBoundingClientRect();
          return { rows: tops.size, visible: !cur || (cur.left >= box.left - 1 && cur.right <= box.right + 1) };
        });
        if (tabs?.rows > 1) failures.push({ check: "wrapped", el: "nav.tabs", detail: `${tabs.rows} rows` });
        if (tabs && !tabs.visible) failures.push({ check: "clipped", el: "nav.tabs", detail: "current tab off-screen" });
        for (const f of failures) problems.push(`${name} ${w} ${theme}: ${f.check} ${f.el} (${f.detail})`);
        await ctx.close();
      }
  assert.deepEqual(problems, []);
});

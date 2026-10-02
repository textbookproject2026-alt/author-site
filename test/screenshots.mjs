// Screenshots of every screen, light and dark, desktop and phone, against the
// test stubs: for looking at the design, not a test.
//
//   PW_CHROMIUM_CHANNEL=chrome node test/screenshots.mjs <out dir>
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright-core";
import { createStub, importDone } from "./stub.mjs";

const out = process.argv[2] ?? "screenshots";
mkdirSync(out, { recursive: true });
const SITE = new URL("../site/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^\/+/, "") || "index.html";
  const file = join(SITE, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.PW_CHROMIUM_CHANNEL ? { channel: process.env.PW_CHROMIUM_CHANNEL } : {}) });

for (const [label, viewport] of [["desktop", { width: 1100, height: 900 }], ["phone", { width: 375, height: 812 }]]) {
  for (const scheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 1 });
    const stub = createStub({ siteOrigin: origin });
    await stub.install(context);
    // Let the real Google Fonts through, so the screenshots show the real faces.
    await context.unroute("https://fonts.googleapis.com/**");
    await context.unroute("https://fonts.gstatic.com/**");
    const page = await context.newPage();
    const shot = async (name) => {
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${out}/${label}-${scheme}-${name}.png`, fullPage: true });
    };
    await page.goto(`${origin}/`);
    await shot("0-signin");
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Sign in with GitHub" }).click()]);
    await page.getByRole("heading", { name: "Your books" }).waitFor();
    await shot("1-books");
    await page.goto(`${origin}/#/a-book`); await page.getByRole("heading", { name: "Chapters" }).waitFor(); await shot("2-chapters");
    await page.goto(`${origin}/#/a-book/chapter/${encodeURIComponent("chapters/chapter-01.md")}`); await page.locator(".preview p").first().waitFor(); await shot("3-chapter");
    stub.s.importState = [importDone({ isNew: false })];
    await page.goto(`${origin}/#/a-book/import`); await page.locator("#docx").waitFor(); await shot("4-import");
    await page.locator("#docx").setInputFiles({ name: "Chapter 2.docx", mimeType: "application/octet-stream", buffer: Buffer.from("PK\x03\x04xx") });
    await page.getByRole("button", { name: "Convert it" }).click();
    await page.getByRole("heading", { name: /It replaces/ }).waitFor({ timeout: 15000 }); await page.locator(".preview").waitFor(); await shot("5-import-review");
    stub.s.sendAnswers = [[409, { error: "conflict", conflict: { head: "b".repeat(40), commits: [{ who: "reader", when: new Date().toISOString(), message: "A browser edit", url: "https://github.com/x" }], files: [{ path: "chapters/chapter-02.md", status: "modified", patch: "@@ -3,3 +3,3 @@\n Converted from Word.\n-The the domains of reality.\n+The three domains of reality.\n " }] } }]];
    await page.getByLabel("I've read the converted chapter").check(); await page.getByLabel(/Replace the/).check();
    await page.getByRole("button", { name: "Send to drafts" }).click(); await page.getByText("Nothing was sent.").waitFor(); await shot("6-conflict");
    await page.goto(`${origin}/#/a-book/waiting`); await page.getByText("Weekly snapshot").waitFor(); await shot("7-waiting");
    await page.goto(`${origin}/#/a-book/suggestion/7`); await page.getByText("What they suggest").waitFor(); await shot("8-suggestion");
    await page.goto(`${origin}/#/a-book/change/12`); await page.getByText("The three domains.").waitFor(); await shot("9-change");
    await page.goto(`${origin}/#/a-book/publish`); await page.getByRole("button", { name: "Publish to the live book" }).waitFor(); await shot("10-publish");
    await context.close();
  }
}
await browser.close();
server.close();
console.log(`screenshots in ${out}`);

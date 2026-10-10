// Stubs for everything the site talks to, installed as Playwright routes on the
// browser context (so the sign-in popup gets them too): the author endpoints and
// github-auth on the function, GitHub's public API and markdown renderer, raw files
// (the registry, pictures), the drafts preview's marker, and Google Fonts.
//
// The author endpoints answer in the shapes suggest-edit-function's tests pin. Every
// request is recorded, so a test can assert what the page sent.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const API = "https://suggest-edit-function.vercel.app/api/";
export const REPO = "someone/a-book";
export const HEAD = "a".repeat(40);
export const MOVED = "b".repeat(40);
export const SENT = "c".repeat(40);
export const LIVE = "d".repeat(40);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAcCBlCwAAAABJRU5ErkJggg==", "base64");

export const BOOK = {
  slug: "a-book", title: "A Book of Things", status: "live", repo: REPO, drafts_branch: "drafts", live_branch: "main",
  domain: "a-book.example.org", zip: `https://github.com/${REPO}/archive/refs/heads/drafts.zip`,
};
export const REGISTRY = {
  schema_version: 1,
  books: [{
    slug: "a-book", status: "live", content: { repo: REPO, live_branch: "main", drafts_branch: "drafts" },
    site: { domain: "a-book.example.org", host: { kind: "static", provider: "cloudflare-pages", project: "a-book", builder: "quartz-book" } },
  }],
};
// The template's .markdownlint-cli2.yaml, as every book has it.
export const LINT_CONFIG = readFileSync(new URL("./fixtures/markdownlint-cli2.yaml", import.meta.url), "utf8");
const CH1 = "# Chapter 1\n\nSome text about ![a figure](../assets/chapter-01/image1.png) things.\n";
const CH2 = "# Chapter 2: Soils\n\nConverted from Word.\n\n![A soil profile](../assets/chapter-02/image1.png)\n";
// The book as readers have it (live) and as the drafts hold it: chapter 1 edited, Rocks
// removed, Water new, Soils moved first, one new picture.
export const INDEX_LIVE = "# A Book of Things\n\nAn introduction.\n\n## Contents\n\n- [[chapters/chapter-01|Chapter 1]]\n- [[chapters/chapter-02|Soils]]\n- [[chapters/chapter-03|Rocks]]\n";
export const INDEX_DRAFTS = "# A Book of Things\n\nAn introduction.\n\n## Contents\n\n- [[chapters/chapter-02|Soils]]\n- [[chapters/chapter-01|Chapter 1]]\n- [[chapters/chapter-04|Water]]\n";
export const CH1_DRAFTS = CH1.replace("Some text", "Some new text");
export const ROCKS = "# Rocks\n\nHard things.\n";
const LIVE_FILES = { "chapters/chapter-01.md": CH1, "chapters/chapter-02.md": CH2, "chapters/chapter-03.md": ROCKS, "chapters/Definitions/Realism.md": "# Realism\n", "index.md": INDEX_LIVE, "glossary.md": "# Glossary\n" };
const DRAFT_FILES = { "chapters/chapter-01.md": CH1_DRAFTS, "chapters/chapter-02.md": CH2, "chapters/chapter-04.md": "# Water\n\nWet things.\n", "chapters/Definitions/Realism.md": "# Realism\n", "index.md": INDEX_DRAFTS, "glossary.md": "# Glossary\n" };

// What the DeepSeek stub answers: llm.suggest_terms' request (its system prompt is
// about a glossary) and formatting.check's (everything else), as llm.py reads them.
export const DEEPSEEK_TERMS = { terms: [{ term: "Morphogenetic approach", definition: "Archer's account of how social structures are reproduced or changed over time." }] };
export const DEEPSEEK_FORMAT = { changes: [
  { line: 5, rule: "EMPH-1", before: "**Ontology** is the study of what exists. Ontology asks different questions from epistemology, as Archer (1995) argues at length.", after: "*Ontology* is the study of what exists. Ontology asks different questions from epistemology, as Archer (1995) argues at length.", why: "A defined term is in italics." },
  { line: 3, rule: "EMPH-1", before: "Critical realism starts from the claim that the world exists independently of our knowledge of it (Bhaskar, 1975). The the domains of reality are layered.", after: "Critical realism starts from the claim that the world exists independently of our knowledge of it (Bhaskar, 1975). The three domains of reality are layered.", why: "Wording." },
], notes: [] };
export const deepseekAnswer = (body) => JSON.stringify({ choices: [{ message: { content: JSON.stringify(/glossary/.test(body.messages[0].content) ? DEEPSEEK_TERMS : DEEPSEEK_FORMAT) } }] });

export function createStub({ siteOrigin }) {
  const s = {
    requests: [],
    signedIn: { token: "tok-1", login: "author-one", id: 5, name: "Author One" },
    books: [BOOK],
    tree: null, // made from bookFiles below
    importState: [], // successive answers for GET author-import status
    importResult: null,
    sendAnswers: [], // successive answers for author-send: [status, body]
    suggestions: [
      { number: 7, who: "Ada", path: "chapters/chapter-01.md", page: "chapter-01", suggestion: '"recieve" should be "receive"', reasoning: "Spelling.", when: new Date(Date.now() - 3600e3).toISOString(), url: "https://github.com/someone/a-book/issues/7", open: true, accepted: false },
      { number: 8, who: "Grace", path: "chapters/chapter-01.md", page: "chapter-01", suggestion: "Could this be clearer?", reasoning: "", when: new Date(Date.now() - 86400e3).toISOString(), url: "https://github.com/someone/a-book/issues/8", open: true, accepted: true },
    ],
    changes: [{ number: 12, who: "reader-bot", title: "Fix a typo", when: new Date().toISOString(), url: "https://github.com/someone/a-book/pull/12", path: "chapters/chapter-02.md" }],
    change: { readable: true, why: "", pages: [{ page: "chapter-01", path: "chapters/chapter-01.md", added: 1, removed: 1, lines: [{ kind: "before", text: "The the domains." }, { kind: "after", text: "The three domains." }] }] },
    publish: { open: true, waiting: false, number: 30, url: "https://github.com/someone/a-book/pull/30", pages: ["chapter-01"], page_count: 1, change_count: 2, who: ["author-one", "reader"], state: "clean", state_words: "This can go to readers now. Nothing else is waiting on it.", can_publish: true },
    status401: false,
    deepseekStatus: 200,
    people: { authors: ["author-one", "co-author", "textbookproject2026-alt"], owner: "textbookproject2026-alt", registry: "r".repeat(40), pending: [] },
    // The author site's own backend (functions/, batch 2b), in memory: the session,
    // the member, the book's people, the links that were "emailed".
    session: false,
    me: { id: "a1a1a1a1a1", name: "Author One", email: "author-one@example.org", github: null, notify: true, maintainer: false },
    members: [
      { id: "a1a1a1a1a1", name: "Author One", hasEmail: true, you: true },
      { id: "c2c2c2c2c2", name: "Co Author", hasEmail: true, you: false },
      { id: "b3b3b3b3b3", name: "Brandon", hasEmail: false, you: false },
    ],
    invitations: [],
    log: [{ at: Date.now() - 86_400_000, text: "Author One invited Co Author" }],
    links: { ["L".repeat(43)]: "signin", ["I".repeat(43)]: "invite", ["J".repeat(43)]: "invite", ["C".repeat(43)]: "claim" },
    own: [], // calls to the site's own endpoints: { path, method, body, header }
    peopleAnswers: [], // successive answers for author-people-change: [status, body]
    // author-history: 31 commits on drafts, the newest 2 still waiting; page 2 is the oldest.
    history: Array.from({ length: 31 }, (_, i) => ({
      sha: (i + 1).toString(16).padStart(40, "e"), who: i === 0 ? "author-one" : "co-author",
      when: new Date(Date.now() - (i + 1) * 3600e3).toISOString(), message: i === 0 ? "Say it better" : `Change ${i}`, live: i >= 2,
    })),
  };

  const json = (route, status, body, headers = {}) => route.fulfill({
    status, contentType: "application/json", body: JSON.stringify(body),
    headers: { "access-control-allow-origin": siteOrigin, vary: "Origin", ...headers },
  });

  /** The site's own endpoints (functions/api/*), as the real ones answer. */
  async function own(route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const header = req.headers()["x-author-site"];
    s.own.push({ path, method: req.method(), body, header });
    const j = (status, b, headers = {}) => route.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(b) });
    if (req.method() !== "GET" && header !== "1") return j(403, { error: "cross-site request" });
    if (path === "/api/me" && req.method() === "GET") return j(200, s.session ? { member: s.me, books: ["a-book"], githubSignin: true } : { member: null, githubSignin: true });
    if (path === "/api/me") {
      if (!s.session) return j(401, { error: "signed out" });
      if (typeof body.notify === "boolean") { s.me = { ...s.me, notify: body.notify }; return j(200, { ok: true }); }
      return j(200, { ok: true, sent: true });
    }
    if (path === "/api/auth/request") return j(200, { ok: true, userMessage: "If that address has access, we've sent a link. It works once, for 15 minutes." });
    if (path === "/api/auth/consume") {
      if (s.links[body.token] !== "signin") return j(410, { error: "used", userMessage: "That link has been used or has expired. Ask for a new one below." });
      delete s.links[body.token];
      s.session = true;
      return j(200, { ok: true, name: s.me.name });
    }
    if (path === "/api/auth/signout") { s.session = false; return j(200, { ok: true }); }
    if (path === "/api/auth/github") { s.session = true; return j(200, { ok: true, needsEmail: !s.me.email }); }
    if (path === "/api/invite") {
      if (s.links[body.token] !== body.kind) return j(410, { error: "used", userMessage: "This invitation has been used or has expired. Ask whoever sent it for a new one." });
      if (body.action === "info") return j(200, body.kind === "invite" ? { title: "A Book of Things", name: "New Person", email: "new@example.org", inviter: "Author One" } : { name: "Brandon", email: "brandon@example.org" });
      delete s.links[body.token];
      // "J…": an invitation the inviter copied, which signs nobody in.
      if (body.token === "J".repeat(43)) return j(200, { ok: true, book: "a-book", joined: false, emailed: true });
      s.session = true;
      if (body.kind === "invite") s.me = { ...s.me, name: body.name || "New Person" };
      return j(200, { ok: true, book: "a-book" });
    }
    if (path === "/api/members") {
      if (!s.session) return j(401, { error: "signed out" });
      if (req.method() === "GET") return j(200, { members: s.members, invitations: s.invitations, log: s.log });
      if (body.action === "invite") {
        s.invitations.unshift({ name: body.name, email: body.email, expires: Date.now() + 7 * 86_400_000 });
        s.log.unshift({ at: Date.now(), text: `Author One invited ${body.name}` });
        return j(200, body.send === false ? { ok: true, mailed: false, link: `${siteOrigin}/#/invite/${"I".repeat(43)}` } : { ok: true, mailed: true });
      }
      if (body.action === "remove") {
        const m = s.members.find((x) => x.id === body.member);
        s.members = s.members.filter((x) => x.id !== body.member);
        s.log.unshift({ at: Date.now(), text: `Author One removed ${m.name}` });
        return j(200, { ok: true });
      }
      if (body.action === "set-email") return j(200, { ok: true });
    }
    return j(404, { error: "not found" });
  }

  async function fn(route) {
    const req = route.request();
    const url = new URL(req.url());
    // Through this site's proxy (/fn/<endpoint>): the session, not a token, says who.
    const proxied = url.pathname.startsWith("/fn/");
    const endpoint = proxied ? url.pathname.slice(4) : url.pathname.replace(/^\/api\//, "");
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": siteOrigin, "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "Content-Type, Authorization", vary: "Origin" } });
    }
    if (endpoint === "github-auth") {
      // The popup's last page, as github-auth writes it: postMessage to the opener at its origin.
      const msg = JSON.stringify({ type: "tb-github-identity", ...s.signedIn });
      return route.fulfill({ status: 200, contentType: "text/html",
        body: `<!doctype html><p>Signed in.</p><script>window.opener.postMessage(${msg}, ${JSON.stringify(siteOrigin)}); window.close();</script>` });
    }
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    s.requests.push({ endpoint, method: req.method(), query: Object.fromEntries(url.searchParams), body, auth: req.headers().authorization });
    // The public /api/history (no sign-in): what is proposed, as Page history shows readers.
    if (endpoint === "history") {
      return json(route, 200, { items: [
        { kind: "note", number: 12, url: "https://github.com/o/a-book/issues/12", date: "2026-10-08T09:00:00Z", summary: "Say where this is from", who: { name: "Jo Reader" }, paragraph: 3 },
      ] });
    }
    if (s.status401) return json(route, 401, { error: "identity required", userMessage: "Please sign in again." });
    if (proxied ? !s.session || req.headers()["x-author-site"] !== "1" : req.headers().authorization !== `Bearer ${s.signedIn.token}`) return json(route, 401, { error: "identity required" });

    if (endpoint === "author-read") {
      const what = url.searchParams.get("what");
      if (what === "books") return json(route, 200, { login: s.signedIn.login, books: s.books });
      if (what === "tree") return json(route, 200, s.tree);
      if (what === "file") {
        const path = url.searchParams.get("path");
        const text = s.bookFiles.has(path) ? s.bookFiles.get(path).toString("utf8") : `# ${path}\n`;
        return json(route, 200, { path, sha: "1".repeat(40), text, last: { who: "author-one", when: new Date().toISOString(), message: "Tidy", url: "" } });
      }
      if (what === "suggestions") return json(route, 200, { suggestions: s.suggestions });
      if (what === "suggestion-changes") return json(route, 200, { page: "chapter-01", changes: [{ sha: SENT, url: `https://github.com/${REPO}/commit/${SENT}`, who: "author-one", when: new Date().toISOString(), message: "Reword" }] });
      if (what === "changes") return json(route, 200, { changes: s.changes });
      if (what === "change") return json(route, 200, s.change);
      if (what === "publish") return s.publishError ? json(route, 502, { error: "x", userMessage: "GitHub didn't answer." }) : json(route, 200, { publish: s.publish });
      if (what === "drafts") {
        const paths = new Set([...s.liveFiles.keys(), ...s.bookFiles.keys()]);
        const files = [...paths].sort().flatMap((path) => {
          const a = s.liveFiles.get(path);
          const b = s.bookFiles.get(path);
          if (a && b && a.equals(b)) return [];
          return [{ path, status: !a ? "added" : !b ? "removed" : "modified", who: "author-one", when: new Date(Date.now() - 600e3).toISOString() }];
        });
        if (s.tree.files.some((f) => f.path === "assets/chapter-04/image1.png")) files.push({ path: "assets/chapter-04/image1.png", status: "added", who: "author-one", when: new Date().toISOString() });
        return json(route, 200, { live: LIVE, drafts: s.tree.head, files, more: 0 });
      }
    }
    if (endpoint === "author-import") {
      if (req.method() === "POST" && typeof body.part === "string") return json(route, 201, { receipt: `receipt-${s.requests.filter((r) => r.body?.part).length}` });
      if (req.method() === "POST" && body.action === "start") return json(route, 201, { id: "0123456789abcdef0123", attempt: 1, base: HEAD });
      if (req.method() === "POST" && body.action === "again") return json(route, 201, { id: body.id, attempt: 2, base: MOVED });
      if (req.method() === "GET" && url.searchParams.has("file")) return json(route, 200, { path: url.searchParams.get("file"), base64: PNG.toString("base64") });
      if (req.method() === "GET") {
        const next = s.importState.length > 1 ? s.importState.shift() : s.importState[0];
        return json(route, 200, next ?? { state: "working", attempt: 1 });
      }
    }
    if (endpoint === "author-send") {
      const [status, answer] = s.sendAnswers.length > 1 ? s.sendAnswers.shift() : s.sendAnswers[0] ?? [201, sentAnswer()];
      return json(route, status, answer);
    }
    if (endpoint === "author-history") {
      const sha = url.searchParams.get("sha");
      const path = url.searchParams.get("path");
      if (!sha) {
        const page = Number(url.searchParams.get("page") ?? 1);
        const list = path ? s.history.slice(0, 3) : s.history;
        return json(route, 200, { commits: list.slice((page - 1) * 30, page * 30), next: list.length > page * 30 });
      }
      const c = s.history.find((x) => x.sha === sha);
      const out = { ...c, parent: HEAD, files: [{ path: "chapters/chapter-01.md", status: "modified", added: 1, removed: 1, patch: "@@ -3 +3 @@\n-Some text about things.\n+" + CH1.split("\n")[2] }] };
      if (path) out.page = { path, text: CH1.replace("Some text", "Some older text"), before: CH1.replace("Some text", "Some first text") };
      return json(route, 200, out);
    }
    if (endpoint === "author-people") return json(route, 200, s.people);
    if (endpoint === "author-people-change") {
      const [status, answer] = s.peopleAnswers.shift() ?? [201, { number: 61, url: "https://github.com/textbookproject2026-alt/textbook-registry/pull/61", action: body.action, login: body.login, by: s.signedIn.login, state: "open", when: new Date().toISOString() }];
      if (status === 201) s.people = { ...s.people, pending: [answer] };
      return json(route, status, answer);
    }
    if (endpoint === "author-act") {
      if (body.action === "publish") return json(route, 200, { done: true, steps: ["The drafts were sent to the live book."] });
      if (body.action === "publish-prepare") return json(route, 200, { done: true, steps: ["The drafts are in line for the live book."], publish: s.publish });
      return json(route, 200, { done: true, steps: [`Did ${body.action}.`] });
    }
    return json(route, 404, { error: "unknown" });
  }

  async function github(route) {
    const url = new URL(route.request().url());
    const cors = { "access-control-allow-origin": "*" };
    if (url.pathname === "/markdown") {
      // Enough of GitHub's renderer for the page: headings, pictures, paragraphs.
      const text = JSON.parse(route.request().postData()).text;
      const html = text.split(/\n{2,}/).map((b) => b.startsWith("# ")
        ? `<h1>${b.slice(2)}</h1>`
        : `<p>${b.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')}</p>`).join("\n");
      return route.fulfill({ status: 200, contentType: "text/html", body: `${html}<script>alert(1)</script><a href="javascript:alert(2)">x</a>`, headers: cors });
    }
    if (url.pathname.endsWith("/commits/drafts")) return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ sha: HEAD, commit: { committer: { date: new Date().toISOString() } } }) });
    if (url.pathname.endsWith("/actions/workflows")) {
      return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ workflows: [
        { id: 1, name: "Weekly snapshot", state: "active", html_url: "https://github.com/x" },
        { id: 2, name: "Link check", state: "active", html_url: "https://github.com/y" }] }) });
    }
    const runs = /\/actions\/workflows\/(\d+)\/runs$/.exec(url.pathname);
    if (runs) {
      const run = runs[1] === "1"
        ? { conclusion: "success", updated_at: new Date().toISOString(), html_url: "https://github.com/run/1" }
        : { conclusion: "failure", updated_at: new Date().toISOString(), html_url: "https://github.com/run/2" };
      return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ workflow_runs: [run] }) });
    }
    return route.fulfill({ status: 404, headers: cors, body: "{}" });
  }

  /** Serve a real book (a folder) as the drafts: tree with git blob ids, files by path. */
  function useBook(dir) {
    const files = [];
    s.bookFiles = new Map();
    const walk = (at) => {
      for (const name of readdirSync(join(dir, at))) {
        const rel = at ? `${at}/${name}` : name;
        if (statSync(join(dir, rel)).isDirectory()) walk(rel);
        else {
          const bytes = readFileSync(join(dir, rel));
          s.bookFiles.set(rel, bytes);
          files.push({ path: rel, sha: gitBlob(bytes), size: bytes.length });
        }
      }
    };
    walk("");
    s.tree = { head: HEAD, files };
  }
  s.bookFiles = new Map(Object.entries(DRAFT_FILES).map(([p, t]) => [p, Buffer.from(t)]));
  s.liveFiles = new Map(Object.entries(LIVE_FILES).map(([p, t]) => [p, Buffer.from(t)]));
  s.tree = { head: HEAD, files: [...[...s.bookFiles].map(([path, b]) => ({ path, sha: gitBlob(b), size: b.length })), { path: "assets/chapter-01/image1.png", sha: "3".repeat(40), size: 70 }, { path: "assets/chapter-04/image1.png", sha: "6".repeat(40), size: 70 }] };
  s.lintConfig = LINT_CONFIG;

  async function raw(route) {
    const url = new URL(route.request().url());
    const cors = { "access-control-allow-origin": "*" };
    // The book's lint settings, at whichever commit is asked for (null: the book has none).
    if (url.pathname.endsWith("/.markdownlint-cli2.yaml")) {
      return s.lintConfig === null ? route.fulfill({ status: 404, headers: cors, body: "" })
        : route.fulfill({ status: 200, contentType: "text/plain", headers: cors, body: s.lintConfig });
    }
    const m = new RegExp(`^/${REPO}/([^/]+)/(.+)$`).exec(url.pathname);
    if (m && !url.pathname.endsWith(".png")) {
      const [ref, path] = [m[1], decodeURIComponent(m[2])];
      const files = ref === LIVE || ref === "main" ? s.liveFiles : s.bookFiles;
      return files.has(path) ? route.fulfill({ status: 200, contentType: "text/plain", headers: cors, body: files.get(path) })
        : route.fulfill({ status: 404, headers: cors, body: "" });
    }
    if (url.pathname.endsWith("/registry.json")) return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(s.registry ?? REGISTRY) });
    if (url.pathname.endsWith(".png")) return route.fulfill({ status: 200, contentType: "image/png", headers: cors, body: PNG });
    return route.fulfill({ status: 404, headers: cors, body: "" });
  }

  // DeepSeek's API as it answers browsers: CORS for the page's origin, the key in Authorization.
  async function deepseek(route) {
    const req = route.request();
    const cors = { "access-control-allow-origin": siteOrigin, "access-control-allow-headers": "authorization,content-type", "access-control-allow-methods": "POST" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: cors });
    const body = JSON.parse(req.postData());
    s.requests.push({ endpoint: "deepseek", method: req.method(), body, auth: req.headers().authorization });
    if (s.deepseekStatus !== 200) return route.fulfill({ status: s.deepseekStatus, contentType: "application/json", headers: cors, body: JSON.stringify({ error: { message: "no" } }) });
    return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: body.max_tokens === 4 ? JSON.stringify({ choices: [{ message: { content: "ready" } }] }) : deepseekAnswer(body) });
  }

  async function install(context) {
    await context.route("https://api.deepseek.com/**", deepseek);
    await context.route(`${API}**`, fn);
    await context.route(`${siteOrigin}/fn/**`, fn);
    await context.route(`${siteOrigin}/api/**`, own);
    await context.route("https://api.github.com/**", github);
    await context.route("https://raw.githubusercontent.com/**", raw);
    await context.route("https://drafts.a-book.pages.dev/**", (route) => route.fulfill({
      status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ slug: "a-book", branch: "drafts", book_commit: HEAD }) }));
    await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await context.route("https://fonts.gstatic.com/**", (route) => route.fulfill({ status: 404, body: "" }));
    await context.route("https://avatars.githubusercontent.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  }

  return { s, install, useBook, CH2 };
}

export const gitBlob = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

export function sentAnswer() {
  return { sha: SENT, url: `https://github.com/${REPO}/commit/${SENT}`, written: ["chapters/chapter-02.md"], deleted: [], steps: ["The change is in the drafts area, as one change made by you."] };
}

export function importDone({ isNew = true, text = CH2 } = {}) {
  return {
    state: "done", attempt: 1,
    chapter: { path: "chapters/chapter-02.md", text },
    result: {
      version: 1, id: "0123456789abcdef0123", attempt: 1, ok: true, book: "a-book", base: HEAD, login: "author-one",
      chapter: isNew
        ? { path: "chapters/chapter-02.md", title: "Chapter 2: Soils", new: true, how: "new", replaces: null, media_dir: "assets/chapter-02" }
        : { path: "chapters/chapter-02.md", title: "Chapter 2: Soils", new: false, how: "recorded", media_dir: "assets/chapter-02",
          replaces: { who: "Reader", when: new Date().toISOString(), message: "a browser edit", url: "", lines_differ: { removed: 2, added: 1 } } },
      writes: [
        { path: "chapters/chapter-02.md", staged: "out/chapters/chapter-02.md", kind: "chapter" },
        { path: "assets/chapter-02/image1.png", staged: "out/assets/chapter-02/image1.png", kind: "picture" },
        ...(isNew ? [{ path: "index.md", staged: "out/index.md", kind: "index" }] : []),
      ],
      deletes: isNew ? [] : ["assets/chapter-02/old.png"],
      removed_pictures: isNew ? [] : ["old.png"],
      contents_line: isNew ? "- **[[chapters/chapter-02|Chapter 2: Soils]]**" : null,
      notes: [],
      report: [
        { level: "ok", headline: "Headings came across", body: "", check: "" },
        { level: "warn", headline: "One picture is a chart", body: "Word draws charts itself.", check: "Paste it back as a picture." },
      ],
      counts: { lines: 5, words: 6, pictures: 1 },
      pandoc: "3.11",
    },
  };
}

// Stubs for everything the site talks to, installed as Playwright routes on the
// browser context (so the sign-in popup gets them too): the author endpoints and
// github-auth on the function, GitHub's public API and markdown renderer, raw files
// (the registry, pictures), the drafts preview's marker, and Google Fonts.
//
// The author endpoints answer in the shapes suggest-edit-function's tests pin. Every
// request is recorded, so a test can assert what the page sent.

export const API = "https://suggest-edit-function.vercel.app/api/";
export const REPO = "someone/a-book";
export const HEAD = "a".repeat(40);
export const MOVED = "b".repeat(40);
export const SENT = "c".repeat(40);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAcCBlCwAAAABJRU5ErkJggg==", "base64");

export const BOOK = {
  slug: "a-book", title: "A Book of Things", status: "live", repo: REPO, drafts_branch: "drafts", live_branch: "main",
  domain: "a-book.example.org", zip: `https://github.com/${REPO}/archive/refs/heads/drafts.zip`,
};
const REGISTRY = {
  schema_version: 1,
  books: [{
    slug: "a-book", status: "live", content: { repo: REPO, live_branch: "main", drafts_branch: "drafts" },
    site: { domain: "a-book.example.org", host: { kind: "static", provider: "cloudflare-pages", project: "a-book", builder: "quartz-book" } },
  }],
};
const CH1 = "# Chapter 1\n\nSome text about ![a figure](../assets/chapter-01/image1.png) things.\n";
const CH2 = "# Chapter 2: Soils\n\nConverted from Word.\n\n![](../assets/chapter-02/image1.png)\n";

export function createStub({ siteOrigin }) {
  const s = {
    requests: [],
    signedIn: { token: "tok-1", login: "author-one", id: 5, name: "Author One" },
    books: [BOOK],
    tree: {
      head: HEAD,
      files: [
        { path: "chapters/chapter-01.md", sha: "1".repeat(40), size: 90 },
        { path: "chapters/Definitions/Realism.md", sha: "2".repeat(40), size: 30 },
        { path: "assets/chapter-01/image1.png", sha: "3".repeat(40), size: 70 },
        { path: "index.md", sha: "4".repeat(40), size: 50 },
        { path: "glossary.md", sha: "5".repeat(40), size: 12 },
      ],
    },
    importState: [], // successive answers for GET author-import status
    importResult: null,
    sendAnswers: [], // successive answers for author-send: [status, body]
    suggestions: [
      { number: 7, who: "Ada", path: "chapters/chapter-01.md", page: "chapter-01", suggestion: '"recieve" should be "receive"', reasoning: "Spelling.", when: new Date(Date.now() - 3600e3).toISOString(), url: "https://github.com/someone/a-book/issues/7", open: true, accepted: false },
      { number: 8, who: "Grace", path: "chapters/chapter-01.md", page: "chapter-01", suggestion: "Could this be clearer?", reasoning: "", when: new Date(Date.now() - 86400e3).toISOString(), url: "https://github.com/someone/a-book/issues/8", open: true, accepted: true },
    ],
    changes: [{ number: 12, who: "reader-bot", title: "Fix a typo", when: new Date().toISOString(), url: "https://github.com/someone/a-book/pull/12" }],
    change: { readable: true, why: "", pages: [{ page: "chapter-01", path: "chapters/chapter-01.md", added: 1, removed: 1, lines: [{ kind: "before", text: "The the domains." }, { kind: "after", text: "The three domains." }] }] },
    publish: { open: true, waiting: false, number: 30, url: "https://github.com/someone/a-book/pull/30", pages: ["chapter-01"], page_count: 1, change_count: 2, who: ["author-one", "reader"], state: "clean", state_words: "This can go to readers now. Nothing else is waiting on it.", can_publish: true },
    status401: false,
  };

  const json = (route, status, body, headers = {}) => route.fulfill({
    status, contentType: "application/json", body: JSON.stringify(body),
    headers: { "access-control-allow-origin": siteOrigin, vary: "Origin", ...headers },
  });

  async function fn(route) {
    const req = route.request();
    const url = new URL(req.url());
    const endpoint = url.pathname.replace(/^\/api\//, "");
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
    if (s.status401) return json(route, 401, { error: "identity required", userMessage: "Please sign in with GitHub again." });
    if (req.headers().authorization !== `Bearer ${s.signedIn.token}`) return json(route, 401, { error: "identity required" });

    if (endpoint === "author-read") {
      const what = url.searchParams.get("what");
      if (what === "books") return json(route, 200, { login: s.signedIn.login, books: s.books });
      if (what === "tree") return json(route, 200, s.tree);
      if (what === "file") {
        const path = url.searchParams.get("path");
        const text = path === "chapters/chapter-01.md" ? CH1 : `# ${path}\n`;
        return json(route, 200, { path, sha: "1".repeat(40), text, last: { who: "author-one", when: new Date().toISOString(), message: "Tidy", url: "" } });
      }
      if (what === "suggestions") return json(route, 200, { suggestions: s.suggestions });
      if (what === "suggestion-changes") return json(route, 200, { page: "chapter-01", changes: [{ sha: SENT, url: `https://github.com/${REPO}/commit/${SENT}`, who: "author-one", when: new Date().toISOString(), message: "Reword" }] });
      if (what === "changes") return json(route, 200, { changes: s.changes });
      if (what === "change") return json(route, 200, s.change);
      if (what === "publish") return json(route, 200, { publish: s.publish });
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

  async function raw(route) {
    const url = new URL(route.request().url());
    const cors = { "access-control-allow-origin": "*" };
    if (url.pathname.endsWith("/registry.json")) return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(REGISTRY) });
    if (url.pathname.endsWith(".png")) return route.fulfill({ status: 200, contentType: "image/png", headers: cors, body: PNG });
    return route.fulfill({ status: 404, headers: cors, body: "" });
  }

  async function install(context) {
    await context.route(`${API}**`, fn);
    await context.route("https://api.github.com/**", github);
    await context.route("https://raw.githubusercontent.com/**", raw);
    await context.route("https://drafts.a-book.pages.dev/**", (route) => route.fulfill({
      status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ slug: "a-book", branch: "drafts", book_commit: HEAD }) }));
    await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
    await context.route("https://fonts.gstatic.com/**", (route) => route.fulfill({ status: 404, body: "" }));
    await context.route("https://avatars.githubusercontent.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  }

  return { s, install, CH2 };
}

export function sentAnswer() {
  return { sha: SENT, url: `https://github.com/${REPO}/commit/${SENT}`, written: ["chapters/chapter-02.md"], deleted: [], steps: ["The change is in the drafts area, as one change made by you."] };
}

export function importDone({ isNew = true } = {}) {
  return {
    state: "done", attempt: 1,
    chapter: { path: "chapters/chapter-02.md", text: CH2 },
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

// The author site's backend (functions/, batch 2b) run for real under
// `wrangler pages dev` with a local D1 (migrations applied, a few members seeded).
// What it proves: sign-in answers alike for known and unknown addresses and is
// rate-limited; links are single-use; invitations land the member in the book;
// removing someone ends their access at once; CSRF; the proxy forwards nothing that
// isn't on its list, nothing without a session on that book; assertions are single-
// use, bound to their request and refused once the member has left; notify refuses
// what isn't a real item. Nothing here reaches GitHub or sends email (no Resend key
// locally); the one upstream call a forwarded request makes is to the real
// suggest-edit function, which answers 401 to an assertion it can't read back.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { rmSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = 8790 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const sql = (command) =>
  execFileSync("npx", ["-y", "wrangler@4", "d1", "execute", "c4n-author-members", "--local", "--persist-to", ".wrangler/test-state", "--command", command, "--json"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const rows = (command) => JSON.parse(sql(command))[0].results;

let server;
const NOW = Date.now();
const ALEC = { id: "a1a1a1a1a1", email: "alec@example.org" };
const BRANDON = { id: "b2b2b2b2b2" };

before(async () => {
  rmSync(`${ROOT}.wrangler/test-state`, { recursive: true, force: true });
  execFileSync("npx", ["-y", "wrangler@4", "d1", "migrations", "apply", "c4n-author-members", "--local", "--persist-to", ".wrangler/test-state"], { cwd: ROOT, stdio: "ignore", env: { ...process.env, CI: "1" } });
  sql(`INSERT INTO members (id, display_name, email, github, created_at) VALUES ('${ALEC.id}', 'Alec Gordon', '${ALEC.email}', 'textbookproject2026-alt', ${NOW}), ('${BRANDON.id}', 'Brandon', NULL, 'BrandonAndCaroline', ${NOW});
       INSERT INTO book_members (book, member_id, added_at) VALUES ('platform-test-book', '${ALEC.id}', ${NOW}), ('ontology-for-social-research-a-criti', '${ALEC.id}', ${NOW}), ('ontology-for-social-research-a-criti', '${BRANDON.id}', ${NOW});`);
  server = spawn("npx", ["-y", "wrangler@4", "pages", "dev", "site", "--port", String(PORT), "--persist-to", ".wrangler/test-state", "--ip", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/me`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("wrangler pages dev didn't start");
});
after(() => server?.kill());

// The seeding (wrangler d1 execute) writes the same local state the dev server
// holds, which now and then drops a connection: a request that never got an answer
// is sent once more. An answer, any answer, is never retried.
const realFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  try {
    return await realFetch(...args);
  } catch (err) {
    if (!/ECONNRESET|fetch failed|socket/i.test(`${err.message} ${err.cause?.message ?? ""}`)) throw err;
    await new Promise((r) => setTimeout(r, 500));
    return realFetch(...args);
  }
};
const site = { origin: BASE, "x-author-site": "1", "content-type": "application/json" };
const post = (path, body, { cookie, headers = site } = {}) =>
  fetch(`${BASE}${path}`, { method: "POST", headers: { ...headers, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const get = (path, { cookie, headers = site } = {}) => fetch(`${BASE}${path}`, { headers: { ...headers, ...(cookie ? { cookie } : {}) } });
const cookieOf = (res) => /(__Host-tb_session=[^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

/** Work done after the answer (waitUntil): wait for what it writes. */
async function eventually(check) {
  for (let i = 0; i < 40; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.fail("never happened");
}

async function signInAs(memberId, email) {
  const t = token();
  sql(`INSERT INTO links (token_hash, kind, member_id, email, created_at, expires_at) VALUES ('${sha(t)}', 'signin', '${memberId}', '${email}', ${Date.now()}, ${Date.now() + 900000})`);
  const res = await post("/api/auth/consume", { token: t });
  assert.equal(res.status, 200);
  return cookieOf(res);
}

test("sign-in: the same answer for a member and a stranger; at most five links an hour to an address, twenty asks per IP", async () => {
  const known = await post("/api/auth/request", { email: "ALEC@example.org " });
  const unknown = await post("/api/auth/request", { email: "nobody@example.org" });
  assert.equal(known.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
  // Only the member's address got a link (stored hashed), and it's for them.
  const signins = () => rows("SELECT kind, member_id, email, length(token_hash) AS l FROM links WHERE kind = 'signin'");
  await eventually(() => signins().length === 1);
  assert.deepEqual(signins(), [{ kind: "signin", member_id: ALEC.id, email: ALEC.email, l: 64 }]);
  // Six more asks for the member: all answered alike, five links in all.
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await post("/api/auth/request", { email: ALEC.email })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 200]);
  await eventually(() => signins().length >= 5);
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(signins().length, 5);
  // Asking about strangers costs no address budget, only the IP's: 20 in all, then 429.
  for (let i = 8; i < 20; i++) assert.equal((await post("/api/auth/request", { email: `x${i}@example.org` })).status, 200);
  assert.equal((await post("/api/auth/request", { email: "flood@example.org" })).status, 429);
  assert.equal((await post("/api/auth/request", { email: "not an email" })).status, 400);
});

test("CSRF: no site header, or another origin, is refused", async () => {
  assert.equal((await post("/api/auth/request", { email: "a@example.org" }, { headers: { origin: BASE, "content-type": "application/json" } })).status, 403);
  assert.equal((await post("/api/auth/request", { email: "a@example.org" }, { headers: { ...site, origin: "https://evil.example" } })).status, 403);
  // A GET without Origin passes only when the browser says it is same-origin.
  const alec = await signInAs(ALEC.id, ALEC.email);
  const bare = { "x-author-site": "1", cookie: alec };
  assert.equal((await fetch(`${BASE}/fn/author-read?what=books`, { headers: bare })).status, 403);
  assert.equal((await fetch(`${BASE}/fn/author-read?what=books`, { headers: { ...bare, "sec-fetch-site": "cross-site" } })).status, 403);
  const ok = await fetch(`${BASE}/fn/author-read?what=books`, { headers: { ...bare, "sec-fetch-site": "same-origin" } });
  assert.notEqual((await ok.json().catch(() => ({}))).error, "cross-site request", "forwarded (whatever the function then says)");
});

test("a sign-in link works once, gives an HttpOnly Secure SameSite=Lax 30-day cookie", async () => {
  const t = token();
  sql(`INSERT INTO links (token_hash, kind, member_id, email, created_at, expires_at) VALUES ('${sha(t)}', 'signin', '${ALEC.id}', '${ALEC.email}', ${Date.now()}, ${Date.now() + 900000})`);
  const res = await post("/api/auth/consume", { token: t });
  assert.equal(res.status, 200);
  const sc = res.headers.get("set-cookie");
  for (const part of ["__Host-tb_session=", "HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=2592000"]) assert.ok(sc.includes(part), part);
  assert.equal((await post("/api/auth/consume", { token: t })).status, 410, "single use");
  const me = await (await get("/api/me", { cookie: cookieOf(res) })).json();
  assert.deepEqual([me.member.name, me.member.maintainer], ["Alec Gordon", true]);
  // His two books, and any the live registry lists him on that had nobody yet (adopted once).
  assert.ok(["ontology-for-social-research-a-criti", "platform-test-book"].every((b) => me.books.includes(b)), me.books.join());
  // Expired: refused.
  const old = token();
  sql(`INSERT INTO links (token_hash, kind, member_id, email, created_at, expires_at) VALUES ('${sha(old)}', 'signin', '${ALEC.id}', '${ALEC.email}', 0, 1)`);
  assert.equal((await post("/api/auth/consume", { token: old })).status, 410);
});

test("invite: a copied link only sends the invitation to the address; from the inbox, two steps to join; People at once with an audit line; removal ends access at once", async () => {
  const alec = await signInAs(ALEC.id, ALEC.email);
  const inv = await (await post("/api/members", { book: "platform-test-book", action: "invite", name: "Test Member", email: "Test.Member@Example.org", send: false }, { cookie: alec })).json();
  const t = /#\/invite\/([A-Za-z0-9_-]{43})$/.exec(inv.link)[1];
  const info = await (await post("/api/invite", { kind: "invite", token: t, action: "info" })).json();
  assert.deepEqual([info.name, info.inviter, info.email], ["Test Member", "Alec Gordon", "test.member@example.org"]);
  const copied = await post("/api/invite", { kind: "invite", token: t, action: "accept", name: "Test Member" });
  assert.equal(copied.status, 200);
  // The inviter has seen a copied link: it adds nobody and signs nobody in. A fresh
  // invitation is written for the address (locally the mail fails, so it's marked unsent).
  assert.equal(cookieOf(copied), undefined);
  assert.equal((await copied.json()).joined, false);
  assert.equal(rows("SELECT COUNT(*) AS n FROM members WHERE email = 'test.member@example.org'")[0].n, 0);
  assert.equal(rows("SELECT COUNT(*) AS n FROM links WHERE kind = 'invite' AND email = 'test.member@example.org' AND used_at IS NULL")[0].n, 1);
  assert.equal((await post("/api/invite", { kind: "invite", token: t, action: "accept" })).status, 410, "single use");
  // The emailed one (as Resend would have delivered it): joins and signs in.
  const mailed = token();
  sql(`INSERT INTO links (token_hash, kind, book, email, name, created_by, mailed, created_at, expires_at) VALUES ('${sha(mailed)}', 'invite', 'platform-test-book', 'test.member@example.org', 'Test Member', '${ALEC.id}', 1, ${Date.now()}, ${Date.now() + 86400000})`);
  const joined = await post("/api/invite", { kind: "invite", token: mailed, action: "accept", name: "Test Member" });
  assert.equal((await joined.json()).joined, true);
  const member = cookieOf(joined);
  assert.ok(member);
  const people = await (await get("/api/members?book=platform-test-book", { cookie: alec })).json();
  const tm = people.members.find((m) => m.name === "Test Member");
  assert.ok(tm && tm.hasEmail);
  assert.deepEqual(people.log.slice(0, 2).map((l) => l.text), ["Test Member joined", "Alec Gordon invited Test Member"]);
  assert.equal(rows(`SELECT email FROM members WHERE id = '${tm.id}'`)[0].email, "test.member@example.org", "emails are lower-cased");
  // Not on another book.
  assert.equal((await get("/api/members?book=ontology-for-social-research-a-criti", { cookie: member })).status, 403);
  // Removed: their session is refused on the next request.
  assert.equal((await (await get("/api/me", { cookie: member })).json()).member.name, "Test Member");
  assert.equal((await post("/api/members", { book: "platform-test-book", action: "remove", member: tm.id }, { cookie: alec })).status, 200);
  assert.equal((await (await get("/api/me", { cookie: member })).json()).member, null);
  assert.equal((await get("/fn/author-read?what=tree&book=platform-test-book", { cookie: member })).status, 401);
  assert.equal(rows(`SELECT email FROM members WHERE id = '${tm.id}'`)[0].email, null, "on no book: email deleted");
});

test("set-email for someone else: the platform maintainer only", async () => {
  const DANA = { id: "d4d4d4d4d4", email: "dana@example.org" };
  sql(`INSERT INTO members (id, display_name, email, created_at) VALUES ('${DANA.id}', 'Dana', '${DANA.email}', ${NOW});
       INSERT INTO book_members (book, member_id, added_at) VALUES ('ontology-for-social-research-a-criti', '${DANA.id}', ${NOW}), ('platform-test-book', '${BRANDON.id}', ${NOW});`);
  const dana = await signInAs(DANA.id, DANA.email);
  const res = await post("/api/members", { book: "ontology-for-social-research-a-criti", action: "set-email", member: BRANDON.id, email: "dana2@example.org" }, { cookie: dana });
  assert.equal(res.status, 403);
  assert.equal(rows(`SELECT COUNT(*) AS n FROM links WHERE member_id = '${BRANDON.id}' AND kind = 'claim'`)[0].n, 0);
  sql(`DELETE FROM book_members WHERE book = 'platform-test-book' AND member_id = '${BRANDON.id}'; DELETE FROM book_members WHERE member_id = '${DANA.id}';`);
});

test("an invitation never renames someone who is already a member", async () => {
  const t = token();
  sql(`INSERT INTO links (token_hash, kind, book, email, name, created_by, mailed, created_at, expires_at) VALUES ('${sha(t)}', 'invite', 'platform-test-book', '${ALEC.email}', 'Mallory', '${ALEC.id}', 1, ${Date.now()}, ${Date.now() + 86400000})`);
  assert.equal((await post("/api/invite", { kind: "invite", token: t, action: "accept", name: "Mallory" })).status, 200);
  assert.equal(rows(`SELECT display_name FROM members WHERE id = '${ALEC.id}'`)[0].display_name, "Alec Gordon");
});

test("removing the last member of a book is refused", async () => {
  sql(`DELETE FROM book_members WHERE book = 'author-guide'; INSERT INTO book_members (book, member_id, added_at) VALUES ('author-guide', '${ALEC.id}', ${NOW})`);
  const alec = await signInAs(ALEC.id, ALEC.email);
  // Alec can't remove himself (the screen offers no button), and can't remove the last one either way.
  const res = await post("/api/members", { book: "author-guide", action: "remove", member: ALEC.id }, { cookie: alec });
  assert.ok([400, 409].includes(res.status), String(res.status));
  assert.equal(rows(`SELECT COUNT(*) AS n FROM book_members WHERE book = 'author-guide'`)[0].n, 1);
  sql(`DELETE FROM book_members WHERE book = 'author-guide'`);
});

test("set-email for a member who has none: a claim link to that address, theirs only once opened", async () => {
  const alec = await signInAs(ALEC.id, ALEC.email);
  const res = await post("/api/members", { book: "ontology-for-social-research-a-criti", action: "set-email", member: BRANDON.id, email: "brandon@example.org" }, { cookie: alec });
  // No Resend key locally: the mail fails, so nothing is pending for anyone to use.
  assert.equal(res.status, 502);
  assert.equal(rows(`SELECT email FROM members WHERE id = '${BRANDON.id}'`)[0].email, null);
  const t = token();
  sql(`INSERT INTO links (token_hash, kind, member_id, email, created_by, created_at, expires_at) VALUES ('${sha(t)}', 'claim', '${BRANDON.id}', 'brandon@example.org', '${ALEC.id}', ${Date.now()}, ${Date.now() + 86400000})`);
  assert.deepEqual(await (await post("/api/invite", { kind: "claim", token: t, action: "info" })).json(), { name: "Brandon", email: "brandon@example.org" });
  assert.equal((await post("/api/invite", { kind: "claim", token: t, action: "accept" })).status, 200);
  assert.equal(rows(`SELECT email FROM members WHERE id = '${BRANDON.id}'`)[0].email, "brandon@example.org");
});

test("the proxy: only its list, only with a session on that book, never the browser's headers", async () => {
  // A book Alec isn't on (someone else is, so it isn't adopted from the registry).
  sql(`DELETE FROM book_members WHERE book = 'from-ontology-to-method-an-ontologic'; INSERT INTO book_members (book, member_id, added_at) VALUES ('from-ontology-to-method-an-ontologic', 'd4d4d4d4d4', ${NOW})`);
  const alec = await signInAs(ALEC.id, ALEC.email);
  for (const [path, method] of [["/fn/author-people", "GET"], ["/fn/author-read/../x", "GET"], ["/fn/author-send", "GET"], ["/fn/author-read", "DELETE"], ["/fn/page-revision", "GET"], ["/fn/", "GET"], ["/fn/author-read/extra", "GET"]])
    assert.equal((await fetch(`${BASE}${path}`, { method, headers: { ...site, cookie: alec } })).status, 404, `${method} ${path}`);
  assert.equal((await get("/fn/author-read?what=tree&book=platform-test-book", { cookie: alec, headers: { origin: BASE } })).status, 403, "no site header");
  assert.equal((await get("/fn/author-read?what=tree&book=platform-test-book")).status, 401, "no session");
  assert.equal((await get("/fn/author-read?what=tree&book=from-ontology-to-method-an-ontologic", { cookie: alec })).status, 403, "not on that book");
  assert.equal((await get("/fn/author-read?what=tree", { cookie: alec })).status, 403, "a request for no book");
  assert.equal((await post("/fn/author-act", { action: "publish" }, { cookie: alec })).status, 403, "a POST names its book");
  // On the book: one assertion written, bound and hashed, then forwarded upstream.
  const before = rows("SELECT COUNT(*) AS n FROM assertions")[0].n;
  const res = await get("/fn/author-read?what=tree&book=platform-test-book", { cookie: alec });
  assert.ok([200, 401, 403].includes(res.status), String(res.status)); // the function's answer, passed through
  assert.equal(res.headers.get("set-cookie"), null);
  const a = rows("SELECT member_id, book, length(id_hash) AS l, length(binding_hash) AS b, expires_at - " + Date.now() + " AS ttl FROM assertions ORDER BY expires_at DESC LIMIT 1")[0];
  assert.equal(rows("SELECT COUNT(*) AS n FROM assertions")[0].n, before + 1);
  assert.deepEqual([a.member_id, a.book, a.l, a.b], [ALEC.id, "platform-test-book", 64, 64]);
  assert.ok(a.ttl > 0 && a.ttl <= 60000);
});

test("read-back: once, only for its binding, only while the member is on the book", async () => {
  const id = token();
  const binding = sha("the request");
  sql(`INSERT INTO assertions (id_hash, member_id, book, binding_hash, expires_at) VALUES ('${sha(id)}', '${BRANDON.id}', 'ontology-for-social-research-a-criti', '${binding}', ${Date.now() + 60000})`);
  const readback = (b) => fetch(`${BASE}/api/internal/assertion`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  assert.equal((await readback({ id, binding: sha("another request") })).status, 404, "wrong binding");
  const ok = await readback({ id, binding });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { member: { id: BRANDON.id, name: "Brandon", github: "BrandonAndCaroline" }, book: "ontology-for-social-research-a-criti", books: ["ontology-for-social-research-a-criti"] });
  assert.equal((await readback({ id, binding })).status, 404, "single use");
  assert.equal((await fetch(`${BASE}/api/internal/assertion?id=${id}`)).status, 405, "no GET");
  // Removed from the book after the assertion was written: refused.
  const id2 = token();
  sql(`INSERT INTO assertions (id_hash, member_id, book, binding_hash, expires_at) VALUES ('${sha(id2)}', '${BRANDON.id}', 'platform-test-book', '${binding}', ${Date.now() + 60000})`);
  assert.equal((await readback({ id: id2, binding })).status, 404);
  // Expired: refused.
  const id3 = token();
  sql(`INSERT INTO assertions (id_hash, member_id, book, binding_hash, expires_at) VALUES ('${sha(id3)}', '${BRANDON.id}', 'ontology-for-social-research-a-criti', '${binding}', 1)`);
  assert.equal((await readback({ id: id3, binding })).status, 404);
});

test("notify: an unknown book or a nonsense number is 404, and sends nothing", async () => {
  const n = (b) => fetch(`${BASE}/api/internal/notify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  assert.equal((await n({ book: "no-such-book", number: 1 })).status, 404);
  assert.equal((await n({ book: "platform-test-book", number: "1; DROP TABLE members" })).status, 404);
  assert.equal((await n({ book: "platform-test-book", number: 0 })).status, 404);
  assert.equal(rows("SELECT COUNT(*) AS n FROM notified")[0].n, 0);
});

test("the public member list: ids and names, linked logins, never an email", async () => {
  const d = await (await fetch(`${BASE}/api/internal/members?book=ontology-for-social-research-a-criti`)).json();
  assert.ok(d.members.every((m) => /^m-[0-9a-f]{10}$/.test(m.id) && !("email" in m)));
  assert.ok(!JSON.stringify(d).includes("@example.org"));
  assert.deepEqual(d.github, ["BrandonAndCaroline", "textbookproject2026-alt"]);
  assert.equal((await fetch(`${BASE}/api/internal/members?book=nope`)).status, 404);
});

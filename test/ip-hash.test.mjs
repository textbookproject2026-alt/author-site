// The sign-in limit keys on HMAC-SHA256(IP, a random salt per UTC day), as the Worker's
// does: no IP is stored, the hourly limit still holds, the visitor starts afresh the next
// day, and yesterday's salt is gone. D1 here is node:sqlite with the repo's migrations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { allow, ipKey, testing } from "../functions/_lib/core.js";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const statement = (sql, args = []) => ({
    bind: (...a) => statement(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  });
  return { prepare: (sql) => statement(sql), batch: (list) => Promise.all(list.map((s) => s.all())), raw: db };
}

const req = (ip) => new Request("https://author.confused4now.org/api/auth/request", { headers: { "cf-connecting-ip": ip } });
const HOUR = 3_600_000;
const noon = Date.UTC(2026, 9, 14, 12);
const signin = async (env, ip, t) => allow(env, `signin:${await ipKey(env, req(ip), t)}`, 20, 3600, t);

test("the sign-in limit triggers, stores no IP, and resets the next day", async () => {
  const env = { DB: fakeD1() };
  testing.resetSalt();
  for (let i = 0; i < 20; i++) assert.equal(await signin(env, "203.0.113.7", noon + i), true);
  assert.equal(await signin(env, "203.0.113.7", noon + 30), false, "the 21st in the hour is refused");
  assert.equal(await signin(env, "198.51.100.1", noon + 31), true, "another visitor is not");

  const keys = env.DB.raw.prepare("SELECT key FROM rate").all().map((r) => r.key);
  assert.equal(keys.length, 2);
  for (const k of keys) assert.match(k, /^signin:h:[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(env.DB.raw.prepare("SELECT * FROM rate").all()).includes("203.0.113"));

  // 00:00:01 UTC next day: a new salt, a new key, so the visitor isn't held back...
  const tomorrow = Date.UTC(2026, 9, 15, 0, 0, 1);
  const today = await ipKey(env, req("203.0.113.7"), noon);
  assert.notEqual(await ipKey(env, req("203.0.113.7"), tomorrow), today);
  assert.equal(await signin(env, "203.0.113.7", tomorrow), true);
  // ...and yesterday's salt is deleted, so yesterday's keys can't be linked to the address.
  assert.deepEqual(env.DB.raw.prepare("SELECT day FROM salts").all().map((r) => r.day), [Math.floor(tomorrow / 86_400_000)]);
  // The salt is shared through D1: another isolate (a reset here) gets the same key.
  testing.resetSalt();
  assert.equal(await ipKey(env, req("203.0.113.7"), tomorrow + HOUR), await ipKey(env, req("203.0.113.7"), tomorrow));
  testing.resetSalt();
});

test("the migration deletes rate rows keyed on a raw IP and keeps the others", () => {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir).sort();
  for (const f of files.filter((f) => f < "0003")) db.exec(readFileSync(new URL(f, dir), "utf8"));
  db.exec(`INSERT INTO rate (key, window, count, expires_at) VALUES ('signin:ip:203.0.113.7', 1, 1, 0), ('notify:ip:203.0.113.7', 1, 1, 0), ('signin:email:abc', 1, 1, 0), ('notify:all', 1, 1, 0)`);
  for (const f of files.filter((f) => f >= "0003")) db.exec(readFileSync(new URL(f, dir), "utf8"));
  assert.deepEqual(db.prepare("SELECT key FROM rate ORDER BY key").all().map((r) => r.key), ["notify:all", "signin:email:abc"]);
});

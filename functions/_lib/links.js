// Emailed links (batch 2b): sign-in (15 minutes), invitation and email claim (seven
// days), and since batch 2c the new-browser alert's "This wasn't me" (revoke, seven days). The token is only in the email; the database keeps its SHA-256. Opening a
// link's page shows what it is for; the page's own button then uses it (POST), so a
// mail scanner that fetches the link can't spend it.
import { LINK_DAYS, SIGNIN_MINUTES, TOKEN_RE, hash, now, randomToken } from "./core.js";

export async function createLink(env, { kind, book = null, email = null, name = null, memberId = null, createdBy = null, mailed = true, deviceHash = null }) {
  const token = randomToken();
  const t = now();
  const ttl = kind === "signin" ? SIGNIN_MINUTES * 60_000 : LINK_DAYS * 86_400_000;
  await env.DB.prepare(
    "INSERT INTO links (token_hash, kind, book, email, name, member_id, created_by, created_at, expires_at, mailed, device_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(await hash(token), kind, book, email, name, memberId, createdBy, t, t + ttl, mailed ? 1 : 0, deviceHash)
    .run();
  return token;
}

/** A live, unused link of this kind, without using it. */
export async function peekLink(env, kind, token) {
  if (!TOKEN_RE.test(String(token ?? ""))) return null;
  return env.DB.prepare("SELECT * FROM links WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?")
    .bind(await hash(token), kind, now())
    .first();
}

/** Uses a link: the one statement that checks it also marks it used. Null if it wasn't live. */
export async function useLink(env, kind, token) {
  if (!TOKEN_RE.test(String(token ?? ""))) return null;
  return env.DB.prepare("UPDATE links SET used_at = ? WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ? RETURNING *")
    .bind(now(), await hash(token), kind, now())
    .first();
}

/** The link was shown to someone other than its addressee: it can't sign anyone in. */
export async function markNotMailed(env, token) {
  await env.DB.prepare("UPDATE links SET mailed = 0 WHERE token_hash = ?").bind(await hash(token)).run();
}

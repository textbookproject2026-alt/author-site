// POST /api/auth/github { token } — the GitHub sign-in, kept only while members move
// to email links (GITHUB_SIGNIN; "off" ends it). The token is the suggest-edit
// function's identity token from its GitHub popup; the function (the hard-coded
// UPSTREAM) says whose it is. Only a member linked to that GitHub login is signed in
// (moved over from the registry, or a new book's people adopted from it); they're
// asked once for an email, which they confirm from that inbox.
import { UPSTREAM, adoptNewBooks, body, booksOf, fail, json, sameSite, SITE, startSession } from "../../_lib/core.js";

export async function onRequestPost({ request, env }) {
  if (!sameSite(request)) return fail(403, "cross-site request");
  if (env.GITHUB_SIGNIN === "off") return fail(410, "github sign-in off", "Sign in with your email address instead.");
  const token = String((await body(request)).token ?? "");
  if (!token || token.length > 4000) return fail(400, "bad token");
  const res = await fetch(`${UPSTREAM}/api/author-read?what=books`, {
    headers: { authorization: `Bearer ${token}`, origin: SITE },
    redirect: "manual",
  });
  if (!res.ok) return fail(401, "github identity refused", "GitHub sign-in didn't work. Try again, or sign in with your email address.");
  const login = String((await res.json().catch(() => ({}))).login ?? "");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login)) return fail(401, "github identity refused");
  // A brand-new book's people may only be in the registry yet: adopt them first.
  await adoptNewBooks(env, { github: login });
  const member = await env.DB.prepare("SELECT id, email FROM members WHERE github = ?").bind(login).first();
  if (!member || !(await booksOf(env, member.id)).length) return fail(403, "not on a book", "Your GitHub account isn't on any book here. Ask someone on your book to invite you by email.");
  return json({ ok: true, needsEmail: !member.email }, 200, { "set-cookie": await startSession(env, member.id) });
}

/** Anything but POST. */
export const onRequest = () => new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } });

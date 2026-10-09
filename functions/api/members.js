// The People tab (batch 2b). Every member of a book is equal: anyone on it can
// invite and remove, as before. Changes take effect at once; the registry, the
// public record, follows in the background (_lib/sync.js).
//
// GET  /api/members?book=<slug> -> { members: [{ id, name, hasEmail, you }],
//        invitations: [{ name, email, expires }], log: [{ at, text }], sync? }
// POST /api/members { book, action: "invite", name, email, send }  -> { mailed, link? }
// POST /api/members { book, action: "remove", member }
// POST /api/members { book, action: "set-email", member, email }   (a member who has none:
//        a link goes to that address; it becomes theirs when it's opened)
import {
  allow, audit, body, bookEntry, cleanName, fail, isMaintainer, json, linkOrigin, mailBody, normEmail, now, onBook, sameSite, sendMail, session, validEmail,
} from "../_lib/core.js";
import { createLink, markNotMailed } from "../_lib/links.js";
import { requestSync, syncStatus } from "../_lib/sync.js";

const WORDS = { invited: "invited", removed: "removed", "email-requested": "asked to confirm an email address for" };
export function logLine(r) {
  if (r.action === "joined") return `${r.subject_name} joined`;
  if (r.action === "published") return `${r.actor_name} published the book`;
  if (r.action === "email-confirmed") return `${r.subject_name} confirmed their email address`;
  return `${r.actor_name} ${WORDS[r.action] ?? r.action} ${r.subject_name}`;
}

async function gate(request, env, book) {
  const s = await session(request, env);
  if (!s) return { error: fail(401, "signed out", "Please sign in again.") };
  if (!(await onBook(env, s.member.id, book))) return { error: fail(403, "not on this book", "You aren't one of this book's people.") };
  return { s };
}

export async function onRequestGet({ request, env }) {
  const book = new URL(request.url).searchParams.get("book") ?? "";
  const { s, error } = await gate(request, env, book);
  if (error) return error;
  const [{ results: members }, { results: invites }, { results: log }] = await Promise.all([
    env.DB.prepare(
      "SELECT m.id, m.display_name, m.email IS NOT NULL AS has_email FROM book_members b JOIN members m ON m.id = b.member_id WHERE b.book = ? ORDER BY m.display_name COLLATE NOCASE",
    ).bind(book).all(),
    env.DB.prepare("SELECT name, email, expires_at FROM links WHERE kind = 'invite' AND book = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC").bind(book, now()).all(),
    env.DB.prepare("SELECT at, actor_name, action, subject_name FROM audit WHERE book = ? ORDER BY at DESC, id DESC LIMIT 30").bind(book).all(),
  ]);
  return json({
    members: members.map((m) => ({ id: m.id, name: m.display_name, hasEmail: !!m.has_email, you: m.id === s.member.id })),
    invitations: invites.map((i) => ({ name: i.name, email: i.email, expires: i.expires_at })),
    log: log.map((r) => ({ at: r.at, text: logLine(r) })),
    ...(isMaintainer(env, s.member) ? { sync: await syncStatus(env, book) } : {}),
  });
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!sameSite(request)) return fail(403, "cross-site request");
  const b = await body(request);
  const book = typeof b.book === "string" ? b.book : "";
  const { s, error } = await gate(request, env, book);
  if (error) return error;
  const me = s.member;
  const entry = await bookEntry(book).catch(() => null);
  if (!entry) return fail(404, "no such book");

  if (b.action === "invite") {
    const name = cleanName(b.name);
    const email = normEmail(b.email);
    if (!name) return fail(400, "no name", "Give the name they'll be credited by.");
    if (!validEmail(email)) return fail(400, "bad email", "That doesn't look like an email address.");
    if (!(await allow(env, `invite:${me.id}`, 20, 86_400)) || !(await allow(env, `invite:book:${book}`, 40, 86_400)))
      return fail(429, "rate limited", "That's a lot of invitations for one day. Try again tomorrow.");
    const already = await env.DB.prepare("SELECT 1 AS x FROM book_members b JOIN members m ON m.id = b.member_id WHERE b.book = ? AND m.email = ?").bind(book, email).first();
    if (already) return fail(409, "already on the book", "That person is already on this book.");
    const token = await createLink(env, { kind: "invite", book, email, name, createdBy: me.id });
    await audit(env, book, me, "invited", name);
    const link = `${linkOrigin(request)}/#/invite/${token}`;
    // A link the inviter passes on themselves can't sign anyone in: whoever opens it
    // joins the book, and the sign-in link goes to the invited address (api/invite.js).
    if (b.send === false) {
      await markNotMailed(env, token);
      return json({ ok: true, mailed: false, link });
    }
    const mail = mailBody({
      lines: [`${me.display_name} invited you to work on ${entry.title} on Confused for Now.`, "Open the link to join. You'll confirm the name the book will credit you by, and then you're in. It works once, within seven days."],
      button: "Join the book",
      url: link,
      footer: "Confused for Now publishes open textbooks. If you weren't expecting this, you can ignore it.",
    });
    try {
      await sendMail(env, { to: email, subject: `${me.display_name} invited you to work on ${entry.title} on Confused for Now`, ...mail });
    } catch (err) {
      console.error(`invite mail: ${err.message}`);
      await markNotMailed(env, token);
      return json({ ok: true, mailed: false, link, userMessage: "The email couldn't be sent just now. Copy the link and send it yourself." });
    }
    return json({ ok: true, mailed: true });
  }

  if (b.action === "remove") {
    const who = await env.DB.prepare("SELECT m.id, m.display_name FROM book_members b JOIN members m ON m.id = b.member_id WHERE b.book = ? AND m.id = ?").bind(book, String(b.member ?? "")).first();
    if (!who) return fail(404, "not on the book", "That person isn't on this book.");
    // One statement checks a book keeps someone and removes: two people removing each
    // other at once can't leave it empty.
    const gone = await env.DB.prepare(
      "DELETE FROM book_members WHERE book = ? AND member_id = ? AND (SELECT COUNT(*) FROM book_members WHERE book = ?) > 1",
    ).bind(book, who.id, book).run();
    if (!gone.meta.changes) return fail(409, "last person", "A book needs at least one person on it.");
    // At once: signed out everywhere, their links and pending requests void.
    const statements = [
      env.DB.prepare("DELETE FROM sessions WHERE member_id = ?").bind(who.id),
      env.DB.prepare("DELETE FROM assertions WHERE member_id = ?").bind(who.id),
      env.DB.prepare("DELETE FROM links WHERE member_id = ? AND used_at IS NULL").bind(who.id),
      env.DB.prepare("DELETE FROM links WHERE created_by = ? AND book = ? AND used_at IS NULL").bind(who.id, book),
    ];
    await env.DB.batch(statements);
    const left = await env.DB.prepare("SELECT 1 AS x FROM book_members WHERE member_id = ?").bind(who.id).first();
    // On no book now: their email is deleted (their name stays in the books' credits:
    // CC-BY-SA attribution).
    if (!left) await env.DB.prepare("UPDATE members SET email = NULL WHERE id = ?").bind(who.id).run();
    await audit(env, book, me, "removed", who.display_name);
    waitUntil(requestSync(env, book));
    return json({ ok: true });
  }

  if (b.action === "set-email") {
    const email = normEmail(b.email);
    if (!validEmail(email)) return fail(400, "bad email", "That doesn't look like an email address.");
    const who = await env.DB.prepare("SELECT m.id, m.display_name, m.email FROM book_members b JOIN members m ON m.id = b.member_id WHERE b.book = ? AND m.id = ?").bind(book, String(b.member ?? "")).first();
    if (!who) return fail(404, "not on the book", "That person isn't on this book.");
    if (who.email) return fail(409, "has email", "They already have an email address.");
    // The address becomes their way in, and whoever reads that inbox becomes them, on
    // every book and after the giver has left. So only the platform maintainer gives
    // one for someone else; anyone can give their own (/api/me, after a GitHub sign-in).
    if (!isMaintainer(env, me)) return fail(403, "maintainer only", `Only the platform's maintainer can give an address for ${who.display_name}. They can also give it themselves: they sign in once more the old way and are asked for it.`);
    const elsewhere = await env.DB.prepare(
      "SELECT 1 AS x FROM book_members t WHERE t.member_id = ? AND t.book NOT IN (SELECT book FROM book_members WHERE member_id = ?) LIMIT 1",
    ).bind(who.id, me.id).first();
    if (elsewhere) return fail(403, "on other books", `${who.display_name} also works on a book you aren't on, so only they can give their address: they sign in once more the old way and are asked for it.`);
    if (!(await allow(env, `claim:${who.id}`, 5, 3600))) return fail(429, "rate limited", "Too many tries. Wait a little.");
    const token = await createLink(env, { kind: "claim", memberId: who.id, email, createdBy: me.id });
    const mail = mailBody({
      lines: [`Hello ${who.display_name},`, `${me.display_name} gave this address for you on ${entry.title} on Confused for Now. Open the link to sign in with it from now on.`],
      button: "Use this address",
      url: `${linkOrigin(request)}/#/claim/${token}`,
      footer: "If this isn't you, ignore it: nothing changes unless the link is opened.",
    });
    try {
      await sendMail(env, { to: email, subject: `Confirm your email for ${entry.title} on Confused for Now`, ...mail });
    } catch (err) {
      console.error(`claim mail: ${err.message}`);
      return fail(502, "mail", "The email couldn't be sent just now. Try again in a moment.");
    }
    await audit(env, book, me, "email-requested", who.display_name);
    return json({ ok: true });
  }
  return fail(400, "unknown action");
}

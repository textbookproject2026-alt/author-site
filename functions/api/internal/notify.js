// POST /api/internal/notify { book, number } — a reader just sent a proposal, note or
// suggestion on a book (the suggest-edit function calls this after opening it).
// Members of that book who have "Emails about reader suggestions" on, and an email,
// get one email each: what it is, the paragraph's link, and a button to review it.
//
// No secret, so nothing in the call is trusted: the item is read from the book's
// repository with the platform's App (the suggest-edit function's mode=item, from
// the hard-coded UPSTREAM), which answers only for an item that exists, is labelled
// as a proposal, note or suggestion, and was opened by the platform's App or carries
// its attribution line; anything else is 404 here too. The email's words come from
// that answer, never from the caller. At most one email per item per member
// (recorded in D1 before sending). Rate-limited per caller before the check, and per
// book and overall once an item has passed it, so a burst of real items can't use up
// the sending quota and a burst of junk can't use up the real items' budget.
import { UPSTREAM, allow, body, bookEntry, fail, json, linkOrigin, mailBody, now, sendMail } from "../../_lib/core.js";

const PER_BOOK_PER_HOUR = 30;
const OVERALL_PER_HOUR = 120;
const PER_CALLER_PER_HOUR = 120;
const KIND = { edit: "proposed an edit to", note: "left a note on", suggestion: "suggested a change to" };

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  const number = Number(b.number);
  const entry = await bookEntry(b.book).catch(() => null);
  if (!entry || !Number.isInteger(number) || number < 1 || number > 1e7) return fail(404, "not found");
  if (!(await allow(env, `notify:ip:${request.headers.get("cf-connecting-ip") ?? "unknown"}`, PER_CALLER_PER_HOUR, 3600))) return fail(429, "rate limited");

  const res = await fetch(`${UPSTREAM}/api/page-revision?mode=item&book=${encodeURIComponent(entry.slug)}&number=${number}`, { redirect: "manual" });
  if (res.status === 404) return fail(404, "not found");
  if (!res.ok) return fail(502, "upstream");
  const item = await res.json().catch(() => null);
  if (!item || item.number !== number || !Object.hasOwn(KIND, item.kind)) return fail(404, "not found");
  if (item.state !== "open") return json({ ok: true, sent: 0 });
  if (!(await allow(env, `notify:book:${entry.slug}`, PER_BOOK_PER_HOUR, 3600)) || !(await allow(env, "notify:all", OVERALL_PER_HOUR, 3600)))
    return fail(429, "rate limited");

  const { results } = await env.DB.prepare(
    "SELECT m.id, m.email FROM book_members bm JOIN members m ON m.id = bm.member_id WHERE bm.book = ? AND m.notify = 1 AND m.email IS NOT NULL",
  )
    .bind(entry.slug)
    .all();
  const what = KIND[item.kind];
  // A reader wrote the summary: short, and only ever as text (mailBody escapes it).
  const summary = typeof item.summary === "string" ? item.summary.slice(0, 200) : "";
  const n = Number.isInteger(item.paragraph?.n) ? item.paragraph.n : null;
  const mail = mailBody({
    lines: [`A reader ${what} ${entry.title}.`, ...(summary ? [`“${summary}”`] : []), ...(n ? [`Where: ¶${n}`] : [])],
    button: "Review in the author site",
    url: `${linkOrigin(request)}/#/${entry.slug}/drafts`,
    footer: "You get these because “Emails about reader suggestions” is on in your author site settings.",
  });
  let sent = 0;
  for (const r of results) {
    // Recorded first: a retry, or a second call for the same item, sends nothing.
    const fresh = await env.DB.prepare("INSERT OR IGNORE INTO notified (book, number, member_id, at) VALUES (?, ?, ?, ?) RETURNING member_id")
      .bind(entry.slug, number, r.id, now())
      .first();
    if (!fresh) continue;
    try {
      await sendMail(env, { to: r.email, subject: `A reader ${what} ${entry.title}`, ...mail });
      sent++;
    } catch (err) {
      console.error(`notify: ${err.message}`);
    }
  }
  return json({ ok: true, sent });
}

/** Anything but POST. */
export const onRequest = () => new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: { "content-type": "application/json", allow: "POST" } });

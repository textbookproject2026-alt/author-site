// Starting a session (batch 2b), and since batch 2c knowing the browser: a
// long-lived HttpOnly device cookie, kept hashed in `devices`. A sign-in from a
// browser the member hasn't used before emails them (time, browser and system, and
// "This wasn't me", a link to a page whose button signs them out everywhere). The
// only sign-in that never alerts is a new member's first, when they join from their
// invitation: every other sign-in on an unknown browser does, including a member's
// first since this change. If the alert can't be sent, the browser isn't remembered,
// so the next sign-in there tries again.
import { SESSION_DAYS, TOKEN_RE, cookies, hash, linkOrigin, mailBody, now, randomToken, sendMail, sessionCookie } from "./core.js";
import { createLink } from "./links.js";

export const DEVICE_COOKIE = "__Host-tb_device";
const DEVICE_DAYS = 400;
const DAY = 86_400_000;

const deviceCookie = (token) => `${DEVICE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DEVICE_DAYS * 86_400}`;

/** "Chrome on macOS": the browser and system from a user agent, in words. Never the user agent itself. */
export function deviceLabel(ua = "") {
  const u = String(ua);
  const browser = /Edg(?:e|A|iOS)?\//.test(u) ? "Edge"
    : /OPR\/|Opera/.test(u) ? "Opera"
    : /SamsungBrowser\//.test(u) ? "Samsung Internet"
    : /Firefox\/|FxiOS\//.test(u) ? "Firefox"
    : /Chrome\/|CriOS\//.test(u) ? "Chrome"
    : /Safari\//.test(u) && /Version\//.test(u) ? "Safari"
    : "A browser";
  const system = /iPad/.test(u) ? "iPad"
    : /iPhone|iPod/.test(u) ? "iPhone"
    : /Android/.test(u) ? "Android"
    : /CrOS/.test(u) ? "ChromeOS"
    : /Mac OS X|Macintosh/.test(u) ? "macOS"
    : /Windows/.test(u) ? "Windows"
    : /Linux/.test(u) ? "Linux"
    : "an unknown system";
  return `${browser} on ${system}`;
}

/** "10 October 2026, 14:05 UTC". */
const at = (ms) => `${new Date(ms).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })} UTC`;

async function newBrowserAlert(env, memberId, label, deviceHash, origin, when) {
  const m = await env.DB.prepare("SELECT display_name, email FROM members WHERE id = ?").bind(memberId).first();
  if (!m?.email) return;
  const token = await createLink(env, { kind: "revoke", memberId, email: m.email, deviceHash });
  const mail = mailBody({
    lines: [
      `Hello ${m.display_name},`,
      `Your account on the Confused for Now author site was just signed in on a browser it hasn't used before: ${label}, on ${when}.`,
      "If that was you, there is nothing to do. If it wasn't, press the button: it signs your account out everywhere. To sign in again you need this inbox, so keep it safe.",
    ],
    button: "This wasn't me",
    url: `${origin}/#/revoke/${token}`,
    footer: "The button opens a page on the author site; nothing happens until you press Sign out everywhere there. The link works for seven days.",
  });
  await sendMail(env, { to: m.email, subject: "New sign-in to your Confused for Now account", ...mail });
}

/**
 * A new session for `memberId`: its Set-Cookie values (the session, and the device
 * cookie, renewed). Emails a new-browser alert after answering (`waitUntil`), except
 * for `{ joined: true }` (a member created by this very request).
 */
export async function startSession(env, memberId, request, waitUntil = (p) => p, { joined = false } = {}) {
  const t = now();
  const label = deviceLabel(request.headers.get("user-agent") ?? "");
  let device = cookies(request)[DEVICE_COOKIE];
  if (!TOKEN_RE.test(device ?? "")) device = randomToken();
  const deviceHash = await hash(device);
  const known = await env.DB.prepare("SELECT 1 AS x FROM devices WHERE member_id = ? AND device_hash = ?").bind(memberId, deviceHash).first();
  if (!known) {
    // Inserted first so two sign-ins at once from one new browser alert once.
    const fresh = await env.DB.prepare("INSERT OR IGNORE INTO devices (member_id, device_hash, label, first_seen) VALUES (?, ?, ?, ?) RETURNING device_hash")
      .bind(memberId, deviceHash, label, t)
      .first();
    if (fresh && !joined)
      waitUntil(
        newBrowserAlert(env, memberId, label, deviceHash, linkOrigin(request), at(t)).catch(async (err) => {
          console.error(`new-browser alert: ${err.message}`);
          await env.DB.prepare("DELETE FROM devices WHERE member_id = ? AND device_hash = ?").bind(memberId, deviceHash).run().catch(() => {});
        }),
      );
  }
  const token = randomToken();
  const sid = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO sessions (id_hash, member_id, created_at, expires_at, sid, label, last_active) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(await hash(token), memberId, t, t + SESSION_DAYS * DAY, sid, label, t)
    .run();
  return [sessionCookie(token, SESSION_DAYS * 86_400), deviceCookie(device)];
}

// The author's own DeepSeek key, as the desktop app used it: for extra glossary
// suggestions and the AI formatting check, both optional. The key is kept in this
// browser only (localStorage) and is only ever sent to DeepSeek, from this page:
// DeepSeek's API answers browsers from any origin (CORS), so nothing of ours sits in
// between and nothing of ours ever sees the key.

const KEY = "tb-deepseek-key";
export const API_URL = "https://api.deepseek.com/chat/completions"; // llm.API_URL
const TIMEOUT_MS = 45_000; // llm.TIMEOUT

export function deepseekKey() {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

/** Keeps (or, given nothing, forgets) the key. False if this browser won't keep it. */
export function keepDeepseekKey(key) {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

/** The last four characters, so the author can tell which key is kept (llm.key_hint). */
export const keyHint = (key) => (key.length > 4 ? key.slice(-4) : "****");

/**
 * One request exactly as llm.py made it (its JSON body), answered as [status, text]
 * for the converter to read: the HTTP status, 0 if DeepSeek couldn't be reached, or
 * -1 if it took longer than llm.py waits.
 */
export async function askDeepseek(body, key, timeout = TIMEOUT_MS) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body,
      signal: AbortSignal.timeout(timeout),
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    return [res.status, await res.text()];
  } catch (err) {
    return [err?.name === "TimeoutError" ? -1 : 0, ""];
  }
}

/** Whether a key works, in llm.test_key's words. */
export async function testDeepseekKey(key) {
  if (!key) return [false, "There is no key saved yet."];
  const body = JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: "Reply with the word: ready" }], max_tokens: 4, stream: false });
  const [status] = await askDeepseek(body, key, 20_000);
  if (status >= 200 && status < 300) return [true, "The key works. DeepSeek answered normally."];
  if (status === 401 || status === 403) return [false, "DeepSeek did not accept that key. Check you copied all of it, with no spaces at either end."];
  if (status === 402) return [false, "The key is valid, but the DeepSeek account has no credit left."];
  if (status === 429) return [false, "The key looks fine, but DeepSeek is busy right now. Try again in a minute."];
  if (status === 0) return [false, "DeepSeek could not be reached. This is usually the internet connection."];
  if (status === -1) return [false, "DeepSeek took too long to answer."];
  return [false, `DeepSeek returned an error (${status}).`];
}

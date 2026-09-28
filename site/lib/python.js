// The Authoring Assistant's own Python, run in the browser with Pyodide: one
// implementation for the desktop app's link and glossary questions, the Word import
// (book-requests runs the same converter) and the author site, with the converter's
// Python tests still the source of truth.
//
// Loaded only when an author opens the questions (or asks for a suggestion's exact
// replacement): Pyodide is a large download, so nothing else waits for it.
//
// What runs is authoring-assistant's app/ package at converter.json's pinned commit,
// copied into site/py/ at build time, with DraftsSession (session.py) doing the work
// on a snapshot of the drafts: no files, only the snapshot and a blob(sha) lookup. The
// only parts replaced are four modules the browser can't or mustn't run, as stand-ins
// below: picker (the Mac's file chooser), keychain (the Mac's Keychain), llm and
// formatting (DeepSeek: out of scope here, and never offered).

const PYODIDE = "314.0.7";
const INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE}/full/`;

const STANDINS = {
  "app/picker.py": `"""Stand-in on the author site: there is no Mac file chooser here."""
def obsidian_running():
    return False
def choose_file(*a, **k):
    return None, "not available"
choose_word_document = choose_folder = choose_file
`,
  "app/keychain.py": `"""Stand-in on the author site: nothing is kept in a keychain."""
def available():
    return False
def load(account):
    return None
def save(account, secret):
    return False
def delete(account):
    return None
forget = delete
def hint(account):
    return ""
ACCOUNT_GITHUB = ACCOUNT_DEEPSEEK = ""
`,
  "app/llm.py": `"""Stand-in on the author site: DeepSeek is not used here."""
def have_key():
    return False
def suggest_terms(text, max_chars=90000):
    return None, ""
def ask_json(*a, **k):
    raise RuntimeError("not available on the author site")
`,
  "app/formatting.py": `"""Stand-in on the author site: the AI formatting check is not offered here."""
def check(docmap, known_pages):
    return [], []
`,
};

// The glue: a DraftsSession held between calls, JSON in and out.
const GLUE = `
import base64, json, types
from app import session as S, console as C

_sess = None

def analyse(snap_json, blobs_json, chapter, options_json):
    global _sess
    snap = json.loads(snap_json)
    store = {sha: base64.b64decode(b) for sha, b in json.loads(blobs_json).items()}
    def blob(sha):
        if sha not in store:
            raise KeyError("A file of the book could not be read just now.")
        return store[sha]
    _sess = S.DraftsSession(types.SimpleNamespace(), snap, blob)
    _sess.load_chapter(chapter)
    warnings, _, _ = _sess.preflight()
    findings, notes = _sess.run_analyses(json.loads(options_json))
    return json.dumps({"findings": findings, "notes": notes, "warnings": warnings,
                       "glossary_path": _sess.glossary_path,
                       "concept_source": _sess.concept_source,
                       "concept_pages": len(_sess.pages)})

def changes(accepted_json, expand_json):
    preview, files = _sess.changes(json.loads(accepted_json), json.loads(expand_json))
    return json.dumps({"preview": preview,
                       "files": {p: b.decode("utf-8") for p, b in files.items()}})

def plan_suggestion(text, path, suggestion):
    plan = C.plan_in_text(text, path, suggestion)
    new_text, why = C.change_text(plan) if plan["can_apply"] else (None, plan["reason"])
    plan.pop("text", None)
    return json.dumps({**plan, "new_text": new_text, "why": why})
`;

let ready = null;

/** Pyodide with the converter imported. `onStatus(words)` says what it is doing. */
export function python(onStatus = () => {}) {
  ready ??= (async () => {
    onStatus("Getting the checker ready. The first time takes a little while…");
    const { loadPyodide } = await import(`${INDEX}pyodide.mjs`);
    const py = await loadPyodide({ indexURL: INDEX });
    const manifest = await fetch(new URL("../py/manifest.json", import.meta.url)).then((r) => {
      if (!r.ok) throw new Error("The checker's files are missing from this site.");
      return r.json();
    });
    py.FS.mkdirTree("/converter/app");
    await Promise.all(manifest.files.map(async (f) => {
      const text = await fetch(new URL(`../py/${f}`, import.meta.url)).then((r) => {
        if (!r.ok) throw new Error(`The checker's file ${f} is missing from this site.`);
        return r.text();
      });
      py.FS.writeFile(`/converter/${f}`, text);
    }));
    for (const [f, text] of Object.entries(STANDINS)) py.FS.writeFile(`/converter/${f}`, text);
    py.FS.writeFile("/converter/webglue.py", GLUE);
    await py.runPythonAsync("import sys; sys.path.insert(0, '/converter'); import webglue");
    return { py, glue: py.pyimport("webglue"), manifest };
  })().catch((err) => {
    ready = null;
    err.userMessage ??= "The checker couldn't be started in this browser. Reload the page and try again.";
    throw err;
  });
  return ready;
}

const b64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/**
 * The questions for one chapter. `snap` is { head, tree, files: { path: sha } } and
 * `blobs` { sha: Uint8Array } for every file the session may read (the chapter, the
 * glossary, the concept pages).
 */
export async function analyse(snap, blobs, chapter, options, onStatus) {
  const { glue } = await python(onStatus);
  const enc = Object.fromEntries(Object.entries(blobs).map(([sha, bytes]) => [sha, b64(bytes)]));
  return JSON.parse(glue.analyse(JSON.stringify(snap), JSON.stringify(enc), chapter, JSON.stringify(options)));
}

/** What the author's answers change: { preview, files: { path: text } }. */
export async function changes(accepted, expandGroups) {
  const { glue } = await python();
  return JSON.parse(glue.changes(JSON.stringify(accepted), JSON.stringify(expandGroups)));
}

/** Whether a suggestion is an exact replacement found exactly once (console.plan_in_text). */
export async function planSuggestion(text, path, suggestion, onStatus) {
  const { glue } = await python(onStatus);
  return JSON.parse(glue.plan_suggestion(text, path, suggestion));
}

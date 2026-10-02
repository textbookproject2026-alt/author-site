# author-site

**author.confused4now.org**: where an author does everything after their book is set
up, in any browser on any computer. It replaced the desktop Authoring Assistant
(28 Sep 2026).

A static site: plain ES modules, no framework and no build step. The one thing it
could have used a framework for is drawing a dozen small screens from JSON, and a
40-line element builder (`site/lib/dom.js`) does that without a dependency to keep
up to date or a build to trust.

```
site/                    what Cloudflare Pages serves (the output directory)
  index.html             the shell; <meta name="tb-api"> is the function's /api/ URL
  theme-init.js          applies the stored light/dark choice before first paint
  styles.css             the platform's palette and type, as --portal-* tokens
  app.js                 routes (#/…) and the header
  lib/api.js             the author endpoints; the identity token on every call
  lib/auth.js            GitHub sign-in (popup), kept in sessionStorage only
  lib/books.js           the author's books, and the book header and tabs
  lib/screens-*.js       books and chapters, Word import, Waiting for you
  lib/preview.js         a chapter as readers see it (copied from the in-site editor)
  lib/diff.js            differences (copied from the in-site editor)
  lib/public.js          reads that need no sign-in: registry, jobs, drafts preview
  lib/upload.js          a Word file in 2.5 MB parts, as the portal's form sends one
  lib/python.js          Pyodide and the converter's Python, loaded only for the questions
  lib/deepseek.js        the author's own DeepSeek key (this browser only), and the request
  lib/screens-settings.js  Settings: that key
  lib/screens-people.js  People: the book's authors, invite and remove
  lib/screens-tidy.js    the citation, concept-link and glossary questions
  lib/screens-edit.js    the editor (edit-on-github editor.ts's layout, as a screen)
  py/                    GENERATED at build: the converter's Python (converter.json)
converter.json           which authoring-assistant commit, and which of its files
scripts/fetch-converter.mjs  the Pages build step: converter.json's files into site/py/
  _headers               Cloudflare Pages control file: the CSP
test/site.test.mjs       headless Chromium against test/stub.mjs
test/questions.test.mjs  the questions in real Pyodide, byte for byte against desktop Python
test/screenshots.mjs     every screen, light and dark, desktop and phone
```

## What it does, and where

| The author… | Screen | Server side |
|---|---|---|
| signs in with GitHub | sign-in | `github-auth` (the author site is a `github-auth` page in the registry's `platform.pages`) |
| sees their books | `#/` | `author-read?what=books`: the books whose registry `authors` include them |
| reads a chapter, downloads a copy | `#/<book>`, `#/<book>/chapter/<path>` | `author-read` tree and file; the drafts zip from GitHub |
| edits a page: Edit, Preview, Changes | `#/<book>/edit/<path>` | `author-read` file; `author-send`, on the drafts commit it was read at |
| brings in a Word document | `#/<book>/import` | `author-import` (parts, start, status, again); book-requests' private `import-chapter` converts; `author-send` sends |
| answers readers' suggestions | `#/<book>/suggestion/<n>` | `author-act` suggestion-accept, -decline, -made |
| accepts or declines draft changes | `#/<book>/change/<n>` | `author-act` change-accept, -decline |
| sends the drafts to readers | `#/<book>/publish` | `author-act` publish-prepare, publish |
| sees the jobs and the drafts preview | `#/<book>/waiting` | none: public reads from the browser |
| invites or removes the book's authors | `#/<book>/people` | `author-people`, `author-people-change`: a registry pull request with auto-merge; pending until the function runs it |
| reads the drafts' history, of the book or one page; one change's difference and the page as it was; restores an old version as a new change | `#/<book>/history[/<path>]`, `#/<book>/revision/<sha>[/<path>]` | `author-history` (as the App, not GitHub's unauthenticated API); Restore sends through `author-send` like any edit |
| keeps a DeepSeek key for the optional checks | `#/settings` | none: the key stays in the browser and goes only to DeepSeek |

The endpoints are suggest-edit-function's `/api/author-*` URLs (one routed function;
its README, "The author site"). They check, on every request, that the page is a registry platform page with
`author-api`, that the identity token was issued to this origin, and that the login
is in the book's `authors`. They act as the GitHub App, and every write names the
author. Nobody's GitHub token is kept, here or there.


**History's two known limits** (accepted):
- A page's History follows its current path only; changes from before a rename are
  in the book's History.
- Live or waiting comes from comparing live with drafts, which GitHub caps at 250
  commits: if drafts are further ahead than that, the oldest waiting commits show as
  Live until the next publish.


## The questions run the converter's own Python

The citation, concept-link and glossary questions, and a reader suggestion's exact
replacement, are the Authoring Assistant's Python (`session.py`'s `DraftsSession`,
`references`, `terms`, `glossary`, `mdmap`, `edits`, `console`), run in the browser by
Pyodide (pinned, from jsDelivr, loaded only when an author opens the questions). One
implementation: book-requests' Word import runs the same repository, and its Python
tests stay the source of truth. The session works on a snapshot of the drafts, read
from GitHub's public copy and checked against the drafts' own blob ids, so it needs
no files. Two modules are replaced by stand-ins in `lib/python.js`, because they
belong to the Mac: `picker` and `keychain`.

**DeepSeek**, optional as in the app: extra glossary suggestions and the AI
formatting check (`formatting.py` and its `formatting_rules.md`), with the author's
**own** key, entered under Settings and kept in that browser's `localStorage` only.
DeepSeek's API answers browsers cross-origin, so the page calls it directly; the key
never reaches the function or anything else of ours (the CSP allows
`api.deepseek.com`). `llm.py` runs as it is, with `load_key` and `urlopen` swapped in
the glue: a DeepSeek check runs twice, the first pass collecting the requests the
converter wants made, the page making them, the second pass reading the answers.

`converter.json` pins the commit; the Pages build (`node scripts/fetch-converter.mjs`)
copies those files into `site/py/`. That needs authoring-assistant to be public.

## Theme

Brandon's "Confused4Now fonts and colours", v1 warm, with the portal's token names
(`--portal-*`): the site follows the system until the author uses the toggle, which
is kept in `localStorage` under `theme` and applied before first paint.

## Test

```bash
npm ci
npx playwright-core install chromium     # once; or PW_CHROMIUM_CHANNEL=chrome for the installed Chrome
CONVERTER_DIR=../authoring-assistant node scripts/fetch-converter.mjs   # site/py, for the questions
CONVERTER_DIR=../authoring-assistant npm test
PW_CHROMIUM_CHANNEL=chrome node test/screenshots.mjs /tmp/shots
```

The tests serve `site/` with `_headers`' CSP applied, stub every outside call as a
Playwright route, and fail on any console error or CSP violation.

## Deploy

Cloudflare Pages project **c4n-author-site** (account brandonproject2026; the name must be
exactly that, because `author-site.pages.dev` belongs to someone else), connected to
this repository: production branch `main`, build command
**`node scripts/fetch-converter.mjs`**, output directory **`site`**. Pushing to `main` deploys; a pull request gets a preview at
`<branch>.c4n-author-site.pages.dev`, where sign-in works too (the function accepts the
project's previews). Custom domain: `author.confused4now.org`.

The modules must reach browsers with `_headers`' `Cache-Control: no-cache`, because the
site has no build step to put versions in their names. The confused4now.org zone's
**Browser Cache TTL** (4 hours) overrides that for `.js` and `.css` on the custom
domain, so after a deploy a browser kept running the old modules, hard reload or not
(2 Oct 2026: PR #2's questions button missing for hours). The zone has a Cache Rule for
`author.confused4now.org`, Browser TTL **Respect origin**; CI's `production-headers`
job fails on main if that stops holding.

No analytics.

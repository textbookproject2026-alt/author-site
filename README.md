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
  _headers               Cloudflare Pages control file: the CSP
test/site.test.mjs       headless Chromium against test/stub.mjs
test/screenshots.mjs     every screen, light and dark, desktop and phone
```

## What it does, and where

| The author… | Screen | Server side |
|---|---|---|
| signs in with GitHub | sign-in | `github-auth` (the author site is a `github-auth` page in the registry's `platform.pages`) |
| sees their books | `#/` | `author-read?what=books`: the books whose registry `authors` include them |
| reads a chapter, downloads a copy | `#/<book>`, `#/<book>/chapter/<path>` | `author-read` tree and file; the drafts zip from GitHub |
| brings in a Word document | `#/<book>/import` | `author-import` (parts, start, status, again); book-requests' private `import-chapter` converts; `author-send` sends |
| answers readers' suggestions | `#/<book>/suggestion/<n>` | `author-act` suggestion-accept, -decline, -made |
| accepts or declines draft changes | `#/<book>/change/<n>` | `author-act` change-accept, -decline |
| sends the drafts to readers | `#/<book>/publish` | `author-act` publish-prepare, publish |
| sees the jobs and the drafts preview | `#/<book>/waiting` | none: public reads from the browser |

The endpoints are suggest-edit-function's `api/author-*.js` (its README, "The author
site"). They check, on every request, that the page is a registry platform page with
`author-api`, that the identity token was issued to this origin, and that the login
is in the book's `authors`. They act as the GitHub App, and every write names the
author. Nobody's GitHub token is kept, here or there.

To change a chapter's wording, an author uses **Edit this page** on the book's own
site; it arrives under *Waiting for you* as a draft change. (The link and glossary
questions arrive on this site next, running the converter's Python in the browser.)

## Theme

Brandon's "Confused4Now fonts and colours", v1 warm, with the portal's token names
(`--portal-*`): the site follows the system until the author uses the toggle, which
is kept in `localStorage` under `theme` and applied before first paint.

## Test

```bash
npm ci
npx playwright-core install chromium     # once; or PW_CHROMIUM_CHANNEL=chrome for the installed Chrome
npm test
PW_CHROMIUM_CHANNEL=chrome node test/screenshots.mjs /tmp/shots
```

The tests serve `site/` with `_headers`' CSP applied, stub every outside call as a
Playwright route, and fail on any console error or CSP violation.

## Deploy

Cloudflare Pages project **author-site** (account brandonproject2026), connected to
this repository: production branch `main`, **no build command**, output directory
**`site`**. Pushing to `main` deploys; a pull request gets a preview at
`<branch>.author-site.pages.dev`, where sign-in works too (the function accepts the
project's previews). Custom domain: `author.confused4now.org`.

No analytics.

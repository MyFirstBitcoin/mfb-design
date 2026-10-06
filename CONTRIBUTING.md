# Contributing to @myfirstbitcoin/design

This repository is the single source of the My First Bitcoin brand as code: the design tokens,
the build that turns them into the published package, the written brand specification, the
brand guard that projects run, and the check against the Brand Book in Figma. The Brand Book in
Figma is where the brand is decided; `tokens.json` mirrors it and is edited only to match it,
under the source rule below.

## The source rule

1. **Brand Book first.** Where the Brand Book in Figma (file `mFIc75UUSyftaqnNUQgjLX`, page
   `262:2`) defines a value, its value is the token, cited by node (`"source": "figma:<node>"`).
2. **Where the Brand Book is silent**, the value used on the live website, myfirstbitcoin.org,
   may become the token. The website was built following the Brand Book, so what it does where
   the book says nothing is the best evidence there is. Such a token is declared with its exact
   origin on the site's main branch: `"sourceKind": "declared"` and
   `"source": "myfirstbitcoin.org@<commit>:<file>:<line>"`, with the number of uses in its note.
   The website's CSS is public, so citing it is fine.
3. **Never a website value that contradicts the Brand Book**, however often the site uses it: a
   slant other than the book's angle, a highlighter other than the book's thin line, duotone
   photos, a font or a color outside the book, all-caps text, orange text on a light background.
   `brand-spec.md` lists the ones found so far under "Not imported from the website".
4. **Where the site has no single value** (several near-duplicates with no convention), no token
   is made until someone picks one.
5. **Quentin or Patrick decides** every brand change, as for any pull request here.

Every token carries `$extensions.mfb.sourceKind`, defined in `$verification` at the end of
`tokens.json`: `rendered-fill` or `rendered-text` (checked by the Figma check), `prose` (stated in
the Brand Book in words), `measured` (read off the Brand Book's vector geometry or a node's
rendered fill, with the node ids in the note), `declared` (not in the Brand Book: a website value
with its site source, or a value this package recommends, with `"source": "declared"` and the
reason in the note), or `unverified`. Color roles and shape tones are aliases of palette colors
(`{color.black}`), and the build refuses one that is not.

Propose every change by pull request. The conventions in [AGENTS.md](AGENTS.md) apply to all
contributions, by people and AI assistants alike.

## What is in the repository

| Path | What it is | Edit it by hand? |
|------|------------|------------------|
| `tokens.json` | The design tokens (published as is) | Yes, only to match the Brand Book |
| `package.json` | Name, version, exports and the `files` list (published) | Yes: the version is how a release happens |
| `src/supergraphics.canon.css` | The supergraphics canon, the origin of the published supergraphics (see below) | Yes, by pull request, with no added comment |
| `src/brand-spec.template.md` | The prose of the brand specification | Yes |
| `brand-check.mjs` | The brand guard projects run after their build (published) | Yes, with its test in `scripts/brand-check.test.mjs` |
| `scripts/` | Build, spec generator and checks | Yes |
| `README.md`, `brand.css`, `theme.css`, `tailwind.js`, `index.js`, `supergraphics.css` | Generated package files (published) | No: rebuild them |
| `brand-spec.md` | Generated brand specification (published, so consumers and their AI tools read the rules from `node_modules`) | No: regenerate it |

What consumers install is exactly the list in `package.json`'s `files`, plus `package.json`
itself: `README.md`, `brand-spec.md`, `brand-check.mjs`, `brand.css`, `index.js`,
`supergraphics.css`, `tailwind.js`, `theme.css` and `tokens.json`. Nothing else in this
repository reaches them.
`brand-spec.md` is there so that a consumer, and the AI tools working in its repository, read
the brand rules at `node_modules/@myfirstbitcoin/design/brand-spec.md`, at the version they pin.

`package.json` must never get `scripts` (including `prepare` or `postinstall`) or any kind of
dependencies. Consumers install this package as a git dependency, and npm runs a git
dependency's `prepare` script, after installing its dependencies, on every consumer install.
`scripts/check.mjs` fails if one appears.

## Making a change

The scripts need Node.js 22 and nothing else (there is no `npm install`). From the repository root:

```
node scripts/build-design-package.mjs   # rewrites the generated package files
node scripts/brand-spec.mjs             # rewrites brand-spec.md
node scripts/check.mjs                  # the rebuild check that GitHub Actions runs
```

Commit the source change and the regenerated files together. The build refuses to write
anything if the canon's geometry disagrees with `tokens.json`, if a geometry token is neither
gated against the canon nor listed as token-only, if a tokens.json group has no entry in its
`GROUP_MAP` (where each group is emitted), or if a new Tailwind key would equal a Tailwind 3 or 4
default. The spec generator refuses if a token it needs, or its source, is missing.

A new token group needs an entry in `GROUP_MAP` in `scripts/build-design-package.mjs`: its
Tailwind 4 namespace, its Tailwind 3 key and its `brand.css` prefix, or `null` where it is not
emitted. New Tailwind keys are `mfb-` prefixed, type levels or color roles
(`<element>-on-<surface>`), so that no release changes a utility a project already uses.

## Checks on every pull request

- **rebuild-check** (`scripts/check.mjs`): rebuilds into a temporary directory and fails if any
  committed output differs from a fresh build, if the build or the spec generator refuses, if
  `package.json` gains scripts or dependencies, or if `brand-check.mjs` misses a planted
  violation or reports a clean line (`scripts/brand-check.test.mjs`). It also runs on every push
  to `master`.
- **version-check**: if the pull request changes the version in `package.json`, the new version
  must be above the newest `v*` tag and must not already be tagged. If published files change
  without a version bump, it warns: merging would release nothing.

## Releases

A release happens only when a merged pull request raises the version in `package.json`. The
author proposes the version, and Quentin or Patrick accepts it when deciding on the pull request. On the
push to `master`, the `release` job creates the tag `vX.Y.Z` on that commit and a GitHub Release
with generated notes. It acts only on the push that raised the version, and checks again that
the version is above the newest `v*` tag. If the version is already tagged, it does nothing, so
merges without a version bump release nothing.

Tags never move and are never deleted. A wrong release is followed by a new one. Consumers pin a
tag, for example `"@myfirstbitcoin/design": "github:MyFirstBitcoin/mfb-design#v1.3.0"`, and see a
release only when they raise their pin.

## The brand-change loop

1. Patrick changes the Brand Book in Figma and tells Quentin, or the Monday check flags a
   difference between Figma and `tokens.json`, or a value the Brand Book is silent on is
   declared from the website under the source rule.
2. The admin session opens a pull request with the change to `tokens.json` and the rebuild.
3. Quentin or Patrick decides.
4. Merging a pull request that raises the version releases it.
5. The Monday digest line shows which projects are behind the newest tag.

## The Figma check

`scripts/verify-figma.mjs` reads the Brand Book page in Figma and checks that every color token
is present there as a rendered fill and every font size and weight token as a rendered text
style. It needs a read-only Figma token in `FIGMA_TOKEN`:

```
FIGMA_TOKEN=... node scripts/verify-figma.mjs [--json] [--summary] [--status FILE]
```

It is not run in GitHub Actions, and no Figma token is stored in this repository. The Monday
check runs it outside GitHub. `--status FILE` writes the full result as JSON for that job, and
`--summary` writes a short Markdown summary (to `$GITHUB_STEP_SUMMARY` when that is set).

## The brand guard

`brand-check.mjs` is published, and projects run it after their build
(`node node_modules/@myfirstbitcoin/design/brand-check.mjs`; the README says how). It needs
Node.js and nothing else, and reads every value it compares with from the `tokens.json` next to
it, so a token change reaches the guard without editing it. It generalises the guards that two
of My First Bitcoin's sites already ran. When you change a rule, add a planted line for it to
`scripts/brand-check.test.mjs` (and a clean line for anything it must not report);
`scripts/check.mjs` runs that test.

## The supergraphics canon

`src/supergraphics.canon.css` is the origin of the supergraphics primitives. It began as a
byte-for-byte copy of `supergraphics.css` in `@mfb/shared`, My First Bitcoin's internal shared
package, which keeps an identical copy. The build appends it unchanged to the published
`supergraphics.css`, after a prelude generated from `tokens.json`, and refuses to build when the
canon's geometry (`--sg-angle-base` and the other `--sg-*` values) disagrees with the tokens.

Keep it free of added comments: any byte added here changes the published file. Change the canon
here, by pull request; the internal copy is then brought into line, and a weekly check compares
the two.

The canon and `tokens.json` keep the punctuation they were published with, em-dashes included,
because rewording them changes published files. Such rewording belongs in a release pull request.
The README template (in `scripts/build-design-package.mjs`) was reworded in the v1.4.0 release
and follows the conventions in [AGENTS.md](AGENTS.md): new published prose carries no em-dash.

## Where the history lives

This repository's history starts with the first generated package, `v1.0.0`. The build, the
spec generator and the Figma check moved into it later, without their history. That earlier
history, and the history of `tokens.json` before it was published here, stays in My First
Bitcoin's private `brand-tokens` repository, which is kept and never deleted. It was
deliberately not imported into this public repository.

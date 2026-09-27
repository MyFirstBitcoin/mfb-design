# Contributing to @myfirstbitcoin/design

This repository is the single source of the My First Bitcoin brand as code: the design tokens,
the build that turns them into the published package, the written brand specification, and the
check against the Brand Book in Figma. The Brand Book in Figma is where the brand is decided;
`tokens.json` mirrors it and is edited only to match it.

Propose every change by pull request. The conventions in [AGENTS.md](AGENTS.md) apply to all
contributions, by people and AI assistants alike.

## What is in the repository

| Path | What it is | Edit it by hand? |
|------|------------|------------------|
| `tokens.json` | The design tokens (published as is) | Yes, only to match the Brand Book |
| `package.json` | Name, version, exports and the `files` list (published) | Yes: the version is how a release happens |
| `src/supergraphics.canon.css` | The supergraphics canon (see below) | Only together with its original |
| `src/brand-spec.template.md` | The prose of the brand specification | Yes |
| `scripts/` | Build, spec generator and checks | Yes |
| `README.md`, `brand.css`, `theme.css`, `tailwind.js`, `index.js`, `supergraphics.css` | Generated package files (published) | No: rebuild them |
| `brand-spec.md` | Generated brand specification (public, not part of the package) | No: regenerate it |

What consumers install is exactly the list in `package.json`'s `files`, plus `package.json`
itself: `README.md`, `brand.css`, `index.js`, `supergraphics.css`, `tailwind.js`, `theme.css`
and `tokens.json`. Nothing else in this repository reaches them.

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
anything if the canon's geometry disagrees with `tokens.json`, and the spec generator refuses if
a token it needs is missing.

## Checks on every pull request

- **rebuild-check** (`scripts/check.mjs`): rebuilds into a temporary directory and fails if any
  committed output differs from a fresh build, if the build or the spec generator refuses, or if
  `package.json` gains scripts or dependencies. It also runs on every push to `master`.
- **version-check**: if the pull request changes the version in `package.json`, the new version
  must be above the newest `v*` tag and must not already be tagged. If published files change
  without a version bump, it warns: merging would release nothing.

## Releases

A release happens only when a merged pull request raises the version in `package.json`. The
author proposes the version and whoever approves the pull request accepts it. On the push to
`master`, the `release` job creates the tag `vX.Y.Z` on that commit and a GitHub Release with
generated notes. If the version is already tagged, it does nothing, so merges without a version
bump release nothing.

Tags never move and are never deleted. A wrong release is followed by a new one. Consumers pin a
tag, for example `"@myfirstbitcoin/design": "github:MyFirstBitcoin/mfb-design#v1.3.0"`, and see a
release only when they raise their pin.

## The brand-change loop

1. Patrick changes the Brand Book in Figma and tells Quentin, or the Monday check flags a
   difference between Figma and `tokens.json`.
2. The admin session opens a pull request with the change to `tokens.json` and the rebuild.
3. Quentin decides.
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

## The supergraphics canon

`src/supergraphics.canon.css` is a byte-for-byte copy of `supergraphics.css` in `@mfb/shared`,
My First Bitcoin's internal shared package, where the supergraphics are maintained against the
Brand Book. The build appends it unchanged to the published `supergraphics.css`, after a prelude
generated from `tokens.json`, and refuses to build when the canon's geometry (`--sg-angle-base`
and the other `--sg-*` values) disagrees with the tokens.

Keep it a pure copy, with no added comment: any byte added here changes the published file. When
one copy changes, change the other in the same step; a weekly check compares the two.

The canon, `tokens.json` and the README template keep the punctuation they were published with,
em-dashes included, because rewording them changes published files. Such rewording belongs in a
release pull request.

## Where the history lives

This repository's history starts with the first generated package, `v1.0.0`. The build, the
spec generator and the Figma check moved into it later, without their history. That earlier
history, and the history of `tokens.json` before it was published here, stays in My First
Bitcoin's private `brand-tokens` repository, which is kept and never deleted. It was
deliberately not imported into this public repository.

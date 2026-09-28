---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQH7QK2XD73MF3VBJ06KSS
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKBPGRHT86HDDY1YS7WS
address: 1a2
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - shell
  - web
title: "The web shell: Sloppy in a browser"
created: 2026-09-28T00:44:42.611Z
updated: 2026-09-28T00:44:42.616Z
---

<!-- block 01M3JQH7QPFX3ZAGX4AWAN8BYQ -->

[apps/sloppy/web](code:apps/sloppy/web)

<!-- block 01M3JQH7QRWDV1HGF9ZAD9WP1N -->

## What it is

`@sloppy/web` is a SvelteKit single-page app, and deliberately little more than a boot. It hands the browser's capabilities to the shared app through the runtime seam and renders what `@sloppy/app-core` provides. A route added here almost always belongs in app-core instead.

## What it does beyond booting

- In dev it is the address Sloppy is used at (`localhost:8030`). It forwards `/api` and the syr discovery paths to the API, so the app and the API share an origin the way a deployment does.
- It serves the `.well-known` association files that let a link to a note on `sloppy.sh` open the native app.

[Its own README](code:apps/sloppy/web/README.md) covers running it on the host, where sign-in needs `PUBLIC_URL`.

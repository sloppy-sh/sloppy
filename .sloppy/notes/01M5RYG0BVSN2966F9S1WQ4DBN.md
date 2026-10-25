---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYG0BVSN2966F9S1WQ4DBN
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DTQZHW4Q1NHXM1VYPQ
address: 1d5
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - federation
  - media
  - privacy
title: "Every remote asset goes through the proxy, save one"
created: 2026-10-25T07:13:12.571Z
updated: 2026-10-25T07:13:12.572Z
---

<!-- block 01M5RYG0BW9VDP1076DQTMF303 -->

## What it is for

A picture from anywhere else reaches a reader through this instance, never straight from the author's host. The API mints every renderable address as a signed path, `/proxy?ref=…` ([asset-link.ts](code:apps/sloppy/api/src/media/asset-link.ts)); [proxied](code:packages/ts/client/src/host.ts#proxied) resolves that path against the host the shell reaches and sends anything absolute to the route unsigned, where it is refused rather than fetched. `GET /api/proxy` ([proxy.controller.ts](code:apps/sloppy/api/src/media/proxy.controller.ts)) fetches only what the signature names, only image types, checks every redirect hop in [remote-host.ts](code:apps/sloppy/api/src/media/remote-host.ts), caps the bytes that arrive and rations fetches per caller.

**The one exception** is an `https:` picture a person linked as the face of a graph kept on a device ([LinkedPictureSchema](code:packages/ts/types/src/media.ts#LinkedPictureSchema)): whoever opens that folder loads it from where it lives, and the profile page says so. A served graph refuses one ([linksAPicture](code:packages/ts/types/src/profile.ts#linksAPicture)).

## Why

AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store (required)": "Viewing a federated node must never leak the viewer's IP to the author's instance — a graph you can pull from strangers makes this more important, not less. A raw remote URL rendered into an `<img>` or a `fetch` is a privacy bug, not a shortcut." [docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "A graph on disk" gives its reason — "a graph on a device has no instance to fetch through", so it is a consequence the owner chooses — and § "Pictures" gives the refusal's: on a server a link "would be the instance pointing every reader at a machine the caller chose".

## Decided against

An origin chosen by the API for each address: § "Pictures" says it "would be a guess, and on a phone a wrong one", because an instance answers at several addresses.

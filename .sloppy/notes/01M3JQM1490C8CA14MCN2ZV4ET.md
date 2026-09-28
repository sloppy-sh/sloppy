---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM1490C8CA14MCN2ZV4ET
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQGKYNV7HMP3611A245MPN
address: 1b1
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - protocol
  - types
title: "types: the shared vocabulary"
created: 2026-09-28T00:46:14.153Z
updated: 2026-09-28T00:46:14.157Z
---

<!-- block 01M3JQM14BXWVK22MT1BW64MCV -->

[packages/ts/types](code:packages/ts/types)

<!-- block 01M3JQM14D62SGABW950S4A1XW -->

## What it is

`@sloppy/types` is the Zod schemas and TypeScript types every other package speaks. One file per concept, re-exported from [the barrel](code:packages/ts/types/src/index.ts).

## What it names

- **The graph itself**: [node](code:packages/ts/types/src/node.ts), [graph](code:packages/ts/types/src/graph.ts), [address](code:packages/ts/types/src/address.ts) (the Folgezettel rule), [edge](code:packages/ts/types/src/edge.ts), [appearance](code:packages/ts/types/src/appearance.ts).
- **A note's interior**: [block](code:packages/ts/types/src/block.ts), [document](code:packages/ts/types/src/document.ts) (the bound a stored editor document is checked against), [ink](code:packages/ts/types/src/ink.ts), [picture](code:packages/ts/types/src/picture.ts), [diagram](code:packages/ts/types/src/diagram.ts).
- **Writing together**: [amendment](code:packages/ts/types/src/amendment.ts) (a change offered to a note's owner), [permission](code:packages/ts/types/src/permission.ts), [authority](code:packages/ts/types/src/authority.ts).
- **Sharing**: [publication](code:packages/ts/types/src/publication.ts), [federation](code:packages/ts/types/src/federation.ts), [conversation](code:packages/ts/types/src/conversation.ts).
- **Identity and syr's wire**: [identity](code:packages/ts/types/src/identity.ts), [profile](code:packages/ts/types/src/profile.ts), [media](code:packages/ts/types/src/media.ts), [emoji](code:packages/ts/types/src/emoji.ts), [key-binding](code:packages/ts/types/src/key-binding.ts).
- **Notes beside code**: [code-anchor](code:packages/ts/types/src/code-anchor.ts), [draft](code:packages/ts/types/src/draft.ts), [chat](code:packages/ts/types/src/chat.ts).
- **The HTTP contract**: [api](code:packages/ts/types/src/api.ts), the request and response shapes the client and the server share.

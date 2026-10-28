---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYQS2XVZJARHBPQ1X62KR4
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DTQZHW4Q1NHXM1VYPQ
address: 1d8
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - identity
  - types
title: "A principal is compared; a did:syr is dereferenced"
created: 2026-10-25T07:17:27.261Z
updated: 2026-10-25T07:17:27.263Z
---

<!-- block 01M5RYQS2Y19VMNWP9Z407D2HE -->

## What it is for

A person Sloppy names is a **principal**, a URI whose scheme says how it is read: `did:syr:z…` or `mailto:…` ([PrincipalSchema](code:packages/ts/types/src/common.ts#PrincipalSchema), held to it in [principal.test.ts](code:packages/ts/types/src/principal.test.ts)). A third way of being named is a third arm of the union, never a second field. A `mailto:` is lowercased at the schema boundary and compared byte for byte after.

The line between the two widths, site by site, is one question: **does this value get compared, or does it get dereferenced?**

- **Wide, a principal** — what the genealogy and a graph's policy name: `created_by`, both halves of a ref, a note's `owner`, `authors` and `contributors`, a role's members, `Viewer.did`, a peer's `PublishedIndex`, `NodeSignedPayloadV2`.
- **Narrow**, a `did:syr` — what this build resolves, fetches from or derives a key from: syr's wire, everything in `@sloppy/idp`, `SessionRow`, a profile, an emoji catalog, a folder's own `VaultGraph.owner`.

A parameter follows what it is FOR, not what today's caller hands it. What a ref is made of is [A note is its ref, and nothing else names it](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYE18WJ2AV6KDMKAAA6WDX).

<!-- block 01M5RYQS2YR04P21H5MV7VW68N -->

## Why

[docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Narrow and wide, and which is which": dereferencing "is per-scheme and this build has one scheme's machinery", and blanket-renaming `DidSyr` "would have been the wrong answer". § "Who a person is" gives the lowercasing: an access list in which two spellings of one address are two people "is a way to be locked out of your own graph". AI.md § "Provider-Agnostic Data Shapes (required)" is why a scheme is an arm and not a field.

<!-- block 01M5RYQS2ZGAZA5ZSAXHYV8JHW -->

## Still open

`syrPostRefFor` hands a note's wide owner half to a slot that resolves it, so a note whose ref is owned by an email address has nowhere to hang a conversation. What will a comment on such a note be filed under?

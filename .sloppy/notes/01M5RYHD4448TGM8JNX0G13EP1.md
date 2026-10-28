---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYHD4448TGM8JNX0G13EP1
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYG0BVSN2966F9S1WQ4DBN
address: 1d5a
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - identity
  - profile
  - vault
title: "A graph on disk says whose it is, not only by DID"
created: 2026-10-25T07:13:58.404Z
updated: 2026-10-25T07:14:06.657Z
---

<!-- block 01M5RYHD458JRVFHJT1C800YVR -->

## What it is for

`graph.json` carries `owner_name`, `owner_bio`, `owner_avatar` and `owner_banner` beside the owner's DID ([layout.ts](code:packages/ts/vault/src/layout.ts#owner_name), tested in [layout.test.ts](code:packages/ts/vault/src/layout.test.ts)): what the person who keeps the graph is called, what they say about themselves, their picture and the one across the top of their profile. Each is optional, and absent is somebody who has not said. Signing in locally writes the name and picture from the profile into the graphs that identity owns, and never into a folder somebody else owns. Importing somebody else's graph leaves all of it behind with them; a person's own archive brings theirs back.

A picture is read by its scheme ([pictureNamed](code:packages/ts/vault/src/layout.ts#pictureNamed)): a path into the vault's own `media/`, which travels with the folder, or an `https:` link, which does not and is loaded from where it lives — the [one exception to the proxy](sloppy:did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYG0BVSN2966F9S1WQ4DBN). Anything else — a path that climbs out of the folder, a file elsewhere on the disk, another scheme — is dropped as it is read.

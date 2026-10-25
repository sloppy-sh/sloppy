---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RYDVRN7QNAP01DKRA41WJE
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M5RY52DTQZHW4Q1NHXM1VYPQ
address: 1d2
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - auth
  - identity
  - syr
title: "A platform holds a grant, never an identity"
created: 2026-10-25T07:12:02.325Z
updated: 2026-10-25T07:15:55.169Z
---

<!-- block 01M5RYDVRNNCE7E7JVQXKYYK81 -->

## What it is for

What Sloppy receives when somebody signs in, and what it may rely on. A person's root key lives on their own devices, carried as a Sigil and managed by Syner. The instance serving that identity holds an **agent** key under a **mandate**: a root-signed statement in the identity record naming the key, its **powers**, its expiry and what it may appoint beneath it. Sloppy holds one step further down, a **grant** that agent signs, short-lived, never published, with its mandate carried inline. So Sloppy verifies a chain — root → agent → Sloppy — instead of trusting whichever host served the token.

**What has landed is Platform Delegation v0.1, and the chain has not.** Today the exchange in [auth.service.ts](code:apps/sloppy/api/src/auth/auth.service.ts) yields `{ access_token, did, delegate_public_key, scopes }` (the shapes are [SyrPlatformTokenResponseSchema](code:packages/ts/types/src/syr.ts#SyrPlatformTokenResponseSchema)), and the delegation is signed by the person's root. No mandate type exists in Sloppy's code; [vouch.ts](code:packages/ts/types/src/vouch.ts#standingVouch) is written so the chain lands behind `Vouch.state` as a different reading rather than a change to every caller.

<!-- block 01M5RYMXWH8ZK5JD4N49HBQ4WC -->

## Why

AI.md § "Sloppy's Vocabulary Stays Out of the Identity Store (required)": "Sloppy is a platform, and a platform holds no identity." [docs/ARCHITECTURE.md](code:docs/ARCHITECTURE.md) § "Auth: Platform Delegation v0.1" sets out what verifying a grant will take — the mandate under the root, the grant under the agent, `delegate` among the powers, neither expired, the agent not dismissed, and the agent's status list or a freshness staple — and says: "This is a syr change, not a Sloppy one; nothing here moves until it lands." syr's `architecture/mandates` and `architecture/authority-model` are the specification.

<!-- block 01M5RYMXWJA02PGCWSAHE3GG68 -->

## Still open

When `scopes` become powers from a closed enum, which of today's five `SyrScope` values map to which power?

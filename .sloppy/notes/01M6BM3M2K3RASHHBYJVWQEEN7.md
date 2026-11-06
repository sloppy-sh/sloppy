---
ref: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M6BM3M2K3RASHHBYJVWQEEN7
parent: did:syr:z6MkofhdxKmE23ZUPQ65Lj7SynGSbLsL1ZNc81tgqQhg8h6X/01M3JQM3WWBG2TQ3Q7SMJXF12R
address: 1b6a
authors:
  - did:syr:z6Mkrpa9ZH9E38f4NpFZUCMEJX2rdGbf4vseijAqcBZHMdwk
tags:
  - graph
  - pictures
  - rendering
title: "A mark's picture is asked for openly, and never stops the graph"
created: 2026-11-01T13:17:15.220Z
updated: 2026-11-01T13:17:15.223Z
---

<!-- block 01M6BM3M2PR5PTH1B2HQR5K5C4 -->

## What it is for

A mark's picture is loaded by `markPicture` in [scene.ts](code:packages/ts/graph/src/scene.ts#L3020-L3060), which asks for it with `crossOrigin = "anonymous"` and then reads one pixel back before turning it into a texture. Two consequences a person can rely on: a picture on a mark always draws in the desktop app as it does in the browser, and a picture the canvas cannot read leaves that one mark bare while the rest of the graph keeps drawing. A moving picture shows its first frame on the mark and moves only where it is shown on its own.

<!-- block 01M6BM3M2Q39JCXZEN1XFDXBNK -->

## Why

The commit that made it so, `3a13e008`: "On the desktop a folder's pictures come from an origin of their own. An image loaded from there without crossOrigin taints the canvas it is cut onto, WebGL refuses to upload it, and the throw inside the frame stops the graph drawing: no labels, no zoom, no marks." It was found on 2026-11-01 when a picture set on a note in a project's graph left the desktop app's canvas frozen; the browser never showed it because it hands the canvas a same-origin address. [DESIGN.md](code:DESIGN.md) § "The mark" now says it in words: "one the canvas cannot draw leaves the mark as one with no picture — never a graph that stops drawing." The tests that hold it are in [scene.pictures.test.ts](code:packages/ts/graph/src/scene.pictures.test.ts): one where the host serves pictures from an origin of its own, and one where the page may not read the picture.

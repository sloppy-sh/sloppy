# @sloppy/local

The graph served off this device. `docs/ARCHITECTURE.md` § "Local-only mode" is the doc of
record — why there is no database, no sign-in and no server here; this file is only how a
caller wires it up.

Four pieces:

- **`Files`** is the shell's file access, rooted at one folder. The native shell answers it
  in `apps/sloppy/native/src/lib/files.ts`; `MemoryFiles` answers it in a test.
- **`openLocalIdentity(files)`** is the identity this device writes under, minted on first
  run with nothing in the way and kept in the app's own private data.
- **`LocalGraph`** is one vault opened: the index its notes, sections, addresses, aliases,
  pictures and emoji are read out of, kept in step with the folder on every write. Where
  the folder keeps what markdown has no syntax for is `@sloppy/vault`'s `layout.ts`; this
  package adds `.sloppy/bin/` for a deleted note's file, and `bin.json`, `media.json` and
  `emoji.json` beside it for what a file name does not say.
- **`LocalApi`** is `SloppyApi` over the three, so every page, store and component reaches
  a local graph through the same `api` they reach a hosted one through. One folder is one
  graph, and the folders this device keeps are listed in the app's own private data.

```ts
import { LocalApi, openLocalIdentity } from '@sloppy/local';
import { initRuntime } from '@sloppy/app-core';

initRuntime({
  apiHost: () => '',
  mode: () => 'local',
  createApi: () => new LocalApi(files),
  assetSrc: (src) => src
});
```

A method that calls `serverOnly` is one this can never answer — publishing, peers, pulls,
conversation, following, somebody else's identity and somebody else's emoji.

**A picture's bytes go where the ticket says.** `createUpload` answers a ticket whose
`upload_url` is `Files.url` of the file the picture will live at, and `completeUpload` says
the bytes are there; the same address is what `ownPicture` renders from. A shell serving
that address has to accept a write on it as well as a read.

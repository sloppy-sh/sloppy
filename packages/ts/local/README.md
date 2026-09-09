# @sloppy/local

The graph served off this device. `docs/ARCHITECTURE.md` § "Local-only mode" is the doc of
record — why there is no database, no sign-in and no server here; this file is only how a
caller wires it up.

Three pieces:

- **`Files`** is the shell's file access, rooted at one folder. The native shell answers it
  in `apps/sloppy/native/src/lib/files.ts`; `MemoryFiles` answers it in a test.
- **`openLocalIdentity(files)`** is the identity this device writes under, minted on first
  run with nothing in the way and kept in the app's own private data.
- **`LocalApi`** is `SloppyApi` over the two, so every page, store and component reaches a
  local graph through the same `api` they reach a hosted one through.

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
conversation, following, somebody else's identity. A method that calls `notImplemented` is
one the local track is still landing.

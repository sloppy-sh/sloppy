# @sloppy/web

Sloppy in a browser: a SvelteKit SPA, static-built, no SvelteKit server.
[`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) is the doc of record.

The shell's whole job is to bind the platform seam and get out of the way. It calls
`initRuntime()` from the root layout and leaves out what web does not have — no
`openExternal`, because consent navigates this tab; no `createApi`, because the graph
lives on a server. `runtime.ts` in `@sloppy/app-core` states what each absence decides.

**The API shares this app's origin.** `apiUrl` in `@sloppy/client` owns where under it
the API mounts, and the dev server proxies that prefix to the API on `SLOPPY_API_PORT`.
Set `PUBLIC_SLOPPY_API_URL` to point the app at somebody else's instance instead.

**`src/lib/screens/` is on loan.** Every screen belongs in `@sloppy/app-core`, so that
the native shell renders the same one rather than a second copy of it; they sit here
only until that package's page tree exists, and the routes already import them the way
they will import it.

```
pnpm --filter @sloppy/web dev      # needs the API and the dev stack up
pnpm --filter @sloppy/web build    # static site into build/
```

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

In dev that shared origin is this server, and the API has to be told so: it builds the
sign-in callback from `PUBLIC_URL`, and syr sends the person back to whatever that names.
Left at its default the callback names the API's own port, which is where sign-in ends —
on the API rather than back in the app.

The containerised stack (`pnpm dev`) sets both — `PUBLIC_URL` and, because `localhost` in
a container is not the API's host, `SLOPPY_API_ORIGIN` for the proxy above. Running the
processes here instead means saying the first one yourself:

```
PUBLIC_URL=http://localhost:8030 pnpm dev:host   # from the repo root, every dev server
pnpm --filter @sloppy/web build                  # static site into build/
```

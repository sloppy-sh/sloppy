# @sloppy/native

The Tauri shell. It boots the app and answers the questions a webview inside a native
process answers differently from a browser tab — where the API is, how a sign-in leaves and
comes back, what the system bars measure, and how it reaches the files a graph on this
device is kept in. Everything else is `@sloppy/app-core`, exactly as on the web.
docs/ARCHITECTURE.md § "Native shell" is the spec.

## Running it

```sh
pnpm tauri:dev        # desktop
pnpm ios:dev          # iOS / iPadOS simulator or device
pnpm android:dev      # Android emulator or device
pnpm dev              # just the frontend, in a browser, on :8040

SLOPPY_LOCAL_MODE=true pnpm ios:dev   # …opening a graph as a folder on the device
```

All of them go through [`scripts/tauri.sh`](scripts/tauri.sh), which keeps the Xcode
project patched.
**[XCODE_PROJECT.md](XCODE_PROJECT.md) is required reading before touching that project** —
`tauri ios init` regenerates it as an iPhone app with no URL scheme, every time.

`src-tauri/gen/` is committed, so a clone builds without generating anything. What a fresh
_machine_ still needs is the mobile Rust targets and the toolchain check, which is what
init is for:

```sh
pnpm tauri ios init
pnpm tauri android init
```

## What it reads

All from the monorepo-root `.env`; a shell variable of the same name wins.

| Variable                            | Default                                                    | What it decides                                                              |
| ----------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `PUBLIC_SLOPPY_API_URL`             | `http://localhost:8020`, `http://10.0.2.2:8020` on Android | The API's **origin**. `@sloppy/client` owns the path after it.               |
| `SLOPPY_LOCAL_MODE`                 | off                                                        | Open a graph as a folder on the device, with no API and no sign-in.          |
| `SLOPPY_DEV_TUNNEL` / `CF_TUNNEL_*` | off                                                        | Front the local API on the https origin a physical device needs to reach it. |

`PUBLIC_SLOPPY_API_URL` is the web shell's variable too — one origin, set once, obeyed by
both surfaces.

## Checking it

```sh
pnpm check                                       # svelte-check
pnpm test                                        # the shell's own units, and the crate's
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

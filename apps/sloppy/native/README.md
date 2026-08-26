# @sloppy/native

The Tauri shell. It boots the app and answers the questions a webview inside a native
process answers differently from a browser tab — where the API is, how a sign-in leaves and
comes back, what the system bars measure, whether an on-device graph engine is compiled in.
Everything else is `@sloppy/app-core`, exactly as on the web. docs/ARCHITECTURE.md
§ "Native shell" is the spec.

## Running it

```sh
pnpm tauri:dev        # desktop
pnpm ios:dev          # iOS / iPadOS simulator or device
pnpm android:dev      # Android emulator or device
pnpm dev              # just the frontend, in a browser, on :8040
```

All of them go through [`scripts/tauri.sh`](scripts/tauri.sh), which keeps the Xcode
project patched and local mode's two halves in step.
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

| Variable                            | Default                                                    | What it decides                                                             |
| ----------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `PUBLIC_SLOPPY_API_URL`             | `http://localhost:8020`, `http://10.0.2.2:8020` on Android | The API's **origin**. `@sloppy/client` owns the path after it.              |
| `SLOPPY_LOCAL_MODE`                 | on for `dev`, else off                                     | Compiles in the on-device graph engine, and tells the frontend it is there. |
| `SLOPPY_DEV_TUNNEL` / `CF_TUNNEL_*` | off                                                        | Raise a Cloudflare tunnel to the local API for a device on another network. |

`PUBLIC_SLOPPY_API_URL` is the web shell's variable too — one origin, set once, obeyed by
both surfaces.

## Checking it

```sh
pnpm check                                       # svelte-check
pnpm test                                        # the on-device engine's round trip
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --features local-mode -- -D warnings
```

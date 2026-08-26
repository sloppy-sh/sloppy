# The Xcode project is patched, and the patch has to survive regeneration

`tauri ios init` writes `src-tauri/gen/apple/project.yml` **from scratch**, every time
anyone runs it. Two things it cannot know about Sloppy therefore cannot be edits somebody
makes once — they are [`scripts/patch-xcode-project.mjs`](scripts/patch-xcode-project.mjs),
which `scripts/tauri.sh` runs for every `ios` command and immediately after `ios init`.

The script is idempotent, and it fails loudly if the generator's shape changes rather than
quietly patching nothing.

## 1. iPad is the primary device

| `project.yml`            | Generated | Sloppy needs |
| ------------------------ | --------- | ------------ |
| `LSRequiresIPhoneOS`     | `true`    | `false`      |
| `TARGETED_DEVICE_FAMILY` | _unset_   | `"1,2"`      |

With the generated values iPadOS runs the app in iPhone compatibility mode: a phone-sized
window on a 13-inch screen, letterboxed, with no multitasking and no external-keyboard
behaviour. Nothing errors — it just quietly ships the wrong app.

## 2. `sloppy://` has to reach the app

Signing in leaves for the system browser, because a webview cannot host somebody else's
sign-in page, and comes back as a `sloppy://` URL. Android takes the scheme from the
manifest the deep-link plugin generates; **iOS takes it from `CFBundleURLTypes`, which
nothing generates**. Without it the browser has nowhere to hand the URL, and sign-in on the
one platform this app is built for ends on a dead page.

The script reads the scheme from `tauri.conf.json`, so the two cannot drift, and writes it
into `project.yml` rather than into the plist — the plist is an _output_ of `project.yml`,
and the next `xcodegen generate` eats anything written straight into it.

## Running it by hand

Anything that regenerates or reads the project without going through `scripts/tauri.sh`:
`pnpm exec tauri ios init` invoked directly, `xcodegen generate` run by hand, or opening
`src-tauri/gen/apple/sloppy-native.xcodeproj` after a fresh init.

```sh
node scripts/patch-xcode-project.mjs
```

## Checking it took

```sh
APP=src-tauri/gen/apple
plutil -extract LSRequiresIPhoneOS raw $APP/sloppy-native_iOS/Info.plist   # → false
plutil -p $APP/sloppy-native_iOS/Info.plist | grep -A4 CFBundleURLTypes    # → sloppy
grep -c 'TARGETED_DEVICE_FAMILY = "1,2"' $APP/sloppy-native.xcodeproj/project.pbxproj  # → 2
```

## What is NOT patched: the deployment target

`iOS.minimumSystemVersion` is **16.0**, set in `src-tauri/tauri.conf.json` and carried into
`project.yml` as `deploymentTarget` by the generator itself. The Apple Pencil APIs that
make ink smooth rather than polygonal — `altitudeAngle`, `getCoalescedEvents()`,
`getPredictedEvents()` — arrived in Safari 18.2 and are feature-detected instead. Raising
the floor to 18.2 would trade every iPad that cannot update for a stroke that is merely
nicer; docs/ARCHITECTURE.md § "Native shell" carries the ruling.

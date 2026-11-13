# Sloppy in a headset

The notes a desk serves, read standing in them: a Godot 4.4 project in GDScript for
Meta Quest. docs/ARCHITECTURE.md § "A headset beside the desk" is what it speaks and
DESIGN.md § "The field in a room" is how it draws.

It is not a pnpm package, and nothing in the monorepo's scripts builds it.

## What it needs

- **Godot 4.4 or later**, the standard build (GDScript, no .NET). The project names 4.4;
  a later editor opens it and offers to convert it, which is fine for working on it.
- **The Godot OpenXR Vendors plugin, 4.3.1-stable** — the last release made for Godot
  4.4. It is fetched rather than kept here:

  ```sh
  ./tools/fetch-vendors.sh
  ```

  That puts it in `addons/godotopenxrvendors/`, which git ignores. A later editor wants a
  later plugin: 5.x is for Godot 4.6 and later.

- **The panels' theme packs**, fetched the same way and kept out of git; `themes/README.md`
  names each one, where it comes from and its licence:

  ```sh
  ./tools/fetch-themes.sh
  ```

- **The palette's glyphs**, fetched the same way and kept out of git; `icons/README.md`
  names them, where they come from and their licence:

  ```sh
  ./tools/fetch-icons.sh
  ```

- **Rust and the extension's libraries** — see "The extension" below.
- For a Quest: the Android export templates for the editor's version, an Android SDK and
  a JDK 17 as the editor's Android settings ask for, and the headset in developer mode.

## Opening it

Open `project.godot` in the editor. The first open writes `.godot/`, which git ignores,
and the default OpenXR action map, `openxr_action_map.tres`, which is the project's to
keep once a view binds a control in it. OpenXR is on for the Android export alone
(`xr/openxr/enabled.android`), so the main scene run on a computer starts flat with no
headset asked for, which is enough to work on a view: the mouse points, WASD walks, the arrow
keys turn and tilt the field, Tab turns the palette and M puts it away and up again, `[` and
`]` move the slider the mouse is on, and F held is B held: describe a note and let go to be
taken to it.

`Client`, `Views` and `Field` are autoloads; `Client` stands on `IrohLink`, which the extension
adds. Every view is `views/<name>.tscn` whose
root script has `func enter(args: Dictionary)`, and `Views.show(name, args)` puts one
in front.

## The extension

`IrohLink` — the headset's link to a desk — is Rust, in `rust/` (the crate `sloppy_iroh`, on
the `godot` crate and `iroh`), loaded by `sloppy_iroh.gdextension` from `bin/`, which git
ignores. It is built against Godot 4.4's API (the crate's `api-4-4`), the oldest editor the
project opens in, so the 4.7 editor this was built with loads it unchanged.

```sh
./rust/build.sh              # bin/libsloppy_iroh.dylib for the editor on an Apple-silicon Mac,
                             # and bin/libsloppy_iroh.so for a Quest
./rust/build.sh --mac-only   # the editor's alone
```

It needs the Rust targets `aarch64-apple-darwin` and `aarch64-linux-android`, and for Android
`cargo-ndk` (`cargo install cargo-ndk`) with an NDK: `ANDROID_NDK_HOME`, or the newest under
`~/Library/Android/sdk/ndk`. An editor opening the project for the first time loads the
extension once its libraries are in `bin/`.

On a Quest, hearing a desk by name needs Android's Wi-Fi multicast lock. `IrohLink` takes it
(`rust/src/multicast.rs`, through JNI) from when the headset starts looking for desks, or dials
one by its id, until a link to a desk is open, and lets it go then. A desk's ticket reaches it
without one.

## Reaching a desk

In Sloppy on a computer or tablet, turn on Serve to a headset in Settings. A desk on the same
network is found by name; enter the code it shows the first time, and the headset is let in
without one after. A desk somewhere else is reached by what it shows under Anywhere.

## Putting it on a Quest 3

1. Project → Install Android Build Template (the plugin needs the Gradle build).
2. Project → Export, choose **Quest**, and check the keystore the editor names for
   debug builds.
3. With the headset connected over USB and developer mode on, use the one-click deploy
   button in the editor's toolbar, or **Export Project** to `build/sloppy-quest.apk`
   and `adb install -r build/sloppy-quest.apk`.

The preset turns on the Meta loader, asks for the network permissions reaching a desk
needs, and asks for passthrough as optional. The project setting
`xr/openxr/extensions/meta/passthrough` is what turns the room's "My surroundings" on:
without it the package does not ask for passthrough and the headset stays dark.

## Tests

```sh
./tests/run.sh                                   # the macOS app's Godot
GODOT=/path/to/godot ./tests/run.sh              # any other
```

The runner builds the native shell's test desk (`examples/desk.rs` in
`apps/sloppy/native/src-tauri`, the desk app's own serving code answering from a canned project)
and starts two of them, opens the project once headless so the extension loads, and runs each
`tests/*_test.gd` headless with OpenXR off. `link_test` pairs with the first desk on the wrong code
and the right one, lists, reads the field and a mark's picture, is refused a write and comes
back by its key; `views_test` drives
the connect, projects and Sets views and the hand menu against the second, which nothing has
paired; both need the macOS library in `bin/`. A test passes only by printing `<name>: passed`; a
script error leaves Godot running, so the runner ends it and counts it failed.

Godot 4.7.2 crashes on quitting the first headless import of a project that loads a GDExtension
(this one loads two: `IrohLink` and the vendors plugin), after the import is written. The runner
imports again when the first fails, and fails itself only if the second does.

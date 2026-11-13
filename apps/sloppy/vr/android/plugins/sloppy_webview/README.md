# The web view plugin

Web pages drawn on panels in the headset's room: a Godot Android plugin (v2) of our own,
`SloppyWebView`, managing many pages by the id Godot gives each. `ui/web_panel.gd` is its one
user; docs/ARCHITECTURE.md § "A headset beside the desk" says what leaves the headset when a page
is opened.

```sh
./tools/build-webview.sh   # from apps/sloppy/vr: unit tests, then both libraries into
                           # addons/sloppy_webview/bin/, which git ignores
```

It needs a JDK 17 and the Android SDK with NDK 29; the Gradle here is pinned by its wrapper. The
editor plugin in `addons/sloppy_webview/` hands the library to the Quest export, which turns it on
with `sloppy_webview/enabled` in `export_presets.cfg`; the export warns when the library has not
been built.

## What Godot calls

| Method | |
| --- | --- |
| `create(id, width, height, path)` | a page `width` × `height` pixels; `path` is `"pixels"` or `"buffer"` |
| `destroy(id)`, `resize(id, width, height)` | |
| `load_url(id, url)`, `load_html(id, html, base_url)` | `base_url` is where the html's relative links read from |
| `evaluate(id, js)` | |
| `go_back(id) -> bool` | whether there was a page to go back to |
| `touch(id, x, y, phase)` | `phase` is `"down"`, `"move"` or `"up"`; pixels from the top left |
| `scroll(id, dx, dy)` | pixels the content moves, positive rightward and downward |
| `text(id, typed)` | typed into what has focus |
| `allow(request, yes)` | the answer to a `navigating` signal |

| Signal | |
| --- | --- |
| `page_loaded(id, url, title)` | |
| `navigating(id, request, url)` | the page wants to go to `url`; Godot answers `allow(request, yes)` while handling it |
| `message(id, json)` | the page called `window.sloppy.send(json)` |
| `failed(id, url, said)` | `said` is the engine's own words, for logs, never for a reader |
| `pixels(id, width, height, bytes)` | a frame, RGBA8, on the `pixels` path |
| `frame(id, buffer)` | a frame's `AHardwareBuffer*`, on the `buffer` path |

A page asks before going anywhere in its main frame. The UI thread waits up to 750 ms for the
answer; no answer keeps the page where it is. A frame inside a page may go to http(s), `about:`,
`data:` and `blob:` without asking.

`window.sloppy` is the plugin's JavaScript interface, present in every page a view loads, but only
a page of ours is heard: one under `file:///android_asset/`, or the html last given to
`load_html` at its `base_url`. A site a reader opens can call it and is ignored.

## How a page is drawn

Every page is off screen: a `WebView` in a `Presentation` on a private `VirtualDisplay`, never in
the Godot activity's views, at 240 dpi (1.5 device pixels to a CSS pixel). The display's frames
land in an `ImageReader`, which is told of a frame only when the page drew one, so nothing is sent
while a page stands still; at most 30 frames a second are sent, and the last change always is.

- **`pixels`** (the default): the reader's image is copied, row by row, into one RGBA8 byte array
  and sent with `pixels`; the panel puts it into an `ImageTexture` (`update` once the size is
  known). Everything here is ordinary Android and Godot API.
- **`buffer`** (unproven): the reader's image is kept open and its `HardwareBuffer` handed to Godot as the
  native `AHardwareBuffer*` (`src/main/jni/held_buffer.c` takes a reference on it), which the panel
  gives `ExternalTexture.set_external_buffer_id`. Each image stays open two frames after the next
  arrives, so Godot is never drawing from a buffer the display is writing into. Godot's
  documentation names `SurfaceTexture.getHardwareBuffer()` as the source; that method is not in the
  public SDK this builds against (34), so the buffer comes from `Image.getHardwareBuffer()`, which
  is.

**Neither path has been seen on a headset.** What has been seen, on an Android 16 emulator:

- `src/androidTest` drives a page on the emulator's own WebView with its network off: a page given as
  html draws into pixels; a page standing still sends no frames; a resized page draws at its new
  size and keeps its document; our page is heard and a site is not; a tap on a link asks where it
  goes and a refusal keeps the page; the stick's scroll moves the page the way it leans; the
  `buffer` path hands over a held buffer.
- A small Godot 4.7 app exported with the plugin found the singleton and drove `create`, `load_html`, `evaluate`, `touch`, `scroll`, `allow`, `go_back` and `destroy` from
  GDScript: frames reached an `ImageTexture` and were drawn by the Mobile renderer, a page's
  change redrew it and nothing else did, `touch` landed where it was sent, and `scroll` of 250
  pixels moved the page 250.
- The `buffer` path did not draw a page there. The Mobile renderer showed the WebView's first frame
  through the `ExternalTexture` and never a later one; the Compatibility renderer showed nothing.
  The emulator's GPU is not a Quest's, so this says little either way, but it is why `pixels` is
  the default: switch to `buffer` with `WebPanel.frames = "buffer"` only once a page is seen to
  change on the headset.

The instrumented tests install a test package on whichever device they are given; run them on an
emulator only, naming it:

```sh
ANDROID_SERIAL=emulator-5554 ./gradlew connectedDebugAndroidTest
```

## Threads

Godot's calls arrive on its main loop and are handed to the UI thread, which owns every `WebView`;
none of them waits for the UI thread, so the UI thread can wait for `allow`. Frames are read on a
thread of their own. Signals are queued to Godot's main loop.

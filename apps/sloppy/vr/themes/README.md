# The panels' theme packs

What the note and chat panels at the hand may be dressed in instead of the look, chosen on
the look panel's "Panels" row. They are fetched rather than kept here:

```sh
./tools/fetch-themes.sh
```

That puts each pack in its own folder below this one, with its licences beside it, and git
ignores all of it but this page. The export takes the folders and their licences with it.

| Pack | Folder | Upstream | Pinned commit | Licence |
| --- | --- | --- | --- | --- |
| Material light, Material dark | `material/` | [TonyXdZ/godot-4-material-theme](https://github.com/TonyXdZ/godot-4-material-theme) | `3e6e9f2f655c642d238cefbec14e592fdd17ac92` | MIT (`material/LICENSE`); Roboto, which the themes carry inside them, under Apache 2.0 (`material/fonts/LICENSE-Roboto.txt`) |
| Spacey | `spacey/` | [wadlo/Themey](https://github.com/wadlo/Themey) | `678c5574b3a9274437c0c1e0ac15395056b5fc5f` | MIT for the theme files (`spacey/LICENSE`), CC0 for its graphics (`spacey/IMAGES_LICENSE`); its faces, Nunito Sans and Share, under the SIL Open Font License (`spacey/font/*/OFL.txt`) |
| Clashy | `clashy/` | [wadlo/Themey](https://github.com/wadlo/Themey) | `678c5574b3a9274437c0c1e0ac15395056b5fc5f` | MIT for the theme files (`clashy/LICENSE`), CC0 for its graphics (`clashy/IMAGES_LICENSE`); its face, Acme, under the SIL Open Font License (`clashy/font/Acme/OFL.txt`, from [google/fonts](https://github.com/google/fonts) at `15c1dd4d2cc8cbd363e2fa68c1b461d5519b17d0`) |

The fetch renames each pack's own paths to where it stands here and leaves everything else as
upstream wrote it. `ui/theme.gd`'s `PACKS` names which of each pack's types a page's sheet,
title and quiet words take; the sizes and the room round things are the look's density's.

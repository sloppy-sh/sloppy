# The palette's glyphs

The small pictures on the left of each of the palette's rows. They are fetched rather than
kept here:

```sh
./tools/fetch-icons.sh
```

That puts each glyph below this folder as the SVG it is published as, with the licence beside
them, and git ignores all of it but this page. The export takes them and the licence with it.

| Upstream | Release | Licence |
| --- | --- | --- |
| [Lucide](https://lucide.dev) (`lucide-static` on npm) | `1.72.0` | ISC (`icons/LICENSE`) |

The glyphs, by the name `Pieces.glyph` takes: `arrow-left`, `blend`, `bookmark`,
`bookmark-minus`, `chevron-down`, `chevron-right`, `chevron-up`, `circle`, `eye`, `folder-open`,
`git-branch`, `hand`, `heading`, `image`, `layout-panel-top`, `link`, `log-out`, `message-square`,
`monitor`, `moon`, `network`, `palette`, `pen-line`, `plus`, `rows-3`, `sparkles`, `spline`,
`square`, `sun`, `sun-dim`, `telescope`, `type`, `undo-2`, `unfold-horizontal`, `unplug`,
`zoom-in`. A glyph not on this headset leaves its row's place for one empty.

# @sloppy/vault

A graph as files. `docs/ARCHITECTURE.md` § "A graph on disk" is the doc of record — the
layout, what a vault carries and what it does not, and the re-keying rule; this file is
only how a caller wires it up.

Nothing here talks to a store, a server or a browser. It is handed rows and hands back
files, so the API streaming an archive out and the native app reading a folder in run the
same code.

## Writing a graph out

```ts
import {
  emojiPath,
  graphFile,
  noteToVault,
  pack,
  picturesFile,
  PICTURES_FILE,
  GRAPH_FILE,
  VAULT_FORMAT,
  type Vault,
} from '@sloppy/vault';

const vault: Vault = new Map();
const pictures = new Map();
const emoji = new Map();
vault.set(GRAPH_FILE, graphFile({ format: VAULT_FORMAT, graph, name, owner }));

for (const note of notes) {
  const written = noteToVault(note, aliasesOf(note), blocksOf(note), { media, pictures, emoji });
  for (const [path, bytes] of written.files) vault.set(path, bytes);
  for (const [upload, size] of written.pictures) pictures.set(upload, size);
  for (const [shortcode, drawing] of written.emoji) emoji.set(shortcode, drawing);
}
vault.set(PICTURES_FILE, picturesFile(pictures));
for (const [shortcode, drawing] of emoji) {
  if (drawing.src) vault.set(emojiPath(shortcode, extension), await bytesOf(drawing.src));
}

const archive = pack(vault); // the `.sloppy` file
```

`media` maps an upload id to where its bytes are in the vault, so a picture's link
resolves in any markdown reader. An upload missing from it is linked by its id alone.

Threading `pictures` and `emoji` through every note is what keeps one upload drawn at two
sizes, or one shortcode drawn two ways, exact: the second use is written as its own JSON
where it disagrees with the first, and only this call can see both.

## Reading one in

```ts
import { manifest, unpack, rekey, noteUlids, vaultToNote } from '@sloppy/vault';

const says = manifest(archive); // whose it is, what it is called, how much of it
const arriving = rekey(unpack(archive), says.owner, viewer.did);
for (const ulid of noteUlids(arriving)) {
  const note = vaultToNote({ markdown: decodeText(arriving.get(notePath(ulid))!), ... });
}
```

`emoji` on the source is how each shortcode is to be drawn where the note is being read —
`.sloppy/emoji/` for a custom one, the character for a standard one — so a note comes back
carrying whatever the reader will actually draw it with.

Refusing an import that would land on a note the importer already holds — and allowing it
where the graph ulid is the same, which makes it a replace — is the caller's, over
`noteUlids`.

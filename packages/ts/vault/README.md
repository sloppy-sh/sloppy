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
const sizes = new Map();
vault.set(GRAPH_FILE, graphFile({ format: VAULT_FORMAT, graph, name, owner }));

for (const note of notes) {
  const { files, pictures } = noteToVault(note, aliasesOf(note), blocksOf(note), media);
  for (const [path, bytes] of files) vault.set(path, bytes);
  for (const [upload, size] of pictures) sizes.set(upload, size);
}
vault.set(PICTURES_FILE, picturesFile(sizes));

const archive = pack(vault); // the `.sloppy` file
```

`media` maps an upload id to where its bytes are in the vault, so a picture's link
resolves in any markdown reader. An upload missing from it is linked by its id alone.

## Reading one in

```ts
import { manifest, unpack, rekey, noteUlids, vaultToNote } from '@sloppy/vault';

const says = manifest(archive); // whose it is, what it is called, how much of it
const arriving = rekey(unpack(archive), says.owner, viewer.did);
for (const ulid of noteUlids(arriving)) {
  const note = vaultToNote({ markdown: decodeText(arriving.get(notePath(ulid))!), ... });
}
```

Refusing an import that would land on a note the importer already holds — and allowing it
where the graph ulid is the same, which makes it a replace — is the caller's, over
`noteUlids`.

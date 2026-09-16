// A device with folders on it, for the tests beside this file. Nothing here is
// shipped.

import type { BlockDocument, DidSyr } from "@sloppy/types";
import { ulid } from "@sloppy/types";
import { VAULT_FORMAT } from "@sloppy/vault";
import { LocalApi } from "./api.js";
import { type Files, MemoryFiles } from "./files.js";
import { LocalGraph } from "./graph.js";
import { openLocalIdentity } from "./identity.js";
import { NoteWriter } from "./notes.js";

/** Files whose folder picker answers a queue, so a test can start a second
 *  graph somewhere else. */
export class PickingFiles extends MemoryFiles {
  readonly picks: string[] = [];

  async pickFolder(): Promise<string | undefined> {
    return this.picks.shift();
  }
}

export interface Device {
  files: PickingFiles;
  api: LocalApi;
  /** Every file on the device, which is what a second client reads. */
  store: Map<string, Uint8Array>;
}

export function device(picks: readonly string[] = ["/graphs/one"]): Device {
  const store = new Map<string, Uint8Array>();
  const files = new PickingFiles({ store });
  files.picks.push(...picks);
  return { files, api: new LocalApi(files), store };
}

/** The same folders read by a second client: nothing of the first client's
 *  index survives, so what it answers is what the files say. */
export function reopened(held: Device): LocalApi {
  return new LocalApi(new PickingFiles({ store: held.store }));
}

/** One vault opened straight, for the acts a client has no route to. */
export async function graphOnly(
  files: Files = new MemoryFiles(),
  root = "/graphs/one",
): Promise<{ graph: LocalGraph; writer: NoteWriter; did: DidSyr }> {
  const identity = await openLocalIdentity(files);
  const graph = await LocalGraph.start(files.at(root), identity.did, {
    format: VAULT_FORMAT,
    graph: ulid(),
    name: "A graph",
    owner: identity.did,
  });
  return {
    graph,
    writer: new NoteWriter(graph, identity.did),
    did: identity.did,
  };
}

/** The same folder read again, so what a test asserts is what the files say. */
export function reread(
  files: Files,
  did: DidSyr,
  root = "/graphs/one",
): Promise<LocalGraph> {
  return LocalGraph.open(files.at(root), did);
}

/** Bytes as the body a surface hands the client — `slice()` so the blob holds a
 *  buffer of exactly these bytes. */
export function body(bytes: Uint8Array): Blob {
  return new Blob([bytes.slice().buffer as ArrayBuffer]);
}

export function textDocument(said: string): BlockDocument {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: said }] }],
  };
}
